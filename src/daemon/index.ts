import chokidar from 'chokidar'
import { TASKS_DIR, ensureHomeDirs, loadDotEnv } from '../paths.ts'
import { syncAllTasks } from '../task/registry.ts'
import { loadTask } from '../task/loader.ts'
import { findDue } from './scheduler.ts'
import { executeTask } from './executor.ts'
import { warnIfAppriseMissing } from '../sinks/apprise.ts'

export type DaemonOptions = {
  tickMs?: number
}

let stopRequested = false
let running = new Set<string>()

function now(): string {
  return new Date().toISOString()
}

function log(msg: string): void {
  process.stdout.write(`[${now()}] ${msg}\n`)
}

function logErr(msg: string): void {
  process.stderr.write(`[${now()}] ${msg}\n`)
}

async function reconcile(): Promise<void> {
  const res = await syncAllTasks()
  if (res.errors.length > 0) {
    for (const e of res.errors) logErr(`task ${e.name}: ${e.error}`)
  }
  if (res.synced.length > 0) {
    log(`reconcile: ${res.synced.length} tasks registered${res.orphaned.length ? `, ${res.orphaned.length} orphan rows kept` : ''}`)
  }
}

async function tick(): Promise<void> {
  const due = findDue()
  if (due.length === 0) return

  await Promise.all(
    due.map(async (d) => {
      if (running.has(d.row.name)) {
        log(`skip ${d.row.name} — previous run still in progress`)
        return
      }
      running.add(d.row.name)
      try {
        const task = await loadTask(d.row.name)
        log(`run ${d.row.name} (mode=${task.config.itemKey ? 'items' : 'snapshot'})`)
        const res = await executeTask(task)
        if (res.status === 'ok') {
          log(`ok ${d.row.name} — ${res.mode}, ${res.newItemsCount} ${res.mode === 'items' ? 'new items' : 'change'}`)
        } else {
          logErr(`error ${d.row.name} — ${res.error}`)
        }
      } catch (err) {
        logErr(`exec ${d.row.name}: ${(err as Error).message}`)
      } finally {
        running.delete(d.row.name)
      }
    }),
  )
}

export async function startDaemon(opts: DaemonOptions = {}): Promise<void> {
  const tickMs = opts.tickMs ?? 15_000
  loadDotEnv()
  ensureHomeDirs()
  warnIfAppriseMissing()

  log(`daemon starting (tasks dir: ${TASKS_DIR}, tick: ${tickMs}ms)`)
  await reconcile()

  const watcher = chokidar.watch(TASKS_DIR, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
  })
  watcher.on('add', (p) => {
    log(`task file added: ${p}`)
    reconcile().catch((e) => logErr(`reconcile: ${(e as Error).message}`))
  })
  watcher.on('change', (p) => {
    log(`task file changed: ${p}`)
    reconcile().catch((e) => logErr(`reconcile: ${(e as Error).message}`))
  })
  watcher.on('unlink', (p) => {
    log(`task file removed: ${p}`)
    reconcile().catch((e) => logErr(`reconcile: ${(e as Error).message}`))
  })

  const shutdown = (signal: string) => {
    if (stopRequested) return
    stopRequested = true
    log(`received ${signal}, shutting down…`)
    watcher.close().catch(() => {})
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  while (!stopRequested) {
    try {
      await tick()
    } catch (err) {
      logErr(`tick: ${(err as Error).message}`)
    }
    for (let i = 0; i < tickMs / 100 && !stopRequested; i++) {
      await sleep(100)
    }
  }
  log('daemon stopped')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
