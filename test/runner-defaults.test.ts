import { test } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { freshDb } from './helpers.ts'

// runWorkflow happens inside the runner module under test, which calls
// withBrowser → which doesn't init Stagehand unless the workflow opens a page.
// Our stub run() never opens a page, so these tests don't need real Chrome.

test('runWorkflow: default concurrency=1 serializes parallel invocations', async () => {
  await freshDb()
  const { runWorkflow } = await import('../src/runner.ts')

  const ts: number[] = []
  const stub = {
    schema: z.object({}),
    async run() {
      ts.push(Date.now())
      await new Promise((r) => setTimeout(r, 400))
      return { ok: true }
    },
  }

  // 3 parallel runs, no concurrency export → default 1 → serialized.
  const start = Date.now()
  await Promise.all([
    runWorkflow('xhs-default-concur', {}, { preloaded: stub as any }),
    runWorkflow('xhs-default-concur', {}, { preloaded: stub as any }),
    runWorkflow('xhs-default-concur', {}, { preloaded: stub as any }),
  ])
  const elapsed = Date.now() - start
  // Each holds 400ms, serialized → ≥ 1200ms.
  assert.ok(elapsed >= 1100, `expected ≥1100ms (serialized), got ${elapsed}ms`)

  // Each invocation's start time must follow the previous one's start by ≥400ms.
  ts.sort((a, b) => a - b)
  assert.ok(ts[1]! - ts[0]! >= 350, `2nd run started ${ts[1]! - ts[0]!}ms after 1st`)
  assert.ok(ts[2]! - ts[1]! >= 350, `3rd run started ${ts[2]! - ts[1]!}ms after 2nd`)
})

test('runWorkflow: concurrency=0 opts out (parallel runs do not block)', async () => {
  await freshDb()
  const { runWorkflow } = await import('../src/runner.ts')

  const stub = {
    schema: z.object({}),
    concurrency: 0,
    async run() {
      await new Promise((r) => setTimeout(r, 400))
      return { ok: true }
    },
  }

  const start = Date.now()
  await Promise.all([
    runWorkflow('unlimited', {}, { preloaded: stub as any }),
    runWorkflow('unlimited', {}, { preloaded: stub as any }),
    runWorkflow('unlimited', {}, { preloaded: stub as any }),
  ])
  const elapsed = Date.now() - start
  // All in parallel ≈ 400ms.
  assert.ok(elapsed < 800, `expected <800ms (parallel), got ${elapsed}ms`)
})

test('runWorkflow: explicit concurrency=2 caps at 2 in flight', async () => {
  await freshDb()
  const { runWorkflow } = await import('../src/runner.ts')

  const stub = {
    schema: z.object({}),
    concurrency: 2,
    async run() {
      await new Promise((r) => setTimeout(r, 400))
      return { ok: true }
    },
  }

  const start = Date.now()
  await Promise.all([
    runWorkflow('cap2', {}, { preloaded: stub as any }),
    runWorkflow('cap2', {}, { preloaded: stub as any }),
    runWorkflow('cap2', {}, { preloaded: stub as any }),
    runWorkflow('cap2', {}, { preloaded: stub as any }),
  ])
  const elapsed = Date.now() - start
  // 4 runs, cap 2, each 400ms → 2 waves → ≥800ms.
  assert.ok(elapsed >= 750, `expected ≥750ms (2 waves), got ${elapsed}ms`)
  assert.ok(elapsed < 1500, `expected <1500ms, got ${elapsed}ms`)
})

test('runWorkflow: rejects concurrency=-1 even on preloaded SDK path', async () => {
  await freshDb()
  const { runWorkflow } = await import('../src/runner.ts')

  const stub = {
    schema: z.object({}),
    concurrency: -1,
    async run() { return { ok: true } },
  }

  await assert.rejects(
    () => runWorkflow('bad', {}, { preloaded: stub as any }),
    /non-negative integer/,
  )
})
