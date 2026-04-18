---
name: browser-cli
description: "Use when the user wants to create, run, or debug a browser automation workflow stored in ~/.browser-cli/. Covers the `browser-cli` CLI, the runner conventions, and the step-by-step playwriter-REPL flow for authoring new workflows with verified selectors/scroll behavior. Triggers on references to ~/.browser-cli/, `browser-cli run`, or asks like \"写一个 x.com 的脚本\" / \"抓一下 <site> 的...\" when the goal is a persistent, reusable workflow."
version: 1.0.0
---

# browser-cli

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

Invocation mirrors the folder name:

```bash
browser-cli run news~ycombinator~com/top '{"limit":5}'
browser-cli run x~com/profile-tweets '{"username":"ClaudeDevs"}'
```

## Running a workflow

```bash
browser-cli list                              # table of name · updated · description
browser-cli run <domain>/<name> '<json-args>' # run one workflow, JSON to stdout
browser-cli --help                            # usage
```

Exit 0 on success, non-zero on script throw. Stdout is JSON (for piping); stderr is human messages (errors, prompts, preflight hints).

```bash
browser-cli run news~ycombinator~com/top '{"limit":5}' | jq '.[].title'
```

## Script shape

Every workflow exports a zod `schema` and an async `run`.

```ts
import { z } from 'zod'
import type { Stagehand } from '@browserbasehq/stagehand'

/** One-line description — shown by `browser-cli list`. */
export const schema = z.object({ /* inputs */ })

export async function run(stagehand: Stagehand, args: z.infer<typeof schema>) {
  const page = await stagehand.context.newPage()
  await page.goto('https://example.com', { waitUntil: 'domcontentloaded' })
  // ... do work, return a JSON-serializable value ...
  return [{ title: '...', score: 99, url: '...' }]
}
```

The runner handles:
- Loading `~/.browser-cli/.env` via `process.loadEnvFile`
- Stagehand init with a **unique** `cdpUrl: ws://127.0.0.1:19988/cdp/bc-<pid>-<ts>` (relay rejects duplicate clientIds with code 4004)
- Closing pages the script opened + orphan about:blank tabs from Stagehand's init
- Printing the returned value as pretty JSON to stdout

**Do not call `stagehand.close()` inside the script.** The runner does it.

## Creating a new workflow — step-by-step flow (PREFERRED)

**Use whenever:** the target site is unfamiliar, selectors/scroll behavior need verification, or you're unsure whether the page virtualizes content. Don't write 100 lines on the first guess — always has 2–3 runtime bugs that cost minutes each to diagnose.

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

### 3. Probe the DOM shape

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

### 4. Characterize scroll / pagination

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

### 5. Commit to a workflow

Drop the verified logic into `~/.browser-cli/workflows/<domain>/<name>.ts` using the standard shape (domain folder uses `.` → `~` convention). Paste the snippets that worked verbatim; only add types at the boundary. Make sure the first JSDoc line is the one-line description — it shows up in `browser-cli list`.

### 6. Run via `browser-cli` and verify

```bash
browser-cli run <domain>/<name> '<args>'
```

If it fails when the REPL succeeded, see **Known gotchas** below.

## Creating a new workflow — quick-start flow

Skip the REPL only when the page is well-known (stable markup, no login, no virtualization, no async renders worth waiting for). Examples: static HTML pages, Hacker News frontpage, a known API response.

Start from an existing workflow (`examples/hn-top.ts` in the installed package is a small template), edit, run with `browser-cli run`, iterate.

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
Toggle full stack traces via `BROWSER_CLI_DEBUG=1`.

## Quick reference

| Task | Command |
|---|---|
| List active playwriter sessions | `playwriter session list` |
| New session for REPL | `playwriter session new` |
| REPL step | `playwriter -s $SID --timeout 40000 -e '<js>'` |
| List workflows | `browser-cli list` |
| Run a workflow | `browser-cli run <domain>/<name> '<args>'` |
| Configure LLM provider | `browser-cli config` |
| Check relay health | `curl -s http://127.0.0.1:19988/` |
| List tabs | `playwriter browser list` |
| Start relay | `playwriter serve --replace` |
