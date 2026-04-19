# Notification channel creation (browser-cli sub-flow)

**Loaded from `SKILL.md`.** Use this when the user wants to add a notification destination (Telegram, Discord, Slack, email, webhook, etc.) that workflows and tasks can reference by name.

Channels are backed by the [apprise](https://github.com/caronc/apprise) CLI, which speaks to 90+ services via a unified URL scheme. We store a named alias (e.g. `tg-me`) in sqlite; tasks/workflows pass that name, and the daemon/SDK shell out to `apprise` with the corresponding URL.

## Preflight: make sure apprise is installed

```bash
which apprise
```

If missing, ask the user to install first — channels saved without apprise work structurally, but no notification will actually fire.

```bash
pipx install apprise     # recommended (isolates the Python deps)
brew install apprise     # macOS Homebrew alternative
```

## Orchestration

### Step 1: pick a channel type

Ask the user which service. Common choices:

| Service | Apprise URL template | What you'll collect |
|---|---|---|
| Telegram | `tgram://<bot-token>/<chat-id>` | Bot token from BotFather, chat ID (your `@userinfobot` reply or group ID) |
| Discord | `discord://<webhook-id>/<webhook-token>` | Server → Integrations → Webhooks → Copy URL; the path after `/api/webhooks/` splits into `<id>/<token>` |
| Slack | `slack://<token-a>/<token-b>/<token-c>` | From an incoming webhook URL: the three path segments after `services/` |
| Email | `mailto://<user>:<pass>@<host>?to=<addr>` | SMTP host, port (if non-default: `:<port>`), username, password, recipient |
| Webhook (JSON POST) | `json://<host>/<path>` or `jsons://...` for HTTPS | Host + path |
| ntfy.sh | `ntfy://<topic>` or `ntfys://<topic>` | Topic name you've subscribed to |

If the user wants something else, ask them to name the service and consult `apprise --help` or the [apprise wiki](https://github.com/caronc/apprise/wiki) for the URL shape. Guide them through the fields; don't ask them to paste the full URL if the parts will do.

### Step 2: ask for a channel name

A short identifier the user will reference later (e.g. `tg-me`, `slack-alerts`, `email-work`). Must start with a letter/digit, 1-50 chars, letters/digits/`_`/`-` only.

**Hint**: pick names that will still make sense months later. `tg-me` is better than `my-tgram-1`.

### Step 3: save the channel

```bash
browser-cli notify add <name> '<apprise-url>'
```

The URL will be stored verbatim. Don't worry about special characters — wrap in single quotes to protect from shell interpolation.

### Step 4: test the channel (MANDATORY ask)

You **must** ask the user — do not skip this step, even if the URL "looks right". Apprise reports success on a 2xx response, but a 2xx doesn't prove the message reached the user's device (wrong chat ID, muted topic, spam folder, expired webhook all surface as "ok" from apprise).

Ask exactly: **"Want me to send a test notification to `<name>` now to verify it actually arrives?"**

If yes:

```bash
browser-cli notify test <name>
```

After the command returns, **ask the user to confirm receipt on the target device**:

> "Sent. Did the test message actually arrive on `<platform>`? (yes / no — and what did it say if it arrived garbled)"

Do not move on to Step 5 or report the channel as ready until the user confirms receipt. If they say no (or the message arrived broken), treat it as a failure even if `notify test` exited 0.

If the user declines the test, note explicitly: "Skipping test — channel is saved but unverified. Run `browser-cli notify test <name>` later before relying on it."

If the test fails (apprise error OR user didn't receive it):
- Check the user's error output. `apprise` usually prints a specific reason (auth failed, unreachable host, invalid format).
- Common causes: wrong bot token, chat ID off by one, expired Slack webhook, SMTP auth/TLS misconfig.
- Let them edit with `browser-cli notify rm <name>` + re-add, or directly hand-edit `~/.browser-cli/db.sqlite` if they know SQL.

### Step 5: confirm and (if returning from another flow) resume

Tell the user: "Channel `<name>` is ready. You can reference it as `'<name>'` in task configs or workflow `notify()` calls."

If this flow was loaded from `task-create.md` or `workflow-create.md`, return to that flow and let the user pick the new channel in the picker.

## Quick reference — building common apprise URLs

### Telegram

1. Create a bot via [@BotFather](https://t.me/BotFather) — `/newbot`, follow prompts.
2. Copy the token (looks like `123456:ABCdefGHI...`).
3. Start a chat with your bot and send it any message.
4. Get your chat ID: talk to [@userinfobot](https://t.me/userinfobot), or open `https://api.telegram.org/bot<TOKEN>/getUpdates` and find `"chat":{"id":...}`.
5. URL: `tgram://<TOKEN>/<CHAT_ID>`

### Discord webhook

1. Server → Edit Channel → Integrations → Webhooks → New Webhook.
2. Copy the webhook URL: `https://discord.com/api/webhooks/<ID>/<TOKEN>`
3. URL: `discord://<ID>/<TOKEN>` (drop the `https://discord.com/api/webhooks/` prefix).

### Slack incoming webhook

1. Create a Slack app, enable Incoming Webhooks, add one to a channel.
2. Copy the webhook URL: `https://hooks.slack.com/services/T.../B.../secret...`
3. URL: `slack://T.../B.../secret...` (drop the `https://hooks.slack.com/services/` prefix).

### Email via Gmail

1. Create an app password at [myaccount.google.com → Security](https://myaccount.google.com/apppasswords).
2. URL: `mailtos://<username>:<app-password>@gmail.com?to=<you@example.com>` (use `mailtos://` for TLS).

### ntfy.sh (simplest push)

1. Install the ntfy app on your phone.
2. Subscribe to a unique topic (e.g. `my-bc-scrapes-abcdef`).
3. URL: `ntfy://my-bc-scrapes-abcdef` (public ntfy.sh) or `ntfys://my-server.example.com/topic` (self-hosted).

## Managing channels later

```bash
browser-cli notify list            # pretty table (URLs are lightly masked)
browser-cli notify list --json     # full URLs — machine-readable
browser-cli notify test <name>     # re-verify
browser-cli notify rm <name>       # delete a channel
```

Re-adding with the same name overwrites (upsert), so it's safe to re-run `notify add <name> <new-url>` to update a token without first removing.
