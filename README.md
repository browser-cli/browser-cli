# browser-cli

Run TypeScript automation workflows against **your own, logged-in Chrome**. Each workflow is a `.ts` file exporting a Zod `schema` and an async `run(stagehand, args)`. Wrap workflows in tasks to get cron scheduling, deduped Atom feeds, and change-detection notifications — all from a single daemon on your machine.

Built on [Stagehand](https://github.com/browserbase/stagehand) (self-healing DOM automation) and [Playwriter](https://playwriter.dev/) (CDP relay for your real Chrome).

## Install

```bash
npm install -g @browserclijs/browser-cli
browser-cli config       # configure LLM provider (interactive)
```

See [**Prerequisites**](./docs/src/content/docs/en/introduction.md) for the Chrome / Playwriter / apprise setup.

## Documentation

Full docs — concepts, design philosophy, features — live in [`docs/`](./docs/src/content/docs/en/) and are published as a bilingual static site (coming soon on Cloudflare Pages).

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
