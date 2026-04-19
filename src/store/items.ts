import { getDb } from './db.ts'

export type ItemRow = {
  taskName: string
  itemKey: string
  payloadJson: string
  firstSeenAt: number
  lastSeenAt: number
}

export type DiffResult<T> = {
  newItems: T[]
  total: number
}

function extractKey(item: unknown, itemKey: string, idx: number): string {
  if (!item || typeof item !== 'object') {
    throw new Error(
      `item at index ${idx} is not an object; cannot read itemKey "${itemKey}" (item: ${JSON.stringify(item).slice(0, 80)})`,
    )
  }
  const v = (item as Record<string, unknown>)[itemKey]
  if (v === undefined || v === null) {
    throw new Error(`item at index ${idx} is missing itemKey "${itemKey}"`)
  }
  return String(v)
}

export function diffAndStore<T>(
  taskName: string,
  items: T[],
  itemKey: string,
): DiffResult<T> {
  if (!Array.isArray(items)) {
    throw new Error(`items must be an array when itemKey is set (got ${typeof items})`)
  }
  const db = getDb()
  const now = Date.now()
  const newItems: T[] = []

  const existing = db
    .prepare(`SELECT item_key as itemKey FROM items WHERE task_name = ?`)
    .all(taskName) as { itemKey: string }[]
  const known = new Set(existing.map((r) => r.itemKey))

  const upsert = db.prepare(
    `INSERT INTO items (task_name, item_key, payload_json, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(task_name, item_key) DO UPDATE SET
       payload_json = excluded.payload_json,
       last_seen_at = excluded.last_seen_at`,
  )

  const txn = db.transaction((arr: T[]) => {
    for (let i = 0; i < arr.length; i++) {
      const key = extractKey(arr[i], itemKey, i)
      upsert.run(taskName, key, JSON.stringify(arr[i]), now, now)
      if (!known.has(key)) newItems.push(arr[i]!)
    }
  })
  txn(items)

  return { newItems, total: items.length }
}

export function listItems(taskName: string, limit: number): ItemRow[] {
  return getDb()
    .prepare(
      `SELECT task_name as taskName, item_key as itemKey, payload_json as payloadJson,
              first_seen_at as firstSeenAt, last_seen_at as lastSeenAt
       FROM items WHERE task_name = ?
       ORDER BY first_seen_at DESC
       LIMIT ?`,
    )
    .all(taskName, limit) as ItemRow[]
}

export function countItems(taskName: string): number {
  const r = getDb().prepare(`SELECT COUNT(*) as n FROM items WHERE task_name = ?`).get(taskName) as { n: number }
  return r.n
}

export function deleteItems(taskName: string): number {
  return getDb().prepare(`DELETE FROM items WHERE task_name = ?`).run(taskName).changes
}
