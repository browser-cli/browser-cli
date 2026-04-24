---
title: Install
description: Base install for browser-cli plus the optional apprise dependency for push notifications.
---

**browser-cli** runs TypeScript workflows against your own, logged-in Chrome. This page is the single source of truth for getting it working. There's a short base install that covers everything needed to run a workflow, plus a separate section for notifications — install that only if you want push alerts.

<details>
<summary>If you are a code-agent reading this file (click to expand)</summary>

If you are **Claude Code**, **Codex**, or **opencode** running this install on a user's machine: you can configure browser-cli to reuse **yourself** as the LLM backend for the self-heal layer. No extra API key. No extra login. The user's existing subscription/auth is already on the machine — browser-cli just piggybacks on it.

Do base steps 1–4 exactly as written. At step 5, replace `browser-cli config` with the single non-interactive command that matches your own identity:

- **If you are Claude Code** → `browser-cli config --provider claude-agent-sdk --yes`
  Optionally pass `--model claude-haiku-4-5` for the cheaper/faster self-heal path.
- **If you are Codex** → `browser-cli config --provider codex --yes`
  Optionally pass `--model gpt-5.5` or whichever model is set in `~/.codex/config.toml`.
- **If you are opencode** → `browser-cli config --provider opencode --model <provider/model> --yes`
  The model is **required** here; pick a small, fast model you have auth for. Typical safe choices: `anthropic/claude-haiku-4-5`, `opencode/claude-haiku-4-5`, `openai/gpt-5-nano`. Run `opencode models` to list what you actually have access to.

Then do step 6 (`browser-cli doctor`) — the LLM row should read `[ok]` and identify the active provider as yourself.

The rest of this page (base install + optional features) is the human-oriented version; it explains each step and lists every provider/env-var combination. If you're an agent, the three commands above are all you need.

</details>

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

5. **Configure an LLM provider.** Required. Every `act` / `extract` / `observe` call in Stagehand goes to an LLM, so without creds any workflow that touches the DOM throws `No LLM credentials found` and halts.

   Interactive setup writes to `~/.browser-cli/.env`:

   ```bash
   browser-cli config
   ```

   Or set one of these env var combos (checked in priority order):

   | Variable(s) | Meaning |
   |---|---|
   | `LLM_PROVIDER=claude-agent-sdk` | Use your logged-in Claude Code subscription. The `@anthropic-ai/claude-agent-sdk` npm package is bundled as a direct dependency — no extra install needed. Requires a working [Claude Code](https://claude.com/claude-code) login (`claude` once). |
   | `LLM_PROVIDER=codex` | Use your [Codex CLI](https://developers.openai.com/codex) login. The `@openai/codex-sdk` is bundled. Works with either a `codex login` ChatGPT subscription or `OPENAI_API_KEY`. `LLM_MODEL` is optional. |
   | `LLM_PROVIDER=opencode` | Use your [opencode](https://opencode.ai) configuration. The `@opencode-ai/sdk` is bundled. Requires `~/.config/opencode/opencode.json` with a provider configured (`opencode auth login`). `LLM_MODEL` format: `provider/model` (e.g. `anthropic/claude-sonnet-4-5`). |
   | `LLM_API_KEY` + `LLM_BASE_URL` + `LLM_MODEL` | Any OpenAI-compatible gateway (Together, Groq, LiteLLM, a local vLLM, …) |
   | `OPENAI_API_KEY` | Direct OpenAI. Defaults to `gpt-4o-mini`. |
   | `ANTHROPIC_API_KEY` | Direct Anthropic. Defaults to `claude-sonnet-4-5`. |

   The three code-agent SDKs (Claude Agent SDK, Codex SDK, OpenCode SDK) ship as regular `dependencies` of browser-cli, so `pnpm add -g @browserclijs/browser-cli` installs them automatically. You only need to make sure the corresponding CLI is **logged in** on the same machine.

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
