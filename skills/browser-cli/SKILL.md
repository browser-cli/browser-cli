---
name: browser-cli
description: "Use when the user wants to create, run, or debug browser automations stored in a project or browser-cli home, schedule them as tasks (RSS feeds, page-change monitoring, new-item notifications), or configure notification channels. Triggers on references to .browser-cli/, ~/.browser-cli/, `browser-cli run`, `browser-cli task`, scheduled-scraping asks like \"每小时抓 X\", change-detection asks like \"网页 X 有变化就通知我\", RSS-feed asks, or notification-channel setup."
version: 2.0.0
---

# browser-cli

A CLI and SDK for running browser automations on the user's real logged-in Chrome. Tasks layered on top add scheduling, stateful diffing, RSS feeds, and apprise-backed notifications.

## Resolving the home directory
  ```bash
  HOME=$(browser-cli home)              # absolute path to the home dir, one line
  SUBS=$(browser-cli subs-home)         # absolute path to the subs dir
  ```
  Then Write to `$HOME/workflows/<name>.ts`, `$HOME/tasks/<name>.ts`, etc. Never expand `~/.browser-cli` yourself — the env var may point somewhere else (tests, multi-profile setups, CI).
- Places in this skill that mention `~/.browser-cli/...` in prose are kept as user-recognizable shorthand (`SKILL.md`'s trigger bullets echo user phrasing). **Always substitute the resolved home before acting.**

## Project-level workflows

When working inside a git repo, browser-cli also supports project workflows at `<git-root>/.browser-cli/workflows/<name>.ts`. `browser-cli list`, `browser-cli describe`, and `browser-cli run` resolve project workflows before global home workflows; tasks/daemon remain global in v1.

Before creating or editing a workflow, ask the user whether it should be **project-level** or **global**. Recommend project-level when the workflow belongs to the current repository or should be shared with that project's code. If they choose project-level, write under the repo's `.browser-cli/workflows/` and do not run `browser-cli sync`; the outer project repo owns versioning.
## Sub-flows

This skill has four sub-flows. Based on the user's intent, **read ONE of these files and follow its instructions**:

## 1. Creating or debugging a workflow

**Read:** `./workflow-create.md`

**Triggers:**
- "write a script that scrapes X"
- "抓一下 X 的 Y" / "写一个 X 的脚本"
- "run a workflow", "debug this workflow", "why is my workflow failing"
- Any mention of `~/.browser-cli/workflows/` or `browser-cli run`
- "notify me if this workflow fails / if login expired" (covered as a notify-on-error extension in `workflow-create.md`)

Workflows are pure functions: input args → JSON output. Stateless. One-shot unless wrapped in a task. They receive a single `Browser` argument from `@browserclijs/browser-cli` — the only sanctioned surface — which hides Stagehand/Playwright internals and enforces the three-layer triage (public-API → network-capture → Stagehand DOM). Raw `page.evaluate` + `document.querySelectorAll` is banned; see `workflow-create.md`.

## 2. Creating a scheduled task (stateful, recurring)

**Read:** `./task-create.md`

**Triggers:**
- "poll X every N minutes / hours"
- "run this on a schedule" / "cron"
- "give me an RSS feed of X"
- "notify me when Y changes" / "监控 Y 的变化"
- "监控网页 X 有新内容就通知我"
- Any mention of `browser-cli task` or `browser-cli daemon`

Tasks wrap a workflow with `{ schedule, args, itemKey, output, notify }`. Supports two diff modes:
- **items** (set `itemKey`): workflow returns `T[]`, framework dedupes → RSS/new-item detection
- **snapshot** (no `itemKey`): workflow returns any JSON, framework hashes → page-change detection

## 3. Adding a notification channel

**Read:** `./channel-create.md`

**Triggers:**
- "add telegram / discord / email notify"
- "set up notifications"
- "configure apprise"
- "I want notifications to go to X"
- Also loaded implicitly from flows 1 and 2 when they need a channel that doesn't exist yet

Channels are named apprise URLs stored in sqlite. Once saved, refer to them by name from workflows (`notify('tg-me', ...)`) or tasks (`notify: { channels: ['tg-me'] }`).

## 4. Managing subscriptions (shared git repos of workflows/tasks)

**Read:** `./sub-manage.md`

**Triggers:**
- "subscribe to X" / "订阅 X"
- "share these scripts with my team" / "分享这些脚本给同事"
- "pull updates from the team pack" / "这个 sub 的脚本更新了"
- "这个 sub 的脚本报错了我想改" / "fork this subscribed workflow so I can edit"
- Any mention of `browser-cli sub`, `~/.browser-cli-subs/`, or `subs.json`

Subscriptions are additional git repos cloned under the subs directory (`browser-cli subs-home`) containing shared `workflows/` and/or `tasks/`. They are **read-only** — to modify a subscribed script, `sub copy` it into the user's own home first, or copy the workflow logic into the project workflow directory when the user explicitly wants a project-local fork.

## Cross-flow orchestration

The sub-flows reference each other:

```
user: "每小时抓 HN 有新条目就推 Telegram"
  → SKILL.md → task-create.md
    → checks workflows → hn-top missing → load workflow-create.md → return
    → checks channels → none saved → load channel-create.md → return
    → writes the task file via `browser-cli task create hn-rss` (CLI resolves path)
    → reminds user: start browser-cli daemon
```

Each sub-flow is self-contained if entered directly (user says "add a telegram channel" → SKILL.md → channel-create.md → done).

## CLI surface reference

```
browser-cli list [<site>]                        list workflows (case-insensitive substring filter)
browser-cli describe <name>                      show a workflow's params
browser-cli run <name> [args]                    run a workflow once
browser-cli config                               LLM provider setup

browser-cli task list [<site>]                   list tasks with status (filter matches underlying workflow)
browser-cli task create <name>                   interactive task scaffolder
browser-cli task show <name>                     task config + recent runs + state
browser-cli task run <name>                      run a task once (same as daemon tick)
browser-cli task enable|disable <name>           toggle scheduling
browser-cli task rm <name>                       delete task file + db row

browser-cli daemon [--detach|-d]                 start the scheduler
browser-cli daemon status                        check running daemon
browser-cli daemon stop                          stop detached daemon

browser-cli notify add <name> <apprise-url>      register a named channel
browser-cli notify list [--json]                 list channels
browser-cli notify test <name>                   send a test notification
browser-cli notify rm <name>                     delete a channel

browser-cli init                                 re-sync layout; print git status + remote hint
browser-cli sync                                 review uncommitted changes + commit (y/n/diff/show)

browser-cli sub add <git-url> [--name N]         clone a shared repo of workflows/tasks
browser-cli sub list                             list subscriptions with counts
browser-cli sub update [name]                    git fetch + hard-reset; warns if dirty
browser-cli sub remove <name>                    delete clone + registry entry
browser-cli sub copy <sub>/<wf-or-task>          fork a subscribed file into your own workflows/ or tasks/
```

## Post-write commits

The browser-cli home is a git repo (auto-initialized on first use). Whenever you write or edit files there — `workflows/*.ts`, `tasks/*.ts`, `subs.json` — end the flow by calling:

```bash
browser-cli sync
```

This prints a summary of uncommitted changes and prompts the user `[y]es / [n]o / [d]iff / [s]how-files`. Relay the prompt output to the user; if they answer `d` or `s`, re-run so they can see the details before committing. CLI subcommands that mutate files (`task create`, `task rm`, `sub add|update|remove|copy`) already call the same prompt at their tail, so you don't need to call `sync` after those — only after you used the `Write` or `Edit` tool directly. Do not run `browser-cli sync` for project-level workflows; use the project's normal git workflow.

## Filesystem layout

The home directory (`browser-cli home`) contains — **tracked in git** — `workflows/<name>.ts` (pure functions: schema + run), `tasks/<name>.ts` (scheduled + stateful wrappers), `subs.json` (registry of subscribed repos), and `.gitignore`. It also contains — **ignored** — `feeds/<task>.xml` (RSS feeds from items-mode tasks), `db.sqlite` (tasks / items / snapshots / runs / channels), `daemon.pid` + `daemon.log` (detached daemon state), `.cache/` (Stagehand action cache), `.env` (LLM config), and `node_modules/` (auto-symlinked on first run). Project workflows use `<git-root>/.browser-cli/workflows/` and are tracked by the outer repo, not by browser-cli's home git repo.

The subs directory (`browser-cli subs-home`) is **not** tracked by the user's repo. Each entry `<sub-name>/` is its own git clone managed by `browser-cli sub` and contains read-only `workflows/` and `tasks/`. Fork one into the user's home via `sub copy` before editing.
