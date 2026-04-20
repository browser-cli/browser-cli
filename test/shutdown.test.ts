import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Stagehand } from '@browserbasehq/stagehand'
import { safeClose } from '../src/shutdown.ts'

function neverResolving(): Promise<void> {
  return new Promise(() => {})
}

type WsStub = { terminated: boolean; closed: boolean }

function stubWithWs(closeBehavior: () => Promise<void>): { sh: Stagehand; ws: WsStub } {
  const ws: WsStub = { terminated: false, closed: false }
  const sh = {
    close: () => closeBehavior(),
    ctx: {
      conn: {
        ws: {
          terminate: () => {
            ws.terminated = true
          },
          close: () => {
            ws.closed = true
          },
        },
      },
    },
  } as unknown as Stagehand
  return { sh, ws }
}

test('safeClose returns within soft window when graceful close resolves', async () => {
  const { sh, ws } = stubWithWs(async () => {})

  const started = Date.now()
  await safeClose(sh, { softMs: 500, hardMs: 500 })
  const elapsed = Date.now() - started

  assert.ok(elapsed < 200, `expected fast return, got ${elapsed}ms`)
  assert.equal(ws.terminated, false, 'ws.terminate must not be called on happy path')
})

test('safeClose falls back to ws.terminate when both close phases hang', async () => {
  const { sh, ws } = stubWithWs(neverResolving)

  const started = Date.now()
  await safeClose(sh, { softMs: 80, hardMs: 80 })
  const elapsed = Date.now() - started

  // soft + hard = 160ms; allow ~200ms headroom for the event loop.
  assert.ok(elapsed >= 160 && elapsed < 400, `elapsed=${elapsed}ms out of expected 160–400`)
  assert.equal(ws.terminated, true, 'ws.terminate must be invoked after both phases time out')
})

test('safeClose uses ws.close when ws.terminate is unavailable', async () => {
  const ws = { closed: false }
  const sh = {
    close: () => neverResolving(),
    ctx: { conn: { ws: { close: () => { ws.closed = true } } } },
  } as unknown as Stagehand

  await safeClose(sh, { softMs: 40, hardMs: 40 })
  assert.equal(ws.closed, true)
})

test('safeClose swallows errors from stagehand.close and returns without touching ws', async () => {
  const ws: WsStub = { terminated: false, closed: false }
  const sh = {
    close: () => Promise.reject(new Error('boom')),
    ctx: { conn: { ws: {
      terminate: () => { ws.terminated = true },
      close: () => { ws.closed = true },
    } } },
  } as unknown as Stagehand

  await safeClose(sh, { softMs: 40, hardMs: 40 })
  assert.equal(ws.terminated, false, 'rejection is counted as completion; terminate skipped')
  assert.equal(ws.closed, false)
})
