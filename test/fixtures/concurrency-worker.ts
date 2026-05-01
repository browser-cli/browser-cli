// Test fixture: acquires a concurrency slot, prints "ACQUIRED <ts>", holds for
// the requested duration, releases, prints "RELEASED <ts>".
// Used by the cross-process integration test to prove the semaphore caps
// across separate Node processes.
import { acquireSlot } from '../../src/store/concurrency.ts'

const [, , key, maxRaw, holdMsRaw] = process.argv
if (!key || !maxRaw || !holdMsRaw) {
  process.stderr.write('usage: concurrency-worker.ts <key> <max> <holdMs>\n')
  process.exit(2)
}
const max = Number(maxRaw)
const holdMs = Number(holdMsRaw)

;(async () => {
  const slot = await acquireSlot(key, max, { pollMs: 100 })
  process.stdout.write(`ACQUIRED ${Date.now()}\n`)
  await new Promise((r) => setTimeout(r, holdMs))
  slot.release()
  process.stdout.write(`RELEASED ${Date.now()}\n`)
})().catch((err) => {
  process.stderr.write(`worker error: ${(err as Error).message}\n`)
  process.exit(1)
})
