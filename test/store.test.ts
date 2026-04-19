import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from './helpers.ts'

test('items.diffAndStore: first insert reports everything as new', async () => {
  await freshDb()
  const { diffAndStore, countItems } = await import('../src/store/items.ts')
  const items = [
    { url: 'a', title: 'A' },
    { url: 'b', title: 'B' },
  ]
  const r = diffAndStore('t1', items, 'url')
  assert.equal(r.newItems.length, 2)
  assert.equal(countItems('t1'), 2)
})

test('items.diffAndStore: second insert dedupes by itemKey', async () => {
  await freshDb()
  const { diffAndStore, countItems } = await import('../src/store/items.ts')
  diffAndStore('t1', [{ url: 'a' }, { url: 'b' }], 'url')
  const r2 = diffAndStore('t1', [{ url: 'a' }, { url: 'b' }, { url: 'c' }], 'url')
  assert.equal(r2.newItems.length, 1)
  assert.equal((r2.newItems[0] as { url: string }).url, 'c')
  assert.equal(countItems('t1'), 3)
})

test('items.diffAndStore: first_seen_at is preserved across re-inserts', async () => {
  await freshDb()
  const { diffAndStore, listItems } = await import('../src/store/items.ts')
  diffAndStore('t1', [{ url: 'a', v: 1 }], 'url')
  const firstSeen = listItems('t1', 10)[0]!.firstSeenAt
  await new Promise((r) => setTimeout(r, 5))
  diffAndStore('t1', [{ url: 'a', v: 2 }], 'url')
  const rows = listItems('t1', 10)
  assert.equal(rows[0]!.firstSeenAt, firstSeen, 'first_seen_at must not change on repeat')
  assert.ok(rows[0]!.lastSeenAt >= firstSeen, 'last_seen_at must update')
  const payload = JSON.parse(rows[0]!.payloadJson) as { v: number }
  assert.equal(payload.v, 2, 'payload must be overwritten with latest')
})

test('items.diffAndStore: isolates tasks from each other', async () => {
  await freshDb()
  const { diffAndStore, countItems } = await import('../src/store/items.ts')
  diffAndStore('t1', [{ url: 'a' }], 'url')
  diffAndStore('t2', [{ url: 'a' }], 'url')
  assert.equal(countItems('t1'), 1)
  assert.equal(countItems('t2'), 1)
})

test('items.diffAndStore: throws when item is missing the key', async () => {
  await freshDb()
  const { diffAndStore } = await import('../src/store/items.ts')
  assert.throws(
    () => diffAndStore('t1', [{ noKey: 'x' }], 'url'),
    /missing itemKey "url"/,
  )
})

test('snapshots.diffSnapshot: first run is baseline with changed=false', async () => {
  await freshDb()
  const { diffSnapshot, getSnapshot } = await import('../src/store/snapshots.ts')
  const r = diffSnapshot('t1', { price: 100 })
  assert.equal(r.isFirstRun, true)
  assert.equal(r.changed, false)
  assert.ok(getSnapshot('t1'), 'baseline must be stored')
})

test('snapshots.diffSnapshot: no-change returns changed=false', async () => {
  await freshDb()
  const { diffSnapshot } = await import('../src/store/snapshots.ts')
  diffSnapshot('t1', { price: 100 })
  const r = diffSnapshot('t1', { price: 100 })
  assert.equal(r.changed, false)
  assert.equal(r.isFirstRun, false)
})

test('snapshots.diffSnapshot: change is detected, before/after returned', async () => {
  await freshDb()
  const { diffSnapshot } = await import('../src/store/snapshots.ts')
  diffSnapshot('t1', { price: 100 })
  const r = diffSnapshot('t1', { price: 120 })
  assert.equal(r.changed, true)
  assert.deepEqual(r.before, { price: 100 })
  assert.deepEqual(r.after, { price: 120 })
})

test('snapshots.diffSnapshot: object-key ordering is stable (no false positive)', async () => {
  await freshDb()
  const { diffSnapshot } = await import('../src/store/snapshots.ts')
  diffSnapshot('t1', { a: 1, b: 2, c: 3 })
  const r = diffSnapshot('t1', { c: 3, a: 1, b: 2 })
  assert.equal(r.changed, false, 'key reordering must not register as a change')
})

test('channels: CRUD roundtrip', async () => {
  await freshDb()
  const { addChannel, getChannel, listChannels, removeChannel } = await import(
    '../src/store/channels.ts'
  )
  addChannel('tg', 'tgram://token/chat')
  const ch = getChannel('tg')
  assert.equal(ch?.url, 'tgram://token/chat')
  assert.equal(listChannels().length, 1)
  assert.equal(removeChannel('tg'), true)
  assert.equal(getChannel('tg'), null)
  assert.equal(removeChannel('tg'), false, 'second remove is a no-op')
})

test('channels: upsert semantics on re-add', async () => {
  await freshDb()
  const { addChannel, getChannel } = await import('../src/store/channels.ts')
  addChannel('tg', 'tgram://old/old')
  addChannel('tg', 'tgram://new/new')
  assert.equal(getChannel('tg')?.url, 'tgram://new/new')
})
