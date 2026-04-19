import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { freshDb } from './helpers.ts'
import type { LoadedTask } from '../src/task/types.ts'

function makeTask(overrides: Partial<LoadedTask['config']> = {}): LoadedTask {
  return {
    name: 'e2e',
    path: '/tmp/ignored.ts',
    configHash: 'h',
    config: {
      workflow: 'fake',
      schedule: '0 * * * *',
      ...overrides,
    },
  }
}

test('applyResult (items mode): first run records all items and writes RSS', async () => {
  await freshDb()
  const { applyResult } = await import('../src/daemon/executor.ts')
  const { feedPath, ensureHomeDirs } = await import('../src/paths.ts')
  ensureHomeDirs()

  // Register the task row first so markRan has something to update (no-op otherwise, but keeps the integration realistic).
  const { upsertTask } = await import('../src/task/registry.ts')
  const task = makeTask({
    itemKey: 'url',
    output: { rss: { title: 'F', link: 'https://ex', itemTitle: 'title', itemLink: 'url' } },
  })
  upsertTask(task, Date.now())

  const res = await applyResult(task, [
    { url: 'https://ex/1', title: 'Item 1' },
    { url: 'https://ex/2', title: 'Item 2' },
  ])
  assert.equal(res.status, 'ok')
  assert.equal(res.mode, 'items')
  assert.equal(res.newItemsCount, 2)

  assert.ok(fs.existsSync(feedPath('e2e')), 'RSS file must exist')
  const body = fs.readFileSync(feedPath('e2e'), 'utf8')
  assert.match(body, /Item 1/)

  const { recentRuns } = await import('../src/store/runs.ts')
  const runs = recentRuns('e2e', 5)
  assert.equal(runs.length, 1)
  assert.equal(runs[0]!.newItemsCount, 2)
})

test('applyResult (items mode): second run with same items reports 0 new', async () => {
  await freshDb()
  const { applyResult } = await import('../src/daemon/executor.ts')
  const { upsertTask } = await import('../src/task/registry.ts')

  const task = makeTask({ itemKey: 'url' })
  upsertTask(task, Date.now())
  await applyResult(task, [{ url: 'a', title: 'A' }])
  const r2 = await applyResult(task, [{ url: 'a', title: 'A' }])
  assert.equal(r2.newItemsCount, 0)
})

test('applyResult (items mode): itemKey + non-array workflow result throws a clear error', async () => {
  await freshDb()
  const { applyResult } = await import('../src/daemon/executor.ts')
  const { upsertTask } = await import('../src/task/registry.ts')

  const task = makeTask({ itemKey: 'url' })
  upsertTask(task, Date.now())
  const res = await applyResult(task, { not: 'array' })
  assert.equal(res.status, 'error')
  assert.match(res.error ?? '', /uses itemKey/)

  const { recentRuns } = await import('../src/store/runs.ts')
  const runs = recentRuns('e2e', 5)
  assert.equal(runs[0]!.status, 'error')
})

test('applyResult (snapshot mode): first run baseline, second run same → no change', async () => {
  await freshDb()
  const { applyResult } = await import('../src/daemon/executor.ts')
  const { upsertTask } = await import('../src/task/registry.ts')

  const task = makeTask()
  upsertTask(task, Date.now())
  const r1 = await applyResult(task, { price: 100 })
  assert.equal(r1.status, 'ok')
  assert.equal(r1.mode, 'snapshot')
  assert.equal(r1.newItemsCount, 0)

  const r2 = await applyResult(task, { price: 100 })
  assert.equal(r2.newItemsCount, 0)
})

test('applyResult (snapshot mode): detects change', async () => {
  await freshDb()
  const { applyResult } = await import('../src/daemon/executor.ts')
  const { upsertTask } = await import('../src/task/registry.ts')

  const task = makeTask()
  upsertTask(task, Date.now())
  await applyResult(task, { price: 100 })
  const r2 = await applyResult(task, { price: 120 })
  assert.equal(r2.newItemsCount, 1)
})
