import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { freshDb } from './helpers.ts'
import { withBrowser } from '../src/browser.ts'

// End-to-end: run a real withBrowser session against a local mock and verify
// the auto-throttling on page.fetch() actually paces calls. Uses Stagehand,
// so it'll skip if no Chrome is reachable (e.g. CI without playwriter).
test('page.fetch auto-throttles by declared host', { timeout: 60000 }, async (t) => {
  await freshDb()

  const port = await new Promise<number>((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ts: Date.now(), url: req.url }))
    })
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => resolve((srv.address() as AddressInfo).port))
    t.after(() => new Promise<void>((r) => srv.close(() => r())))
  })

  const host = `127.0.0.1:${port}`
  const timestamps: number[] = []

  try {
    await withBrowser(
      {
        rateLimits: { [host]: { rps: 5, burst: 1 } }, // ~200ms gap between calls
      },
      async (browser) => {
        const page = await browser.newPage()
        // Land on something so page.fetch has a real document context.
        await page.goto(`http://${host}/seed`, { waitUntil: 'domcontentloaded' })
        for (let i = 0; i < 4; i++) {
          await page.fetch(`http://${host}/api/${i}`)
          timestamps.push(Date.now())
        }
      },
    )
  } catch (err) {
    const msg = (err as Error).message
    if (/LLM credentials|CDP|playwriter|chromium/i.test(msg)) {
      t.skip(`stagehand env not available: ${msg.split('\n')[0]}`)
      return
    }
    throw err
  }

  const gaps: number[] = []
  for (let i = 1; i < timestamps.length; i++) {
    gaps.push(timestamps[i]! - timestamps[i - 1]!)
  }
  // 5 rps, burst 1 → first call free, then 200ms gaps. Allow slack for setup.
  for (let i = 0; i < gaps.length; i++) {
    assert.ok(
      gaps[i]! >= 150,
      `gap ${i} should be >=150ms (got ${gaps[i]}ms; all gaps: ${gaps.join(', ')})`,
    )
  }
})
