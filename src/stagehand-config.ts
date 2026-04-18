import { createOpenAI } from '@ai-sdk/openai'
import { AISdkClient, Stagehand } from '@browserbasehq/stagehand'

export type StagehandOptions = ConstructorParameters<typeof Stagehand>[0]
type LlmPart = Pick<StagehandOptions, 'model' | 'llmClient'>

export const PLAYWRITER_CDP_HOST = '127.0.0.1:19988'

async function resolveLlm(): Promise<LlmPart> {
  const { LLM_PROVIDER, LLM_API_KEY, LLM_BASE_URL, LLM_MODEL, OPENAI_API_KEY, ANTHROPIC_API_KEY } =
    process.env

  if (LLM_PROVIDER === 'claude-agent-sdk') {
    const { ClaudeAgentSdkLanguageModel } = await import('./llm/claude-agent-sdk-adapter.ts')
    const model = new ClaudeAgentSdkLanguageModel({ modelId: LLM_MODEL })
    return { llmClient: new AISdkClient({ model }) }
  }

  if (LLM_API_KEY && LLM_BASE_URL && LLM_MODEL) {
    const provider = createOpenAI({
      apiKey: LLM_API_KEY,
      baseURL: LLM_BASE_URL,
    })
    const modelId = LLM_MODEL.replace(/^openai\//, '')
    return { llmClient: new AISdkClient({ model: provider.chat(modelId) }) }
  }

  if (OPENAI_API_KEY) {
    return { model: { modelName: 'openai/gpt-4o-mini', apiKey: OPENAI_API_KEY } }
  }

  if (ANTHROPIC_API_KEY) {
    return { model: { modelName: 'anthropic/claude-sonnet-4-5', apiKey: ANTHROPIC_API_KEY } }
  }

  throw new Error(
    'No LLM credentials found. Run `browser-cli config` to set up, or set one of:\n' +
      '  - LLM_PROVIDER=claude-agent-sdk (uses Claude Code subscription)\n' +
      '  - LLM_API_KEY + LLM_BASE_URL + LLM_MODEL (OpenAI-compatible gateway)\n' +
      '  - OPENAI_API_KEY\n' +
      '  - ANTHROPIC_API_KEY',
  )
}

export function makeClientId(): string {
  return `bc-${process.pid}-${Date.now().toString(36)}`
}

export async function makeStagehandConfig(cacheDir: string): Promise<StagehandOptions> {
  const clientId = makeClientId()
  return {
    env: 'LOCAL',
    localBrowserLaunchOptions: {
      cdpUrl: `ws://${PLAYWRITER_CDP_HOST}/cdp/${clientId}`,
    },
    selfHeal: true,
    cacheDir,
    disablePino: true,
    verbose: 0,
    ...(await resolveLlm()),
  }
}
