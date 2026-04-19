# Workflow creation (browser-cli sub-flow)

**Loaded from `SKILL.md`.** Use this when the user wants to create, run, or debug a browser automation workflow stored in `~/.browser-cli/workflows/`. For scheduled/stateful tasks wrapping a workflow, see `./task-create.md`. For notification channel setup, see `./channel-create.md`.

## browser-cli

A workflow-folder-based browser automation system running on the user's real Chrome (logged-in, extensions alive). Stack:

- **playwriter** (Chrome extension + CDP relay at `ws://127.0.0.1:19988`) — provides the Chrome attach
- **Stagehand v3** — SDK with `page.evaluate`, `context.newPage`, optional `act()/extract()` with cache + selfHeal
- LLM gateway via `~/.browser-cli/.env` (OpenAI-compatible, tool-calling supported)

## Directory layout

```
~/.browser-cli/
├── workflows/                workflow scripts live here (recursed)
│   ├── <domain>/<name>.ts    actual workflows, grouped by target site (see below)
│   └── test/                 exploratory and regression scripts
├── .cache/                   Stagehand action cache (SHA256-keyed JSON)
├── .env                      LLM_API_KEY / LLM_BASE_URL / LLM_MODEL (gitignored)
└── node_modules/             auto-symlinked to the installed package on first `run`
```

The `browser-cli` binary itself comes from `npm install -g @browserclijs/browser-cli` and is on PATH.

### Folder naming convention

One folder per target **domain**, using the **full domain with dots replaced by `~`**. Rationale: short aliases like `x/`, `hn/`, `google/` collide across TLDs (`example.com` vs `example.org`). The domain is the natural unique key.

Examples:
```
~/.browser-cli/workflows/
├── news~ycombinator~com/
│   └── top.ts
├── x~com/
│   ├── profile-tweets.ts
│   └── my-timeline.ts
├── github~com/
│   └── star.ts
└── mail~google~com/       ← subdomains get their own folder; no collision with google~com
```

Invocation mirrors the folder name. Three arg forms are auto-detected (pick whichever is terser):

```bash
browser-cli run news~ycombinator~com/top 5                              # positional (schema order)
browser-cli run x~com/profile-tweets --username ClaudeDevs --limit 20   # named flags
browser-cli run x~com/profile-tweets '{"username":"ClaudeDevs"}'        # JSON (complex inputs)
```

## Running a workflow

```bash
browser-cli list                              # table of name · updated · description
browser-cli describe <domain>/<name>          # parameter table + usage examples
browser-cli run <domain>/<name> [args]        # positional / --flag / JSON, see above
browser-cli run <domain>/<name> --help        # same as `describe`, no execution
browser-cli run <domain>/<name> [args] --cdp-url <url>   # run inside an external Chrome
browser-cli --help                            # usage
```

Exit 0 on success, non-zero on script throw. Stdout is JSON (for piping); stderr is human messages (errors, prompts, preflight hints).

```bash
browser-cli run news~ycombinator~com/top 5 | jq '.[].title'
```

Give each schema field a `.describe("...")` string — `browser-cli describe` surfaces it as the per-parameter docstring, so unfamiliar workflows become self-documenting at the CLI.

## External CDP / fingerprint browsers

The runner connects to Playwriter's relay at `ws://127.0.0.1:19988` by default
(your main Chrome). To run a workflow inside a different browser — a
fingerprint browser profile (AdsPower, BitBrowser, Multilogin, Hubstudio, …) or
any Chrome started with `--remote-debugging-port=9222` — pass `--cdp-url`:

```bash
# HTTP discovery URL — browser-cli resolves the websocket via /json/version
browser-cli run news~ycombinator~com/top 5 --cdp-url http://127.0.0.1:9222

# Or paste the raw websocket URL straight from .webSocketDebuggerUrl
browser-cli run news~ycombinator~com/top 5 \
  --cdp-url "ws://127.0.0.1:9222/devtools/browser/abc123"

# Or persist a default for the shell
export BROWSER_CLI_CDP_URL=http://127.0.0.1:9222
browser-cli run news~ycombinator~com/top 5
```

Workflow files do NOT change — the CDP endpoint is a runner-level concern
selected at invocation time. When `--cdp-url` is supplied the Playwriter
preflight is skipped and browser-cli probes `/json/version` on the given host
instead, failing fast with a clear error if unreachable.

