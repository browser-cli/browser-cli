---
title: Features
description: What browser-cli gives you beyond a runtime — concurrency isolation, self-healing selectors, BYO Chrome, scheduled feeds, and sharable workflows.
---

The [Introduction](./introduction.md) covers what browser-cli *is*. This page covers what you get for free once you're using it.

## Concurrent workflows don't collide

Running five workflows at once against five different sites shouldn't corrupt any of their sessions. browser-cli guarantees this without requiring you to think about it.

Every workflow run gets a unique CDP client ID of the form `bc-{pid}-{base36-timestamp}`, appended to Playwriter's relay path. Playwriter spins up a fresh browser context per client ID, backed by the same underlying Chrome profile. Cookies and local storage are shared across contexts (so every run is logged in), but each context has its own pages, its own in-memory state, and its own lifecycle.

The practical consequence: you can have a Telegram scraper and a GitHub notifier and a product-price monitor all running at the same minute, and none of them will step on each other's tabs, share a half-loaded page, or see each other's downloads. Isolation is free and automatic.

## Stagehand self-heal absorbs DOM drift

Traditional Playwright scripts die the moment a site renames a CSS class. browser-cli enables Stagehand's `selfHeal: true` by default.

The mechanism is simple. When `stagehand.act("click the 'Export' button")` runs, Stagehand asks an LLM to resolve the instruction against the live DOM, caches the resulting selector under `~/.browser-cli/.cache/`, and reuses it next time. If the cached selector fails — because the button moved, the class renamed, the component re-rendered — Stagehand transparently re-asks the LLM, picks a new selector, and updates the cache. Your workflow keeps running; you don't find out until you read the logs.

This is why the [philosophy](./philosophy.md) page steers you toward Stagehand for any interaction that has to touch the DOM: selector drift becomes a cache miss, not a crash.

## Bring your own Chrome

The default CDP target is Playwriter's local relay (`ws://127.0.0.1:19988/cdp/{clientId}`), which uses your everyday Chrome. That's the path we recommend because it inherits your real fingerprint and your real sessions.

But you can redirect any run at any CDP endpoint:

- `--cdp-url ws://...` on the command line overrides for one run.
- `BROWSER_CLI_CDP_URL=...` in the environment (or `~/.browser-cli/.env`) overrides globally.

The resolver accepts `ws://`, `wss://`, `http://`, and `https://`. Point it at a fingerprint browser (AdsPower, Multilogin), a remote Chrome on a VPS, a containerized headless instance — whatever you need. The workflow code never changes; only the target endpoint does.

## Scheduled feeds and change detection, built in

The [task](./concepts/task.md) system turns any workflow into either an Atom RSS feed or a change-detection alert, based on whether you set `itemKey`.

- **Feed mode (items)**: workflow returns an array, daemon dedupes by key, new entries flow into `~/.browser-cli/feeds/<task>.xml` — drop-in subscribable in any reader.
- **Alert mode (snapshots)**: workflow returns any JSON, daemon hashes it, notifies you with before/after when the hash changes.

Both modes share the same cron scheduler, the same notification channels (Telegram, Discord, Slack, email, webhooks — anything [apprise](https://github.com/caronc/apprise) supports), and the same failure reporting. You configure a task once; the daemon handles retries, state, feeds, and pings.

## Subscriptions: share workflows as git repos

Workflows are just TypeScript files in a git repo. That makes them trivially shareable.

```
browser-cli sub add https://github.com/friend/their-workflows --name friend
browser-cli run friend/twitter-bookmarks
```

Subscribed repos clone into `~/.browser-cli-subs/<name>/` and are **read-only** by convention — `browser-cli sub update` pulls new commits without touching your local modifications. When you want to fork a subscribed workflow into something editable, `browser-cli sub copy friend/twitter-bookmarks my-twitter` copies it into your own `~/.browser-cli/workflows/` and you diverge from there.

A registry at `~/.browser-cli/subs.json` tracks which repos are subscribed, at what revisions, and where their symlinks point.

## Everything is a git repo

`~/.browser-cli/` itself is initialized as a git repo the first time you run the CLI. Your workflows, tasks, and notifications live in tracked files. `browser-cli sync` commits any changes with a sensible message and lets you push to your own remote for backup and portability.

This is the cheapest possible "cloud sync": your data is plain text, your history is `git log`, and restoring to a new machine is `git clone` plus `browser-cli init`.
