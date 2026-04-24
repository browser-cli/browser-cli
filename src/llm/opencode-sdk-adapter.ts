import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2CallWarning,
  LanguageModelV2Content,
  LanguageModelV2FinishReason,
  LanguageModelV2Prompt,
  LanguageModelV2Usage,
} from '@ai-sdk/provider'

type OpenCodeModule = typeof import('@opencode-ai/sdk')
type CreateOpencode = OpenCodeModule['createOpencode']
type OpencodeServer = Awaited<ReturnType<CreateOpencode>>

export interface OpenCodeSdkModelOptions {
  /** Model id in the form `providerID/modelID`, e.g. `anthropic/claude-sonnet-4-5`. */
  modelId?: string
  /** Optional host for the bundled server (defaults to 127.0.0.1). */
  hostname?: string
  /** Optional port; default lets opencode pick. */
  port?: number
}

// Adapter wrapping @opencode-ai/sdk as a Vercel AI SDK LanguageModelV2. The SDK
// starts a local opencode server (`createOpencode`) and exposes a REST client.
// This class starts the server lazily on the first doGenerate() call and
// reuses it across calls within the same process. The server is killed when
// `dispose()` is called or on process exit via a best-effort handler.
//
// OpenCode does not take a json_schema / outputSchema parameter the way Codex
// does; instead the caller is expected to have embedded "return JSON matching
// this schema" in the prompt text. This adapter still reads `responseFormat`
// for warnings and applies the same code-fence stripping that the Claude
// Agent SDK adapter does.
export class OpenCodeSdkLanguageModel implements LanguageModelV2 {
  readonly specificationVersion = 'v2' as const
  readonly provider = 'opencode-sdk'
  readonly modelId: string
  readonly supportedUrls: Record<string, RegExp[]> = {}

  private readonly hostname: string
  private readonly port?: number
  private readonly modelPair: { providerID: string; modelID: string } | null
  private serverPromise: Promise<OpencodeServer> | null = null
  private exitHandlerInstalled = false

  constructor(opts: OpenCodeSdkModelOptions = {}) {
    this.modelId = opts.modelId ?? 'opencode-sdk-default'
    this.hostname = opts.hostname ?? '127.0.0.1'
    this.port = opts.port
    this.modelPair = parseModelPair(opts.modelId)
  }

  async doGenerate(options: LanguageModelV2CallOptions) {
    const { client } = await this.getServer()
    const prompt = flattenPrompt(options.prompt)
    const warnings = collectWarnings(options)

    const sessionRes = await client.session.create({ body: {} })
    const sessionId = extractSessionId(sessionRes)
    if (!sessionId) throw new Error('opencode-sdk: session.create returned no session id')

    try {
      const promptRes = await client.session.prompt({
        path: { id: sessionId },
        body: {
          parts: [{ type: 'text', text: prompt }],
          model: this.modelPair ?? undefined,
        },
        signal: options.abortSignal,
      })

      const { text, tokens } = extractAssistantResponse(promptRes)

      const content: LanguageModelV2Content[] = [{ type: 'text', text }]
      const usage: LanguageModelV2Usage = {
        inputTokens: tokens?.input,
        outputTokens: tokens?.output,
        totalTokens:
          tokens?.input !== undefined && tokens?.output !== undefined
            ? tokens.input + tokens.output
            : undefined,
      }

      return {
        content,
        finishReason: 'stop' as LanguageModelV2FinishReason,
        usage,
        providerMetadata: {
          'opencode-sdk': {
            sessionId,
            providerID: this.modelPair?.providerID ?? null,
            modelID: this.modelPair?.modelID ?? null,
          },
        },
        warnings,
      }
    } catch (err) {
      throw wrapOpenCodeError(err)
    } finally {
      // Best-effort cleanup of the session.
      try {
        await client.session.delete({ path: { id: sessionId } })
      } catch {
        // ignore: orphan sessions are harmless and the server dies with the process.
      }
    }
  }