## Script shape

Every workflow exports a zod `schema` and an async `run`. Two extraction shapes
are supported; **prefer the API-first shape** when the page renders from JSON
(most modern SPAs do — see "Decision: API-first vs DOM" below).

```ts
import { z } from 'zod'
import type { Stagehand } from '@browserbasehq/stagehand'
import { waitForJsonResponse, pageFetch } from '@browserclijs/browser-cli'

/** One-line description — shown by `browser-cli list`. */
export const schema = z.object({ /* inputs */ })

export async function run(stagehand: Stagehand, args: z.infer<typeof schema>) {
  const page = await stagehand.context.newPage()

  // -- API-first (preferred): capture the JSON the page itself fetches --
  const { json } = await waitForJsonResponse(page, /\/api\/things/)
  await page.goto('https://example.com/things', { waitUntil: 'domcontentloaded' })
  return (json as { items: unknown[] }).items

  // -- Active fetch: hit the API directly, reusing the page's session/cookies --
  // await page.goto('https://example.com/', { waitUntil: 'domcontentloaded' })
  // return await pageFetch(page, 'https://example.com/api/things')

  // -- DOM scrape (fallback): only when no JSON backs the page --
  // await page.goto('https://example.com', { waitUntil: 'domcontentloaded' })
  // return await page.evaluate(() => Array.from(document.querySelectorAll('…')).map(…))
}
```

The three helpers are exported from `@browserclijs/browser-cli`:
- `waitForJsonResponse(page, match, opts?)` — install BEFORE `page.goto`; resolves to the first matching JSON response.
- `captureResponses(page, match, opts?)` — install BEFORE `page.goto`; returns `{ list(), clear() }` for bulk inspection (e.g. while scrolling).
- `pageFetch<T>(page, url, init?)` — fire a request from the page's JS context (inherits cookies / same-origin auth).

The runner handles:
- Loading `~/.browser-cli/.env` via `process.loadEnvFile`
- Stagehand init with a **unique** `cdpUrl: ws://127.0.0.1:19988/cdp/bc-<pid>-<ts>` (relay rejects duplicate clientIds with code 4004)
- Closing pages the script opened + orphan about:blank tabs from Stagehand's init
- Printing the returned value as pretty JSON to stdout

**Do not call `stagehand.close()` inside the script.** The runner does it.

## Creating a new workflow — step-by-step flow (PREFERRED)

**Use whenever:** the target site is unfamiliar, selectors/scroll behavior need verification, or you're unsure whether the page virtualizes content. Don't write 100 lines on the first guess — always has 2–3 runtime bugs that cost minutes each to diagnose.

**API-first principle:** before scraping any DOM, check whether the page is just rendering a JSON response. Most modern SPAs (X, Reddit, GitHub, Linear, Notion, …) are. APIs change far less than markup, return the full result without virtualization, and skip scroll/wait-for-render. **Always do step 3 (network capture) before step 4 (DOM probe).** Skip step 4 entirely when step 3 finds the data.

### 1. Open a playwriter session (persistent REPL)

```bash
SID=$(playwriter session new | tail -1 | tr -d '[:space:]')
echo "session=$SID"
```

The `state` object inside playwriter's executor persists across `-e` invocations tied to the same `$SID`. Use it to carry `state.p` (your working page) between steps.

Always pass `--timeout 40000` (default 10s is too short for goto + waitForSelector on real sites).

### 2. Navigate and pin the page to state

```bash
playwriter -s $SID --timeout 40000 -e '
  state.p = await context.newPage();
  await state.p.goto("https://<target>", { waitUntil: "domcontentloaded" });
  await state.p.waitForSelector("<stable-anchor-selector>", { timeout: 20000 });
  console.log(JSON.stringify({ title: await state.p.title(), url: state.p.url() }));
'
```

Verify: title is what you expect, you're in the logged-in view (not a login wall).

### 3. Capture network responses (DO THIS BEFORE DOM PROBING)

Install a JSON response listener **before** the navigation in step 2 — for new sessions reorder the steps so the listener attaches first. For existing sessions, navigate again with the listener already in place.

