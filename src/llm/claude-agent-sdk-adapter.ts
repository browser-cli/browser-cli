import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2CallWarning,
  LanguageModelV2Content,
  LanguageModelV2FinishReason,
  LanguageModelV2Prompt,
  LanguageModelV2Usage,
} from '@ai-sdk/provider'

// Dynamic type for the lazy-loaded SDK entry.
type QueryFn = (input: { prompt: string; options?: Record<string, unknown> }) => AsyncIterable<unknown>

export interface ClaudeAgentSdkModelOptions {
  modelId?: string
  maxTurns?: number
}

// Adapter wrapping @anthropic-ai/claude-agent-sdk's `query()` as a Vercel AI
// SDK LanguageModelV2 so Stagehand's AISdkClient can consume it.
//
// POC findings (bench/cas-poc.ts, 2026-04-18) baked into defaults:
// - `allowedTools: []` collapses the agent so it doesn't try to call tools.
// - `settingSources: []` skips the user's ~/.claude hooks (saves ~4s / call).
// - `maxTurns: 2` because some prompts need a plan turn then an emit turn;
//   `maxTurns: 1` causes `error_max_turns` on flatter act-style schemas.
// - `structured_output` is populated unreliably for nested schemas; when
//   undefined we fall back to stripping ```json fences from the `result`
//   string and JSON.parse'ing that. Zod validation happens upstream in
//   Stagehand's AISdkClient.
// - Streaming is not implemented — Stagehand's act()/extract() use
//   generateText-style calls that go through doGenerate.
export class ClaudeAgentSdkLanguageModel implements LanguageModelV2 {
  readonly specificationVersion = 'v2' as const
  readonly provider = 'claude-agent-sdk'
  readonly modelId: string
  readonly supportedUrls: Record<string, RegExp[]> = {}

  private readonly maxTurns: number
  private queryFn: QueryFn | null = null

  constructor(opts: ClaudeAgentSdkModelOptions = {}) {
    this.modelId = opts.modelId ?? 'claude-agent-sdk-default'
    this.maxTurns = opts.maxTurns ?? 2
  }

  async doGenerate(options: LanguageModelV2CallOptions) {
    const query = await this.getQuery()
    const prompt = flattenPrompt(options.prompt)
    const warnings = collectWarnings(options)

    const queryOptions: Record<string, unknown> = {
      allowedTools: [],
      maxTurns: this.maxTurns,
      settingSources: [],
    }
    if (options.responseFormat?.type === 'json' && options.responseFormat.schema) {
      queryOptions.outputFormat = {
        type: 'json_schema',
        schema: options.responseFormat.schema,
      }
    }

    let result: Record<string, unknown> | null = null
    for await (const msg of query({ prompt, options: queryOptions })) {
      if (options.abortSignal?.aborted) {
        throw new DOMException('Aborted', 'AbortError')
      }
      if ((msg as { type?: string }).type === 'result') {
        result = msg as Record<string, unknown>
        break
      }
    }
    if (!result) {
      throw new Error('claude-agent-sdk returned no result message (query exhausted without a terminal message).')
    }

    const subtype = String(result.subtype ?? 'unknown')
    if (subtype !== 'success') {
      const errs = Array.isArray(result.errors) ? (result.errors as unknown[]).join('; ') : ''
      throw new Error(`claude-agent-sdk finished with ${subtype}${errs ? `: ${errs}` : ''}`)
    }

    const payload = extractPayload(result)
    const content: LanguageModelV2Content[] = [{ type: 'text', text: payload }]

    const sdkUsage = (result.usage ?? {}) as Record<string, unknown>
    const inputTokens = asNumber(sdkUsage.input_tokens)
    const outputTokens = asNumber(sdkUsage.output_tokens)
    const usage: LanguageModelV2Usage = {
      inputTokens,
      outputTokens,
      totalTokens:
        inputTokens !== undefined && outputTokens !== undefined ? inputTokens + outputTokens : undefined,
    }

    return {
      content,
      finishReason: 'stop' as LanguageModelV2FinishReason,
      usage,
      providerMetadata: {
        'claude-agent-sdk': {
          subtype,
          numTurns: asNumber(result.num_turns) ?? null,
          durationMs: asNumber(result.duration_ms) ?? null,
          durationApiMs: asNumber(result.duration_api_ms) ?? null,
          totalCostUsd: asNumber(result.total_cost_usd) ?? null,
          sessionId: typeof result.session_id === 'string' ? result.session_id : null,
        },
      },
      warnings,
    }
  }

  doStream(_options: LanguageModelV2CallOptions) {
    const err = new Error(
      'claude-agent-sdk adapter does not support streaming yet. Stagehand act()/extract() use non-streaming generation, so this usually is not called.',
    )
    const stream = new ReadableStream<never>({
      start(controller) {
        controller.error(err)
      },
    })
    return Promise.resolve({ stream })
  }

  private async getQuery(): Promise<QueryFn> {
    if (this.queryFn) return this.queryFn
    try {
      const mod = (await import('@anthropic-ai/claude-agent-sdk')) as { query: QueryFn }
      this.queryFn = mod.query
      return mod.query
    } catch (err) {
      throw new Error(
        '@anthropic-ai/claude-agent-sdk is not installed. Run `npm i @anthropic-ai/claude-agent-sdk`, make sure `claude` is authenticated (run `claude` once), or switch LLM_PROVIDER.',
        { cause: err instanceof Error ? err : undefined },
      )
    }
  }
}

function collectWarnings(options: LanguageModelV2CallOptions): LanguageModelV2CallWarning[] {
  const warnings: LanguageModelV2CallWarning[] = []
  if (options.tools?.length) {
    warnings.push({
      type: 'unsupported-setting',
      setting: 'tools',
      details: 'claude-agent-sdk adapter forces allowedTools=[]; upstream tools are ignored.',
    })
  }
  for (const key of ['temperature', 'topP', 'topK', 'maxOutputTokens', 'seed', 'frequencyPenalty', 'presencePenalty'] as const) {
    if (options[key] !== undefined) {
      warnings.push({ type: 'unsupported-setting', setting: key })
    }
  }
  return warnings
}

function extractPayload(result: Record<string, unknown>): string {
  if (result.structured_output !== undefined) {
    return JSON.stringify(result.structured_output)
  }
  const raw = typeof result.result === 'string' ? result.result : ''
  const stripped = raw
    .replace(/^\s*```(?:json)?\s*\n?/, '')
    .replace(/\n?```\s*$/, '')
    .trim()
  try {
    const parsed = JSON.parse(stripped)
    return JSON.stringify(parsed)
  } catch {
    return raw
  }
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
        parts.push(`[file omitted (${part.mediaType}); claude-agent-sdk adapter is text-only]`)
      }
    }
  }
  return parts.join('\n\n')
}

function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}
