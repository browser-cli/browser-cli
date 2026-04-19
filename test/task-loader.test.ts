import { test } from 'node:test'
import assert from 'node:assert/strict'
import './helpers.ts'

test('validateTaskConfig: accepts a minimal valid config', async () => {
  const { validateTaskConfig } = await import('../src/task/loader.ts')
  const cfg = validateTaskConfig(
    { workflow: 'hn-top', schedule: '*/30 * * * *' },
    'minimal',
  )
  assert.equal(cfg.workflow, 'hn-top')
})

test('validateTaskConfig: accepts a rich items-mode config', async () => {
  const { validateTaskConfig } = await import('../src/task/loader.ts')
  const cfg = validateTaskConfig(
    {
      workflow: 'hn-top',
      args: { limit: 30 },
      schedule: '*/30 * * * *',
      itemKey: 'url',
      output: { rss: { title: 'HN', link: 'https://news.ycombinator.com/' } },
      notify: { channels: ['tg'], onError: ['tg'] },
    },
    'rich',
  )
  assert.equal(cfg.itemKey, 'url')
})

test('validateTaskConfig: rejects missing workflow', async () => {
  const { validateTaskConfig } = await import('../src/task/loader.ts')
  assert.throws(
    () => validateTaskConfig({ schedule: '* * * * *' }, 'bad'),
    /workflow must be a non-empty string/,
  )
})

test('validateTaskConfig: rejects invalid cron', async () => {
  const { validateTaskConfig } = await import('../src/task/loader.ts')
  assert.throws(
    () => validateTaskConfig({ workflow: 'x', schedule: 'not-a-cron' }, 'bad'),
    /invalid cron expression/,
  )
})

test('validateTaskConfig: rejects notify.channels that is not a string[]', async () => {
  const { validateTaskConfig } = await import('../src/task/loader.ts')
  assert.throws(
    () =>
      validateTaskConfig(
        { workflow: 'x', schedule: '* * * * *', notify: { channels: 'tg' } },
        'bad',
      ),
    /notify.channels must be a string\[\]/,
  )
})

test('hashConfig: stable across runs for same input', async () => {
  const { hashConfig } = await import('../src/task/loader.ts')
  const a = hashConfig({ workflow: 'w', schedule: '* * * * *', args: { a: 1, b: 2 } })
  const b = hashConfig({ workflow: 'w', schedule: '* * * * *', args: { b: 2, a: 1 } })
  assert.equal(a, b, 'object key order must not change hash')
})

test('hashConfig: different config yields different hash', async () => {
  const { hashConfig } = await import('../src/task/loader.ts')
  const a = hashConfig({ workflow: 'w', schedule: '* * * * *' })
  const b = hashConfig({ workflow: 'w', schedule: '*/5 * * * *' })
  assert.notEqual(a, b)
})
