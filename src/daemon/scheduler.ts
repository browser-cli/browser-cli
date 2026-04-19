import { Cron } from 'croner'
import { listTaskRows } from '../task/registry.ts'
import type { TaskRow } from '../task/registry.ts'

export type DueTask = { row: TaskRow }

export function findDue(now: number = Date.now()): DueTask[] {
  const rows = listTaskRows()
  const out: DueTask[] = []
  for (const r of rows) {
    if (!r.enabled) continue
    if (r.nextRunAt != null && r.nextRunAt <= now) {
      out.push({ row: r })
    }
  }
  return out
}

export function nextRunAt(schedule: string, fromMs: number = Date.now()): number | null {
  const cron = new Cron(schedule, { paused: true })
  const d = cron.nextRun(new Date(fromMs))
  return d ? d.getTime() : null
}