```bash
playwriter -s $SID --timeout 40000 -e '
  state.responses = []
  state.p.on("response", async (r) => {
    const ct = r.headers()["content-type"] || ""
    if (!ct.includes("json")) return
    try { state.responses.push({ url: r.url(), status: r.status(), method: r.request().method(), json: await r.json() }) } catch (e) {}
  })
  await state.p.goto("https://<target>", { waitUntil: "domcontentloaded" })
  await state.p.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {})
  console.log(JSON.stringify(state.responses.map(r => ({ url: r.url, status: r.status, method: r.method, keys: r.json && typeof r.json === "object" ? Object.keys(r.json).slice(0, 8) : null })), null, 2))
'
```

Read the list. Look for:
- A response whose URL contains a stable path like `/api/`, `/graphql`, `/v1/`, `/_next/data/`, `/internal/`
- A `keys` array that obviously contains the data the user asked for (e.g. `["items"]`, `["data", "user"]`, `["edges"]`)

If you see a candidate, pull its body to confirm shape:

```bash
playwriter -s $SID -e '
  const r = state.responses.find(x => x.url.includes("/api/stories"))
  console.log(JSON.stringify(r.json, null, 2).slice(0, 2000))
'
```

If the data is there, **stop probing the DOM** and skip to step 5. Use `waitForJsonResponse` (passive — waits for the page to fire it) or `pageFetch` (active — fires it yourself, faster but may need extra headers) when you commit the workflow.

If the page renders server-side (no useful JSON in the responses), or the only matching responses are HTML/CSS/JS, **then** continue to step 4.

#### Decision: API-first vs DOM

| Question | If yes → | If no → |
|---|---|---|
| Is the data inside one of the captured JSON responses? | API-first (step 5 with `waitForJsonResponse`) | DOM (step 4) |
| Does the request fire on every navigation, predictably? | `waitForJsonResponse` — passive, mirrors a real visit | `pageFetch` — active, fire it directly after `goto` |
| Does the API need auth headers the page sets dynamically? | `pageFetch` (cookies + same-origin auth come from the page) | Either |
| Does the page virtualize a long list? | API-first — the response usually returns the full page | DOM with dedup-while-scrolling (step 4) |

### 4. Probe the DOM shape

Query the smallest possible surface first. Use `JSON.stringify` so the output is parseable and compact.

```bash
playwriter -s $SID --timeout 40000 -e '
  const data = await state.p.evaluate(() => {
    const items = Array.from(document.querySelectorAll("article[data-testid=tweet]")).slice(0,1);
    return items.map(el => ({
      hasText: !!el.querySelector("[data-testid=tweetText]"),
      hasTime: !!el.querySelector("time"),
      href: el.querySelector("time")?.closest("a")?.getAttribute("href"),
    }));
  });
  console.log(JSON.stringify(data));
'
```

One sample tells you whether the selectors resolve. If `hasText: false`, the test-id changed — investigate before scaling.

### 5. Characterize scroll / pagination

Many modern sites (Twitter/X, Instagram, some SPAs) **virtualize lists** — off-screen items are removed from the DOM. A single "scrape after scroll" pattern will silently drop data. Always measure:

```bash
playwriter -s $SID --timeout 60000 -e '
  const counts = [];
  for (let i=0; i<5; i++) {
    await state.p.evaluate(() => window.scrollBy(0, window.innerHeight * 0.9));
    await new Promise(r => setTimeout(r, 800));
    const n = await state.p.evaluate(() => document.querySelectorAll("<selector>").length);
    counts.push(n);
  }
  const atBottom = await state.p.evaluate(() => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 50);
  console.log(JSON.stringify({ counts, atBottom }));
'
```

Interpret:
- Linear growth → simple `scrape-after-scroll` works
- Plateau / drop → **virtualization**; you must dedup-while-scrolling (use a stable key like tweet URL, item href, `data-id`)
- `atBottom: true` AND no new items over N consecutive scrolls → done

### 6. Commit to a workflow

Drop the verified logic into `~/.browser-cli/workflows/<domain>/<name>.ts` using the standard shape (domain folder uses `.` → `~` convention). Paste the snippets that worked verbatim; only add types at the boundary. Make sure the first JSDoc line is the one-line description — it shows up in `browser-cli list`.

### 7. Run via `browser-cli` and verify

