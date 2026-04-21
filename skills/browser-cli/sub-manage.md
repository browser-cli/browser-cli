# Subscription management (browser-cli sub-flow)

**Loaded from `SKILL.md`.** Use this when the user wants to share workflows/tasks across machines or teammates via a git repo, pull updates from an existing subscription, or fork a subscribed script so they can edit it.

## Mental model

- The browser-cli home (resolve via `browser-cli home`) is the user's own git repo — their workflows and tasks, pushable to a remote for cross-device sync.
- The subs directory (resolve via `browser-cli subs-home`) is a sibling holding clones of **other** people's repos of workflows/tasks. Each entry `<sub-name>/` is its own git checkout, managed by `browser-cli sub *`.
- Subscribed files are **read-only**. The daemon never schedules tasks from a sub location. To run a subscribed workflow, reference it as `<sub-name>/<workflow>`. To enable a subscribed task on your schedule, `sub copy` it into your own `tasks/` first.
- `subs.json` under the browser-cli home is the registry of subscriptions (tracked in the user's git repo). The subs directory itself is **not** tracked by the user's repo.

## Common flows

### Subscribe to a new repo

Ask for the git URL if the user hasn't given one. Clone:

```bash
browser-cli sub add <git-url>                    # derives sub name from URL basename
browser-cli sub add <git-url> --name <n>         # override the name
```

The command clones into `<name>/` under the subs directory (see `browser-cli subs-home`), updates `subs.json`, and prompts to commit the registry change. Relay the `[y]es / [n]o / [d]iff / [s]how-files` prompt to the user.

Verify the contents after subscribing:

```bash
browser-cli sub list
browser-cli list                                 # workflows — yours on top, subs below
browser-cli task list                            # tasks — yours (scheduled) + subs (read-only hint)
```

### Run a subscribed workflow

Namespace it with the sub name:

```bash
browser-cli run <sub-name>/<workflow> [args]
browser-cli describe <sub-name>/<workflow>       # shows schema + usage
```

Works exactly like a user-local workflow — only the file path differs.

### Enable a subscribed scheduled task

Sub tasks are visible in `browser-cli task list` but **never scheduled from the sub location**. To run one on your schedule, fork it:

```bash
browser-cli sub copy <sub-name>/<task>           # copies into the user's tasks/ dir (CLI resolves path)
browser-cli task enable <task>                   # now it's a normal user task
```

The copy is a plain file you own — edit freely, or leave as-is if the defaults fit.

If the user tries `task enable <sub-name>/<task>` directly they'll see an error pointing them to `sub copy` — that's intentional.

### Pull updates

```bash
browser-cli sub update                           # update all subscriptions
browser-cli sub update <name>                    # one sub
```

Per sub, this does `git fetch --depth 1 origin` + `git reset --hard origin/<default-branch>`.

**Dirty warning**: if the user has edited files inside the sub's clone in place (under `browser-cli subs-home`/`<name>/`), `sub update` prints a warning and asks whether to continue (continuing discards the edits). **Don't let users edit subs in place** — always `sub copy` first. If the warning fires, ask the user whether they meant to save those edits; if yes, help them `sub copy` the affected file before re-running `sub update`.

### Fork for editing

```bash
browser-cli sub copy <sub-name>/<workflow-or-task>
browser-cli sub copy <sub-name>/<name> --as <new-name>   # rename on copy
browser-cli sub copy <sub-name>/<name> --force           # overwrite existing user file
```

The command detects whether the source is a workflow or task by where it lives in the sub (`workflows/` vs `tasks/`) and drops the copy into the matching dir under the user's browser-cli home. From there, the user can edit it like any other workflow/task and, if desired, PR the fix upstream manually.

### Remove a subscription

```bash
browser-cli sub remove <name>
```

Deletes the clone and the registry entry, then prompts to commit `subs.json`. Any files that were already `sub copy`-ed into the user's own dirs are unaffected.

## Read-only semantics — what to tell users

- **Never edit inside the subs directory** (see `browser-cli subs-home`). Those files are overwritten by `sub update`.
- **Never assume a subscribed task is running.** The daemon only schedules tasks from the user's own `tasks/` dir (under `browser-cli home`). Subscribed tasks show up in `task list` purely for discoverability, with a `sub copy` hint.
- **Fork-then-edit is the canonical path.** Users asking "how do I tweak this sub's workflow" → `sub copy` first, then edit the copy.

## Triggers — how the user might phrase this

| User says | Flow |
|---|---|
| "subscribe to https://github.com/acme/browser-cli-pack" | `sub add` |
| "订阅这个 repo" | `sub add` |
| "pull updates from the team pack" / "更新一下" | `sub update` |
| "show me what subs I have" / "list subscriptions" | `sub list` |
| "run the news-digest from pack" | `run pack/news-digest` (no copy needed) |
| "enable pack/news-digest on my schedule" | `sub copy pack/news-digest` → `task enable news-digest` |
| "this pack workflow is broken, I need to fix it" | `sub copy pack/<workflow>` → edit the copy → optionally PR upstream |
| "remove the pack subscription" | `sub remove pack` |

## Post-write commits

`sub add|update|remove|copy` all end with the same commit prompt used by `browser-cli sync`. Relay the `[y]es / [n]o / [d]iff / [s]how-files` output to the user and wait for their reply. On `d` or `s`, re-run the last command or `browser-cli sync` so the details print before they commit.

## Cross-device sync

Subscriptions travel via `subs.json` — if the user syncs their browser-cli home repo across machines (push to a remote), each machine just needs to run `browser-cli sub update` once to re-clone the subs listed in `subs.json` that aren't yet on disk.

Wait — v1 does **not** auto-clone missing subs from `subs.json` on sync. If the user asks for cross-device-sync-including-subs, tell them to re-run `sub add <url>` per missing sub on the new machine. A future improvement could be a `sub sync` command that reconciles registry ↔ disk; for now it's manual.
