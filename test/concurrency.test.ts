import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from './helpers.ts'

test('acquireSlot: rejects max < 1', async () => {
  await freshDb()
  const { acquireSlot } = await import('../src/store/concurrency.ts')
  await assert.rejects(() => acquireSlot('k', 0), /positive integer/)
  await assert.rejects(() => acquireSlot('k', 1.5), /positive integer/)
})

test('acquireSlot: returns immediately when under cap', async () => {
  await freshDb()
  const { acquireSlot, holderCount } = await import('../src/store/concurrency.ts')
  const start = Date.now()
  const a = await acquireSlot('k', 3)
  const b = await acquireSlot('k', 3)
  const elapsed = Date.now() - start
  assert.ok(elapsed < 500, `under-cap acquires should be near-instant (got ${elapsed}ms)`)
  assert.equal(holderCount('k'), 2)
  a.release()
  b.release()
  assert.equal(holderCount('k'), 0)
})

test('acquireSlot: 4th waits when cap is 3', async () => {
  await freshDb()
  const { acquireSlot, holderCount } = await import('../src/store/concurrency.ts')
  const a = await acquireSlot('k', 3, { pollMs: 50 })
  const b = await acquireSlot('k', 3, { pollMs: 50 })
  const c = await acquireSlot('k', 3, { pollMs: 50 })
  assert.equal(holderCount('k'), 3)

  let dResolved = false
  const dPromise = acquireSlot('k', 3, { pollMs: 50 }).then((h) => {
    dResolved = true
    return h
  })

  await new Promise((r) => setTimeout(r, 200))
  assert.equal(dResolved, false, '4th must still be waiting')

  a.release()
  const d = await dPromise
  assert.ok(dResolved)
  assert.equal(holderCount('k'), 3)

  b.release()
  c.release()
  d.release()
  assert.equal(holderCount('k'), 0)
})

test('acquireSlot: release is idempotent', async () => {
  await freshDb()
  const { acquireSlot, holderCount } = await import('../src/store/concurrency.ts')
  const a = await acquireSlot('k', 1)
  assert.equal(holderCount('k'), 1)
  a.release()
  a.release()
  a.release()
  assert.equal(holderCount('k'), 0)
})

test('acquireSlot: dead-PID holders are reaped on next acquire', async () => {
  await freshDb()
  const { acquireSlot, holderCount } = await import('../src/store/concurrency.ts')
  const { getDb } = await import('../src/store/db.ts')
  const os = await import('node:os')

  // Manually plant 3 dead-PID holders (PID 1 is init, but we use very large
  // unlikely PIDs to avoid collisions on weird CI hosts).
  const stmt = getDb().prepare(
    `INSERT INTO concurrency_holders (key, holder_token, pid, hostname, acquired_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
  for (let i = 0; i < 3; i++) {
    stmt.run('reap-test', `dead-${i}`, 99999990 + i, os.hostname(), Date.now())
  }
  assert.equal(holderCount('reap-test'), 3)

  // Cap is 3 — without reaping this would block. With reaping, immediate.
  const start = Date.now()
  const a = await acquireSlot('reap-test', 3, { pollMs: 50 })
  assert.ok(Date.now() - start < 200, 'should reap and acquire fast')
  assert.equal(holderCount('reap-test'), 1)
  a.release()
})

test('acquireSlot: foreign-host holders are NOT reaped', async () => {
  await freshDb()
  const { acquireSlot, holderCount } = await import('../src/store/concurrency.ts')
  const { getDb } = await import('../src/store/db.ts')

  // Plant holders with a different hostname; even if their PIDs would be dead
  // locally, we can't probe across machines, so they must be left in place.
  const stmt = getDb().prepare(
    `INSERT INTO concurrency_holders (key, holder_token, pid, hostname, acquired_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
  stmt.run('xhost', 'alice', 99999991, 'other-machine.local', Date.now())
  stmt.run('xhost', 'bob', 99999992, 'other-machine.local', Date.now())
  assert.equal(holderCount('xhost'), 2)

  // cap=2 → 3rd local acquire must block (foreign holders count as alive).
  let resolved = false
  const p = acquireSlot('xhost', 2, { pollMs: 50 }).then((h) => {
    resolved = true
    return h
  })
  await new Promise((r) => setTimeout(r, 200))
  assert.equal(resolved, false, 'foreign holders must NOT be reaped')

  // Clean up to release the waiter so the test exits.
  getDb().prepare(`DELETE FROM concurrency_holders WHERE key = ?`).run('xhost')
  const h = await p
  h.release()
})

test('acquireSlot: per-key isolation', async () => {
  await freshDb()
  const { acquireSlot, holderCount } = await import('../src/store/concurrency.ts')
  const a1 = await acquireSlot('alpha', 1)
  const b1 = await acquireSlot('beta', 1)
  assert.equal(holderCount('alpha'), 1)
  assert.equal(holderCount('beta'), 1)

  let a2Resolved = false
  const a2P = acquireSlot('alpha', 1, { pollMs: 50 }).then((h) => {
    a2Resolved = true
    return h
  })
  await new Promise((r) => setTimeout(r, 150))
  assert.equal(a2Resolved, false, 'second acquire on alpha must wait')

  a1.release()
  const a2 = await a2P
  a2.release()
  b1.release()
})