  doStream(_options: LanguageModelV2CallOptions) {
    const err = new Error(
      'opencode-sdk adapter does not support streaming yet. Stagehand act()/extract() use non-streaming generation, so this usually is not called.',
    )
    const stream = new ReadableStream<never>({
      start(controller) {
        controller.error(err)
      },
    })
    return Promise.resolve({ stream })
  }

  async dispose(): Promise<void> {
    if (!this.serverPromise) return
    try {
      const srv = await this.serverPromise
      srv.server.close()
    } catch {
      // ignore shutdown errors
    } finally {
      this.serverPromise = null
    }
  }

  private async getServer(): Promise<OpencodeServer> {
    if (!this.serverPromise) {
      this.serverPromise = (async () => {
        const mod = (await import('@opencode-ai/sdk')) as OpenCodeModule
        // Only pass defined keys — @opencode-ai/sdk uses Object.assign with
        // defaults, which an undefined value would overwrite (yielding
        // `--port=undefined` in argv).
        const opts: { hostname?: string; port?: number } = {}
        if (this.hostname) opts.hostname = this.hostname
        if (this.port !== undefined) opts.port = this.port
        const srv = await mod.createOpencode(opts)
        this.installExitHandler(srv)
        return srv
      })()
    }
    return this.serverPromise
  }

  private installExitHandler(srv: OpencodeServer): void {
    if (this.exitHandlerInstalled) return
    this.exitHandlerInstalled = true
    const handler = () => {
      try {
        srv.server.close()
      } catch {
        // ignore
      }
    }
    process.once('exit', handler)
    process.once('SIGINT', handler)
    process.once('SIGTERM', handler)
  }
}

// Exported for unit testing of the pure helpers.
export const __test = {
  parseModelPair,
  extractSessionId,
  extractAssistantResponse,
  wrapOpenCodeError,
  stripJsonFence,
  flattenPrompt,
}

function parseModelPair(modelId: string | undefined): { providerID: string; modelID: string } | null {
  if (!modelId) return null
  const idx = modelId.indexOf('/')
  if (idx <= 0 || idx === modelId.length - 1) return null
  return { providerID: modelId.slice(0, idx), modelID: modelId.slice(idx + 1) }
}

function extractSessionId(res: unknown): string | null {
  if (!res || typeof res !== 'object') return null
  const { data, error } = res as { data?: { id?: unknown }; error?: unknown }
  if (error) throw wrapOpenCodeError(error)
  const id = data?.id
  return typeof id === 'string' && id ? id : null
}

type AssistantErrorShape = {
  name?: string
  data?: { message?: string; providerID?: string; statusCode?: number }
}
type PromptResponseShape = {
  data?: {
    info?: {
      error?: AssistantErrorShape | string
      tokens?: { input?: number; output?: number }
      providerID?: string
      modelID?: string
    }
    parts?: Array<{ type?: string; text?: string }>
  }
  error?: unknown
}

function extractAssistantResponse(
  res: unknown,
): { text: string; tokens?: { input: number; output: number } } {
  if (!res || typeof res !== 'object') {
    throw new Error('opencode-sdk: session.prompt returned no response object')
  }
  const typed = res as PromptResponseShape
  if (typed.error) throw wrapOpenCodeError(typed.error)

  const info = typed.data?.info
  if (info?.error) {
    throw wrapOpenCodeError(new Error(formatAssistantError(info.error, info.providerID, info.modelID)))
  }

  const parts = typed.data?.parts ?? []
  const textParts: string[] = []
  for (const p of parts) {
    if (p?.type === 'text' && typeof p.text === 'string') textParts.push(p.text)
  }
  const text = stripJsonFence(textParts.join('\n'))

  const tokens =
    info?.tokens && typeof info.tokens.input === 'number' && typeof info.tokens.output === 'number'
      ? { input: info.tokens.input, output: info.tokens.output }
      : undefined

  return { text, tokens }
}

