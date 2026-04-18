import type { Stagehand } from '@browserbasehq/stagehand'

export type StagehandPage = Awaited<ReturnType<Stagehand['context']['newPage']>>

export type CapturedResponse = {
  url: string
  method: string
  status: number
  /** Populated when the response declared a JSON content-type and parsed cleanly. */
  json?: unknown
  /** Raw text body for non-JSON responses (or JSON that failed to parse). */
  text?: string
}

export type Matcher = string | RegExp | ((url: string) => boolean)

// Self-guarded IIFE. Safe to inject many times — re-runs are no-ops.
// Stored as a string so tsx never tries to transform it.
const SPY_SOURCE = `(() => {
  if (globalThis.__bcNetworkSpy) return
  var MAX = 500
  var buf = []
  function push(entry) { if (buf.length >= MAX) buf.shift(); buf.push(entry) }
  function decode(ct, text) {
    if ((ct || '').indexOf('json') !== -1) {
      try { return { json: JSON.parse(text) } } catch (e) {}
    }
    return { text: text }
  }
  var origFetch = globalThis.fetch
  if (origFetch) {
    globalThis.fetch = function (input, init) {
      return origFetch.call(this, input, init).then(function (resp) {
        try {
          var url = typeof input === 'string' ? input : (input && input.url) || ''
          var method = (init && init.method) || (input && input.method) || 'GET'
          var ct = resp.headers.get('content-type') || ''
          resp.clone().text().then(function (text) {
            var d = decode(ct, text)
            push({ url: url, method: String(method).toUpperCase(), status: resp.status, json: d.json, text: d.text })
          }).catch(function () {})
        } catch (e) {}
        return resp
      })
    }
  }
  var X = globalThis.XMLHttpRequest
  if (X) {
    var origOpen = X.prototype.open
    var origSend = X.prototype.send
    X.prototype.open = function (method, url) {
      this.__bcMethod = String(method || 'GET').toUpperCase()
      this.__bcUrl = String(url)
      return origOpen.apply(this, arguments)
    }
    X.prototype.send = function () {
      var self = this
      this.addEventListener('loadend', function () {
        try {
          var ct = self.getResponseHeader('content-type') || ''
          var text = typeof self.responseText === 'string' ? self.responseText : ''
          var d = decode(ct, text)
          push({ url: self.__bcUrl, method: self.__bcMethod, status: self.status, json: d.json, text: d.text })
        } catch (e) {}
      })
      return origSend.apply(this, arguments)
    }
  }
  globalThis.__bcNetworkSpy = { responses: buf, clear: function () { buf.length = 0 } }
})()`

function compileMatcher(m: Matcher): (url: string) => boolean {
  if (typeof m === 'function') return m
  if (m instanceof RegExp) return (url) => m.test(url)
  return (url) => url.includes(m)
}

const installed = new WeakSet<object>()

async function ensureSpy(page: StagehandPage): Promise<void> {
  if (installed.has(page as object)) return
  installed.add(page as object)
  // Cover all FUTURE navigations (loaded before any user script).
  await page.addInitScript(SPY_SOURCE)
  // Cover the CURRENT document if the page is already on something. Safe to fail
  // (e.g. about:blank with no JS context yet) — the init script will handle the next nav.
  try {
    await page.evaluate(SPY_SOURCE)
  } catch {
    /* no current document yet, addInitScript will catch the next nav */
  }
}

/**
 * Bulk capture of XHR/fetch responses. Install BEFORE `page.goto`. Call
 * `list()` after the actions you care about have completed.
 */
export async function captureResponses(
  page: StagehandPage,
  match: Matcher,
  opts: { method?: string; jsonOnly?: boolean } = {},
): Promise<{
  list: () => Promise<CapturedResponse[]>
  clear: () => Promise<void>
}> {
  await ensureSpy(page)
  const matchUrl = compileMatcher(match)
  return {
    async list() {
      const all = (await page.evaluate(
        'globalThis.__bcNetworkSpy ? globalThis.__bcNetworkSpy.responses.slice() : []',
      )) as CapturedResponse[]
      return all.filter((r) => {
        if (opts.method && r.method !== opts.method.toUpperCase()) return false
        if (opts.jsonOnly && r.json === undefined) return false
        return matchUrl(r.url)
      })
    },
    async clear() {
      try {
        await page.evaluate(
          'globalThis.__bcNetworkSpy && globalThis.__bcNetworkSpy.clear()',
        )
      } catch {
        /* ignore */
      }
    },
  }
}

/**
 * Wait for the first JSON response whose URL matches `match` (and optionally
 * passes `predicate`). Install BEFORE `page.goto` for reliable capture.
 *
 * Returns the captured `{ url, method, status, json }` entry; `json` is the
 * parsed body. Throws if no match within `timeout` (default 30s).
 */
export async function waitForJsonResponse(
  page: StagehandPage,
  match: Matcher,
  opts: { method?: string; timeout?: number; predicate?: (json: unknown) => boolean; pollMs?: number } = {},
): Promise<CapturedResponse> {
  const timeout = opts.timeout ?? 30000
  const pollMs = opts.pollMs ?? 100
  const handle = await captureResponses(page, match, { method: opts.method, jsonOnly: true })
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const list = await handle.list()
    const hit = list.find((r) => (opts.predicate ? opts.predicate(r.json) : true))
    if (hit) return hit
    await new Promise((r) => setTimeout(r, pollMs))
  }
  throw new Error(
    `waitForJsonResponse: no JSON response matching ${String(match)} within ${timeout}ms`,
  )
}

/**
 * Fire a request from inside the page's JS context. Inherits cookies and
 * same-origin auth from the current page — useful for hitting authenticated
 * APIs (X, GitHub, etc.) without re-implementing the auth headers in Node.
 *
 * Caller is responsible for any extra headers the API needs (e.g.
 * `X-CSRF-Token`, `Authorization` for non-cookie auth).
 */
export async function pageFetch<T = unknown>(
  page: StagehandPage,
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<T> {
  return (await page.evaluate(
    async ([u, i]: [string, typeof init]) => {
      const r = await fetch(u, i)
      const ct = r.headers.get('content-type') || ''
      const text = await r.text()
      if (ct.includes('json')) return JSON.parse(text) as unknown
      return text
    },
    [url, init ?? {}],
  )) as T
}
