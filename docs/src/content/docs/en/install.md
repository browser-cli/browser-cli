---
title: Install
description: Base install for browser-cli, plus the extra dependencies unlocked by optional features (notifications, embedded agents).
---

**browser-cli** runs TypeScript workflows against your own, logged-in Chrome. This page is the single source of truth for getting it working. There's a short base install, then separate sections for optional features — install only the ones you'll use.

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

4. **Install the playwriter Chrome extension.** Visit [https://playwriter.dev/](https://playwriter.dev/) and follow the install instructions there. This step is manual — there's no way to install a Chrome extension from the terminal.

5. **Start the relay.** In a terminal you can leave open (or a tmux/screen session on a server):

   ```bash
   playwriter serve --replace
   ```

   Then click the playwriter extension icon in Chrome. It turns green when the relay and the extension have handshaken.

6. **Verify.**

   ```bash
   browser-cli doctor
   ```

   Every item should read `[ok]` except possibly `apprise` (optional) and `LLM creds` (configured in the next section).

That's the base install. browser-cli can now run workflows, but it still needs an LLM and — if you want push notifications — apprise.

## Optional features

Each of these is independent. Install only what you need.

### LLM provider

**What it enables.** Stagehand's self-healing `act` / `extract` calls, plus the Claude Code skill's ability to draft workflows.

**What happens if missing.** `browser-cli run` on any workflow that uses Stagehand throws `No LLM credentials found`. Pure-Playwright workflows still run.

**Configure interactively:**

```bash
browser-cli config
```

**Or set env vars** (one of the following, checked in priority order):

| Variable(s) | Meaning |
|---|---|
| `LLM_PROVIDER=claude-agent-sdk` | Uses your logged-in Claude Code subscription (needs the SDK — see [Embedded agent mode](#embedded-agent-mode) below) |
| `LLM_API_KEY` + `LLM_BASE_URL` + `LLM_MODEL` | Any OpenAI-compatible gateway (Together, Groq, LiteLLM, a local vLLM, …) |
| `OPENAI_API_KEY` | Direct OpenAI. Defaults to `gpt-4o-mini`. |
| `ANTHROPIC_API_KEY` | Direct Anthropic. Defaults to `claude-sonnet-4-5`. |

Env vars in `~/.browser-cli/.env` are loaded automatically.

### Notifications

**What it enables.** Push channels on tasks — "send me a Telegram when this task finds new items", "email me when this page changes". Channels are created with `browser-cli notify add`.

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

### Embedded agent mode

**What it enables.** Workflows that call `agent(...)` inside `run()` to delegate a sub-task to Claude Code (for open-ended scraping, ambiguous forms, multi-page reasoning). Also required when you set `LLM_PROVIDER=claude-agent-sdk` above.

**What happens if missing.** `import`ing `@anthropic-ai/claude-agent-sdk` fails at workflow load time. Any workflow that doesn't use `agent(...)` or `claude-agent-sdk` provider keeps working.

**Install:**

```bash
pnpm add -g @anthropic-ai/claude-agent-sdk
# or:
npm install -g @anthropic-ai/claude-agent-sdk
```

You also need a working Claude Code install on the same machine — see [claude.com/claude-code](https://claude.com/claude-code).

## Troubleshooting

**`browser-cli doctor` says `playwriter` is missing but `which playwriter` finds it.** Your global `pnpm` / `npm` bin directory isn't in the PATH that browser-cli's shell sees. Run `pnpm config get global-bin-dir` (or `npm config get prefix`) and add it to `~/.zshrc` / `~/.bashrc` / `~/.config/fish/config.fish`. Restart the shell.

**Relay is running but the extension icon stays gray.** The extension and the CLI must match major versions. Update both: `pnpm add -g playwriter@latest` and reinstall the extension from [playwriter.dev](https://playwriter.dev/). Also confirm nothing else is bound to `127.0.0.1:19988` (`lsof -i :19988`).

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
6. For features not present in `[missing]` rows that the user still asks about — e.g. they want to write workflows that call `agent(...)` — jump directly to the relevant section above.

Do not guess install commands for these dependencies. Every command you need is on this page. If something doesn't work and it's not in [Troubleshooting](#troubleshooting), escalate to the user rather than trying another package manager at random.
