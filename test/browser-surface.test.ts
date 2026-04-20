import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page, Browser } from '../src/browser.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BROWSER_SRC = path.resolve(__dirname, '..', 'src', 'browser.ts')

// Compile-time surface check — if `Page` gains any of these keys, `Extract`
// narrows to a non-`never` union, which then doesn't satisfy the `true` slot,
// and tsc fails the typecheck. The runtime assert is a belt-and-suspenders.
test('Page surface — forbidden Playwright/Stagehand methods are absent (compile-time)', () => {
  type ForbiddenPageKeys =
    | 'evaluate'
    | 'evaluateHandle'
    | 'on'
    | 'once'
    | 'off'
    | '$'
    | '$$'
    | '$eval'
    | '$$eval'
    | 'newCDPSession'
    | 'route'
    | 'addInitScript'
    | 'waitForFunction'
    | 'waitForRequest'
    | 'waitForResponse'
    | 'exposeFunction'
    | 'context'

  type Leak = Extract<keyof Page, ForbiddenPageKeys>
  const _ok: Leak extends never ? true : never = true as Leak extends never ? true : never
  assert.equal(_ok, true)
})

test('Browser surface — forbidden Playwright methods are absent (compile-time)', () => {
  type ForbiddenBrowserKeys =
    | 'close'
    | 'contexts'
    | 'newContext'
    | 'on'
    | 'once'
    | 'off'

  type Leak = Extract<keyof Browser, ForbiddenBrowserKeys>
  const _ok: Leak extends never ? true : never = true as Leak extends never ? true : never
  assert.equal(_ok, true)
})

test('Page surface — wrapPage exposes exactly the allow-listed keys (runtime)', () => {
  const src = fs.readFileSync(BROWSER_SRC, 'utf8')
  const match = src.match(/export interface Page \{([\s\S]*?)\n\}/)
  assert.ok(match, 'could not find `export interface Page` block in src/browser.ts')
  const body = match[1]

  const forbidden = [
    /\bevaluate\s*\(/,
    /\bon\s*\(/,
    /\$\s*\(/,
    /\$\$\s*\(/,
    /\bnewCDPSession\s*\(/,
    /\broute\s*\(/,
    /\baddInitScript\s*\(/,
  ]
  for (const pattern of forbidden) {
    assert.ok(!pattern.test(body), `Page interface must not declare ${pattern}`)
  }

  // Allow-list spot checks — if these go missing, we've accidentally deleted
  // part of the wrapper surface.
  for (const expected of ['goto', 'extract', 'act', 'observe', 'extractFromJson', 'fetch', 'captureResponses', 'waitForJsonResponse', 'unsafe']) {
    assert.ok(body.includes(expected), `Page interface should expose ${expected}`)
  }
})

test('unsafe() escape hatch is the ONLY place that hands back v3Page', () => {
  const src = fs.readFileSync(BROWSER_SRC, 'utf8')
  const lines = src.split('\n')

  // Find every line that returns an object literal containing v3Page.
  const leaks: Array<{ line: number; body: string; methodName: string | null }> = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!/return\s*\{[^}]*\bv3Page\b/.test(line)) continue
    // Walk backward to find the nearest method signature. Skip control-flow
    // keywords (`if`, `for`, `while`, `switch`, `catch`) which also look like
    // `name(` but aren't method names.
    const SKIP = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'await'])
    let methodName: string | null = null
    for (let j = i - 1; j >= Math.max(0, i - 40); j--) {
      const m = lines[j].match(/^\s*(?:async\s+)?([a-zA-Z_$][\w$]*)\s*\(/)
      if (m && !SKIP.has(m[1])) {
        methodName = m[1]
        break
      }
    }
    leaks.push({ line: i + 1, body: line.trim(), methodName })
  }

  assert.equal(leaks.length, 1, `expected exactly one v3Page return; got ${leaks.length}: ${JSON.stringify(leaks)}`)
  assert.equal(leaks[0].methodName, 'unsafe', `v3Page must only leak from unsafe(); found in ${leaks[0].methodName}() at line ${leaks[0].line}`)
})
