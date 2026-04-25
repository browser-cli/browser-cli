---
title: Workflow
description: The core unit of browser-cli — a TypeScript module that exports a Zod schema and an async run function.
---

A **workflow** is the core unit of browser-cli. It's a single TypeScript file that describes *how to do one browser-automation thing, once*. The same file can be invoked from the CLI, scheduled as a [task](/en/concepts/task/), or imported as a function through the SDK. Workflows are stateless and one-shot — any state they accumulate (deduped items, snapshots, run logs) is owned by the task layer, not the workflow itself.

## The shape

Every workflow exports exactly two things:

```ts
export type WorkflowModule<S extends ZodSchema = ZodSchema> = {
  schema: S
  run: (browser: Browser, args: z.infer<S>) => Promise<unknown>
}
```

- `schema` is a [Zod](https://zod.dev) validator describing the arguments the workflow accepts.
- `run` is an async function that receives a ready-to-use `Browser` wrapper and the parsed arguments, and returns any value.

That's the entire contract. No subclassing, no decorators, no lifecycle hooks.

## Why this shape

Splitting the workflow into a schema and a function buys three things:

- **Introspection without execution.** `browser-cli describe <name>` reads the schema and prints the argument list without ever launching Chrome. You can see what a workflow expects before you run it.
- **Type-safe runtime validation.** The runner parses raw CLI arguments — strings from the shell, JSON blobs, positional args — against the schema. Type mismatches surface as readable errors before any browser work starts. Inside `run`, `args` is fully typed.
- **Zero browser boilerplate.** The runner lazy-constructs Stagehand behind the `Browser` wrapper only when you open a page. When `run` returns (or throws), the runner closes only the pages your workflow created and shuts Stagehand down. Your code never has to `await browser.close()`.

## Runner lifecycle

The runner (in `src/runner.ts`) is a thin wrapper:

1. `loadWorkflow(name)` — finds the project workflow first (`<git-root>/.browser-cli/workflows/<name>.ts`) and falls back to `~/.browser-cli/workflows/<name>.ts`, transpiles it, and asserts the module exports a Zod `schema` and a `run` function.
2. `runWorkflow(name, rawArgs)` — parses `rawArgs` with `schema.parse(...)`, creates the `Browser` wrapper, and calls `mod.run(browser, parsed)`.
3. The `finally` block closes any pages opened during the run, leaves pre-existing tabs alone, and disposes Stagehand.

Your workflow code runs inside step 2. Everything else is plumbing.

## Where workflows live

Workflows can live in a project or in your global browser-cli home:

- **Project workflows** live at `<git-root>/.browser-cli/workflows/<name>.ts`. When you run inside a git repo, these are resolved first.
- **Global workflows** live at `~/.browser-cli/workflows/<name>.ts`. They are the fallback when no project workflow matches.

Two conventions matter:

- **The filename is the command name.** A file called `hn-top.ts` becomes `browser-cli run hn-top`.
- **The global home directory is a git repo.** Track your global workflows, diff them, push them, and share them as subscriptions. `browser-cli sync` commits global changes for you. Project workflows are versioned by the outer project repo.

Subscribed workflows live at `~/.browser-cli-subs/<repo>/workflows/<name>.ts` and are invoked with a namespaced name: `browser-cli run <repo>/<name>`.

Tasks and the daemon are still global in v1; project-level support only changes workflow discovery for `list`, `describe`, and `run`.

## How to structure `run`

Inside `run`, you pick the lightest tool that actually works. browser-cli has strong opinions about this; the [Design Philosophy](/en/philosophy/) page is the full treatment. A quick sketch:

- **Layer 1 — intercept the network.** If the page fetches JSON from an endpoint, capture it (`page.captureResponses`, `page.waitForJsonResponse`, `page.fetch`). JSON is structured and stable; DOM is neither.
- **Layer 2 — Stagehand for the DOM.** When data or interaction only exist as rendered pixels, call `page.act(...)` or `page.extract(...)`. Selectors adapt to drift; `selfHeal: true` caches what works.
- **Escape hatch — raw Playwright.** Only for structures that are *trivially* stable (e.g. Hacker News' `tr.athing`). Document why.

Default to Layer 1. Only reach for Layer 2 when the data isn't in a network call.

## Arguments and return values

Arguments come in through the CLI as strings, JSON blobs, or named flags. The runner coerces them to match the schema, so `browser-cli run hn-top '{"limit":10}'` and `browser-cli run hn-top --limit 10` produce the same typed `args`.

`run` returns `Promise<unknown>`. The CLI pretty-prints the return value as JSON. The task layer hashes it (snapshot mode) or dedupes an array of it (items mode). The SDK caller gets the raw value. Returning an object or an array of objects is idiomatic.

## A realistic workflow

```ts
import { z } from 'zod'
import type { Browser } from '@browserclijs/browser-cli'

export const schema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
})

export async function run(browser: Browser, args: z.infer<typeof schema>) {
  const page = await browser.newPage()
  await page.goto('https://github.com/', { waitUntil: 'domcontentloaded' })

  const data = await page.fetch(
    `https://api.github.com/repos/${args.owner}/${args.repo}`,
    { headers: { Accept: 'application/vnd.github+json' } },
  )
  return data
}
```

Two things to notice. We land on `github.com` first so the subsequent `page.fetch` inherits the user's logged-in session — GitHub's authenticated rate limits are an order of magnitude higher than anonymous. Then we skip the DOM entirely: the API returns JSON, so we call it with `page.fetch` and return it. No selectors, no `extract`, no LLM. Layer 1, start to finish.
