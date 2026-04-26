# Task creation (browser-cli sub-flow)

**Loaded from `SKILL.md`.** Use this when the user wants recurring, stateful execution of a workflow — RSS feeds, new-item detection, page-change monitoring, schedule-driven notifications.

Tasks wrap a workflow with `{ schedule, args, itemKey, output, notify }`. A `browser-cli daemon` process reads tasks, fires them on cron, diffs results against sqlite, writes RSS feeds, and dispatches notifications via apprise.

## The two diff modes (decide this first)

| Mode | When | Workflow return | What "change" means |
|---|---|---|---|
| **items** | RSS feeds, new posts, new jobs, new deals | `T[]` — an array | A new element appears, keyed by `itemKey` |
| **snapshot** | Page-content monitoring, price watches, "did this change" | Any JSON value | The full payload hash differs from last run |

Mode is inferred from the presence of `itemKey` — set it for items mode; leave it off for snapshot mode. Don't guess — ask the user which they want if their goal could go either way.

## Orchestration

### Step 1: ensure the workflow exists

```bash
browser-cli list <site>          # scope by site when you know it (case-insensitive substring)
browser-cli list                 # or no filter to see everything
```

Ask the user which global or subscribed workflow this task wraps. Project-level workflows are for direct `list`/`describe`/`run` use only in v1; the daemon/task layer remains global. If the one they want **doesn't exist** (or they've described a scraping goal with no existing workflow), STOP and load `./workflow-create.md` and create a global workflow. Return here after the workflow is created and tested with `browser-cli run <name>`.

### Step 2: pick the diff mode

Ask:
- "Does the workflow return a list of items with stable IDs (like URLs)?" → **items mode**, ask for the key field name (usually `url`, `id`, or `permalink`).
- "Is it a single value or object whose content you want to watch for changes?" → **snapshot mode**, no key needed.

**Validation reminder**: if `itemKey` is set, the workflow MUST return an array. If it returns a scalar or object, the task will fail at runtime with a clear error message. When in doubt, check the workflow's return statement.

### Step 3: ask about notifications

Show saved channels:

```bash
browser-cli notify list
```

Prompt: "Do you want notifications on new items / changes? On task errors?"

If the user wants notifications but **no channels exist**, STOP and load `./channel-create.md`. Return after channel creation + test.

Collect:
- `notify.channels` — array of channel names to ping on new items / content changes
- `notify.onError` — array of channel names to ping if the task run throws (daemon wraps execution in try/catch)

### Step 4: ask about RSS (items mode only)

Skip in snapshot mode. For items mode, ask: "Do you want an RSS feed generated?"

If yes, collect:
- `rss.title` — feed title
- `rss.link` — canonical page link (goes in the feed metadata)
- `rss.itemTitle` — which field in each item is the title (default: `title`)
- `rss.itemLink` — which field is the item link (default: `url`)
- optionally: `rss.itemDescription`, `rss.itemPubDate`, `rss.maxItems`

Feeds are written under `$(browser-cli home)/feeds/<task>.xml` as Atom 1.0. User can point any RSS reader at that file:// path or serve it via their own HTTP server.

### Step 5: ask for the cron schedule

Explain in plain language and show an example. Validate with croner — the loader rejects invalid cron strings.

Common patterns:
- `*/30 * * * *` — every 30 minutes
- `0 * * * *` — top of every hour
- `0 9 * * *` — every day at 9:00
- `0 9 * * 1-5` — weekday mornings at 9
- `*/10 * * * *` — every 10 minutes

### Step 6: write the task file

Call the interactive scaffolder:

```bash
browser-cli task create <name>
```

It prompts for all of the above and writes the task file under your browser-cli home (the CLI resolves the path internally). You can also hand-write the file directly — the scaffolder is a convenience, not a requirement.

**Hand-written task format** (write directly when you have all the details already). Resolve the home once (`HOME=$(browser-cli home)`), then Write to `$HOME/tasks/<name>.ts`:

