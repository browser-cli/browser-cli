import type { Stagehand } from '@browserbasehq/stagehand'
import { Stagehand as StagehandCtor } from '@browserbasehq/stagehand'
import type { z } from 'zod'
import { makeClientId, makeStagehandConfig } from './stagehand-config.ts'
import { CACHE_DIR } from './paths.ts'
import { closeWorkflowPages, registerSession, safeClose, unregisterSession } from './shutdown.ts'
import {
  captureResponses as rawCaptureResponses,
  waitForJsonResponse as rawWaitForJsonResponse,
  type CapturedResponse,
  type Matcher,
} from './helpers/network.ts'
import { extractFromJson as rawExtractFromJson } from './helpers/extract-from-json.ts'
import { acquireToken, ensureBucket, RateLimiter, buildRateLimiter, type RateLimits } from './store/rate-limit.ts'

type V3Page = Awaited<ReturnType<Stagehand['context']['newPage']>>

export type FetchInit = {
  method?: string
  headers?: Record<string, string>
  body?: string
  credentials?: 'include' | 'omit' | 'same-origin'
}

export type ResponseCapture = {
  list(): Promise<CapturedResponse[]>
  clear(): Promise<void>
}

export type Observation = { selector: string; description: string }

export type WaitForJsonOpts = {
  method?: string
  timeout?: number
  predicate?: (json: unknown) => boolean
  pollMs?: number
}

export interface Page {
  // navigation & state
  goto(url: string, opts?: { waitUntil?: 'load' | 'domcontentloaded' }): Promise<void>
  url(): string
  close(): Promise<void>

  // Layer 3 — DOM via Stagehand (resilient, LLM-backed)
  extract<T extends z.ZodTypeAny>(instruction: string, schema: T): Promise<z.infer<T>>
  act(instruction: string): Promise<void>
  observe(instruction: string): Promise<Observation[]>

  // Layer 2.5 — JSON extract (cached path self-heal)
  extractFromJson<T extends z.ZodTypeAny>(json: unknown, instruction: string, schema: T): Promise<z.infer<T>>

  // Layer 2 — network
  fetch<T = unknown>(url: string, init?: FetchInit): Promise<T>
  captureResponses(match: Matcher, opts?: { method?: string; jsonOnly?: boolean }): Promise<ResponseCapture>
  waitForJsonResponse<T = unknown>(match: Matcher, opts?: WaitForJsonOpts): Promise<T>
  findResource(predicate: (entry: { name: string; initiatorType: string }) => boolean): Promise<string | null>

  // plumbing — selectors allowed only for form fills / presence checks
  click(selector: string): Promise<void>
  fill(selector: string, value: string): Promise<void>
  getText(selector: string): Promise<string>
  count(selector: string): Promise<number>
  waitForSelector(selector: string, opts?: { timeoutMs?: number; state?: 'attached' | 'visible' | 'hidden' | 'detached' }): Promise<void>
  waitForUrl(pattern: string | RegExp, opts?: { timeoutMs?: number; pollMs?: number }): Promise<void>

  // storage
  localStorage(key: string): Promise<string | null>
  setLocalStorage(key: string, value: string): Promise<void>

  // escape hatch — logs a WARN on first use per page so misuse is visible
  unsafe(): { v3Page: V3Page; stagehand: Stagehand }
}

export interface Browser {
  newPage(): Promise<Page>
  onCleanup(fn: () => void | Promise<void>): void
  /**
   * Run `fn` under a named rate-limit bucket. The bucket name must be declared
   * in the workflow's `rateLimits` export (or passed via `withBrowser` opts in
   * SDK use). Cross-process safe — multiple workflow runs targeting the same
   * bucket key share the same SQLite-backed token bucket.
   */
  rateLimit<T>(name: string, fn: () => Promise<T>): Promise<T>
  unsafe(): { stagehand: Stagehand }
}

export type WithBrowserOpts = {
  cdpUrl?: string
  /** Pre-built limiter (used by the workflow runner). */
  rateLimiter?: RateLimiter
  /** Convenience for SDK callers — equivalent to passing a limiter built from these declarations. */
  rateLimits?: RateLimits
}

