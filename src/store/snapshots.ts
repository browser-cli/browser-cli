import crypto from 'node:crypto'
import { getDb } from './db.ts'

export type Snapshot = {
  taskName: string
  payloadJson: string
  payloadHash: string
  updatedAt: number
}

export type SnapshotDiff = {
  changed: boolean
  isFirstRun: boolean
  before: unknown
  after: unknown
}

function stableStringify(v: unknown): string {
  return JSON.stringify(v, (_k, val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const sorted: Record<string, unknown> = {}
      for (const k of Object.keys(val).sort()) sorted[k] = (val as Record<string, unknown>)[k]
      return sorted
    }
    return val
  })
}

function hash(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex')
}

export function getSnapshot(taskName: string): Snapshot | null {
  const row = getDb()
    .prepare(
      `SELECT task_name as taskName, payload_json as payloadJson,
              payload_hash as payloadHash, updated_at as updatedAt
       FROM snapshots WHERE task_name = ?`,
    )
    .get(taskName) as Snapshot | undefined
  return row ?? null
}

export function saveSnapshot(taskName: string, payload: unknown): void {
  const json = stableStringify(payload)
  const h = hash(json)
  getDb()
    .prepare(
      `INSERT INTO snapshots (task_name, payload_json, payload_hash, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(task_name) DO UPDATE SET
         payload_json = excluded.payload_json,
         payload_hash = excluded.payload_hash,
         updated_at = excluded.updated_at`,
    )
    .run(taskName, json, h, Date.now())
}

export function diffSnapshot(taskName: string, payload: unknown): SnapshotDiff {
  const prev = getSnapshot(taskName)
  const json = stableStringify(payload)
  const h = hash(json)

  if (!prev) {
    saveSnapshot(taskName, payload)
    return { changed: false, isFirstRun: true, before: undefined, after: payload }
  }
  if (prev.payloadHash === h) {
    return { changed: false, isFirstRun: false, before: JSON.parse(prev.payloadJson), after: payload }
  }
  const before = JSON.parse(prev.payloadJson)
  saveSnapshot(taskName, payload)
  return { changed: true, isFirstRun: false, before, after: payload }
}

export function deleteSnapshot(taskName: string): boolean {
  const info = getDb().prepare(`DELETE FROM snapshots WHERE task_name = ?`).run(taskName)
  return info.changes > 0
}
