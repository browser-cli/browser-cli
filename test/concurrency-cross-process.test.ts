import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { TEST_HOME, freshDb } from './helpers.ts'

const WORKER = path.resolve('test/fixtures/concurrency-worker.ts')

type Event = { kind: 'ACQUIRED' | 'RELEASED'; ts: number }

function runWorker(key: string, max: number, holdMs: number): Promise<Event[]> {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['exec', 'tsx', WORKER, key, String(max), String(holdMs)], {
      env: { ...process.env, BROWSER_CLI_HOME: TEST_HOME },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => { out += d.toString() })
    child.stderr.on('data', (d) => { err += d.toString() })
    child.on('exit', (code) => {
      if (code !== 0) return reject(new Error(`worker exited ${code}: ${err}`))
      const events: Event[] = out.trim().split('\n').filter(Boolean).map((line) => {
        const [kind, tsStr] = line.split(' ')
        return { kind: kind as Event['kind'], ts: Number(tsStr) }
      })
      resolve(events)
    })
  })
}

test('concurrency cap holds across separate processes', { timeout: 30000 }, async () => {
  await freshDb()
  // Seed the row indirectly: acquireSlot inserts on first call. No setup needed.

  // 5 workers, cap=2, each holds 800ms. Expected: 2 acquire immediately, then
  // pairs come through as earlier ones release. Total wall ≥ 3 * 800 = 2400ms.
  const max = 2
  const holdMs = 800
  const start = Date.now()
  const results = await Promise.all([
    runWorker('xproc-cap', max, holdMs),
    runWorker('xproc-cap', max, holdMs),
    runWorker('xproc-cap', max, holdMs),
    runWorker('xproc-cap', max, holdMs),
    runWorker('xproc-cap', max, holdMs),
  ])
  const elapsed = Date.now() - start

  const events = results.flat().sort((a, b) => a.ts - b.ts)

  // Sweep events in time order; live count must never exceed `max`.
  let live = 0
  let peak = 0
  for (const ev of events) {
    if (ev.kind === 'ACQUIRED') live++
    else live--
    if (live > peak) peak = live
  }
  assert.ok(peak <= max, `live count peaked at ${peak}, must be <= ${max}`)
  assert.equal(events.filter((e) => e.kind === 'ACQUIRED').length, 5)
  assert.equal(events.filter((e) => e.kind === 'RELEASED').length, 5)

  // Sanity: 5 holders at cap=2, 800ms hold ⇒ ≥ ceil(5/2) * 800 = 2400ms in serial waves.
  assert.ok(elapsed >= 2200, `expected wall >= 2200ms, got ${elapsed}ms`)
})