export async function withBrowser<T>(
  opts: WithBrowserOpts,
  fn: (browser: Browser) => Promise<T>,
): Promise<T> {
  const rateLimiter = opts.rateLimiter ?? buildRateLimiter(opts.rateLimits)

  // Lazy Stagehand init: Layer 1 workflows (public API, no browser needed)
  // never call browser.newPage(), so we never pay the Chrome attach cost
  // and never register a CDP session that could leak.
  type Session = {
    stagehand: Stagehand
    sessionId: string
    preExisting: Set<V3Page>
    preExistingUrls: Map<V3Page, string>
  }
  const session: { current: Session | null } = { current: null }

  const ensureStagehand = async (): Promise<Stagehand> => {
    if (session.current) return session.current.stagehand
    const sh = new StagehandCtor(await makeStagehandConfig(CACHE_DIR, { cdpUrl: opts.cdpUrl }))
    await sh.init()
    const sessionId = makeClientId()
    const preExisting = new Set<V3Page>()
    const preExistingUrls = new Map<V3Page, string>()
    for (const p of sh.context.pages()) {
      preExisting.add(p)
      preExistingUrls.set(p, p.url())
    }
    registerSession({ id: sessionId, stagehand: sh, preExisting, preExistingUrls })
    session.current = { stagehand: sh, sessionId, preExisting, preExistingUrls }
    return sh
  }

  const cleanupFns: Array<() => void | Promise<void>> = []

  const browser: Browser = {
    async newPage() {
      const sh = await ensureStagehand()
      const v3Page = await sh.context.newPage()
      await enableFocusEmulation(v3Page)
      return wrapPage(v3Page, sh, rateLimiter)
    },
    onCleanup(fn) {
      cleanupFns.push(fn)
    },
    async rateLimit<R>(name: string, fn: () => Promise<R>): Promise<R> {
      const spec = rateLimiter.getByName(name)
      if (!spec) {
        throw new Error(
          `browser.rateLimit("${name}"): no bucket with that name was declared. ` +
            `Add it to your workflow's \`rateLimits\` export (or pass it in \`withBrowser({ rateLimits })\`).`,
        )
      }
      await acquireToken(name)
      return await fn()
    },
    unsafe() {
      throw new Error(
        'browser.unsafe() requires an initialized session — call browser.newPage() at least once before browser.unsafe().',
      )
    },
  }

  // Replace the placeholder unsafe() with one that returns the real session
  // once Stagehand is up. Layer 1 workflows (no newPage) never trigger init,
  // so calling unsafe() there throws — that's correct: there's nothing to expose.
  browser.unsafe = () => {
    const s = session.current
    if (!s) {
      throw new Error(
        'browser.unsafe() requires an initialized session — call browser.newPage() at least once before browser.unsafe().',
      )
    }
    return { stagehand: s.stagehand }
  }

  try {
    return await fn(browser)
  } finally {
    // 1. Workflow-registered cleanups first (they may depend on pages still being open)
    for (const fn of cleanupFns.reverse()) {
      try {
        await fn()
      } catch (err) {
        process.stderr.write(`cleanup hook failed: ${(err as Error).message}\n`)
      }
    }

    // 2. Close pages opened by the workflow + run two-phase Stagehand shutdown,
    //    but only if the workflow ever booted a browser. Layer 1 paths skip both.
    //    The same close-pages helper runs on the SIGINT path in shutdownAndExit
    //    so long-running workflows get the same cleanup when they exit via signal.
    const s = session.current
    if (s) {
      await closeWorkflowPages(s).catch(() => {})
      unregisterSession({
        id: s.sessionId,
        stagehand: s.stagehand,
        preExisting: s.preExisting,
        preExistingUrls: s.preExistingUrls,
      })
      await safeClose(s.stagehand).catch(() => {})
    }
  }
}

// Tell Chrome to render this CDP-attached target as if it had focus, even when
// it isn't the OS-foreground tab. Without this, Chrome freezes the renderer of
// any tab that isn't the focused one — visibilityState=hidden, requestAnimationFrame
// is paused, IntersectionObserver callbacks never fire, and window.scrollBy
// doesn't actually scroll. Pages that use virtual lists (xhs, twitter, most
// modern feeds) then fail to mount items the script is trying to interact with;
// the only way to unstick them is for the user to physically click the tab,
// which defeats the point of running automation in the background.
//
// Emulation.setFocusEmulationEnabled flips visibilityState back to 'visible'
// and unfreezes rAF / IO without stealing OS focus from whatever the user is
// actually doing. Best-effort: wrapped in try/catch so an unsupported runtime
// (e.g., older Chromium) doesn't break workflows that don't need it.
async function enableFocusEmulation(v3Page: V3Page): Promise<void> {
  try {
    await v3Page.sendCDP('Emulation.setFocusEmulationEnabled', { enabled: true })
  } catch (err) {
    process.stderr.write(
      `browser-cli: focus emulation setup failed (non-fatal): ${(err as Error).message}\n`,
    )
  }
}

// Tracks default-throttle hint emissions across the process so we don't spam.
const defaultFetchHintEmitted = new Set<string>()
const defaultFetchBucketRegistered = new Set<string>()

/**
 * Acquire a token for `page.fetch(url)`. If the workflow declared an explicit
 * `rateLimits` entry that matches the URL, use it. Otherwise fall back to a
 * per-host default of 1 qps / burst 1 — safe for unattended personal scripts,
 * cheap to override per workflow.
 */
