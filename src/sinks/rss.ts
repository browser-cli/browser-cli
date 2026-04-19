import fs from 'node:fs'
import path from 'node:path'
import { Feed } from 'feed'
import type { RssConfig } from '../task/types.ts'
import { listItems } from '../store/items.ts'
import { feedPath } from '../paths.ts'

function pick(obj: unknown, field: string | undefined): string | undefined {
  if (!field || !obj || typeof obj !== 'object') return undefined
  const v = (obj as Record<string, unknown>)[field]
  return typeof v === 'string' ? v : v != null ? String(v) : undefined
}

export function renderRssToString(taskName: string, rss: RssConfig): string {
  const maxItems = rss.maxItems ?? 100
  const rows = listItems(taskName, maxItems)

  const feed = new Feed({
    title: rss.title,
    description: rss.description ?? rss.title,
    id: rss.link,
    link: rss.link,
    updated: rows[0] ? new Date(rows[0].firstSeenAt) : new Date(),
    generator: 'browser-cli',
    copyright: '',
  })

  for (const r of rows) {
    const payload = safeParse(r.payloadJson)
    const title = pick(payload, rss.itemTitle) ?? r.itemKey
    const link = pick(payload, rss.itemLink) ?? r.itemKey
    const desc = pick(payload, rss.itemDescription)
    const pub = pick(payload, rss.itemPubDate)
    const pubDate = pub ? safeDate(pub) ?? new Date(r.firstSeenAt) : new Date(r.firstSeenAt)

    feed.addItem({
      title,
      id: String(link),
      link: String(link),
      description: desc,
      content: desc,
      date: pubDate,
    })
  }

  return feed.atom1()
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}

function safeDate(v: string): Date | undefined {
  const t = Date.parse(v)
  return Number.isFinite(t) ? new Date(t) : undefined
}

export function writeRssFile(taskName: string, rss: RssConfig): string {
  const out = renderRssToString(taskName, rss)
  const target = feedPath(taskName)
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.tmp`)
  fs.writeFileSync(tmp, out, 'utf8')
  fs.renameSync(tmp, target)
  return target
}
