import type { Stagehand } from '@browserbasehq/stagehand'

type V3Page = Awaited<ReturnType<Stagehand['context']['newPage']>>

export type ActiveSession = {
  id: string
  stagehand: Stagehand
  // Snapshot of pages that existed at session-init time, so we can avoid
  // closing tabs that belong to the user (or to other workflows running in
  // the same Chrome). Each /cdp/<clientId> connection sees its own context,
  // so this set only contains pages this client could see at startup.
  preExisting: Set<V3Page>
  preExistingUrls: Map<V3Page, string>
}

const active = new Set<ActiveSession>()
let handlersInstalled = false
let shuttingDown = false

export function registerSession(session: ActiveSession): void {
  active.add(session)
}

export function unregisterSession(session: ActiveSession): void {
  active.delete(session)
}

/**
 * Close every page this session opened (i.e. every page in the session's
 * context that is NOT in the preExisting snapshot). Also closes pre-existing
 * blanks that the workflow used and left blank, since those are effectively
 * disposable.
 *
 * Used by both the normal-exit `withBrowser` finally AND the SIGINT-path
 * `shutdownAndExit`, so long-running workflows (HTTP servers etc.) get the
 * same tab cleanup as one-shot workflows when they exit via signal.
 *
 * Defensive against an already-closed stagehand: if `context.pages()` or
 * `page.url()` throws, we simply skip — the underlying CDP target is gone,
 * which is exactly what we wanted.
 */
export async function closeWorkflowPages(
  s: Pick<ActiveSession, 'stagehand' | 'preExisting' | 'preExistingUrls'>,
): Promise<void> {
  let pages: V3Page[]
  try {
    pages = s.stagehand.context.pages()
  } catch {
    return
  }
  for (const v3Page of pages) {
    const wasPre = s.preExisting.has(v3Page)
    const wasBlank = s.preExistingUrls.get(v3Page) === 'about:blank'
    let stillBlank = false
    try {
      stillBlank = v3Page.url() === 'about:blank'
    } catch {
      continue
    }
    if (!wasPre || (wasBlank && stillBlank)) {
      await v3Page.close().catch(() => {})
    }
  }
}

type SafeCloseOpts = { softMs?: number; hardMs?: number }

/**
 * Two-phase shutdown of a Stagehand session:
 *   1. Graceful: stagehand.close() — sends Network.disable, Target.detach, closes CDP WS cleanly.
 *   2. Force: stagehand.close({ force: true }) — bypasses the isClosing guard.
 *   3. Hard: terminate the underlying WebSocket so Chrome sees the client drop
 *      and reclaims every CDP session attributed to it.
 * After hardMs elapses the caller is expected to fall back to process.exit(),
 * which we do not call from here so callers stay in control of exit codes.
 */
export async function safeClose(stagehand: Stagehand, opts: SafeCloseOpts = {}): Promise<void> {
  const softMs = opts.softMs ?? 3000
  const hardMs = opts.hardMs ?? 2000

  if (await raceTimeout(stagehand.close().catch(() => {}), softMs)) return

  if (await raceTimeout(stagehand.close({ force: true }).catch(() => {}), hardMs)) return

  forceTerminateWs(stagehand)
}

async function raceTimeout(p: Promise<void>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms)
  })
  const done = p.then(() => true)
  const winner = await Promise.race([done, timeout])
  if (timer) clearTimeout(timer)
  return winner
}

function forceTerminateWs(stagehand: Stagehand): void {
  try {
    const ws = (stagehand as unknown as { ctx?: { conn?: { ws?: { terminate?: () => void; close?: () => void } } } })
      .ctx?.conn?.ws
    if (ws?.terminate) ws.terminate()
    else if (ws?.close) ws.close()
  } catch {
    // last-resort fallback; swallow so caller can still process.exit
  }
}

type SignalExit = { signal: NodeJS.Signals; code: number }
const SIGNAL_EXITS: SignalExit[] = [
  { signal: 'SIGINT', code: 130 },
  { signal: 'SIGTERM', code: 143 },
  { signal: 'SIGHUP', code: 129 },
]

/**
 * Register process-level handlers that guarantee safeClose runs before exit
 * on any abnormal path. Idempotent: calling twice is a no-op.
 *
 * We do NOT swallow errors here — uncaughtException/unhandledRejection still
 * exit with code 1, but only after the cleanup window has elapsed. This
 * preserves observability while preventing leaked CDP sessions.
 */
export function installShutdownHandlers(): void {
  if (handlersInstalled) return
  handlersInstalled = true

  for (const { signal, code } of SIGNAL_EXITS) {
    process.on(signal, () => {
      void shutdownAndExit(code, `received ${signal}`)
    })
  }

  process.on('uncaughtException', (err) => {
    process.stderr.write(`uncaughtException: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`)
    void shutdownAndExit(1, 'uncaughtException')
  })

  process.on('unhandledRejection', (reason) => {
    process.stderr.write(`unhandledRejection: ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}\n`)
    void shutdownAndExit(1, 'unhandledRejection')
  })
}

async function shutdownAndExit(code: number, reason: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true

  if (active.size === 0) {
    process.exit(code)
    return
  }

  if (process.env.BROWSER_CLI_DEBUG === '1') {
    process.stderr.write(`shutdown: ${reason}; closing ${active.size} session(s)\n`)
  }

  // Per-session: close the workflow's pages first so the tabs go away in
  // the user's Chrome, THEN safeClose the CDP session. safeClose alone only
  // detaches CDP — without the page-close step, long-running workflows that
  // exit via SIGINT (e.g. HTTP-server workflows) leave their tab open.
  const closes = Array.from(active).map(async (s) => {
    await closeWorkflowPages(s).catch(() => {})
    await safeClose(s.stagehand).catch(() => {})
  })

  // Upper bound: page-close timeout (~2s/page realistically) + safeClose
  // softMs(3s) + hardMs(2s) + small slack. If a session hangs past this
  // despite all phases, exit anyway — the OS will reap the WebSocket when
  // the process dies.
  await raceTimeout(Promise.all(closes).then(() => {}), 8000)

  active.clear()
  process.exit(code)
}
