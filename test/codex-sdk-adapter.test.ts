import { test } from 'node:test'
import assert from 'node:assert/strict'
import './helpers.ts'
import { __test } from '../src/llm/codex-sdk-adapter.ts'

const { extractText, stripJsonFence, wrapCodexError, flattenPrompt } = __test

test('flattenPrompt: joins system + user text messages with double newlines', () => {
  const out = flattenPrompt([
    { role: 'system', content: 'you are a helpful assistant' },
    { role: 'user', content: [{ type: 'text', text: 'hello' }, { type: 'text', text: 'world' }] },
  ])
  assert.equal(out, 'you are a helpful assistant\n\nhello\n\nworld')
})

test('flattenPrompt: ignores tool messages', () => {
  const out = flattenPrompt([
    { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    // @ts-expect-error — minimal shape for the test
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'x', toolName: 'y', result: {} }] },
  ])
  assert.equal(out, 'hi')
})

test('flattenPrompt: surfaces file placeholders', () => {
  const out = flattenPrompt([
    {
      role: 'user',
      content: [
        { type: 'text', text: 'look' },
        // @ts-expect-error — minimal shape for the test
        { type: 'file', mediaType: 'image/png', data: new Uint8Array() },
      ],
    },
  ])
  assert.match(out, /\[file omitted \(image\/png\); codex-sdk adapter is text-only\]/)
})

test('stripJsonFence: removes ```json fences', () => {
  assert.equal(stripJsonFence('```json\n{"a":1}\n```'), '{"a":1}')
  assert.equal(stripJsonFence('```\n{"a":1}\n```'), '{"a":1}')
})

test('stripJsonFence: returns raw when no fences', () => {
  assert.equal(stripJsonFence('{"a":1}'), '{"a":1}')
  assert.equal(stripJsonFence('  plain text  '), '  plain text  ')
})

test('extractText: prefers finalResponse when present', () => {
  const turn = {
    items: [],
    finalResponse: '{"selector": "#login"}',
    usage: null,
  }
  // @ts-expect-error — minimal Turn shape for the test
  assert.equal(extractText(turn), '{"selector": "#login"}')
})

test('extractText: falls back to agent_message items when finalResponse empty', () => {
  const turn = {
    items: [
      { id: '1', type: 'reasoning', text: 'thinking...' },
      { id: '2', type: 'agent_message', text: 'part A' },
      { id: '3', type: 'agent_message', text: 'part B' },
    ],
    finalResponse: '',
    usage: null,
  }
  // @ts-expect-error — minimal Turn shape for the test
  assert.equal(extractText(turn), 'part A\npart B')
})

test('extractText: strips code fences from finalResponse', () => {
  const turn = {
    items: [],
    finalResponse: '```json\n{"x":1}\n```',
    usage: null,
  }
  // @ts-expect-error — minimal Turn shape for the test
  assert.equal(extractText(turn), '{"x":1}')
})

test('wrapCodexError: auth-ish messages get codex login hint', () => {
  for (const raw of ['not logged in', 'Unauthorized: missing api key', '401 API key invalid']) {
    const wrapped = wrapCodexError(new Error(raw))
    assert.match(wrapped.message, /codex login/)
    assert.match(wrapped.message, /OPENAI_API_KEY/)
  }
})

test('wrapCodexError: non-auth messages pass through', () => {
  const wrapped = wrapCodexError(new Error('ECONNREFUSED 127.0.0.1:1234'))
  assert.equal(wrapped.message, 'ECONNREFUSED 127.0.0.1:1234')
  assert.doesNotMatch(wrapped.message, /codex login/)
})

test('wrapCodexError: non-Error input becomes Error', () => {
  const wrapped = wrapCodexError('oops')
  assert.ok(wrapped instanceof Error)
  assert.equal(wrapped.message, 'oops')
})
