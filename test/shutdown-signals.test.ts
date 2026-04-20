import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.join(__dirname, 'fixtures', 'signal-child.ts')

type ChildResult = { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }

async function runUntilSignal(signal: NodeJS.Signals, expectedCode: number): Promise<ChildResult> {
  return await new Promise<ChildResult>((resolve, reject) => {
    const child = spawn('node', ['--import', 'tsx', FIXTURE], {
      stdio: ['ignore', 'pipe', 'pipe'],
      // Detach so Ctrl-C-like signals are handled by the child's own
      // installShutdownHandlers, not propagated from our test's own signal group.
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    let readyTimer: NodeJS.Timeout | undefined
    let hardTimer: NodeJS.Timeout | undefined

    const finish = (result: ChildResult | Error) => {
      if (settled) return
      settled = true
      if (readyTimer) clearTimeout(readyTimer)
      if (hardTimer) clearTimeout(hardTimer)
      if (result instanceof Error) reject(result)
      else resolve(result)
    }

    child.stdout.on('data', (buf: Buffer) => {
      stdout += buf.toString()
      if (stdout.includes('READY')) {
        // Give the handlers a beat to bind, then send the signal.
        setTimeout(() => child.kill(signal), 50)
      }
    })
    child.stderr.on('data', (buf: Buffer) => {
      stderr += buf.toString()
    })

    child.on('exit', (code, sig) => {
      finish({ code, signal: sig, stdout, stderr })
    })
    child.on('error', (err) => finish(err))

    // Fail loudly if READY never arrives (e.g. tsx failed to start).
    readyTimer = setTimeout(() => {
      if (!stdout.includes('READY')) {
        child.kill('SIGKILL')
        finish(new Error(`child never printed READY; stderr=${stderr}`))
      }
    }, 10000)

    // Absolute hard cap so a wedged handler can't hang the whole test run.
    hardTimer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(new Error(`child exceeded hard cap; exitCode=${expectedCode} expected`))
    }, 20000)
  })
}

test('SIGINT triggers safeClose → ws.terminate → exit 130', async () => {
  const res = await runUntilSignal('SIGINT', 130)
  assert.equal(res.code, 130, `exit code: got ${res.code}, stdout=${res.stdout}, stderr=${res.stderr}`)
  assert.ok(res.stdout.includes('TERMINATED'), 'ws.terminate must fire because stagehand.close hangs')
})

test('SIGTERM triggers safeClose → ws.terminate → exit 143', async () => {
  const res = await runUntilSignal('SIGTERM', 143)
  assert.equal(res.code, 143, `exit code: got ${res.code}, stdout=${res.stdout}, stderr=${res.stderr}`)
  assert.ok(res.stdout.includes('TERMINATED'))
})

test('SIGHUP triggers safeClose → ws.terminate → exit 129', async () => {
  const res = await runUntilSignal('SIGHUP', 129)
  assert.equal(res.code, 129, `exit code: got ${res.code}, stdout=${res.stdout}, stderr=${res.stderr}`)
  assert.ok(res.stdout.includes('TERMINATED'))
})
