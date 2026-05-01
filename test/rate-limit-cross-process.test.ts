import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { TEST_HOME, freshDb } from './helpers.ts'

const WORKER = path.resolve('test/fixtures/rate-limit-worker.ts')

function runWorker(key: string, count: number): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['exec', 'tsx', WORKER, key, String(count)], {
      env: { ...process.env, BROWSER_CLI_HOME: TEST_HOME },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => { out += d.toString() })
    child.stderr.on('data', (d) => { err += d.toString() })
    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`worker exited ${code}: ${err}`))
        return
      }
      const ts = out.trim().split('\n').filter(Boolean).map(Number)
      resolve(ts)
    })
  })
}

test('rate limit coordinates across separate Node processes', async () => {
  await freshDb()
  // Seed the bucket from the parent so all 3 workers share it.
  const { ensureBucket } = await import('../src/store/rate-limit.ts')
  ensureBucket('xproc', { rps: 10, burst: 2, manual: false })

  const start = Date.now()
  const results = await Promise.all([
    runWorker('xproc', 10),
    runWorker('xproc', 10),
    runWorker('xproc', 10),
  ])
  const elapsed = Date.now() - start

  const all = results.flat().sort((a, b) => a - b)
  assert.equal(all.length, 30, 'all 30 acquires must complete')

  // 30 acquires at rps=10, burst=2 → first 2 free, remaining 28 paced at 100ms
  // each → ~2.8s minimum. Allow generous upper bound for spawn + CI overhead.
  assert.ok(elapsed >= 2500, `expected >=2500ms total, got ${elapsed}ms`)
  assert.ok(elapsed < 8000, `expected <8000ms total, got ${elapsed}ms`)

  // No rolling 1-second window contains more than burst + rps tokens.
  // (rps=10, burst=2 → at most 12 in any 1s window.)
  const windowMs = 1000
  const maxInWindow = 10 + 2
  for (let i = 0; i < all.length; i++) {
    let inWindow = 0
    for (let j = i; j < all.length && all[j]! - all[i]! < windowMs; j++) {
      inWindow++
    }
    assert.ok(
      inWindow <= maxInWindow,
      `window starting at index ${i} (t=${all[i]}) had ${inWindow} acquires, max ${maxInWindow}`,
    )
  }
}, { timeout: 20000 })
