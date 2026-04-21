import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { DAEMON_PID_PATH, DAEMON_LOG_PATH, TASKS_DIR, ensureHomeDirs } from '../paths.ts'
import { startDaemon } from '../daemon/index.ts'

const USAGE = `Usage:
  browser-cli daemon [--detach|-d]      Start the scheduler (foreground by default)
  browser-cli daemon status             Show whether a daemon is running
  browser-cli daemon stop               Stop a detached daemon via pidfile

Tick interval defaults to 15s. While running, the daemon watches
${TASKS_DIR} and reconciles changes into sqlite on the fly.
`

export async function runDaemon(argv: string[]): Promise<void> {
  const [sub, ...rest] = argv
  if (sub === '-h' || sub === '--help') {
    process.stdout.write(USAGE)
    return
  }
  if (!sub || sub === 'start') {
    return cmdStart(rest)
  }
  if (sub === '--detach' || sub === '-d') {
    return cmdStart([sub, ...rest])
  }
  switch (sub) {
    case 'status':
      return cmdStatus()
    case 'stop':
      return cmdStop()
    default:
      process.stderr.write(`Unknown subcommand: daemon ${sub}\n\n${USAGE}`)
      process.exit(2)
  }
}

async function cmdStart(args: string[]): Promise<void> {
  const detach = args.includes('--detach') || args.includes('-d')
  const isDetachedChild = process.env.BROWSER_CLI_DAEMON_CHILD === '1'

  ensureHomeDirs()

  if (!isDetachedChild) {
    if (isDaemonAlive()) {
      const pid = readPid()
      process.stderr.write(`daemon already running (pid ${pid}). use \`daemon stop\` first.\n`)
      process.exit(1)
    }
    if (fs.existsSync(DAEMON_PID_PATH)) fs.unlinkSync(DAEMON_PID_PATH)
  }

  if (detach && !isDetachedChild) {
    const out = fs.openSync(DAEMON_LOG_PATH, 'a')
    const err = fs.openSync(DAEMON_LOG_PATH, 'a')
    const child = spawn(process.execPath, [process.argv[1]!, 'daemon'], {
      detached: true,
      stdio: ['ignore', out, err],
      env: { ...process.env, BROWSER_CLI_DAEMON_CHILD: '1' },
    })
    child.unref()
    process.stdout.write(`daemon started, pid=${child.pid}\n`)
    process.stdout.write(`logs: ${DAEMON_LOG_PATH}\n`)
    process.stdout.write(`stop with: browser-cli daemon stop\n`)
    return
  }

  fs.writeFileSync(DAEMON_PID_PATH, String(process.pid), 'utf8')
  try {
    await startDaemon()
  } finally {
    try {
      if (readPid() === process.pid) fs.unlinkSync(DAEMON_PID_PATH)
    } catch {}
  }
}

function cmdStatus(): void {
  const pid = readPid()
  if (pid == null) {
    process.stdout.write('daemon: not running\n')
    return
  }
  if (isPidAlive(pid)) {
    process.stdout.write(`daemon: running (pid ${pid})\n`)
    process.stdout.write(`logs: ${DAEMON_LOG_PATH}\n`)
  } else {
    process.stdout.write(`daemon: not running (stale pidfile for ${pid})\n`)
  }
}

function cmdStop(): void {
  const pid = readPid()
  if (pid == null) {
    process.stderr.write('daemon: not running (no pidfile)\n')
    process.exit(1)
  }
  if (!isPidAlive(pid)) {
    process.stderr.write(`daemon: not running (stale pidfile for ${pid}), cleaning up\n`)
    try { fs.unlinkSync(DAEMON_PID_PATH) } catch {}
    return
  }
  try {
    process.kill(pid, 'SIGTERM')
  } catch (err) {
    process.stderr.write(`failed to kill ${pid}: ${(err as Error).message}\n`)
    process.exit(1)
  }
  process.stdout.write(`sent SIGTERM to pid ${pid}\n`)
}

function readPid(): number | null {
  if (!fs.existsSync(DAEMON_PID_PATH)) return null
  const txt = fs.readFileSync(DAEMON_PID_PATH, 'utf8').trim()
  const n = Number(txt)
  return Number.isFinite(n) && n > 0 ? n : null
}

function isDaemonAlive(): boolean {
  const pid = readPid()
  return pid != null && isPidAlive(pid)
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    return code === 'EPERM'
  }
}
