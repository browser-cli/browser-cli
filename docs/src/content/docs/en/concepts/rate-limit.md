---
title: Rate limit & concurrency
description: Declare rate limits and concurrency caps on a workflow so parallel runs share one token budget and one slot pool — coordinated across processes via SQLite.
---

A **rate limit** is a token bucket that throttles outbound calls so concurrent workflow runs don't trip an API's HTTP 429 wall. Limits are **declared at the top of a workflow** alongside `schema`, applied **automatically** to matching `page.fetch()` URLs, and **shared across processes** via the SQLite store — so spawning ten parallel `browser-cli run my-workflow` invocations against the same host stays under one budget.

## Defaults (the part most users never need to override)

Every workflow gets two safe defaults without writing a line of config:

| Default | Value | Behavior |
| --- | --- | --- |
| `page.fetch` per-host throttle | **1 qps, burst 1** | First call to a host is free; subsequent calls within 1s wait. |
| Workflow concurrency | **1** | Only one instance of a workflow runs at a time across all `browser-cli run` invocations + daemon ticks. The 2nd parallel call blocks (FIFO best-effort) until the 1st finishes. |

When either default actually causes a wait, the framework prints a one-shot stderr hint per process telling you how to customize. You don't need to read further unless you've seen one of those hints, or you're explicitly building a workflow that needs different values (high-throughput scraper, server-style workflow with multiple tabs, etc.).

To opt out of the concurrency default entirely: `export const concurrency = 0`. To raise the per-host fetch budget: declare an explicit entry under `rateLimits` (next section).

## The shape

A workflow exports `rateLimits` next to `schema` and `run`:

```ts
import { z } from 'zod'
import type { Browser, RateLimits } from '@browserclijs/browser-cli'

export const schema = z.object({ owner: z.string(), repo: z.string() })

export const rateLimits: RateLimits = {
  // Auto-applied: any page.fetch() to api.github.com is throttled at 1 rps,
  // burst 3.
  'api.github.com':           { rps: 1, burst: 3 },
  // Path-prefix match: only the GraphQL endpoint, not the REST endpoints
  // on the same host.
  'api.github.com/graphql':   { rpm: 30 },
  // Manual bucket: opted out of auto-match, only applied when you wrap a
  // block with browser.rateLimit('mutation', ...).
  'mutation':                 { rps: 0.5, manual: true },
}

export async function run(browser: Browser, args: z.infer<typeof schema>) {
  const page = await browser.newPage()

  // Auto-throttled — URL matches `api.github.com`.
  const data = await page.fetch(`https://api.github.com/repos/${args.owner}/${args.repo}`)

  // Manual bucket — throttle an arbitrary block of code, not just a fetch.
  await browser.rateLimit('mutation', async () => {
    await page.click('#delete')
    await page.waitForJsonResponse(/\/delete$/)
  })

  return data
}
```

## Declaration shape

Each entry in `rateLimits` is a key (matcher or bucket name) mapped to a spec:

| Field | Required | Description |
| --- | --- | --- |
| `rps` / `rpm` / `rph` | one of | Requests per second / minute / hour. |
| `burst` | optional | Max tokens the bucket can hold. Defaults to `max(1, ceil(rps))`. |
| `manual` | optional | If `true`, the bucket is **not** auto-matched against `page.fetch()` URLs and is only usable via `browser.rateLimit(name, fn)`. |

## How URLs match buckets

The auto-matcher walks declarations from longest key to shortest and stops at the first match:

- A key without a `/` (e.g. `api.example.com`) matches if the URL hostname equals the key.
- A key with a `/` (e.g. `api.example.com/graphql`) matches if `host + pathname` starts with the key.

This means a coarse host-level limit can coexist with a tighter path-level limit on the same host — the more specific declaration wins.

## browser.rateLimit(name, fn)

The explicit helper wraps any code block under a named bucket — useful when:

- You're throttling something that isn't a `page.fetch` call (e.g. a sequence of clicks that triggers a slow backend).
- The same host needs different budgets for different operations (declare two manual buckets, wrap each path with the right one).

```ts
await browser.rateLimit('mutation', async () => {
  await page.act('click the delete button')
  await page.waitForJsonResponse(/\/delete$/)
})
```

The name must match a key in `rateLimits` (or one passed via `withBrowser({ rateLimits })` in SDK use); calling with an undeclared name throws with a hint.

## Cross-process coordination

Buckets are persisted in `~/.browser-cli/db.sqlite`. Each acquire takes an `IMMEDIATE` SQLite transaction, reads the token count, applies the elapsed-time refill, deducts one token, and writes back atomically. Two processes can never both decide they have a token from the same time window — the second writer blocks until the first commits.

The contention overhead under WAL is sub-millisecond, negligible compared to the latency of the browser actions you're throttling.

## Conflict resolution between workflows

If two workflows declare different limits for the same key, the **strictest wins** — lowest `rps`, smallest `burst`. The runner logs a warning when one declaration tightens an existing bucket. Existing tokens are not refunded; the next acquire feels the new limit immediately.

## SDK usage

`withBrowser` accepts the same declaration shape directly, for code that doesn't go through the workflow runner:

```ts
import { withBrowser } from '@browserclijs/browser-cli'

await withBrowser(
  { rateLimits: { 'api.example.com': { rps: 1 } } },
  async (browser) => {
    const page = await browser.newPage()
    await page.fetch('https://api.example.com/...') // auto-throttled
  },
)
```

## Concurrency limit (separate from rate limit)

A token bucket controls **rate** (events per time window). A semaphore controls **concurrency** (events overlapping in time). They're independent — a workflow can need both. To cap how many instances of the same workflow can run **at the same time**, declare:

```ts
export const concurrency = 3
```

The runner acquires a slot at the start of `run()` and releases it on every exit path (normal return, throw, SIGINT/SIGTERM). When all 3 slots are taken, the 4th `browser-cli run` invocation **blocks** (FIFO best-effort) until a slot frees — it does not error out.

```ts
import { z } from 'zod'
import type { Browser } from '@browserclijs/browser-cli'

export const schema = z.object({ /* … */ })

export const concurrency = 3   // at most 3 of this workflow run globally

export async function run(browser: Browser, args: z.infer<typeof schema>) {
  // ... your workflow code ...
}
```

### Cross-process semantics

Slots are persisted in `~/.browser-cli/db.sqlite`, keyed by the resolved workflow file path, so the cap is shared across all `browser-cli run` invocations and the daemon's task ticks.

If a process crashes without releasing (SIGKILL, OOM, etc.), the next acquire reaps stale holders by probing `process.kill(pid, 0)` — but only on the same hostname. Across machines we cannot probe, so foreign-host holders always count as alive.

### When to use it

- A long-running server-style workflow that opens a browser tab and holds it (e.g. a search-server pinned to one logged-in tab) — cap to whatever the upstream site tolerates.
- A workflow that mutates shared state (uploads, deletes) where multiple parallel runs would interfere.
- Any workflow where running too many copies in parallel hurts more than it helps.

### SDK usage

```ts
import { acquireSlot } from '@browserclijs/browser-cli'

const slot = await acquireSlot('my-job', 3)
try {
  // ... work ...
} finally {
  slot.release()
}
```

