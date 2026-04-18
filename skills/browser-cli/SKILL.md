---
name: browser-cli
description: Run browser automation workflows inside the user's logged-in Chrome via Stagehand and Playwriter. Use when the user asks to scrape, interact with, or automate a webpage with their real login state.
---

# browser-cli

`browser-cli` is a CLI + SDK that runs TypeScript workflows against the user's real Chrome (via a Playwriter CDP relay + the Stagehand automation library). Workflow files live in `~/.browser-cli/workflows/*.ts` and each exports a Zod `schema` plus an async `run(stagehand, args)` function.

## How to use this skill

1. **Discover workflows**
   ```bash
   browser-cli list
   ```
   Lists available workflows with their description and last-updated date.

2. **Run a workflow**
   ```bash
   browser-cli run <name> '<json-args>'
   ```
   Returns a JSON result on stdout. Errors and prompts go to stderr. Example:
   ```bash
   browser-cli run hn-top '{"limit":3}'
   ```

3. **Create a new workflow** (when the user asks for a new automation task)
   - Create a file at `~/.browser-cli/workflows/<name>.ts`.
   - Export `schema` (Zod object) describing the inputs.
   - Export `async function run(stagehand, args)` that uses `stagehand.context.newPage()` + Playwright APIs and returns JSON-serializable data.
   - Reference shape:
     ```ts
     import { z } from 'zod'
     import type { Stagehand } from '@browserbasehq/stagehand'

     /** One-line description of what this workflow does. */
     export const schema = z.object({ /* inputs */ })
     export async function run(stagehand: Stagehand, args: z.infer<typeof schema>) {
       const page = await stagehand.context.newPage()
       // ... page.goto, page.evaluate, stagehand.act, etc.
       return { /* JSON-serializable result */ }
     }
     ```
   - Test with `browser-cli run <name> '<json>'`.

## Operating rules

- The workflow runs in the user's real Chrome — expect real login state and real side effects. Prefer read-only workflows by default; confirm before writing to cookies, sending messages, or submitting forms.
- Multiple concurrent `browser-cli run` invocations share the same Chrome instance. Two scripts opening their own tabs are safe; two scripts mutating the same page or cookies can race.
- If `browser-cli run` fails with a playwriter/relay message, the user needs to start the relay (`playwriter serve --replace`) and enable the Chrome extension at `https://playwriter.dev/`.
- If `browser-cli run` fails with "No LLM credentials found", the user needs to populate `~/.browser-cli/.env` with one of: `LLM_API_KEY+LLM_BASE_URL+LLM_MODEL` (OpenAI-compatible gateway), `OPENAI_API_KEY`, or `ANTHROPIC_API_KEY`.
- Stdout is the JSON payload; parse it. Stderr is for humans — surface it to the user verbatim when something goes wrong.
