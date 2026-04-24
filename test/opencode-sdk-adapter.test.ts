import { test } from 'node:test'
import assert from 'node:assert/strict'
import './helpers.ts'
import { __test } from '../src/llm/opencode-sdk-adapter.ts'

const { parseModelPair, extractSessionId, extractAssistantResponse, wrapOpenCodeError, stripJsonFence, flattenPrompt } =
  __test

test('parseModelPair: valid provider/model', () => {
  assert.deepEqual(parseModelPair('anthropic/claude-sonnet-4-5'), {
    providerID: 'anthropic',
    modelID: 'claude-sonnet-4-5',
  })
  assert.deepEqual(parseModelPair('openai/gpt-4o-mini'), { providerID: 'openai', modelID: 'gpt-4o-mini' })
})

test('parseModelPair: returns null for undefined / no slash / edge slashes', () => {
  assert.equal(parseModelPair(undefined), null)
  assert.equal(parseModelPair(''), null)
  assert.equal(parseModelPair('nomodel'), null)
  assert.equal(parseModelPair('/leading'), null)
  assert.equal(parseModelPair('trailing/'), null)
})

test('parseModelPair: keeps nested slashes in modelID', () => {
  assert.deepEqual(parseModelPair('openrouter/meta/llama-3-70b'), {
    providerID: 'openrouter',
    modelID: 'meta/llama-3-70b',
  })
})

test('extractSessionId: happy path', () => {
  assert.equal(extractSessionId({ data: { id: 'sess_123' } }), 'sess_123')
})

test('extractSessionId: missing id returns null', () => {
  assert.equal(extractSessionId({ data: {} }), null)
  assert.equal(extractSessionId({}), null)
  assert.equal(extractSessionId(null), null)
})

test('extractSessionId: error throws (wrapped)', () => {
  assert.throws(() => extractSessionId({ error: 'Unauthorized' }), /opencode auth login/)
})

test('extractAssistantResponse: concatenates text parts and returns tokens', () => {
  const res = {
    data: {
      info: { tokens: { input: 100, output: 50 } },
      parts: [
        { type: 'text', text: 'hello' },
        { type: 'reasoning', text: 'ignored' },
        { type: 'text', text: 'world' },
      ],
    },
  }
  const out = extractAssistantResponse(res)
  assert.equal(out.text, 'hello\nworld')
  assert.deepEqual(out.tokens, { input: 100, output: 50 })
})

test('extractAssistantResponse: strips json fences from concatenated parts', () => {
  const res = {
    data: {
      info: {},
      parts: [{ type: 'text', text: '```json\n{"a":1}\n```' }],
    },
  }
  const out = extractAssistantResponse(res)
  assert.equal(out.text, '{"a":1}')
})

test('extractAssistantResponse: missing info.tokens → no usage', () => {
  const res = { data: { info: {}, parts: [{ type: 'text', text: 'hi' }] } }
  const out = extractAssistantResponse(res)
  assert.equal(out.text, 'hi')
  assert.equal(out.tokens, undefined)
})

test('extractAssistantResponse: info.error wraps with auth hint', () => {
  const res = { data: { info: { error: { message: 'ProviderAuthError: no key' } }, parts: [] } }
  assert.throws(() => extractAssistantResponse(res), /opencode auth login/)
})

test('extractAssistantResponse: top-level error field wraps', () => {
  assert.throws(() => extractAssistantResponse({ error: 'Unauthorized' }), /opencode auth login/)
})

test('wrapOpenCodeError: auth-ish messages get opencode auth login hint', () => {
  for (const raw of ['no provider configured', 'Unauthorized 401', 'missing api key', 'login required']) {
    const wrapped = wrapOpenCodeError(new Error(raw))
    assert.match(wrapped.message, /opencode auth login/)
  }
})

test('wrapOpenCodeError: non-auth message passes through', () => {
  const wrapped = wrapOpenCodeError(new Error('ECONNRESET'))
  assert.equal(wrapped.message, 'ECONNRESET')
  assert.doesNotMatch(wrapped.message, /opencode auth login/)
})

test('stripJsonFence / flattenPrompt mirror Codex behavior (smoke)', () => {
  assert.equal(stripJsonFence('```json\n"x"\n```'), '"x"')
  assert.equal(
    flattenPrompt([
      { role: 'system', content: 'sys' },
      { role: 'user', content: [{ type: 'text', text: 'u' }] },
    ]),
    'sys\n\nu',
  )
})
