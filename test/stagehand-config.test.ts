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
