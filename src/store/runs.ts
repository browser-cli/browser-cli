import { getDb } from './db.ts'

export type Run = {
  id: number
  taskName: string
  status: 'ok' | 'error'
  startedAt: number
  endedAt: number
  newItemsCount: number
  error: string | null
}

export function insertRun(run: Omit<Run, 'id'>): number {
  const info = getDb()
    .prepare(
      `INSERT INTO runs (task_name, status, started_at, ended_at, new_items_count, error)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      run.taskName,
      run.status,
      run.startedAt,
      run.endedAt,
      run.newItemsCount,
      run.error ?? null,
    )
  return Number(info.lastInsertRowid)
}

export function recentRuns(taskName: string, limit: number): Run[] {
  return getDb()
    .prepare(
      `SELECT id, task_name as taskName, status,
              started_at as startedAt, ended_at as endedAt,
              new_items_count as newItemsCount, error
       FROM runs WHERE task_name = ?
       ORDER BY started_at DESC
       LIMIT ?`,
    )
    .all(taskName, limit) as Run[]
}
