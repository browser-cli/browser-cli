import crypto from 'node:crypto'
import os from 'node:os'
import { getDb } from './db.ts'

export type SlotHandle = {
  release: () => void
}

const HOSTNAME = os.hostname()
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Cross-process semaphore. `acquireSlot(key, max)` blocks until at most
 * `max - 1` other holders are alive on this key, then inserts a row and
 * returns a `release()` to remove it. Holders carry pid + hostname so a
 * crashed process's slot is reaped on the next acquire attempt (we only
 * reap entries from the current host — `process.kill(pid, 0)` only knows
 * about local pids).
 *
 * Best-effort FIFO: every waiter polls with jittered backoff, so the
 * order isn't strict, but no waiter starves indefinitely while the
 * key is at-or-below capacity.
 */
export async function acquireSlot(
  key: string,
  max: number,
  opts: { pollMs?: number; signal?: AbortSignal } = {},
): Promise<SlotHandle> {
  if (!Number.isInteger(max) || max < 1) {
    throw new Error(`acquireSlot: max must be a positive integer (got ${max})`)
  }
  const db = getDb()
  const token = crypto.randomUUID()
  const basePoll = opts.pollMs ?? 750

  for (;;) {
    if (opts.signal?.aborted) throw new Error('acquireSlot aborted')

    const acquired = db.transaction(() => {
      const rows = db
        .prepare(
          `SELECT holder_token, pid, hostname FROM concurrency_holders WHERE key = ?`,
        )
        .all(key) as { holder_token: string; pid: number; hostname: string }[]

      const reap = db.prepare(
        `DELETE FROM concurrency_holders WHERE key = ? AND holder_token = ?`,
      )
      let alive = 0
      for (const r of rows) {
        if (r.hostname !== HOSTNAME) {
          // Foreign-host holder — assume alive; can't probe across machines.
          alive++
          continue
        }
        try {
          process.kill(r.pid, 0)
          alive++
        } catch {
          reap.run(key, r.holder_token)
        }
      }

      if (alive >= max) return false

      db.prepare(
        `INSERT INTO concurrency_holders (key, holder_token, pid, hostname, acquired_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(key, token, process.pid, HOSTNAME, Date.now())
      return true
    }).immediate()

    if (acquired) {
      let released = false
      return {
        release() {
          if (released) return
          released = true
          try {
            getDb()
              .prepare(
                `DELETE FROM concurrency_holders WHERE key = ? AND holder_token = ?`,
              )
              .run(key, token)
          } catch {
            // db may be closed during shutdown; safe to ignore — dead-holder
            // reaping on the next acquire will clean up our row.
          }
        },
      }
    }

    const jitter = Math.random() * basePoll * 0.5
    await sleep(basePoll + jitter)
  }
}

/** Test/debug helper. Returns count of live holders on this key. */
export function holderCount(key: string): number {
  const r = getDb()
    .prepare(`SELECT COUNT(*) as n FROM concurrency_holders WHERE key = ?`)
    .get(key) as { n: number }
  return r.n
}
