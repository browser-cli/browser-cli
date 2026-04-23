import { test } from 'node:test'
import assert from 'node:assert/strict'
import './helpers.ts'

type Row = { name: string; enabled: boolean; nextRunAt: number }
type DueTask = { row: Row }

const makeDue = (names: string[]): (() => DueTask[]) => {
  return () => names.map((name) => ({ row: { name, enabled: true, nextRunAt: 0 } }))
}

test('tick: returns synchronously even when a task hangs forever', async () => {
  const { tick } = await import('../src/daemon/index.ts')
  const running = new Set<string>()
  const logs: string[] = []

  // Task that never resolves — simulates a wedged CDP connection.
  const hangForever = () => new Promise<void>(() => {})

  const before = Date.now()
  tick(
    { findDue: makeDue(['hung-task']), run: hangForever, log: (m) => logs.push(m) },
    running,
  )
  const elapsed = Date.now() - before

  assert.ok(elapsed < 50, `tick should return immediately, took ${elapsed}ms`)
  assert.ok(running.has('hung-task'), 'hung task should be in running set')
})

test('tick: subsequent ticks skip an in-flight task instead of re-dispatching', async () => {
  const { tick } = await import('../src/daemon/index.ts')
  const running = new Set<string>()
  const logs: string[] = []
  const hangForever = () => new Promise<void>(() => {})

  tick(
    { findDue: makeDue(['a']), run: hangForever, log: (m) => logs.push(m) },
    running,
  )
  assert.equal(running.size, 1)

  tick(
    { findDue: makeDue(['a']), run: hangForever, log: (m) => logs.push(m) },
    running,
  )
  assert.ok(logs.some((m) => m.includes('skip a')), `expected a skip log, got: ${JSON.stringify(logs)}`)
  assert.equal(running.size, 1, 'a second tick must not double-register the task')
})

test('tick: one hanging task does not prevent other tasks in the same tick from running', async () => {
  const { tick } = await import('../src/daemon/index.ts')
  const running = new Set<string>()
  const logs: string[] = []
  let bRan = false

  const run = (name: string): Promise<void> => {
    if (name === 'a-hang') return new Promise(() => {})
    if (name === 'b-ok') {
      bRan = true
      return Promise.resolve()
    }
    return Promise.resolve()
  }

  tick(
    { findDue: makeDue(['a-hang', 'b-ok']), run, log: (m) => logs.push(m) },
    running,
  )

  // b-ok runs synchronously via Promise.resolve() — but its finally cleanup
  // is a microtask. Drain the microtask queue.
  await Promise.resolve()
  await Promise.resolve()

  assert.equal(bRan, true, 'b-ok must be dispatched even though a-hang is hanging')
  assert.ok(running.has('a-hang'), 'a-hang should still occupy its slot')
  assert.ok(!running.has('b-ok'), 'b-ok should be removed after it resolves')
})

test('tick: resolved task releases its slot so the next tick can re-run it', async () => {
  const { tick } = await import('../src/daemon/index.ts')
  const running = new Set<string>()
  let runCount = 0
  const run = (): Promise<void> => {
    runCount++
    return Promise.resolve()
  }
  const log = () => {}

  tick({ findDue: makeDue(['x']), run, log }, running)
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(runCount, 1)
  assert.equal(running.size, 0, 'slot should be released after resolution')

  tick({ findDue: makeDue(['x']), run, log }, running)
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(runCount, 2, 'second tick should re-dispatch after the first resolved')
})
