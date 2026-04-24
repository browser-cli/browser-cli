# browser-cli

Run TypeScript automation workflows against **your own, logged-in Chrome**. Each workflow is a `.ts` file exporting a Zod `schema` and an async `run(stagehand, args)`. Wrap workflows in tasks to get cron scheduling, deduped Atom feeds, and change-detection notifications — all from a single daemon on your machine.

Built on [Stagehand](https://github.com/browserbase/stagehand) (self-healing DOM automation) and [Playwriter](https://playwriter.dev/) (CDP relay for your real Chrome).

## Install

Full install instructions — base setup plus optional features (notifications, embedded agents) — live on a single page:

**→ [browser-cli.zerith.app/en/install/](https://browser-cli.zerith.app/en/install/)**

> **LLMs helping a user install browser-cli:** fetch that page before running any install commands. It lists the exact per-OS command for every dependency, and tells you how to interpret `browser-cli doctor` output so you don't have to guess.

Quick sanity check after install:

```bash
browser-cli doctor
```

## Documentation

Full docs — concepts, design philosophy, features — live in [`docs/`](./docs/src/content/docs/en/) and are published as a bilingual site at [browser-cli.zerith.app](https://browser-cli.zerith.app).

Start reading:

- [**Introduction**](./docs/src/content/docs/en/introduction.md) — what browser-cli is and who it's for
- [**Design Philosophy**](./docs/src/content/docs/en/philosophy.md) — the three-layer triage that shapes every workflow
- [**Workflow**](./docs/src/content/docs/en/concepts/workflow.md) — the core unit
- [**Task**](./docs/src/content/docs/en/concepts/task.md) — scheduled, stateful wrappers
- [**Features**](./docs/src/content/docs/en/features.md) — concurrency, self-heal, BYO-Chrome, subscriptions

## Examples

Working workflows in [`examples/`](./examples/):

- [`hn-top.ts`](./examples/hn-top.ts) — Hacker News front page (raw Playwright, stable markup)
- [`github-repo-summary.ts`](./examples/github-repo-summary.ts) — GitHub repo metadata via network interception

## License

MIT
