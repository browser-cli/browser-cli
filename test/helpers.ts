import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Pick ONE home dir for the whole test run, before paths.ts loads (it captures env at import time).
const HOME =
  process.env.BROWSER_CLI_HOME ??
  path.join(os.tmpdir(), `bc-test-${process.pid}-${Date.now()}`)
process.env.BROWSER_CLI_HOME = HOME
fs.mkdirSync(HOME, { recursive: true })

export const TEST_HOME = HOME

export async function freshDb(): Promise<void> {
  const { __resetDbForTests } = await import('../src/store/db.ts')
  __resetDbForTests()
  const dbPath = path.join(HOME, 'db.sqlite')
  for (const p of [dbPath, dbPath + '-wal', dbPath + '-shm']) {
    if (fs.existsSync(p)) fs.rmSync(p, { force: true })
  }
}
