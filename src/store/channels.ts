import { getDb } from './db.ts'

export type Channel = { name: string; url: string; createdAt: number }

export function addChannel(name: string, url: string): void {
  const db = getDb()
  db.prepare(
    `INSERT INTO channels (name, url, created_at) VALUES (?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET url = excluded.url`,
  ).run(name, url, Date.now())
}

export function getChannel(name: string): Channel | null {
  const row = getDb()
    .prepare(`SELECT name, url, created_at as createdAt FROM channels WHERE name = ?`)
    .get(name) as Channel | undefined
  return row ?? null
}

export function listChannels(): Channel[] {
  return getDb()
    .prepare(`SELECT name, url, created_at as createdAt FROM channels ORDER BY name`)
    .all() as Channel[]
}

export function removeChannel(name: string): boolean {
  const info = getDb().prepare(`DELETE FROM channels WHERE name = ?`).run(name)
  return info.changes > 0
}
