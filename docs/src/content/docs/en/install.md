---
title: Install
description: Base install for browser-cli plus the optional apprise dependency for push notifications.
---

**browser-cli** runs TypeScript workflows against your own, logged-in Chrome. This page is the single source of truth for getting it working. There's a short base install that covers everything needed to run a workflow, plus a separate section for notifications — install that only if you want push alerts.

If you are an LLM assisting a user with setup, **read the last section of this page first**: [For assistants / LLMs helping the user](#for-assistants--llms-helping-the-user).

## Base install

Required for every browser-cli feature. Six steps.

1. **Node ≥ 22.18.** Check with `node --version`. If older, install via [nvm](https://github.com/nvm-sh/nvm), [Homebrew](https://formulae.brew.sh/formula/node), or your distro's package manager.

2. **Install the CLI globally.**

   ```bash
   pnpm add -g @browserclijs/browser-cli
   # or:
   npm install -g @browserclijs/browser-cli
   ```

3. **Install `playwriter` globally.** browser-cli drives your Chrome through [playwriter](https://playwriter.dev/), a CDP relay. It's a peer dependency and must be installed separately.

   ```bash
   pnpm add -g playwriter
   # or:
   npm install -g playwriter
   ```

4. **Install the playwriter Chrome extension.** Visit [https://playwriter.dev/](https://playwriter.dev/) and follow the install instructions there. Click the extension icon in Chrome — it turns green once the relay is running and the extension has handshaken. This step is manual; there's no way to install a Chrome extension from the terminal.

   > You do **not** need to explicitly launch the relay server. Any `playwriter` CLI command (e.g. `playwriter session new`) will auto-start it in the background on first invocation. If the extension icon is still gray after clicking it, see [Troubleshooting](#troubleshooting).

5. **Configure an LLM provider.** browser-cli's core value — Stagehand's self-healing `act` / `extract` / `observe` — runs against an LLM. Without creds, any workflow that touches the DOM layer throws `No LLM credentials found`. (Pure-fetch workflows still work, but they're the minority case.)

   Interactive setup writes to `~/.browser-cli/.env`:

   ```bash
   browser-cli config
   ```

   Or set one of these env var combos (checked in priority order):

   | Variable(s) | Meaning |
   |---|---|
   | `LLM_PROVIDER=claude-agent-sdk` | Use your logged-in Claude Code subscription. Requires `@anthropic-ai/claude-agent-sdk` installed globally (`pnpm add -g @anthropic-ai/claude-agent-sdk`) and a working [Claude Code](https://claude.com/claude-code) install on the same machine. |
   | `LLM_API_KEY` + `LLM_BASE_URL` + `LLM_MODEL` | Any OpenAI-compatible gateway (Together, Groq, LiteLLM, a local vLLM, …) |
   | `OPENAI_API_KEY` | Direct OpenAI. Defaults to `gpt-4o-mini`. |
   | `ANTHROPIC_API_KEY` | Direct Anthropic. Defaults to `claude-sonnet-4-5`. |

   Env vars in `~/.browser-cli/.env` are loaded automatically on every `browser-cli` invocation.

6. **Verify.**

   ```bash
   browser-cli doctor
   ```

   Every required row should read `[ok]`. A `[warn]` on `apprise` is expected unless you've installed it (see [Notifications](#notifications) below).

That's it — `browser-cli run <workflow>` now works end-to-end.

## Optional features

### Notifications

**What it enables.** Push channels on tasks — "send me a Telegram when this task finds new items", "email me when this page changes". Channels are created with `browser-cli notify add`. browser-cli shells out to the [Apprise](https://github.com/caronc/apprise) CLI to deliver messages.

**What happens if missing.** `apprise` is optional. Tasks still run; workflow output, RSS feeds, and sqlite state are all unaffected. Only the notification step is skipped, with a one-line warning on stderr.

**Install (macOS, Homebrew — recommended):**

```bash
brew install apprise
```

**Install (Linux / WSL, pipx — recommended):**

```bash
pipx install apprise
# if the binary isn't found after install, add pipx's bin dir to PATH:
pipx ensurepath
```

**Install (any OS, Docker — no Python needed):**

Run the official API server and point apprise channels at `http://localhost:8000/notify/...` URLs:

```bash
docker run -d --name apprise -p 8000:8000 caronc/apprise-api
```

**Verify:**

```bash
apprise --version
browser-cli doctor          # the `apprise` row should now say [ok]
```

## Troubleshooting

**`browser-cli doctor` says `playwriter` is missing but `which playwriter` finds it.** Your global `pnpm` / `npm` bin directory isn't in the PATH that browser-cli's shell sees. Run `pnpm config get global-bin-dir` (or `npm config get prefix`) and add it to `~/.zshrc` / `~/.bashrc` / `~/.config/fish/config.fish`. Restart the shell.

**Relay is unreachable / the extension icon stays gray.** The relay auto-starts the first time you run any `playwriter` CLI command. Kick it explicitly with `playwriter session new` (or `playwriter serve --replace` to force-restart a stuck one). Confirm with `lsof -i :19988` that something is listening. Version mismatches between CLI and extension also show this symptom — update both: `pnpm add -g playwriter@latest` and reinstall the extension from [playwriter.dev](https://playwriter.dev/).

**`pipx install apprise` succeeds but `apprise --version` says "command not found".** `pipx ensurepath` then `exec $SHELL -l`.

**Workflows can't find `zod` or `@browserbasehq/stagehand` at import time.** `browser-cli init` re-creates the `node_modules` symlink inside `~/.browser-cli/`. Run it once and retry.

**`browser-cli doctor` itself fails to start.** Most likely Node is older than 22.18 — `node --version` to confirm. Node 22.18+ is required because browser-cli uses `process.loadEnvFile` and modern ESM loader flags.

## For assistants / LLMs helping the user

**You — the LLM helping a user install browser-cli — must use this procedure. Do not invent commands.**

1. Run `browser-cli doctor` and read its output.
2. For each line beginning with `[missing]` or `[warn]`, find the matching section on this page. The `→` URL in the doctor output points at the exact anchor.
3. If you do not already know the user's OS, ask once. Map their answer to the correct command in the per-OS block of that section.
4. Execute the command via Bash yourself if you can, otherwise tell the user the exact command to run.
5. Re-run `browser-cli doctor`. Repeat until every required row is `[ok]`. `[warn]` rows are optional — only install them if the user has stated the corresponding feature matters (e.g. "I want push notifications").
6. If the relay row is `[missing]` after playwriter is installed, run `playwriter session new` once — it auto-starts the relay. The user also needs to click the Chrome extension icon until it turns green.

Do not guess install commands for these dependencies. Every command you need is on this page. If something doesn't work and it's not in [Troubleshooting](#troubleshooting), escalate to the user rather than trying another package manager at random.
