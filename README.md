# browser-cli

Run browser automation workflows against **your real, logged-in Chrome**, via [Stagehand](https://github.com/browserbase/stagehand) (automation + self-heal) and [Playwriter](https://playwriter.dev/) (CDP relay + Chrome extension).

- **CLI & SDK** — humans, AI agents, and scripts all share the same workflow files
- **Multi-tab concurrency** — each run gets a unique CDP client id; concurrent workflows don't collide
- **TypeScript workflows** — each workflow is a `.ts` file with a Zod `schema` + `run(stagehand, args)` export
- **Stateful tasks + scheduler daemon** — wrap any workflow with cron + diff (items / snapshot) + RSS / notifications
- **Notifications via apprise** — named channels (telegram, discord, slack, email, webhooks, …) are reusable from both tasks and workflows
- **Claude Code skill included** — `browser-cli` ships a skill that lets Claude Code discover and invoke workflows

LLM-driven fallback (selector / request / workflow layers) is on the roadmap; this first release focuses on getting the scaffold + end-to-end run working.

## Prerequisites

- **Node 22.18+** (needed for native TypeScript strip-types)
- **Chrome** on the same machine
- **Playwriter** — the CLI will offer to install it on first run, or install it yourself:
  ```bash
  npm install -g playwriter@latest   # or pnpm add -g / yarn global add
  ```
- **Playwriter Chrome extension** — install from [playwriter.dev](https://playwriter.dev/), click the icon in Chrome until it turns green
- **Playwriter relay** — run in a spare terminal:
  ```bash
  playwriter serve --replace
  ```
- **`apprise` CLI** (optional, only if you want notifications) — install once with:
  ```bash
  pipx install apprise   # or `brew install apprise` on macOS
  ```

## Install

```bash
npm install -g @browserclijs/browser-cli
# or: pnpm add -g @browserclijs/browser-cli
```

Then configure your LLM provider:

```bash
browser-cli config
```

This is an interactive prompt that writes `~/.browser-cli/.env`. Two providers are supported.

### LLM provider options

| Provider            | When to pick it                                                          | Setup                                      |
| ------------------- | ------------------------------------------------------------------------ | ------------------------------------------ |
| `claude-agent-sdk`  | You have an active Claude Code subscription (Max or Pro) and want to skip gateway / API billing. **Slow: 6-10s per LLM call** (each call spawns a Claude Code subprocess). Fine for sparse `selfHeal`, painful for dense `extract`. | Requires `claude` CLI authenticated and `@anthropic-ai/claude-agent-sdk` installed (`npm i -g @anthropic-ai/claude-agent-sdk`). |
| `openai-compat`     | Any OpenAI-compatible endpoint — a gateway (aigate, openrouter), a local model server (ollama, vllm, llama.cpp), or openai.com itself. **Fast: ~500ms per call.** | Just needs `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`. |

`browser-cli config` walks you through both. You can also hand-edit `~/.browser-cli/.env` directly — the resolver honors these env vars in this priority order:

```bash
# 1. Claude Code subscription (if LLM_PROVIDER is set)
LLM_PROVIDER=claude-agent-sdk
LLM_MODEL=claude-sonnet-4-5   # optional model hint

# 2. Any OpenAI-compatible endpoint
LLM_API_KEY=sk-...
LLM_BASE_URL=https://your-gateway.example.com/v1
LLM_MODEL=openai/gpt-4o-mini

# 3. Direct OpenAI (fallback)
OPENAI_API_KEY=sk-...

# 4. Direct Anthropic (fallback)
ANTHROPIC_API_KEY=sk-ant-...
```

## Commands

```bash
# Workflows (stateless, one-shot)
browser-cli list                                     # list workflows in ~/.browser-cli/workflows/
browser-cli describe <name>                          # show workflow params + usage
browser-cli run <name> [args]                        # run a workflow end-to-end
browser-cli run <name> [args] --cdp-url <url>        # run against any external Chrome
browser-cli config                                   # interactively update LLM provider in .env

# Notification channels (apprise URLs, persisted in sqlite)
browser-cli notify add <name> <apprise-url>          # register a channel (telegram, discord, mailto, …)
browser-cli notify list                              # show saved channels (use --json for scripting)
browser-cli notify test <name>                       # send a test ping
browser-cli notify rm <name>                         # remove a channel

# Stateful tasks (workflow + cron + diff + sinks, persisted in sqlite)
browser-cli task list                                # list tasks with status, last/next run
browser-cli task show <name>                         # config, recent runs, latest items
browser-cli task run <name>                          # manual one-off run (same code path as the daemon)
browser-cli task enable <name> | task disable <name> # toggle scheduling
browser-cli task remove <name> [--with-state]       # forget a task (optionally wipe its sqlite state)

# Scheduler daemon (drives task execution on cron)
browser-cli daemon                                   # run in foreground (logs to stdout)
browser-cli daemon --detach                          # fork to background (writes pidfile + log)
browser-cli daemon status                            # check if running
browser-cli daemon stop                              # SIGTERM the running daemon

browser-cli --help                                   # show usage
```

## Your first workflow

```bash
mkdir -p ~/.browser-cli/workflows
cp "$(npm root -g)/@browserclijs/browser-cli/examples/hn-top.ts" ~/.browser-cli/workflows/
browser-cli list
# NAME     UPDATED     DESCRIPTION
# ------   ----------  --------------------------------------------
# hn-top   2026-04-18  Fetch top N stories from the Hacker News front page

browser-cli run hn-top '{"limit":3}'
# [
#   { "rank": "1", "title": "...", "url": "...", "score": "...", "user": "..." },
#   ...
# ]
```

## Writing a workflow

Each workflow is a TS file that exports `schema` (Zod) and `run(stagehand, args)`:

```ts
import { z } from 'zod'
import type { Stagehand } from '@browserbasehq/stagehand'

/** One-line description — shown by `browser-cli list`. */
export const schema = z.object({
  query: z.string().min(1),
})

export async function run(stagehand: Stagehand, args: z.infer<typeof schema>) {
  const page = await stagehand.context.newPage()
  await page.goto('https://example.com/', { waitUntil: 'domcontentloaded' })

  // Fast path: raw Playwright
  const title = await page.title()

  // Natural-language fallback: Stagehand self-heals selectors
  // await stagehand.act('click the sign-in button')
  // const data = await stagehand.extract({ ... })

  return { query: args.query, title }
}
```

A starter template lives at `src/templates/workflow.ts.tmpl` inside the installed package.

## Bring your own browser (fingerprint browsers, remote Chrome)

By default `browser-cli` connects to your main Chrome via Playwriter's relay. To
run a workflow inside a different browser — a fingerprint browser profile
(AdsPower, BitBrowser, Multilogin, Hubstudio, …), a Chrome started with
`--remote-debugging-port=9222`, or any other CDP endpoint — pass `--cdp-url`:

```bash
# HTTP discovery URL — browser-cli resolves the websocket via /json/version
browser-cli run hn-top '{"limit":3}' --cdp-url http://127.0.0.1:9222

# Or paste the raw websocket URL directly
browser-cli run hn-top '{"limit":3}' \
  --cdp-url "ws://127.0.0.1:9222/devtools/browser/abc123"

# Persist a default for the shell
export BROWSER_CLI_CDP_URL=http://127.0.0.1:9222
browser-cli run hn-top '{"limit":3}'
```

Workflow files don't change — the CDP endpoint is a runner-level concern.
When `--cdp-url` is supplied the Playwriter preflight is skipped; instead
browser-cli probes `/json/version` on the given host and fails fast with a
clear error if the endpoint is unreachable.

## Using as an SDK

```ts
import { runWorkflow, notify } from '@browserclijs/browser-cli'

const result = await runWorkflow('hn-top', { limit: 3 })

// Inside a workflow, fire a notification on a non-throwing problem state
// (e.g. "got data but it looks like the login expired"):
await notify('telegram-me', {
  title: 'github-summary: login expired',
  body: 'Cookie for github.com rejected, re-run config.',
})
```

## Stateful tasks, scheduling & notifications

Workflows are pure functions. To poll a page on a schedule, dedupe items, generate an RSS feed, or get notified when something changes, wrap the workflow in a **task**.

A task is a `.ts` file under `~/.browser-cli/tasks/<name>.ts` that exports a `config` object:

### Items mode — RSS / new-item detection

```ts
// ~/.browser-cli/tasks/hn-rss.ts
import type { TaskConfig } from '@browserclijs/browser-cli'

export const config: TaskConfig = {
  workflow: 'hn-top',
  args: { limit: 30 },
  schedule: '*/30 * * * *',     // standard cron, 5-field
  itemKey: 'url',                // → items mode: dedupe by this field
  output: {
    rss: {
      title: 'HN Top',
      link: 'https://news.ycombinator.com/',
      itemTitle: 'title',
      itemLink: 'url',
    },
  },
  notify: {
    channels: ['telegram-me'],   // fires only on new items (after dedup)
    onError: ['telegram-me'],    // fires if the workflow throws
  },
}
```

The daemon writes a valid Atom 1.0 file to `~/.browser-cli/feeds/<task>.xml` and pings `telegram-me` whenever new items appear.

### Snapshot mode — page-change detection

```ts
// ~/.browser-cli/tasks/announcement-watch.ts
import type { TaskConfig } from '@browserclijs/browser-cli'

export const config: TaskConfig = {
  workflow: 'page-text',         // returns a single value (string / object)
  args: { url: 'https://example.com/news', selector: '#announcement' },
  schedule: '*/10 * * * *',
  // no itemKey → snapshot mode: hash the entire return, fire on change
  notify: {
    channels: ['telegram-me'],
    onChangeTemplate: '{{ workflow }} changed:\nbefore: {{ before }}\nafter: {{ after }}',
  },
}
```

The first run captures a baseline silently. Any subsequent run whose JSON hash differs from the stored snapshot triggers the notification.

### Putting it together

```bash
# 1. Register a notification channel once
browser-cli notify add telegram-me 'tgram://BOT_TOKEN/CHAT_ID'
browser-cli notify test telegram-me

# 2. Drop a task file (or use the Claude Code skill — `/browser-cli` and ask it to scaffold)
$EDITOR ~/.browser-cli/tasks/hn-rss.ts

# 3. Try it manually before automating
browser-cli task run hn-rss
browser-cli task show hn-rss

# 4. Start the scheduler daemon
browser-cli daemon --detach
browser-cli daemon status
```

State lives in `~/.browser-cli/db.sqlite` (better-sqlite3): `tasks`, `items`, `snapshots`, `runs`, `channels`. Feed files live in `~/.browser-cli/feeds/`. Logs from the detached daemon land in `~/.browser-cli/daemon.log`.

## Claude Code skill

The npm package ships a Claude Code skill at `<pkg>/skills/browser-cli/SKILL.md`. npm does NOT auto-discover it from the global install directory, so copy it once:

```bash
cp -r "$(npm root -g)/@browserclijs/browser-cli/skills/browser-cli" ~/.claude/skills/
```

Then restart Claude Code. It will discover the skill and invoke `browser-cli list` / `browser-cli run ...` via the Bash tool when you ask it to operate on a webpage.

## Files & paths

| Path                              | Purpose                                  |
| --------------------------------- | ---------------------------------------- |
| `~/.browser-cli/workflows/*.ts`   | Your workflow scripts                    |
| `~/.browser-cli/tasks/*.ts`       | Task configs (workflow + cron + sinks)   |
| `~/.browser-cli/feeds/*.xml`      | Generated Atom 1.0 RSS feeds             |
| `~/.browser-cli/db.sqlite`        | Tasks, items, snapshots, runs, channels  |
| `~/.browser-cli/daemon.pid`       | Detached scheduler pid                   |
| `~/.browser-cli/daemon.log`       | Detached scheduler stdout + stderr       |
| `~/.browser-cli/.cache/`          | Stagehand action cache (auto-generated)  |
| `~/.browser-cli/.env`             | LLM credentials                          |
| `$BROWSER_CLI_HOME`               | Override the default home directory      |
| `$BROWSER_CLI_CDP_URL`            | Default CDP endpoint when `--cdp-url` not given |

## Known limitations

- Playwriter's CDP relay is bound to a single Chrome instance. Concurrent workflows that mutate the same page or cookies can race — the safe pattern is one workflow per tab.
- Stagehand has a known URL-normalization quirk in its cache keys (`example.com` vs `example.com/`). Avoid mixing trailing slashes in `page.goto` calls within a single workflow until the upstream fix lands.

## License

MIT
