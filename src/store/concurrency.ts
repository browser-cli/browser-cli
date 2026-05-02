import crypto from 'node:crypto'
import os from 'node:os'
import { getDb } from './db.ts'

export type SlotHandle = {
  release: () => void
}

const HOSTNAME = os.hostname()
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Heartbeat cadence — holders refresh acquired_at this often so the reaper
 *  can distinguish "still working" from "process forked off and orphaned".
 *  Tuned: 60s heartbeat, 180s staleness threshold (3x). Long-running services
 *  (e.g. xhs search-server) heartbeat fine; crashed/orphaned slots get reaped
 *  within ~3 minutes regardless of whether their PID is still alive. */
const HEARTBEAT_MS = 60_000
const STALE_AFTER_MS = 180_000

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
          `SELECT holder_token, pid, hostname, acquired_at FROM concurrency_holders WHERE key = ?`,
        )
        .all(key) as { holder_token: string; pid: number; hostname: string; acquired_at: number }[]

      const reap = db.prepare(
        `DELETE FROM concurrency_holders WHERE key = ? AND holder_token = ?`,
      )
      const now = Date.now()
      let alive = 0
      for (const r of rows) {
        // Heartbeat-based staleness: a healthy holder refreshes acquired_at
        // every HEARTBEAT_MS via the interval set up below. If we haven't seen
        // a heartbeat in STALE_AFTER_MS the holder is presumed orphaned even
        // if its PID still answers — covers the "process forked off and is
        // still alive but no longer doing the work that held this slot" case.
        const stale = now - r.acquired_at > STALE_AFTER_MS
        if (r.hostname !== HOSTNAME) {
          // Foreign-host holder — can't probe pid across machines, but the
          // heartbeat staleness check still works since acquired_at is
          // wall-clock-time and we share the SQLite db.
          if (stale) {
            reap.run(key, r.holder_token)
          } else {
            alive++
          }
          continue
        }
        try {
          process.kill(r.pid, 0)
          if (stale) {
            reap.run(key, r.holder_token)
          } else {
            alive++
          }
        } catch {
          reap.run(key, r.holder_token)
        }
      }

      if (alive >= max) return false

      db.prepare(
        `INSERT INTO concurrency_holders (key, holder_token, pid, hostname, acquired_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(key, token, process.pid, HOSTNAME, now)
      return true
    }).immediate()

    if (acquired) {
      let released = false
      // Heartbeat: refresh acquired_at on a steady cadence so reapers in
      // other processes can tell we're still healthy. unref() so the timer
      // doesn't pin the event loop and prevent normal exit.
      const heartbeat = setInterval(() => {
        if (released) return
        try {
          getDb()
            .prepare(
              `UPDATE concurrency_holders SET acquired_at = ? WHERE key = ? AND holder_token = ?`,
            )
            .run(Date.now(), key, token)
        } catch {
          // db transient errors are non-fatal — next heartbeat will retry.
        }
      }, HEARTBEAT_MS)
      heartbeat.unref?.()
      return {
        release() {
          if (released) return
          released = true
          clearInterval(heartbeat)
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
