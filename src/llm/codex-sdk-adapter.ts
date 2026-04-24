import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2CallWarning,
  LanguageModelV2Content,
  LanguageModelV2FinishReason,
  LanguageModelV2Prompt,
  LanguageModelV2Usage,
} from '@ai-sdk/provider'

type CodexModule = typeof import('@openai/codex-sdk')
type CodexClass = CodexModule['Codex']
type CodexInstance = InstanceType<CodexClass>
type CodexThread = ReturnType<CodexInstance['startThread']>
type Turn = Awaited<ReturnType<CodexThread['run']>>

export interface CodexSdkModelOptions {
  modelId?: string
  baseUrl?: string
  apiKey?: string
  env?: Record<string, string>
}

// Adapter wrapping @openai/codex-sdk as a Vercel AI SDK LanguageModelV2. Mirrors
// the shape of ClaudeAgentSdkLanguageModel: lazy-loads the SDK, flattens the
// prompt, uses the SDK's one-shot `thread.run()` with `outputSchema` when a
// JSON response is requested. Auth errors from Codex (no ChatGPT login and no
// OPENAI_API_KEY) are wrapped with a `codex login` hint.
export class CodexSdkLanguageModel implements LanguageModelV2 {
  readonly specificationVersion = 'v2' as const
  readonly provider = 'codex-sdk'
  readonly modelId: string
  readonly supportedUrls: Record<string, RegExp[]> = {}

  private readonly baseUrl?: string
  private readonly apiKey?: string
  private readonly env?: Record<string, string>
  private codexInstance: CodexInstance | null = null

  constructor(opts: CodexSdkModelOptions = {}) {
    this.modelId = opts.modelId ?? 'codex-sdk-default'
    this.baseUrl = opts.baseUrl
    this.apiKey = opts.apiKey
    this.env = opts.env
  }

  async doGenerate(options: LanguageModelV2CallOptions) {
    const codex = await this.getCodex()
    const prompt = flattenPrompt(options.prompt)
    const warnings = collectWarnings(options)

    const thread = codex.startThread({
      skipGitRepoCheck: true,
      model: this.modelId === 'codex-sdk-default' ? undefined : this.modelId,
      sandboxMode: 'read-only',
      networkAccessEnabled: false,
      approvalPolicy: 'never',
    })

    const outputSchema =
      options.responseFormat?.type === 'json' && options.responseFormat.schema
        ? options.responseFormat.schema
        : undefined

    let turn: Turn
    try {
      turn = await thread.run(prompt, {
        outputSchema,
        signal: options.abortSignal,
      })
    } catch (err) {
      throw wrapCodexError(err)
    }

    const text = extractText(turn)
    const content: LanguageModelV2Content[] = [{ type: 'text', text }]

    const usage: LanguageModelV2Usage = {
      inputTokens: turn.usage?.input_tokens,
      outputTokens: turn.usage?.output_tokens,
      totalTokens:
        turn.usage != null ? turn.usage.input_tokens + turn.usage.output_tokens : undefined,
    }

    return {
      content,
      finishReason: 'stop' as LanguageModelV2FinishReason,
      usage,
      providerMetadata: {
        'codex-sdk': {
          threadId: thread.id ?? null,
          cachedInputTokens: turn.usage?.cached_input_tokens ?? null,
          itemCount: turn.items.length,
        },
      },
      warnings,
    }
  }

  doStream(_options: LanguageModelV2CallOptions) {
    const err = new Error(
      'codex-sdk adapter does not support streaming yet. Stagehand act()/extract() use non-streaming generation, so this usually is not called.',
    )
    const stream = new ReadableStream<never>({
      start(controller) {
        controller.error(err)
      },
    })
    return Promise.resolve({ stream })
  }

  private async getCodex(): Promise<CodexInstance> {
    if (this.codexInstance) return this.codexInstance
    const mod = (await import('@openai/codex-sdk')) as CodexModule
    const instance = new mod.Codex({
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      env: this.env,
    })
    this.codexInstance = instance
    return instance
  }
}

// Exported for unit testing of the pure helpers.
export const __test = {
  extractText,
  stripJsonFence,
  wrapCodexError,
  flattenPrompt,
}

function extractText(turn: Turn): string {
  if (typeof turn.finalResponse === 'string' && turn.finalResponse.length > 0) {
    return stripJsonFence(turn.finalResponse)
  }
  // Fallback: concatenate agent_message items if finalResponse is empty.
  const parts: string[] = []
  for (const item of turn.items) {
    if (item.type === 'agent_message' && typeof item.text === 'string') {
      parts.push(item.text)
    }
  }
  return stripJsonFence(parts.join('\n'))
}

function stripJsonFence(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('```')) return raw
  return trimmed
    .replace(/^\s*```(?:json)?\s*\n?/, '')
    .replace(/\n?```\s*$/, '')
    .trim()
}

function wrapCodexError(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err)
  const authSignal = /(?:not.*logged|unauthori[sz]ed|auth|401|api\s*key)/i.test(message)
  if (authSignal) {
    return new Error(
      `@openai/codex-sdk failed to authenticate (${message}). Run \`codex login\` or set OPENAI_API_KEY, then try again.`,
      { cause: err instanceof Error ? err : undefined },
    )
  }
  return err instanceof Error ? err : new Error(message)
}

function collectWarnings(options: LanguageModelV2CallOptions): LanguageModelV2CallWarning[] {
  const warnings: LanguageModelV2CallWarning[] = []
  if (options.tools?.length) {
    warnings.push({
      type: 'unsupported-setting',
      setting: 'tools',
      details: 'codex-sdk adapter does not forward upstream tool definitions.',
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
        parts.push(`[file omitted (${part.mediaType}); codex-sdk adapter is text-only]`)
      }
    }
  }
  return parts.join('\n\n')
}
