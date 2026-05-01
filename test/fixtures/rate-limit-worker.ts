// Test fixture: acquires N tokens from a shared bucket and prints a JSON-line
// per acquire to stdout. Used by the cross-process integration test to prove
// that two browser-cli runs (separate Node processes) coordinate via SQLite.
//
// Args (positional): <key> <count>
// Required env: BROWSER_CLI_HOME (so we share the test sqlite db)
import { ensureBucket, acquireToken } from '../../src/store/rate-limit.ts'

const [, , key, countRaw] = process.argv
if (!key || !countRaw) {
  process.stderr.write('usage: rate-limit-worker.ts <key> <count>\n')
  process.exit(2)
}
const count = Number(countRaw)

// Ensure the bucket exists; the parent test seeds it with the desired spec
// before spawning, so this is a strictest-wins no-op (we use looser values).
ensureBucket(key, { rps: 1000, burst: 1000, manual: false })

;(async () => {
  for (let i = 0; i < count; i++) {
    await acquireToken(key)
    process.stdout.write(`${Date.now()}\n`)
  }
})().catch((err) => {
  process.stderr.write(`worker error: ${(err as Error).message}\n`)
  process.exit(1)
})
