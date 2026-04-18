# browser-cli

Run browser automation workflows against **your real, logged-in Chrome**, via [Stagehand](https://github.com/browserbase/stagehand) (automation + self-heal) and [Playwriter](https://playwriter.dev/) (CDP relay + Chrome extension).

- **CLI & SDK** — humans, AI agents, and scripts all share the same workflow files
- **Multi-tab concurrency** — each run gets a unique CDP client id; concurrent workflows don't collide
- **TypeScript workflows** — each workflow is a `.ts` file with a Zod `schema` + `run(stagehand, args)` export
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

## Install

```bash
npm install -g @browserclijs/browser-cli
# or: pnpm add -g @browserclijs/browser-cli
```

Then configure your LLM credentials in `~/.browser-cli/.env`:

```bash
# Option A: any OpenAI-compatible gateway
LLM_API_KEY=sk-...
LLM_BASE_URL=https://your-gateway.example.com/v1
LLM_MODEL=openai/gpt-4o

# Option B: direct OpenAI
OPENAI_API_KEY=sk-...

# Option C: direct Anthropic
ANTHROPIC_API_KEY=sk-ant-...
```

## Commands

```bash
browser-cli list                       # list workflows in ~/.browser-cli/workflows/
browser-cli run <name> '<json-args>'   # run a workflow end-to-end
browser-cli --help                     # show usage
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

## Using as an SDK

```ts
import { runWorkflow } from '@browserclijs/browser-cli'

const result = await runWorkflow('hn-top', { limit: 3 })
```

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
| `~/.browser-cli/.cache/`          | Stagehand action cache (auto-generated)  |
| `~/.browser-cli/.env`             | LLM credentials                          |
| `$BROWSER_CLI_HOME`               | Override the default home directory      |

## Known limitations

- Playwriter's CDP relay is bound to a single Chrome instance. Concurrent workflows that mutate the same page or cookies can race — the safe pattern is one workflow per tab.
- Stagehand has a known URL-normalization quirk in its cache keys (`example.com` vs `example.com/`). Avoid mixing trailing slashes in `page.goto` calls within a single workflow until the upstream fix lands.

## License

MIT
