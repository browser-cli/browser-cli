import { test } from 'node:test'
import assert from 'node:assert/strict'
import './helpers.ts'

test('makeClientId: unique across concurrent calls in the same tick', async () => {
  const { makeClientId } = await import('../src/stagehand-config.ts')
  // Reproduce the original bug: before the fix, Promise.all over makeClientId
  // produced duplicates because Date.now() returns the same ms for concurrent
  // calls, which caused CDP "Duplicate Playwright clientId" at the daemon level.
  const ids = await Promise.all(Array.from({ length: 1000 }, async () => makeClientId()))
  const unique = new Set(ids)
  assert.equal(unique.size, ids.length, `expected ${ids.length} unique ids, got ${unique.size}`)
})

test('makeClientId: unique across a tight synchronous loop', async () => {
  const { makeClientId } = await import('../src/stagehand-config.ts')
  const ids = Array.from({ length: 10_000 }, () => makeClientId())
  const unique = new Set(ids)
  assert.equal(unique.size, ids.length)
})

test('makeClientId: preserves bc-<pid>- prefix', async () => {
  const { makeClientId } = await import('../src/stagehand-config.ts')
  const id = makeClientId()
  assert.match(id, new RegExp(`^bc-${process.pid}-`))
})

// ---------------------------------------------------------------------------
// resolveLanguageModel() provider branches
// ---------------------------------------------------------------------------

async function withEnv<T>(patch: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const prev: Record<string, string | undefined> = {}
  for (const k of Object.keys(patch)) {
    prev[k] = process.env[k]
    if (patch[k] === undefined) delete process.env[k]
    else process.env[k] = patch[k]!
  }
  try {
    return await fn()
  } finally {
    for (const k of Object.keys(prev)) {
      if (prev[k] === undefined) delete process.env[k]
      else process.env[k] = prev[k]
    }
  }
}

test('resolveLanguageModel: LLM_PROVIDER=claude-agent-sdk returns Claude adapter', async () => {
  const { resolveLanguageModel } = await import('../src/stagehand-config.ts')
  const { ClaudeAgentSdkLanguageModel } = await import('../src/llm/claude-agent-sdk-adapter.ts')
  await withEnv({ LLM_PROVIDER: 'claude-agent-sdk', LLM_MODEL: undefined }, async () => {
    const model = await resolveLanguageModel()
    assert.ok(model instanceof ClaudeAgentSdkLanguageModel)
  })
})

test('resolveLanguageModel: LLM_PROVIDER=codex returns Codex adapter', async () => {
  const { resolveLanguageModel } = await import('../src/stagehand-config.ts')
  const { CodexSdkLanguageModel } = await import('../src/llm/codex-sdk-adapter.ts')
  await withEnv({ LLM_PROVIDER: 'codex', LLM_MODEL: undefined }, async () => {
    const model = await resolveLanguageModel()
    assert.ok(model instanceof CodexSdkLanguageModel)
    assert.equal(model?.provider, 'codex-sdk')
  })
})

test('resolveLanguageModel: LLM_PROVIDER=opencode returns OpenCode adapter', async () => {
  const { resolveLanguageModel } = await import('../src/stagehand-config.ts')
  const { OpenCodeSdkLanguageModel } = await import('../src/llm/opencode-sdk-adapter.ts')
  await withEnv({ LLM_PROVIDER: 'opencode', LLM_MODEL: 'anthropic/claude-sonnet-4-5' }, async () => {
    const model = await resolveLanguageModel()
    assert.ok(model instanceof OpenCodeSdkLanguageModel)
    assert.equal(model?.modelId, 'anthropic/claude-sonnet-4-5')
    assert.equal(model?.provider, 'opencode-sdk')
  })
})

test('resolveLanguageModel: OpenAI-compatible gateway returns a LanguageModelV2', async () => {
  const { resolveLanguageModel } = await import('../src/stagehand-config.ts')
  await withEnv(
    {
      LLM_PROVIDER: undefined,
      LLM_API_KEY: 'sk-test',
      LLM_BASE_URL: 'http://localhost:8080/v1',
      LLM_MODEL: 'gpt-4o-mini',
    },
    async () => {
      const model = await resolveLanguageModel()
      assert.ok(model, 'expected a LanguageModelV2 instance')
      assert.equal(model!.specificationVersion, 'v2')
    },
  )
})

test('resolveLanguageModel: returns null when only OPENAI_API_KEY is set (Stagehand built-in path)', async () => {
  const { resolveLanguageModel } = await import('../src/stagehand-config.ts')
  await withEnv(
    {
      LLM_PROVIDER: undefined,
      LLM_API_KEY: undefined,
      LLM_BASE_URL: undefined,
      LLM_MODEL: undefined,
      OPENAI_API_KEY: 'sk-xxx',
    },
    async () => {
      const model = await resolveLanguageModel()
      assert.equal(model, null)
    },
  )
})
