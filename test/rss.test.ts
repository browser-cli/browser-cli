import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from './helpers.ts'

test('rss.renderRssToString: emits Atom 1.0 with expected items', async () => {
  await freshDb()
  const { diffAndStore } = await import('../src/store/items.ts')
  const { renderRssToString } = await import('../src/sinks/rss.ts')

  diffAndStore(
    't1',
    [
      { url: 'https://x.com/a', title: 'Post A', text: 'body a' },
      { url: 'https://x.com/b', title: 'Post B', text: 'body b' },
    ],
    'url',
  )

  const xml = renderRssToString('t1', {
    title: 'Feed',
    link: 'https://x.com',
    itemTitle: 'title',
    itemLink: 'url',
    itemDescription: 'text',
  })

  assert.match(xml, /<feed/)
  assert.match(xml, /<title>Feed<\/title>/)
  assert.match(xml, /Post A/)
  assert.match(xml, /Post B/)
  assert.match(xml, /https:\/\/x\.com\/a/)
})

test('rss.renderRssToString: no items still produces valid feed', async () => {
  await freshDb()
  const { renderRssToString } = await import('../src/sinks/rss.ts')
  const xml = renderRssToString('empty', { title: 'Empty', link: 'https://example.com' })
  assert.match(xml, /<feed/)
  assert.match(xml, /<title>Empty<\/title>/)
})

test('rss.writeRssFile: atomically writes the file to feedsDir', async () => {
  const fs = await import('node:fs')
  await freshDb()
  const { diffAndStore } = await import('../src/store/items.ts')
  const { writeRssFile } = await import('../src/sinks/rss.ts')
  const { feedPath, ensureHomeDirs } = await import('../src/paths.ts')
  ensureHomeDirs()

  diffAndStore('t-file', [{ url: 'https://ex/1', title: 'T1' }], 'url')
  const target = writeRssFile('t-file', {
    title: 'FileFeed',
    link: 'https://ex',
    itemTitle: 'title',
    itemLink: 'url',
  })
  assert.equal(target, feedPath('t-file'))
  assert.ok(fs.existsSync(target))
  const body = fs.readFileSync(target, 'utf8')
  assert.match(body, /FileFeed/)
  assert.match(body, /T1/)
})
