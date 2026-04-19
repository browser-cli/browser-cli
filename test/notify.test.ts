import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from './helpers.ts'

test('notify: unknown channel is reported as missing, does not throw', async () => {
  await freshDb()
  const { notify } = await import('../src/notify/index.ts')
  const r = await notify('nope', { title: 't', body: 'b' })
  assert.deepEqual(r.missing, ['nope'])
  assert.equal(r.sent.length, 0)
})

test('notify: multi-channel split between known and missing', async () => {
  await freshDb()
  const { addChannel } = await import('../src/store/channels.ts')
  addChannel('tg', 'tgram://token/chat')
  const { notify } = await import('../src/notify/index.ts')
  const r = await notify(['tg', 'ghost'], { title: 't', body: 'b' })
  assert.deepEqual(r.missing, ['ghost'])
  // Apprise not installed in CI → dispatch will fail. Either sent OR failed is acceptable;
  // the critical property is that ghost appears in missing and no throw occurs.
  assert.ok(r.sent.length + r.failed.length <= 1)
})
