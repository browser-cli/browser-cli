import { Cron } from 'croner'
import { getDb } from '../store/db.ts'
import { loadAllTasks } from './loader.ts'
import type { LoadedTask } from './types.ts'
export type { LoadedTask } from './types.ts'

export type TaskRow = {
  name: string
  configHash: string
  enabled: number
  lastRunAt: number | null
  nextRunAt: number | null
  updatedAt: number
}

export function upsertTask(loaded: LoadedTask, now: number): void {
  const db = getDb()
  const prev = db
    .prepare(`SELECT config_hash as configHash, next_run_at as nextRunAt FROM tasks WHERE name = ?`)
    .get(loaded.name) as { configHash: string; nextRunAt: number | null } | undefined

  const cron = new Cron(loaded.config.schedule, { paused: true })
  const configChanged = !prev || prev.configHash !== loaded.configHash

  let nextRunAt = prev?.nextRunAt ?? null
  if (configChanged) {
    const d = cron.nextRun()
    nextRunAt = d ? d.getTime() : null
  }

  db.prepare(
    `INSERT INTO tasks (name, config_hash, enabled, last_run_at, next_run_at, updated_at)
     VALUES (?, ?, 1, NULL, ?, ?)
     ON CONFLICT(name) DO UPDATE SET
       config_hash = excluded.config_hash,
       next_run_at = CASE WHEN tasks.config_hash = excluded.config_hash
                          THEN tasks.next_run_at
                          ELSE excluded.next_run_at END,
       updated_at = excluded.updated_at`,
  ).run(loaded.name, loaded.configHash, nextRunAt, now)
}

export async function syncAllTasks(): Promise<{
  synced: string[]
  orphaned: string[]
  errors: { name: string; error: string }[]
  loaded: LoadedTask[]
}> {
  const now = Date.now()
  const db = getDb()
  const { loaded, errors } = await loadAllTasks()
  const onDisk = new Set(loaded.map((t) => t.name))

  for (const t of loaded) upsertTask(t, now)

  const stored = db.prepare(`SELECT name FROM tasks`).all() as { name: string }[]
  const orphaned: string[] = []
  for (const row of stored) {
    if (!onDisk.has(row.name)) orphaned.push(row.name)
  }
  // Don't delete orphans automatically — keep run history. A future `task cleanup` can prune them.

  return { synced: loaded.map((t) => t.name), orphaned, errors, loaded }
}

export function getTaskRow(name: string): TaskRow | null {
  const row = getDb()
    .prepare(
      `SELECT name, config_hash as configHash, enabled,
              last_run_at as lastRunAt, next_run_at as nextRunAt, updated_at as updatedAt
       FROM tasks WHERE name = ?`,
    )
    .get(name) as TaskRow | undefined
  return row ?? null
}

export function listTaskRows(): TaskRow[] {
  return getDb()
    .prepare(
      `SELECT name, config_hash as configHash, enabled,
              last_run_at as lastRunAt, next_run_at as nextRunAt, updated_at as updatedAt
       FROM tasks ORDER BY name`,
    )
    .all() as TaskRow[]
}

export function setEnabled(name: string, enabled: boolean): boolean {
  const info = getDb()
    .prepare(`UPDATE tasks SET enabled = ?, updated_at = ? WHERE name = ?`)
    .run(enabled ? 1 : 0, Date.now(), name)
  return info.changes > 0
}

export function markRan(name: string, endedAt: number, schedule: string): void {
  const cron = new Cron(schedule, { paused: true })
  const next = cron.nextRun(new Date(endedAt))
  getDb()
    .prepare(`UPDATE tasks SET last_run_at = ?, next_run_at = ?, updated_at = ? WHERE name = ?`)
    .run(endedAt, next ? next.getTime() : null, endedAt, name)
}

export function removeTaskRow(name: string): boolean {
  const info = getDb().prepare(`DELETE FROM tasks WHERE name = ?`).run(name)
  return info.changes > 0
}