async function acquireFetchToken(rawUrl: string, rateLimiter: RateLimiter): Promise<void> {
  const explicit = rateLimiter.matchUrl(rawUrl)
  if (explicit) {
    await acquireToken(explicit.key)
    return
  }

  let host: string
  try {
    host = new URL(rawUrl).host
  } catch {
    return // invalid URL — let the page-side fetch report the error
  }

  const key = `default:${host}`
  if (!defaultFetchBucketRegistered.has(key)) {
    defaultFetchBucketRegistered.add(key)
    ensureBucket(key, { rps: 1, burst: 1, manual: false })
  }

  const start = Date.now()
  await acquireToken(key)
  const waited = Date.now() - start
  if (waited > 100 && !defaultFetchHintEmitted.has(host)) {
    defaultFetchHintEmitted.add(host)
    process.stderr.write(
      `[browser-cli] page.fetch to ${host} is throttled to 1 qps (default).\n` +
        `   → To customize: tell your AI "raise rate limit for ${host} in this workflow"\n` +
        `   → Docs: https://browser-cli.zerith.app/concepts/rate-limit/\n`,
    )
  }
}

function wrapPage(v3Page: V3Page, stagehand: Stagehand, rateLimiter: RateLimiter): Page {
  let unsafeWarned = false

  const activate = () => stagehand.context.setActivePage(v3Page)

  const page: Page = {
    async goto(url, opts) {
      await v3Page.goto(url, { waitUntil: opts?.waitUntil ?? 'domcontentloaded' })
    },

    url() {
      return v3Page.url()
    },

    async close() {
      await v3Page.close()
    },

    async extract(instruction, schema) {
      activate()
      return await stagehand.extract(instruction, schema)
    },

    async act(instruction) {
      activate()
      await stagehand.act(instruction)
    },

    async observe(instruction) {
      activate()
      const actions = await stagehand.observe(instruction)
      return actions.map((a: { selector?: string; description?: string }) => ({
        selector: a.selector ?? '',
        description: a.description ?? '',
      }))
    },

    async extractFromJson(json, instruction, schema) {
      // No activate() — pure data operation, doesn't touch the browser page.
      return await rawExtractFromJson(json, instruction, schema)
    },

    async fetch<T>(url: string, init?: FetchInit): Promise<T> {
      await acquireFetchToken(url, rateLimiter)
      const merged: FetchInit = { credentials: 'include', ...init }
      return (await v3Page.evaluate(
        async ([u, i]: [string, FetchInit]) => {
          const r = await fetch(u, i as RequestInit)
          const ct = r.headers.get('content-type') || ''
          const text = await r.text()
          if (ct.includes('json')) return JSON.parse(text) as unknown
          return text
        },
        [url, merged],
      )) as T
    },

    async captureResponses(match, opts) {
      return await rawCaptureResponses(v3Page, match, opts)
    },

    async waitForJsonResponse<T = unknown>(match: Matcher, opts?: WaitForJsonOpts): Promise<T> {
      const hit = await rawWaitForJsonResponse(v3Page, match, opts)
      return hit.json as T
    },

    async findResource(predicate) {
      return await v3Page.evaluate(
        (predicateSrc: string) => {
          const fn = new Function('entry', `return (${predicateSrc})(entry)`) as (e: { name: string; initiatorType: string }) => boolean
          const entries = performance.getEntriesByType('resource') as unknown as Array<{ name: string; initiatorType: string }>
          const hit = entries.find((e) => fn(e))
          return hit ? hit.name : null
        },
        predicate.toString(),
      )
    },

    async click(selector) {
      await v3Page.locator(selector).click()
    },

    async fill(selector, value) {
      await v3Page.locator(selector).fill(value)
    },

    async getText(selector) {
      return await v3Page.locator(selector).first().innerText()
    },

    async count(selector) {
      return await v3Page.locator(selector).count()
    },

    async waitForSelector(selector, opts) {
      await v3Page.waitForSelector(selector, {
        timeout: opts?.timeoutMs,
        state: opts?.state ?? 'visible',
      })
    },

    async waitForUrl(pattern, opts) {
      const timeoutMs = opts?.timeoutMs ?? 30000
      const pollMs = opts?.pollMs ?? 100
      const matches = (url: string): boolean =>
        typeof pattern === 'string' ? url.includes(pattern) : pattern.test(url)

      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        if (matches(v3Page.url())) return
        await new Promise((r) => setTimeout(r, pollMs))
      }
      throw new Error(`waitForUrl: timeout after ${timeoutMs}ms; current url="${v3Page.url()}"`)
    },

    async localStorage(key) {
      return await v3Page.evaluate(
        (k: string) => (globalThis as unknown as { localStorage: { getItem(k: string): string | null } }).localStorage.getItem(k),
        key,
      )
    },

    async setLocalStorage(key, value) {
      await v3Page.evaluate(
        ([k, v]: [string, string]) =>
          (globalThis as unknown as { localStorage: { setItem(k: string, v: string): void } }).localStorage.setItem(k, v),
        [key, value],
      )
    },

    unsafe() {
      if (!unsafeWarned) {
        unsafeWarned = true
        process.stderr.write(
          'WARN: page.unsafe() called — you are bypassing the browser wrapper. ' +
            'Raw page.evaluate + document.querySelectorAll breaks when the target site changes its markup. ' +
            'Prefer page.extract / page.observe / page.act (LLM-cached, self-healing) or page.fetch / page.captureResponses.\n',
        )
      }
      return { v3Page, stagehand }
    },
  }

  return page
}
