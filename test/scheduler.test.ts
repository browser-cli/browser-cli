import { test } from 'node:test'
import assert from 'node:assert/strict'
import './helpers.ts'

test('scheduler.nextRunAt: computes a future time for a valid cron', async () => {
  const { nextRunAt } = await import('../src/daemon/scheduler.ts')
  const base = Date.parse('2026-04-01T12:00:00Z')
  const next = nextRunAt('0 * * * *', base)
  assert.ok(next != null)
  assert.ok(next! > base)
  // Next whole hour after 12:00 is 13:00
  assert.equal(new Date(next!).getUTCHours(), 13)
  assert.equal(new Date(next!).getUTCMinutes(), 0)
})

test('scheduler.nextRunAt: */15 minutes produces 15-minute gaps', async () => {
  const { nextRunAt } = await import('../src/daemon/scheduler.ts')
  const base = Date.parse('2026-04-01T12:03:00Z')
  const next = nextRunAt('*/15 * * * *', base)
  assert.equal(new Date(next!).getUTCMinutes(), 15)
})