```bash
browser-cli run <domain>/<name> '<args>'
```

If it fails when the REPL succeeded, see **Known gotchas** below.

## Creating a new workflow — quick-start flow

Skip the REPL only when you already know the answer to the API-vs-DOM question:

- You know a public/internal JSON endpoint and its shape (use `pageFetch` directly — see `examples/github-repo-summary.ts`)
- The page is static HTML with stable markup and no login/virtualization (use `page.evaluate` directly — see `examples/hn-top.ts`)

Even here, spend ~30s opening DevTools Network to confirm the API exists and returns what you expect — assumptions about response shape are the #1 source of "worked locally, broke on first run" bugs.

Start from an existing workflow (`examples/github-repo-summary.ts` for API-first, `examples/hn-top.ts` for DOM), edit, run with `browser-cli run`, iterate.

## Known gotchas

### `__name is not defined`
`tsx/esbuild` wraps named arrow functions with `__name(fn, "label")` to preserve debug names. That helper doesn't exist in the page's JS context. Symptom: `StagehandEvalError: Uncaught`, then `ReferenceError: __name is not defined`.

Fix — right after `page.goto` / `waitForSelector`, inject the stub via a **string** expression (strings bypass tsx's transform):

```ts
await page.evaluate(
  'globalThis.__name = globalThis.__name || function(f){return f}',
)
```

Do this ONCE per page before any function-form `page.evaluate(() => ...)` call.

### DOM virtualization
See step 4 above. When in doubt, measure counts across scrolls before writing the extractor. For Twitter/X specifically: incremental scroll by `0.9 × innerHeight`, 800ms settle, dedup by `article > time > a[href]`.

### Stagehand's evaluate vs playwriter's executor
Within the playwriter REPL (`playwriter -s $SID -e '...'`), you can freely use arrow functions — playwriter's VM doesn't have the `__name` issue. Inside a `browser-cli run` script, you need the stub. Don't assume "it worked in the REPL" implies "it works in the script."

Prefer **string expressions** for side-effect-only calls (`page.evaluate('window.scrollBy(0, innerHeight)')`) — they avoid the stub question entirely.

### Cleanup behavior (runner)
The runner closes:
- Pages the script opened via `context.newPage()`
- Tabs that were `about:blank` before the run AND still `about:blank` after (these are Stagehand's init-created blanks)

The runner does NOT touch the user's real navigated tabs.

### Concurrent runs
Playwriter relay rejects duplicate clientIds with code 4004. The runner already appends a unique `bc-<pid>-<ts>` per process, so `browser-cli run ... & browser-cli run ... & wait` works. Two concurrent workflows that mutate the **same** page or cookies can still race — one workflow per tab is the safe pattern.

### Stagehand URL drift (minor)
`stagehand.act()` with `selfHeal: true` sometimes writes the healed entry to a different cache key (URL normalization differs between read and write paths). Functionally fine — self-heal always produces a successful click — but stale cache entries may accumulate. If `~/.browser-cli/.cache/` grows weird, delete files matching the affected instruction and let them regenerate.

### LLM gateway must support `response_format: json_schema`
Stagehand's `act()`/`extract()` rely on structured output via OpenAI's json_schema mode. If the gateway ignores it and returns prose, you'll see `AI_NoObjectGeneratedError`. The user's `aigate` gateway already supports this as of 2026-04-18.

### Output formats (roadmap, not yet implemented)
Current MVP prints pretty JSON only. Multiple output formats (`table`/`csv`/`md`/`jsonl`) and optional `export const columns` / `defaultFormat` from the script are planned for a later milestone. For now, pipe to `jq` for shaping.

### LLM-driven fallback (roadmap, not yet implemented)
Three layers are on the roadmap but not wired: selector self-heal surfacing into the runner's error channel, request-schema drift detection, and full workflow rewrite with auto-versioning. The underlying Stagehand `selfHeal` already runs inside `act()`.

The new network helpers (`captureResponses` / `waitForJsonResponse` / `pageFetch`) are the foundation for L2 (request-schema drift): once a workflow extracts from a typed JSON shape, "the API moved a field" is a clean signal the runner can detect (zod parse failure on the response) and feed back to the LLM for re-mapping. The DOM-extraction path can't give us this without a brittle "did the page render fewer items than usual?" heuristic.

## Environment

`~/.browser-cli/.env` (gitignored). Run `browser-cli config` to set it up interactively, or hand-edit.

Two main providers:

**A. Claude Code subscription** (free on Max, but ~6-10s per LLM call):
```
LLM_PROVIDER=claude-agent-sdk
LLM_MODEL=claude-sonnet-4-5   # optional
```
Requires `claude` authenticated and `@anthropic-ai/claude-agent-sdk` installed.

**B. OpenAI-compatible endpoint** (fast, any gateway / local model server):
```
LLM_API_KEY=sk-...
LLM_BASE_URL=https://<endpoint>/v1
LLM_MODEL=openai/<model>
```

Fallbacks if neither is set: `OPENAI_API_KEY`, then `ANTHROPIC_API_KEY`.

Override the home directory via `BROWSER_CLI_HOME=/some/path`.
Set a default external CDP endpoint via `BROWSER_CLI_CDP_URL=http://127.0.0.1:9222`
(equivalent to passing `--cdp-url` on every run).
Toggle full stack traces via `BROWSER_CLI_DEBUG=1`.

## Notify-on-error inside a workflow

When the user asks for "notify me if this workflow fails" / "if login expires, ping me" / "warn me when the page is empty", wire a call to the shared `notify()` helper directly inside the workflow. This is independent of tasks — any workflow can fire notifications on its own error paths without needing to be scheduled.

### Step 1: pick a channel

Get the list of saved channels:

```bash
browser-cli notify list --json
```

If the output is empty (`no channels saved…`), STOP and load `./channel-create.md` to set one up. After that flow completes, come back here.

If channels exist, ask the user which one(s) to use — show the names and let them pick.

### Step 2: insert the notify call

Import `notify` from the package and call it from the error path. The function signature:

```ts
notify(channel: string | string[], { title, body }): Promise<NotifyResult>
```

Never throws — failure logs a warning and resolves. Safe to call without a try/catch.

**Login-expiry pattern** (most common for logged-in scraping):

```ts
import { z } from 'zod'
import type { Stagehand } from '@browserbasehq/stagehand'
import { notify } from '@browserclijs/browser-cli'

export const schema = z.object({ /* … */ })

export async function run(stagehand: Stagehand, args: z.infer<typeof schema>) {
  const page = await stagehand.context.newPage()
  await page.goto('https://example.com/profile', { waitUntil: 'domcontentloaded' })

  // Detect login-required redirects or sign-in selectors.
  const needsLogin = /\/login|\/signin/.test(page.url())
    || await page.locator('input[name="password"]').count() > 0
  if (needsLogin) {
    await notify('telegram-me', {
      title: 'example-scraper: login expired',
      body: `Workflow redirected to ${page.url()}. Re-auth in the logged-in Chrome.`,
    })
    throw new Error('Login expired')
  }

  // … normal extraction …
}
```

**Catch-all failure pattern**: if the user wants notification on ANY thrown error (not just known cases), prefer letting them use `notify.onError` in a task wrapper instead — that's what it's for. Only instrument the workflow itself when the error state is non-throwing (e.g. "got 0 items when we expected ≥1") or when the workflow is run ad-hoc without a task.

### Step 3: verify

Save the workflow and dry-run the error branch:

```bash
# Force a login failure (logged-in Chrome signed out)
browser-cli run <name>
# → should: fire notify to the channel, then throw Login expired
```

Check the user's channel actually received the notification. If it didn't, check:
1. `apprise` CLI is on PATH (`which apprise`)
2. The channel name in `notify(...)` matches exactly what's in `browser-cli notify list`

## Quick reference

| Task | Command |
|---|---|
| List active playwriter sessions | `playwriter session list` |
| New session for REPL | `playwriter session new` |
| REPL step | `playwriter -s $SID --timeout 40000 -e '<js>'` |
| List workflows | `browser-cli list` |
| Run a workflow | `browser-cli run <domain>/<name> '<args>'` |
| Configure LLM provider | `browser-cli config` |
| List notification channels | `browser-cli notify list` |
| Check relay health | `curl -s http://127.0.0.1:19988/` |
| List tabs | `playwriter browser list` |
| Start relay | `playwriter serve --replace` |