function formatAssistantError(err: AssistantErrorShape | string, providerID?: string, modelID?: string): string {
  if (typeof err === 'string') return err
  const name = err.name ?? 'UnknownError'
  const msg = err.data?.message ?? JSON.stringify(err)
  const ctx = [
    err.data?.providerID ?? providerID,
    modelID,
    err.data?.statusCode != null ? `status=${err.data.statusCode}` : undefined,
  ]
    .filter(Boolean)
    .join(' ')
  return ctx ? `${name} (${ctx}): ${msg}` : `${name}: ${msg}`
}

function stripJsonFence(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('```')) return raw
  return trimmed
    .replace(/^\s*```(?:json)?\s*\n?/, '')
    .replace(/\n?```\s*$/, '')
    .trim()
}

const WRAPPED_MARK = '__opencodeSdkWrapped'

function wrapOpenCodeError(err: unknown): Error {
  // Avoid double-wrapping when the same error bubbles through multiple layers.
  if (err instanceof Error && (err as Error & { [WRAPPED_MARK]?: boolean })[WRAPPED_MARK]) {
    return err
  }

  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err)

  // "401" / "403" alone is ambiguous (could be billing, rate limit, real auth),
  // so we only suggest `opencode auth login` when the signal is unambiguous:
  // - ProviderAuthError from opencode's own type system
  // - strings that are specifically about credentials, not status codes
  const authSignal =
    /ProviderAuthError/.test(message) ||
    /\bunauthori[sz]ed\b/i.test(message) ||
    /\bnot\s+(?:authenticated|logged[-\s]?in)\b/i.test(message) ||
    /\b(?:invalid|missing|no)\s+(?:api[-\s]?key|credentials?|token)\b/i.test(message) ||
    /\bno\s+provider\b/i.test(message) ||
    /\blogin\s+required\b/i.test(message)

  const wrapped = authSignal
    ? new Error(
        `@opencode-ai/sdk failed (${message}). Run \`opencode auth login\` to sign in, or make sure ~/.config/opencode/opencode.json has a valid provider.`,
        { cause: err instanceof Error ? err : undefined },
      )
    : err instanceof Error
      ? err
      : new Error(message)

  Object.defineProperty(wrapped, WRAPPED_MARK, { value: true, enumerable: false })
  return wrapped
}

function collectWarnings(options: LanguageModelV2CallOptions): LanguageModelV2CallWarning[] {
  const warnings: LanguageModelV2CallWarning[] = []
  if (options.tools?.length) {
    warnings.push({
      type: 'unsupported-setting',
      setting: 'tools',
      details: 'opencode-sdk adapter does not forward upstream tool definitions.',
    })
  }
  if (options.responseFormat?.type === 'json') {
    warnings.push({
      type: 'other',
      message:
        'opencode-sdk has no json_schema parameter; callers should request JSON in the prompt text and validate upstream.',
    })
  }
  for (const key of [
    'temperature',
    'topP',
    'topK',
    'maxOutputTokens',
    'seed',
    'frequencyPenalty',
    'presencePenalty',
  ] as const) {
    if (options[key] !== undefined) {
      warnings.push({ type: 'unsupported-setting', setting: key })
    }
  }
  return warnings
}

function flattenPrompt(prompt: LanguageModelV2Prompt): string {
  const parts: string[] = []
  for (const msg of prompt) {
    if (msg.role === 'system') {
      parts.push(msg.content)
      continue
    }
    if (msg.role === 'tool') continue
    for (const part of msg.content) {
      if (part.type === 'text') parts.push(part.text)
      else if (part.type === 'file') {
        parts.push(`[file omitted (${part.mediaType}); opencode-sdk adapter is text-only]`)
      }
    }
  }
  return parts.join('\n\n')
}
