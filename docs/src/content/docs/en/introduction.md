---
title: Introduction
description: What browser-cli is, who it's for, and the mental model behind it.
---

**browser-cli** runs TypeScript automation workflows against your own, logged-in Chrome. You write a file, the CLI runs it, and you get the data you came for — without standing up a scraping farm, maintaining a fleet of fragile selectors, or renting infra to keep a cron job alive.

## The problem

A lot of the internet has quietly become read-only unless you have a browser. Sites kill their RSS feeds. Public APIs disappear behind auth walls. Pages that used to render HTML now boot a SPA that hydrates from private JSON endpoints. The data is still there — it's just locked behind *your* session, your cookies, your Chrome profile.

The common workarounds are all bad in their own way:

- **Headless scraping farms** don't know who you are. They get throttled, fingerprinted, challenged, and blocked.
- **Bespoke Playwright scripts** break the moment a site renames a CSS class.
- **Cloud schedulers** (Lambda, cron on a VPS) add infra you have to maintain for a one-line scraping job.

browser-cli sits below all of this. It automates *your* real Chrome, via a local CDP relay, so sites see the same session you'd see if you visited them yourself. Workflows are TypeScript files. The scheduler is a single daemon on your laptop or a server you already own. When a site's DOM drifts, Stagehand's LLM-backed selectors adapt in place of brittle queries.

## Who it's for

- **Developers automating their own accounts.** You want to pull data from GitHub, your bank, your internal dashboards, your email — places you're logged in as yourself. Not a bot, just you, doing it on a schedule.
- **RSS DIYers.** Sites that deprecated their feeds (Twitter/X, Medium, forums) can be reconstituted into Atom feeds with a single task config.
- **Scheduled-scraping without DevOps.** No Kubernetes, no Lambda cold starts. A laptop, a Chrome, and `browser-cli daemon` will do.
- **Code agent users.** browser-cli ships as a skill for Claude Code, Codex, and OpenCode. You describe what you want in chat; the agent drafts, runs, and debugs the workflow — you don't hand-write one.

## Who it's *not* for

- **Anonymous scraping at scale.** browser-cli leans on your real session and your real fingerprint. It has no multi-account rotation, no proxy pool, no anti-detection layer. That's by design.
- **Commercial data harvesting.** One machine, one browser, one user. The architecture won't scale horizontally and we're not trying to make it.
- **Bot frameworks.** There's no built-in humanization, no click-jittering, no Turing evasion. If a site actively fights bots, you'll lose.

## The mental model

You write a **workflow** — a TypeScript file that exports a Zod schema describing its arguments and an async `run(browser, args)` function. The CLI loads the file, validates arguments, hands you a ready-to-use `Browser` wrapper, and gets out of your way. You don't manage the browser lifecycle; the runner does.

Inside `run`, you pick the lightest tool that will do the job. Public `fetch` when no browser is needed. [Network interception](/en/philosophy/#layer-1--intercept-the-network) (`page.captureResponses`, `page.fetch`) when the data is in JSON the page already fetches. [Stagehand's LLM-backed](/en/philosophy/#layer-2--stagehand-for-the-dom) `page.act` and `page.extract` when the DOM is the only path and selectors might drift. The [philosophy page](/en/philosophy/) goes deep on this triage — it's the thing we care most about.

You run the workflow directly with `browser-cli run <name>`, or you wrap it in a **task** — a small config that binds a workflow to a cron schedule, dedupes results, writes an Atom feed, and notifies you when something new shows up or a page changes. Tasks are how one-shot workflows become feeds and alerts.

A **daemon** (`browser-cli daemon --detach`) runs tasks in the background. State lives in SQLite under `~/.browser-cli/`. The home directory is a git repo, so your workflows, tasks, and history are versioned, diffable, and portable.

That's the whole picture. Four moving parts: **workflow** (what to do), **task** (when + how to track), **daemon** (the loop), **Stagehand** (the DOM safety net). Everything else in these docs is detail.
