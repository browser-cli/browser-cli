---
title: Task
description: A scheduled, stateful wrapper around a workflow — dedupe items into an Atom feed, or hash a snapshot and notify on change.
---

A **task** is how a one-shot [workflow](/en/concepts/workflow/) becomes a recurring job. It's a small config that binds a workflow to a cron schedule, remembers what the workflow saw last time, and emits something useful when things change — a new RSS item, a notification, a diff.

Workflows answer *what to do*. Tasks answer *when to do it, how to track results, and who to tell*.

## The shape

A task is a TypeScript file exporting a single `config`:

```ts
export type TaskConfig = {
  workflow: string                  // name of the workflow to run
  args?: Record<string, unknown>    // arguments passed to workflow.run
  schedule: string                  // cron expression
  itemKey?: string                  // presence decides the mode (see below)
  output?: { rss?: RssConfig }      // optional Atom feed
  notify?: NotifyConfig             // notification channels
}
```

Task files live at `~/.browser-cli/tasks/<name>.ts`. The filename is the task name (`browser-cli task show hn-monitor`).

## Two modes: items and snapshot

Whether a task is in **items mode** or **snapshot mode** depends on a single field: `itemKey`.

**Items mode** (`itemKey` set). The workflow is expected to return an *array*. Each element must carry a field with the name you gave to `itemKey` (typically `url` or `id`). The daemon dedupes against everything the task has ever seen before, stores the new ones in SQLite, optionally writes them into an Atom 1.0 feed at `~/.browser-cli/feeds/<name>.xml`, and notifies you with "*X new items*" plus previews. Use this mode for "give me a feed of new things" — Hacker News, forum threads, job postings.

**Snapshot mode** (no `itemKey`). The workflow returns any JSON-serializable value. The daemon stable-stringifies the output, SHA-256s it, and compares against the last stored hash. If the hash changed, it stores the new snapshot and notifies with the before/after payloads. Use this for "tell me when *this* changes" — a product's price, an availability banner, a status page.

That's the whole conceptual split. Same daemon, same scheduler, same notification system; the only difference is whether `itemKey` is defined.

## Scheduling

`schedule` is a standard cron expression parsed by [`croner`](https://github.com/hexagon/croner): `'*/15 * * * *'` is every 15 minutes, `'0 9 * * *'` is 9 a.m. daily. The daemon (`browser-cli daemon`, or `--detach` for background) wakes at the right times, finds the tasks whose `nextRunAt` has passed, and runs them. After each run it recomputes the next fire time and updates the database.

## State

State lives in `~/.browser-cli/db.sqlite` (SQLite via `better-sqlite3`), with four tables:

| Table | Purpose |
|---|---|
| `tasks` | Registry: name, enabled flag, config hash, last run, next run |
| `items` | Items-mode store: keyed entries, first-seen / last-seen timestamps |
| `snapshots` | Snapshot-mode store: last payload + hash |
| `runs` | Per-execution log: status, started/ended, new item count, error message |

The `config hash` is a quick way for the daemon to detect that you edited the task file and to re-seed its schedule. The `items` and `snapshots` tables are the durable memory that turns a stateless workflow into a stateful task.

## Outputs

Depending on how a task is configured, a run produces:

- **RSS/Atom feed** — items mode only, when `output.rss` is set. Newest items first, capped at `maxItems`, mapped to feed fields by `itemTitle`/`itemLink`/`itemDescription`.
- **Console output** — `browser-cli task run <name>` executes the task ad-hoc and prints the result.
- **Notifications** — `notify.channels` lists named apprise channels (configured via `browser-cli notify add`) that receive a templated message on new content. `notify.onError` is a separate list that fires only when the workflow throws.

You can have any combination: feed only, notify only, both, or neither.

## Lifecycle

Tasks are managed through the CLI:

- `task create <name>` — scaffold a new task file
- `task list` — show all tasks with enabled status, last/next run
- `task show <name>` — display config + recent runs + current state
- `task run <name>` — execute once, ignoring the schedule
- `task enable <name>` / `task disable <name>` — flip the enabled flag; the daemon picks it up without a restart
- `task rm <name>` — delete the file and its rows

Enable/disable only flip a database flag; the file on disk is untouched.

## A realistic task

```ts
import type { TaskConfig } from '@browserclijs/browser-cli'

export const config: TaskConfig = {
  workflow: 'hn-top',
  args: { limit: 10 },
  schedule: '*/15 * * * *',     // every 15 minutes
  itemKey: 'url',               // items mode — dedupe by url
  output: {
    rss: {
      title: 'HN top stories',
      link: 'https://news.ycombinator.com',
      itemTitle: 'title',
      itemLink: 'url',
    },
  },
  notify: { channels: ['telegram'], onError: ['telegram'] },
}
```

Every 15 minutes the daemon runs the `hn-top` workflow, asks "which of these URLs have I never seen?", stores and writes the new ones into an Atom feed, and pings Telegram with a preview. If the workflow throws — network blip, HN outage, bad selector — Telegram gets the error instead.

A price monitor is the same shape without `itemKey` and `output.rss`: the workflow returns `{ price, stock }`, the daemon compares hashes, and notifies when something changes.