```ts
import type { TaskConfig } from '@browserclijs/browser-cli'

export const config: TaskConfig = {
  workflow: 'hn-top',               // name of a global/subscribed workflow; project workflows are not task targets in v1
  args: { limit: 30 },              // passed to workflow's run()
  schedule: '*/30 * * * *',         // cron
  itemKey: 'url',                   // → items mode; remove for snapshot mode
  output: {
    rss: {
      title: 'HN Top',
      link: 'https://news.ycombinator.com/',
      itemTitle: 'title',
      itemLink: 'url',
    },
  },
  notify: {
    channels: ['telegram-me'],      // fires on new items / content changes
    onError: ['telegram-me'],       // fires if the task errors
    // onChangeTemplate: '{{ workflow }} changed: {{ before.price }} → {{ after.price }}',
  },
}
```

The `onChangeTemplate` field (snapshot mode only) supports `{{ before.X }}`, `{{ after.X }}`, `{{ workflow }}`, `{{ task }}` with dot-path access.

### Step 7: run once manually to verify

```bash
browser-cli task run <name>
```

This is the same code path as the daemon tick: load workflow → run → diff → sinks → record. Safe to run repeatedly.

Verify the outcomes:
- **Items mode first run**: all items fire as "new", notifications sent (if configured), RSS file written.
- **Items mode second run**: no new items (dedupe works), no notifications, no RSS rewrite.
- **Snapshot mode first run**: baseline captured, NO notification.
- **Snapshot mode second run**: if the source page hasn't changed, no notification; if it has, change notification fires.

### Step 8: check the daemon is running

```bash
browser-cli daemon status
```

If not running, remind the user:

```bash
browser-cli daemon              # foreground — tie to the terminal
browser-cli daemon --detach     # background — writes daemon.pid under $(browser-cli home)
```

For boot-start on macOS, the user can wrap `browser-cli daemon --detach` in a launchd plist; we don't install one automatically in v1.

### Step 9: commit the task file

If you used `browser-cli task create <name>` above, the scaffolder already runs the commit prompt at its tail — no extra step needed. If you **hand-wrote** the task file (used `Write` / `Edit` tools directly), end with:

```bash
browser-cli sync
```

Relay the `[y]es / [n]o / [d]iff / [s]how-files` prompt to the user and wait for their reply. On `d` or `s` re-run `sync` so the details print before they commit.

## Snapshot-mode examples

### Amazon price watch

```ts
// Assumes a workflow 'amazon-price' that returns { price, availability }
import type { TaskConfig } from '@browserclijs/browser-cli'

export const config: TaskConfig = {
  workflow: 'amazon-price',
  args: { asin: 'B0C123ABCD' },
  schedule: '0 * * * *',            // hourly
  // no itemKey → snapshot mode
  notify: {
    channels: ['telegram-me'],
    onChangeTemplate: '{{ workflow }} changed:\nprice: {{ before.price }} → {{ after.price }}\navailability: {{ before.availability }} → {{ after.availability }}',
  },
}
```

### Announcement watch (any-change trigger)

```ts
export const config: TaskConfig = {
  workflow: 'page-text',            // returns innerText of a selector
  args: { url: 'https://example.com/news', selector: '#announcement' },
  schedule: '*/10 * * * *',
  notify: { channels: ['telegram-me'] },
}
```

## Troubleshooting

- **"task X uses itemKey but workflow returned Y"**: Either change the workflow to return an array, or remove `itemKey` to use snapshot mode.
- **"task file added" logged but no runs**: check `browser-cli task show <name>` — `enabled: yes`? `next run` in the near future? If next run is far away (wrong cron), fix the schedule.
- **Daemon running but no notifications fire**: run `browser-cli notify test <channel>` directly to isolate channel vs task issues.
- **Apprise not on PATH warning**: `pipx install apprise` (or `brew install apprise`). The daemon keeps running either way — tasks execute, notifications just skip.
