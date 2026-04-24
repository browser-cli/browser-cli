import { randomUUID } from 'node:crypto'
import type { LanguageModelV2 } from '@ai-sdk/provider'
import { createOpenAI } from '@ai-sdk/openai'
import { AISdkClient, Stagehand } from '@browserbasehq/stagehand'

export type StagehandOptions = ConstructorParameters<typeof Stagehand>[0]
type LlmPart = Pick<StagehandOptions, 'model' | 'llmClient'>

export const PLAYWRITER_CDP_HOST = '127.0.0.1:19988'

/**
 * Build a Vercel AI SDK `LanguageModelV2` from env vars when the active
 * provider uses the custom adapter path (claude-agent-sdk / codex / opencode /
 * OpenAI-compatible gateway). Returns null when the active provider delegates
 * to Stagehand's built-in adapters (OPENAI_API_KEY / ANTHROPIC_API_KEY), where
 * no LanguageModelV2 instance is available.
 *
 * `extract-from-json` depends on this so its self-heal layer shares the same
 * backend as Stagehand's DOM self-heal instead of being locked to Claude.
 */
export async function resolveLanguageModel(): Promise<LanguageModelV2 | null> {
  const { LLM_PROVIDER, LLM_API_KEY, LLM_BASE_URL, LLM_MODEL } = process.env

  if (LLM_PROVIDER === 'claude-agent-sdk') {
    const { ClaudeAgentSdkLanguageModel } = await import('./llm/claude-agent-sdk-adapter.ts')
    const maxTurns = process.env.LLM_MAX_TURNS ? parseInt(process.env.LLM_MAX_TURNS, 10) : undefined
    return new ClaudeAgentSdkLanguageModel({ modelId: LLM_MODEL, maxTurns })
  }

  if (LLM_PROVIDER === 'codex') {
    const { CodexSdkLanguageModel } = await import('./llm/codex-sdk-adapter.ts')
    return new CodexSdkLanguageModel({ modelId: LLM_MODEL })
  }

  if (LLM_PROVIDER === 'opencode') {
    const { OpenCodeSdkLanguageModel } = await import('./llm/opencode-sdk-adapter.ts')
    return new OpenCodeSdkLanguageModel({ modelId: LLM_MODEL })
  }

  if (LLM_API_KEY && LLM_BASE_URL && LLM_MODEL) {
    const provider = createOpenAI({ apiKey: LLM_API_KEY, baseURL: LLM_BASE_URL })
    const modelId = LLM_MODEL.replace(/^openai\//, '')
    return provider.chat(modelId)
  }

  return null
}

async function resolveLlm(): Promise<LlmPart> {
  const model = await resolveLanguageModel()
  if (model) return { llmClient: new AISdkClient({ model }) }

  const { OPENAI_API_KEY, ANTHROPIC_API_KEY } = process.env
  if (OPENAI_API_KEY) {
    return { model: { modelName: 'openai/gpt-4o-mini', apiKey: OPENAI_API_KEY } }
  }
  if (ANTHROPIC_API_KEY) {
    return { model: { modelName: 'anthropic/claude-sonnet-4-5', apiKey: ANTHROPIC_API_KEY } }
  }

  throw new Error(
    'No LLM credentials found. Run `browser-cli config` to set up, or set one of:\n' +
      '  - LLM_PROVIDER=claude-agent-sdk (uses Claude Code subscription)\n' +
      '  - LLM_PROVIDER=codex (uses Codex CLI login / OPENAI_API_KEY)\n' +
      '  - LLM_PROVIDER=opencode (uses ~/.config/opencode/opencode.json)\n' +
      '  - LLM_API_KEY + LLM_BASE_URL + LLM_MODEL (OpenAI-compatible gateway)\n' +
      '  - OPENAI_API_KEY\n' +
      '  - ANTHROPIC_API_KEY',
  )
}

export function makeClientId(): string {
  return `bc-${process.pid}-${randomUUID()}`
}

export type CdpResolution = { cdpUrl: string; isCustom: boolean }

const ALLOWED_CDP_SCHEMES = ['ws:', 'wss:', 'http:', 'https:']

export function resolveCdpUrl(override?: string): CdpResolution {
  const raw = (override ?? process.env.BROWSER_CLI_CDP_URL)?.trim()
  if (raw) {
    let parsed: URL
    try {
      parsed = new URL(raw)
    } catch {
      throw new Error(`Invalid --cdp-url: "${raw}" is not a valid URL.`)
    }
    if (!ALLOWED_CDP_SCHEMES.includes(parsed.protocol)) {
      throw new Error(
        `Invalid --cdp-url scheme "${parsed.protocol}". Use ws://, wss://, http://, or https://.`,
      )
    }
    return { cdpUrl: raw, isCustom: true }
  }
  return { cdpUrl: `ws://${PLAYWRITER_CDP_HOST}/cdp/${makeClientId()}`, isCustom: false }
}

export async function makeStagehandConfig(
  cacheDir: string,
  options: { cdpUrl?: string } = {},
): Promise<StagehandOptions> {
  const { cdpUrl } = resolveCdpUrl(options.cdpUrl)
  return {
    env: 'LOCAL',
    localBrowserLaunchOptions: { cdpUrl },
    selfHeal: true,
    cacheDir,
    disablePino: true,
    verbose: 0,
    ...(await resolveLlm()),
  }
}
