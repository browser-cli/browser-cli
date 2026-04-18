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
browser-cli list                       # list workflows in ~/.browser-cli/workflows/
browser-cli run <name> '<json-args>'   # run a workflow end-to-end
browser-cli config                     # interactively update LLM provider in .env
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
