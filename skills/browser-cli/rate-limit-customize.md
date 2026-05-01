# Rate-limit & concurrency customization (browser-cli sub-flow)

**Loaded from `SKILL.md`.** Use this when the user wants to override the framework defaults for `page.fetch` throttling or workflow concurrency.

## The defaults you're overriding

The framework applies safe defaults to every workflow without any declaration:

- **`page.fetch` per-host throttle**: 1 qps, burst 1. First call to a host is free; subsequent calls within 1s wait.
- **Workflow concurrency**: 1 — only one instance of a given workflow runs at a time across all `browser-cli run` invocations + daemon ticks. The 2nd parallel call blocks (FIFO best-effort) until the 1st finishes.

When either default actually causes a wait, the framework prints a one-shot stderr hint per process telling the user how to customize. That hint is what brought the user here. **Do not change defaults without an explicit ask** — the defaults exist because most personal automation scripts shouldn't hammer APIs.

## When to load this sub-flow

Triggers (English/Chinese):
- "raise rate limit", "change rate limit", "modify rate limit", "customize throttle"
- "改限流", "修改限流", "调高限流", "定制限流"
- "allow more parallel runs", "raise concurrency", "run multiple instances"
- "允许多个同时跑", "提高并发", "去掉并发限制"
- The user pastes one of the framework's `[browser-cli] ... throttled to ...` hints and asks to fix it.

If the user just asks "what's a rate limit" without an action — explain briefly and link to the docs at `/concepts/rate-limit/`. Don't edit anything.

## API surface

A workflow may export two optional top-level values alongside `schema` and `run`:

```ts
import { z } from 'zod'
import type { Browser, RateLimits } from '@browserclijs/browser-cli'

export const schema = z.object({ /* … */ })

export const concurrency = 3            // number of in-flight runs allowed; default 1; use 0 to opt out
export const rateLimits: RateLimits = {
  'api.cloudflare.com':         { rps: 1, burst: 3 },
  'api.github.com/graphql':     { rpm: 30 },
  'mutation':                   { rps: 0.5, manual: true },
}

export async function run(browser: Browser, args: z.infer<typeof schema>) { /* … */ }
```

Inside `run`, the explicit-only manual buckets are wrapped via the helper:

```ts
await browser.rateLimit('mutation', async () => {
  await page.click('#delete')
  await page.waitForJsonResponse(/\/delete$/)
})
```

## How to pick values — decision matrix

| User says | Action |
|---|---|
| "I'm hitting 429 on api.X.com" | Add `'api.X.com': { rpm: <safe value, default 30> }` after asking what their limit is |
| "I want this workflow to run faster, no throttling" | Add explicit declaration with high rps for the involved host(s); don't blanket-disable |
| "I want to run N copies in parallel" | `export const concurrency = N` |
| "Disable concurrency limit entirely" | `export const concurrency = 0` (only when user is sure) |
| "5 seconds between detail clicks" | `'detail-click': { rps: 0.2, burst: 1, manual: true }` + wrap call site |
| "10 calls per minute" | `{ rpm: 10 }` (framework normalizes to rps) |

### Spec field reference

- One of `rps` (per second) / `rpm` (per minute) / `rph` (per hour) — required.
- `burst?: number` — max tokens in the bucket; default `max(1, ceil(rps))`. Larger burst = more flexibility for spiky access patterns.
- `manual?: true` — opt out of auto-matching against `page.fetch()` URLs. The bucket is then only acquired via `browser.rateLimit(name, fn)`.

### URL → bucket matching

Auto-matched (non-`manual`) declarations are checked **longest key first**:
- Key without `/` (e.g. `api.example.com`) — matches when URL hostname == key.
- Key with `/` (e.g. `api.example.com/graphql`) — matches when `host + pathname` starts with key.

So a coarse `'api.github.com'` and a tighter `'api.github.com/graphql'` can coexist; the more specific declaration wins for graphql, the coarse one catches everything else.

If no explicit match, the **default** per-host bucket fires (1 qps). Add an explicit declaration to the host to override.

## Cross-process semantics

Both rate-limit and concurrency state lives in `~/.browser-cli/db.sqlite`. **All `browser-cli run` invocations + the daemon's task ticks share the same buckets and slots**, keyed by:
- Rate limit: the declaration key (or `default:<host>` for the per-host fallback).
- Concurrency: the resolved workflow file path.

Crashed processes' concurrency slots are reaped on the next acquire by probing `process.kill(pid, 0)` — same hostname only.

When two workflows declare different limits for the same key, the **strictest wins** (lowest `rps`, smallest `burst`); a warning is logged.

## How to apply changes

1. Read the workflow file (resolve via `browser-cli home` or check `<git-root>/.browser-cli/workflows/`).
2. Add or modify the `rateLimits` / `concurrency` exports in place.
3. Re-run `browser-cli describe <name>` — it loads the file and surfaces parse errors.
4. Tell the user to re-run their workflow.

If the workflow lives in a git-tracked browser-cli home, tail with `browser-cli sync` so the change gets committed.

## Don'ts

- **Don't blanket-add `concurrency = 0`** to bypass the default. Ask whether the user actually wants unlimited parallel — usually they want 2–5.
- **Don't raise defaults globally**. Defaults are per-workflow, set on the workflow file. There is no global config.
- **Don't pass `manual: true`** unless the user explicitly wants a non-fetch code block throttled. Default-matched buckets are easier to reason about.
- **Don't wrap `page.goto` or `page.act` in `browser.rateLimit`** unless the user explicitly asks — those operations cost more than a single API call and rate-limiting them often produces confusing latency. If you do, be explicit in the bucket name.

## Reference

- Full docs: `/concepts/rate-limit/` (en) / `/zh-cn/concepts/rate-limit/` (zh)
- Source primitives: `src/store/rate-limit.ts`, `src/store/concurrency.ts`
- Example: `examples/rate-limited-fetch.ts`
