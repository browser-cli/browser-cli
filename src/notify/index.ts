import { getChannel } from '../store/channels.ts'
import { sendApprise } from '../sinks/apprise.ts'

export type NotifyPayload = {
  title: string
  body: string
}

export type NotifyResult = {
  sent: string[]
  missing: string[]
  failed: { channel: string; reason: string }[]
}

export async function notify(
  channel: string | string[],
  payload: NotifyPayload,
): Promise<NotifyResult> {
  const names = Array.isArray(channel) ? channel : [channel]
  const result: NotifyResult = { sent: [], missing: [], failed: [] }

  const urls: { name: string; url: string }[] = []
  for (const name of names) {
    const ch = getChannel(name)
    if (!ch) {
      result.missing.push(name)
      process.stderr.write(`notify: channel "${name}" not found; skipping\n`)
      continue
    }
    urls.push({ name, url: ch.url })
  }

  if (urls.length === 0) return result

  const r = await sendApprise(urls.map((u) => u.url), payload.title, payload.body)
  if (r.ok) {
    for (const u of urls) result.sent.push(u.name)
  } else {
    for (const u of urls) result.failed.push({ channel: u.name, reason: r.stderr || 'apprise failed' })
    process.stderr.write(`notify: apprise dispatch failed (${r.code}): ${r.stderr}\n`)
  }
  return result
}
