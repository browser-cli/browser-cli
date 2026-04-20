// Test fixture: stays alive under a stub Stagehand session so the parent test
// can send a signal and assert the installed handlers invoke safeClose + exit
// with the right signal-mapped code.
import type { Stagehand } from '@browserbasehq/stagehand'
import { registerSession, installShutdownHandlers } from '../../src/shutdown.ts'

let terminateCalled = false

const sh = {
  close: () => new Promise<void>(() => {}), // hang forever
  ctx: {
    conn: {
      ws: {
        terminate: () => {
          terminateCalled = true
          process.stdout.write('TERMINATED\n')
        },
      },
    },
  },
} as unknown as Stagehand

registerSession({ id: 'fixture', stagehand: sh })
installShutdownHandlers()

// Signal we're ready so the parent knows when to deliver the signal.
process.stdout.write('READY\n')

// Keep alive. SIGINT/SIGTERM/SIGHUP triggers the handler, which runs safeClose
// (hangs → times out → calls ws.terminate() → process.exit(code)).
setInterval(() => {
  // Keep a reference so the interval keeps the loop alive.
  void terminateCalled
}, 1000)
