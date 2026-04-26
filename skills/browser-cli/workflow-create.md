# Workflow creation (browser-cli sub-flow)

**Loaded from `SKILL.md`.**

## Core rule (read first)

> **Workflows import only `Browser` from `@browserclijs/browser-cli`.**
> Never import `@browserbasehq/stagehand` or `playwright` directly,
> never call `page.unsafe().evaluate(() => document.querySelectorAll(…))`.
>
> Three resilient layers, in strict priority order:
>
> 1. **Public API exists and you've verified it returns the data unauthenticated**
>    → still a workflow, but **don't open a browser**. The `run(browser, args)`
>    function never calls `browser.newPage()` — it just `fetch`es the public
>    endpoint directly (Node's global `fetch`). The runner skips Stagehand init
>    entirely if no page is ever opened. This is the most robust path: no Chrome,
>    no CDP, no LLM, no markup risk.
> 2. **Browser needed but data comes through a JSON endpoint**
>    → `page.fetch` / `page.captureResponses` / `page.waitForJsonResponse`.
>    Trigger via a page action; read the network. **Do not touch the DOM.**
> 3. **DOM is unavoidable** → `page.extract` / `page.act` / `page.observe`.
>    These are LLM-cached and `selfHeal`-backed: when the site renames a
>    class or shifts a container, the cache invalidates and Stagehand
>    re-resolves the selector on the next run.
>
> Raw `document.querySelectorAll` looks convenient and breaks the moment
> the target site tweaks its markup. We have already been burned by this
> pattern (April 2026 incident: an orphaned CDP session from a fragile
> scraper leaked 18 GB of Chrome memory before SIGKILL). The wrapper is
> a non-negotiable lid: it owns lifecycle cleanup AND it hides the
> fragile API. If you catch yourself reaching for `page.unsafe()` to
> scrape, stop — re-walk the three layers, the answer is almost always
> a level higher than where you started.

## When to load this skill

Load this sub-flow when the user wants to **create**, **fix**, or **modify** a workflow in a project or in their browser-cli home. Project workflows live at `<git-root>/.browser-cli/workflows/`; global workflows live under the home `workflows/` subdir — run `browser-cli home` to resolve the absolute path. Concrete triggers:

- **Create** — "写一个抓 X 的脚本" / "scrape X" / "get Y from Z site" / "监控 X 的 Y" / any new automation ask
- **Fix** — "这个 workflow 报错了" / "selectors broke" / "login expired" / "zod parse failed" / any `browser-cli run` failure. See the **Fixing an existing workflow** procedure under **Known gotchas** below.
- **Modify** — "把 limit 改成 50" / "多返回一个字段" / "改成抓登录后的页面" / any edit to an existing file under `workflows/`

For scheduling a workflow on cron (with diff/RSS/notifications), see `./task-create.md` instead — this file only covers the workflow itself. For notification channel setup, see `./channel-create.md`.

## browser-cli

A workflow-folder-based browser automation system running on the user's real Chrome (logged-in, extensions alive). Stack:

- **playwriter** (Chrome extension + CDP relay at `ws://127.0.0.1:19988`) — provides the Chrome attach
- **`Browser` wrapper** (`@browserclijs/browser-cli`) — the single API workflows import. Wraps Stagehand v3's `extract` / `act` / `observe` for DOM resilience, re-exports `fetch` / `captureResponses` / `waitForJsonResponse` for the network path, and owns lifecycle + CDP cleanup so a crash or SIGINT can't leak a renderer session.
- LLM gateway via the env file under your browser-cli home (configured via `browser-cli config`, OpenAI-compatible, tool-calling supported)

## Directory layout

Before writing a workflow, ask whether the target should be **project-level** or **global**. Recommend project-level when the user is inside a git repo and the automation belongs with that project. Use global when the workflow is personal, reusable across projects, or meant to be wrapped by a global task.

Project workflows:

- live at `<git-root>/.browser-cli/workflows/<domain>/<name>.ts`
- are resolved before global workflows by `browser-cli list`, `browser-cli describe`, and `browser-cli run`
- are versioned by the outer project repo; do not run `browser-cli sync` for them

Your browser-cli home (resolve via `browser-cli home`) contains:

- `workflows/` — workflow scripts, recursed. Grouped into `<domain>/<name>.ts` subfolders (see naming convention below). A `test/` subfolder is conventional for exploratory / regression scripts.
- `.cache/` — Stagehand action cache (SHA256-keyed JSON)
- `.env` — `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` (gitignored; manage via `browser-cli config`)
- `node_modules/` — auto-symlinked to the installed package on first `run`

The `browser-cli` binary itself comes from `npm install -g @browserclijs/browser-cli` and is on PATH.

### Folder naming convention

One folder per target **domain**, using the **full domain verbatim** (lowercase). Rationale: short aliases like `x/`, `hn/`, `google/` collide across TLDs (`example.com` vs `example.org`). The domain is the natural unique key.

Examples (under `<workflow-root>/`, where the root is either `<git-root>/.browser-cli/workflows/` or `$(browser-cli home)/workflows/`):
```
news.ycombinator.com/
└── top.ts
x.com/
├── profile-tweets.ts
└── my-timeline.ts
github.com/
└── star.ts
mail.google.com/       ← subdomains get their own folder; no collision with google.com
```

Invocation mirrors the folder name. Three arg forms are auto-detected (pick whichever is terser):

```bash
browser-cli run news.ycombinator.com/top 5                              # positional (schema order)
browser-cli run x.com/profile-tweets --username ClaudeDevs --limit 20   # named flags
browser-cli run x.com/profile-tweets '{"username":"ClaudeDevs"}'        # JSON (complex inputs)
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
browser-cli run news.ycombinator.com/top 5 | jq '.[].title'
```

Give each schema field a `.describe("...")` string — `browser-cli describe` surfaces it as the per-parameter docstring, so unfamiliar workflows become self-documenting at the CLI.

## External CDP / fingerprint browsers

The runner connects to Playwriter's relay at `ws://127.0.0.1:19988` by default
(your main Chrome). To run a workflow inside a different browser — a
fingerprint browser profile (AdsPower, BitBrowser, Multilogin, Hubstudio, …) or
any Chrome started with `--remote-debugging-port=9222` — pass `--cdp-url`:

```bash
# HTTP discovery URL — browser-cli resolves the websocket via /json/version
browser-cli run news.ycombinator.com/top 5 --cdp-url http://127.0.0.1:9222

# Or paste the raw websocket URL straight from .webSocketDebuggerUrl
browser-cli run news.ycombinator.com/top 5 \
  --cdp-url "ws://127.0.0.1:9222/devtools/browser/abc123"

# Or persist a default for the shell
export BROWSER_CLI_CDP_URL=http://127.0.0.1:9222
browser-cli run news.ycombinator.com/top 5
```

Workflow files do NOT change — the CDP endpoint is a runner-level concern
selected at invocation time. When `--cdp-url` is supplied the Playwriter
preflight is skipped and browser-cli probes `/json/version` on the given host
instead, failing fast with a clear error if unreachable.

## Script shape

Every workflow exports a zod `schema` and an async `run(browser, args)`. The
`Browser` argument is the single sanctioned API surface — it produces `Page`
instances whose methods cover all three layers below.

```ts
import { z } from 'zod'
import type { Browser } from '@browserclijs/browser-cli'

/** One-line description — shown by `browser-cli list`. */
export const schema = z.object({
  limit: z.number().int().positive().default(5),
})

export async function run(browser: Browser, args: z.infer<typeof schema>) {
  const page = await browser.newPage()
  await page.goto('https://example.com/things', { waitUntil: 'domcontentloaded' })

  // Layer 3 (DOM) — resilient via Stagehand's LLM cache + selfHeal:
  const data = await page.extract(
    `find the top ${args.limit} items on the page and return title + url for each`,
    z.object({ items: z.array(z.object({ title: z.string(), url: z.string().url() })) }),
  )
  return data.items

  // Layer 2 (preferred when a JSON endpoint exists):
  // const json = await page.waitForJsonResponse<{ items: unknown[] }>(/\/api\/things/)
  // return json.items.slice(0, args.limit)

  // Layer 2 active fetch — inherits the page's cookies / same-origin auth:
  // return await page.fetch('https://example.com/api/things')
}
```

`Page` re-exports the network helpers as methods:
- `page.waitForJsonResponse(match, opts?)` — resolves to the first matching JSON response (works whether installed before or after `page.goto`; default `credentials: 'include'`).
- `page.captureResponses(match, opts?)` — returns `{ list(), clear() }` for bulk inspection (e.g. while scrolling).
- `page.fetch<T>(url, init?)` — fire a request from the page's JS context (inherits cookies / same-origin auth).

The runner (via `withBrowser`) handles:
- Loading the env file under the browser-cli home via `process.loadEnvFile`
- Stagehand init with a **unique** `cdpUrl: ws://127.0.0.1:19988/cdp/bc-<pid>-<ts>` (relay rejects duplicate clientIds with code 4004)
- Closing pages the script opened + orphan about:blank tabs from Stagehand's init
- Two-phase Stagehand shutdown (graceful → forced WebSocket terminate) on **every** exit path including SIGINT/SIGTERM/uncaught throws
- Printing the returned value as pretty JSON to stdout

**Do not import `Stagehand` and do not call `stagehand.close()` inside the
workflow.** If you need a teardown hook (e.g. you opened a download stream),
register it via `browser.onCleanup(fn)` so the runner can sequence it before
the CDP shutdown.

## Decision: which execution path

Before any probing, walk this tree. It decides whether you even need a browser at all.

1. **Can the user's goal be served by a public / documented JSON API?**
   - Check the site's `/api/`, `/graphql`, `/_next/data/`, or published REST docs.
   - Unknown? Spend 30 seconds in step 3 of the step-by-step flow below (network capture in a playwriter REPL) to see whether the page itself fetches JSON that contains the ask.
   - **Always verify by actually calling the endpoint before committing to Path A** — don't rely on docs alone. An endpoint that requires a session cookie or a dynamic header falls to Path B.

2. **If yes and you verified the public endpoint returns the data without auth → Path A (public API, no browser).**
   The workflow file still exists — `run(browser, args)` is the entry point — but it never calls `browser.newPage()`. Use Node's global `fetch`, `URL`, etc. directly. `withBrowser` lazy-inits Stagehand: if `newPage` is never called, Chrome is never attached and no CDP session is ever registered. This is the fastest, most robust path; no LLM, no renderer, no markup risk.

3. **If the API needs login / cookies / dynamic auth headers → Path B (page-API).**
   Open a page via `browser.newPage()` so the request inherits the user's real Chrome cookies, then use:
   - `page.waitForJsonResponse(match, opts?)` — passive. Navigate and let the page fire its own request; this matches a real visit and picks up any session/CSRF headers the page injects.
   - `page.fetch(url, init?)` — active. Fires a request from the page's JS context. Defaults `credentials: 'include'` so cross-origin cookies come along. Faster than a full navigation when you already know the endpoint.
   - `page.captureResponses(match, opts?)` — bulk inspection while driving the page (e.g. scrolling a virtualized list).

4. **If the data only renders in the DOM → Path C (DOM via Stagehand).**
   Use `page.extract(instruction, schema)` / `page.observe(instruction)` / `page.act(instruction)`. These route through Stagehand with `cacheDir` + `selfHeal` already wired (see `src/stagehand-config.ts`), so the first run pays the LLM cost, subsequent runs hit the cache, and a small markup change triggers a re-resolve instead of a hard failure.
   Do **not** drop to `page.unsafe().evaluate(() => document.querySelectorAll(...))` — that throws away the cache + self-heal and gives you the exact fragility the wrapper was built to prevent. See the `page.unsafe()` section near the end of this file for the narrow set of cases where the escape hatch is legitimate (downloads, cookie seeding, etc.).

| Path | When | Tools | Robustness |
|---|---|---|---|
| A — public API | Public endpoint verified without auth | Node `fetch`; never call `browser.newPage()` | Highest (no browser, no LLM) |
| B — page-API | Private API behind login | `page.waitForJsonResponse` / `page.fetch` / `page.captureResponses` | High (depends on API shape drift) |
| C — DOM via Stagehand | Data only in rendered HTML | `page.extract` / `page.observe` / `page.act` (+ cache, selfHeal) | LLM-healable on markup drift |

**Rule of thumb:** Every step down the list costs more tokens, runs slower, and breaks more often. Pick the highest path that actually serves the data.

## Creating a new workflow — step-by-step flow (PREFERRED)

**Use whenever:** the target site is unfamiliar, selectors/scroll behavior need verification, or you're unsure whether the page virtualizes content. Don't write 100 lines on the first guess — always has 2–3 runtime bugs that cost minutes each to diagnose.

**API-first principle:** before scraping any DOM, check whether the page is just rendering a JSON response. Most modern SPAs (X, Reddit, GitHub, Linear, Notion, …) are. APIs change far less than markup, return the full result without virtualization, and skip scroll/wait-for-render. **Always do step 3 (network capture) before step 4 (DOM probe).** Skip step 4 entirely when step 3 finds the data.

### 0. Check for an existing workflow first (DO THIS BEFORE ANYTHING ELSE)

Before writing anything new, list what's already saved and look for a match by target domain. Pass the site as a filter — case-insensitive substring match:

```bash
browser-cli list <site>          # e.g. `browser-cli list ycombinator` or `browser-cli list news.ycombinator.com`
browser-cli list                 # omit the filter if you want the full picture
```

Map the user's ask to a domain folder using the verbatim hostname (e.g. "抓 HN" → `news.ycombinator.com/`, "抓我的推特" → `x.com/`). Also skim subscriptions — shared packs may already cover the ask:

```bash
browser-cli sub list          # if any subs are registered, inspect their workflows/ dirs too
```

If there's a plausible hit (same domain, overlapping purpose), STOP and ask the user:

- **Reuse** — run the existing workflow with their args (`browser-cli describe <name>` to show params, then `browser-cli run <name> ...`). Done; no new file.
- **Modify** — open the existing file and edit in place. Jump to the **Fixing an existing workflow** procedure under **Known gotchas** (same pattern applies to feature tweaks, not just bug fixes).
- **Fork a subscribed one** — if the hit is under the subs directory (see `browser-cli subs-home`), run `browser-cli sub copy <sub>/<name>` to fork it into the user's own `workflows/` before editing. See `./sub-manage.md`.
- **New one anyway** — only if the user confirms the existing workflow genuinely doesn't cover the goal (different auth, different endpoint, different output shape). Pick a distinct filename — don't overwrite.

Only proceed to step 1 after the user has chosen "new one anyway" or no hit exists. Silent duplicates under the same domain folder are the failure mode to avoid.

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

If the data is there, **stop probing the DOM** and skip to step 5. Use `page.waitForJsonResponse(match)` (passive — waits for the page to fire it) or `page.fetch(url, init?)` (active — fires it yourself, faster but may need extra headers) when you commit the workflow.

If the page renders server-side (no useful JSON in the responses), or the only matching responses are HTML/CSS/JS, **then** continue to step 4.

#### Decision: API-first vs DOM

| Question | If yes → | If no → |
|---|---|---|
| Is the data inside one of the captured JSON responses? | API-first (step 5 with `waitForJsonResponse`) | DOM (step 4) |
| Does the request fire on every navigation, predictably? | `page.waitForJsonResponse` — passive, mirrors a real visit | `page.fetch` — active, fire it directly after `goto` |
| Does the API need auth headers the page sets dynamically? | `page.fetch` (cookies + same-origin auth come from the page) | Either |
| Does the page virtualize a long list? | API-first — the response usually returns the full page | DOM with dedup-while-scrolling (step 4) |

### 4. Probe the DOM (Path C) — Stagehand primitives only

In the committed workflow, every DOM interaction goes through
`page.extract` / `page.observe` / `page.act`. These are the only DOM
primitives the `Browser` wrapper exposes on `Page`, and they are the
reason Stagehand is in the stack — the LLM cache means subsequent runs
hit O(ms) selector resolution, and `selfHeal` repairs cache entries when
the site redesigns. Hand-written `querySelectorAll` gets none of that.

Order: `observe` → then `extract` or `act`. Each step narrows what the
next sees, keeping token cost low.

**4a. `page.observe(instruction)` — find candidate elements and get stable selectors**

Returns `Promise<{ selector: string; description: string }[]>`. Selectors are freshly resolved on every call, so they adapt to class-name churn.

```ts
const listings = await page.observe('find the product cards on the page')
// [{ description: 'Product card "Foo"', selector: 'xpath=…' }, …]
```

**4b. `page.extract(instruction, schema)` — pull structured data with a zod schema**

```ts
const products = await page.extract(
  'extract name, price, and url for every product card on the page',
  z.object({
    products: z.array(
      z.object({
        name: z.string(),
        price: z.string().describe('as displayed, incl. currency symbol'),
        url: z.string().url(),
      }),
    ),
  }),
)
return products.products
```

**4c. `page.act(instruction)` — interact (click / fill / scroll) via a natural-language instruction**

With `cacheDir` + `selfHeal` already wired in `src/stagehand-config.ts`,
the first run caches the action; later runs skip the LLM call unless the
DOM moved enough to need a self-heal.

```ts
await page.act('click the sign-in button in the header')
```

For deterministic selector work where Stagehand is overkill — an input
whose `name` attribute is documented, a button with a stable `id` — the
wrapper also exposes `page.click(selector)` / `page.fill(selector, value)`
/ `page.count(selector)` / `page.getText(selector)` /
`page.waitForSelector(selector, opts?)`. Use them for form fills and
presence checks, never to replicate a querySelector-based scraper.

**Quick DOM sanity probe during iteration (in the playwriter REPL, NOT in the committed workflow):**

The REPL is where you experiment with selectors before you commit. Raw
`page.evaluate` is fine here because playwriter's executor runs in a VM
without the `__name` issue and nothing about your exploration persists.
The committed workflow file must still route through `page.extract` /
`observe` / `act`.

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

One sample tells you whether the container selector is stable enough to
pass into `page.extract` as a `selector` scope later — but the committed
extraction itself goes through `page.extract`, not `evaluate`.

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

Use the storage scope chosen earlier:

- **Project-level** — find the git root, then write to `<git-root>/.browser-cli/workflows/<domain>/<name>.ts`.
- **Global** — resolve the home once (`HOME=$(browser-cli home)`), then write to `$HOME/workflows/<domain>/<name>.ts`. Never expand `~/.browser-cli` yourself — `$BROWSER_CLI_HOME` may point somewhere else.

Use the standard shape and the domain folder convention (verbatim lowercase hostname). Paste the snippets that worked verbatim; only add types at the boundary. Make sure the first JSDoc line is the one-line description — it shows up in `browser-cli list`.

### 7. Run via `browser-cli` and verify — TWICE

```bash
browser-cli run <domain>/<name> '<args>'     # first run: populates Stagehand cache under $(browser-cli home)/.cache/
browser-cli run <domain>/<name> '<args>'     # second run: should be noticeably faster, hitting cached observe/act
```

What to check:

1. **First run succeeds** and the output JSON matches what the user asked for. Diff against a small golden sample if the data is deterministic.
2. **Second run is faster** and still returns the same shape. If it doesn't, either the page is non-deterministic (pagination, personalization) or the cache key is drifting — note it and move on; `selfHeal` will handle minor drift later.
3. **Cache files exist** under `$(browser-cli home)/.cache/` after the first run (only when Path C actually used `observe` / `act` / `extract` — Path A/B workflows don't populate this cache). If you expected cache entries and none appear, the LLM gateway probably doesn't support `response_format: json_schema` — see **Known gotchas**.

If the first run fails when the REPL step succeeded, see **Known gotchas** below.

### 8. Commit the new workflow

After a global workflow is written and verified, end with:

```bash
browser-cli sync
```

Relay the prompt output `[y]es / [n]o / [d]iff / [s]how-files` to the user and wait for their answer. If they pick `d` or `s`, re-run `browser-cli sync` so they can see the details before committing. Skip this step if the user has explicitly said not to commit, if you only read files (no writes), or if the workflow is project-level. For project-level workflows, report the changed project path and let the outer repo's normal git workflow handle commits.

## Creating a new workflow — quick-start flow

Skip the REPL only when you already know the answer to the layer question:

- **Path A** — you've verified (with an actual `curl`) that a public endpoint returns the data without auth. Write a workflow whose `run(browser, args)` never calls `browser.newPage()`; use Node's global `fetch` directly. No browser, no LLM.
- **Path B** — you know the private JSON endpoint and have confirmed shape + auth pattern. Use `page.fetch` or `page.waitForJsonResponse` (see `examples/github-repo-summary.ts` for the Layer 2 shape).
- **Path C** — the data is DOM-only and you already know the stable container. Use `page.extract` with a zod schema (see `examples/hn-top.ts` for the Layer 3 shape).

Even here, spend ~30s opening DevTools Network to confirm an API exists before committing to Path C — assumptions about response shape are the #1 source of "worked locally, broke on first run" bugs.

Start from an existing workflow (`examples/github-repo-summary.ts` for Layer 2, `examples/hn-top.ts` for Layer 3), edit, run with `browser-cli run`, iterate.

## Known gotchas

### Fixing an existing workflow

Trigger: user says "this workflow broke" / "zod parse failed" / "selectors 404'd" / "上次能跑现在跑不了".

1. Run `browser-cli run <name>` and read the error. Three common shapes:
   - `AI_NoObjectGeneratedError` → the LLM gateway regressed on structured output, or the `page.extract` schema no longer matches the DOM. Re-run `page.observe` on the live page to see the new shape before touching the schema.
   - `zod parse failed` on a captured JSON response (Path B) → the site's API changed. Capture the response again in a REPL (step 3) and diff it against the workflow's type; update the type or the pick.
   - `locator … not found` / `timeout waiting for …` → a form-fill selector passed to `page.click` / `page.fill` / `page.waitForSelector` moved. Either update it, or — if this lookup used to be a DOM scrape via `page.unsafe()` — migrate to `page.extract` / `page.observe` so the next regression self-heals.
2. Reproduce in a playwriter REPL (steps 1–3 of the step-by-step flow) against the same page state the cron run sees.
3. Clear cache entries for the affected instruction under `$(browser-cli home)/.cache/` before the fix re-run, so you don't race against stale cache entries while iterating.
4. Re-verify with `browser-cli run` twice (step 7) before `browser-cli sync`.

### DOM virtualization
See step 4 above. When in doubt, measure counts across scrolls in the REPL before writing the workflow. For Twitter/X specifically: incremental scroll by `0.9 × innerHeight`, 800ms settle, dedup by `article > time > a[href]`. In the committed workflow, drive the scroll via `page.act('scroll to the bottom of the timeline')` or `page.unsafe().v3Page.evaluate('window.scrollBy(0, innerHeight)')` (legitimate escape-hatch use — it's a side-effect-only imperative call, not a scraper).

### When (and how) to use `page.unsafe()` / `browser.unsafe()`

The wrapper intentionally hides raw Stagehand / Playwright surface. The
escape hatch exists for features the wrapper hasn't re-exported yet —
not for scraping.

**Legitimate uses:**

- `page.on('download', …)` — handling a binary download. Wrap the raw page listener and register teardown via `browser.onCleanup(fn)`.
- `context.addCookies(...)` — seeding auth state from a saved file (`browser.unsafe().stagehand.context.addCookies(...)`).
- `context.setExtraHTTPHeaders(...)` / CDP target features not yet on the wrapper.
- Side-effect-only imperative calls like `window.scrollBy(...)` or `window.focus()` — pass the code as a **string** to `evaluate`, not a function, so there's no scraping surface.

**Illegitimate uses — if you catch yourself doing one of these, back up:**

- `page.unsafe().v3Page.evaluate(() => document.querySelector(...))` — this is the exact pattern we built the wrapper to prevent. Rewrite as `page.extract(instruction, schema)` or `page.observe(instruction)`.
- Re-importing `@browserbasehq/stagehand` at the top of a workflow. There is no legitimate reason; if something's missing from `browser.unsafe().stagehand`, file an issue against the wrapper.

**What happens when you use it:**

- First call per page prints a one-line `WARN: page.unsafe() called — you are bypassing the browser wrapper …` to stderr, citing `page.extract / observe / act` as the resilient alternative. The warning is intentional: it makes misuse visible in CI logs, cron output, and `browser-cli sync` diffs.
- Lifecycle cleanup (CDP detach, page close, process-exit safeClose) still runs — you do not lose the memory-leak guarantees by using the hatch. But the fragility guarantee (cache + self-heal) is on you.

### Cleanup behavior (runner)
The runner (via `withBrowser`) handles cleanup on **every** exit path —
normal return, thrown error, SIGINT/SIGTERM/SIGHUP, uncaught exception,
unhandled rejection. The sequence is:

1. Workflow-registered cleanup hooks (`browser.onCleanup(fn)`) run first, in LIFO order, while pages are still open.
2. Pages the script opened via `browser.newPage()` get closed. Pre-existing tabs are left alone unless they were `about:blank` before the run AND still `about:blank` after (Stagehand init-created blanks).
3. Two-phase Stagehand shutdown: graceful `stagehand.close()` (3s) → forced `close({ force: true })` (2s) → raw WebSocket `terminate()` as last resort. This is what reclaims the CDP session in Chrome and avoids the renderer-memory leak that motivated the wrapper.

The runner does NOT touch the user's real navigated tabs. If Stagehand
was never initialized (Path A / Layer 1 workflows that never called
`browser.newPage()`), steps 2–3 are skipped entirely — there's nothing
to clean up.

### Concurrent runs
Playwriter relay rejects duplicate clientIds with code 4004. The runner already appends a unique `bc-<pid>-<ts>` per process, so `browser-cli run ... & browser-cli run ... & wait` works. Two concurrent workflows that mutate the **same** page or cookies can still race — one workflow per tab is the safe pattern.

### Stagehand URL drift (minor)
`page.act()` with `selfHeal: true` sometimes writes the healed entry to a different cache key (URL normalization differs between read and write paths). Functionally fine — self-heal always produces a successful click — but stale cache entries may accumulate. If `$(browser-cli home)/.cache/` grows weird, delete files matching the affected instruction and let them regenerate.

### LLM gateway must support `response_format: json_schema`
Stagehand's `act()`/`extract()` rely on structured output via OpenAI's json_schema mode. If the gateway ignores it and returns prose, you'll see `AI_NoObjectGeneratedError`. The user's `aigate` gateway already supports this as of 2026-04-18.

### Output formats (roadmap, not yet implemented)
Current MVP prints pretty JSON only. Multiple output formats (`table`/`csv`/`md`/`jsonl`) and optional `export const columns` / `defaultFormat` from the script are planned for a later milestone. For now, pipe to `jq` for shaping.

### LLM-driven fallback (roadmap, not yet implemented)
Three layers are on the roadmap but not wired: selector self-heal surfacing into the runner's error channel, request-schema drift detection, and full workflow rewrite with auto-versioning. The underlying Stagehand `selfHeal` already runs inside `act()`.

The Layer 2 network surface (`page.captureResponses` / `page.waitForJsonResponse` / `page.fetch`) is the foundation for L2 (request-schema drift): once a workflow extracts from a typed JSON shape, "the API moved a field" is a clean signal the runner can detect (zod parse failure on the response) and feed back to the LLM for re-mapping. The DOM-extraction path can't give us this without a brittle "did the page render fewer items than usual?" heuristic.

## Environment

The env file lives under your browser-cli home (gitignored). Run `browser-cli config` to set it up interactively, or hand-edit after resolving the path with `browser-cli home`.

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
import type { Browser } from '@browserclijs/browser-cli'
import { notify } from '@browserclijs/browser-cli'

export const schema = z.object({ /* … */ })

export async function run(browser: Browser, args: z.infer<typeof schema>) {
  const page = await browser.newPage()
  await page.goto('https://example.com/profile', { waitUntil: 'domcontentloaded' })

  // Detect login-required redirects or sign-in selectors.
  const needsLogin = /\/login|\/signin/.test(page.url())
    || (await page.count('input[name="password"]')) > 0
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
