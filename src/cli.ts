import { installShutdownHandlers } from './shutdown.ts'
import { runList } from './commands/list.ts'
import { runRunCommand } from './commands/run.ts'
import { runConfig } from './commands/config.ts'
import { runDescribe } from './commands/describe.ts'
import { runNotify } from './commands/notify.ts'
import { runTask } from './commands/task.ts'
import { runDaemon } from './commands/daemon.ts'
import { runInit } from './commands/init.ts'
import { runSync } from './commands/sync.ts'
import { runSub } from './commands/sub.ts'
import { runHome, runSubsHome } from './commands/home.ts'
import { checkForUpdate } from './versionCheck.ts'

const USAGE = `Usage:
  browser-cli list [<site>] [--site <pattern>]          List workflows (yours + subscribed), optionally filtered by site
  browser-cli describe <name>                           Show a workflow's parameters and usage examples
  browser-cli run <name> [args] [--cdp-url <url>]       Run a workflow end-to-end (namespaced as <sub>/<workflow> for subs)
  browser-cli config [--provider <p>]                   Interactively configure the LLM provider in ~/.browser-cli/.env
  browser-cli notify <subcommand>                       Manage notification channels (add/list/test/rm)
  browser-cli task <subcommand>                         Manage tasks (list/create/show/run/enable/disable/rm)
  browser-cli daemon [--detach|-d]                      Start the scheduler (foreground or detached)
  browser-cli daemon status|stop                        Inspect/stop a detached daemon
  browser-cli init                                      Re-sync ~/.browser-cli layout + git repo, print status
  browser-cli sync                                      Review uncommitted changes in ~/.browser-cli and commit
  browser-cli sub <subcommand>                          Manage subscribed repos (add/list/update/remove/copy)
  browser-cli home                                      Print the resolved home directory (respects $BROWSER_CLI_HOME)
  browser-cli subs-home                                 Print the resolved subscriptions directory (respects $BROWSER_CLI_SUBS_HOME)
  browser-cli --help                                    Show this message

\`list\` / \`task list\` accept an optional site filter — case-insensitive substring
match where '.' and '~' are interchangeable. \`list hn\`, \`list ycombinator\`, and
\`list news.ycombinator.com\` all match workflows under news~ycombinator~com/.

Args for \`run\` accept three forms (auto-detected):
  - Positional in schema order:   browser-cli run x~com/profile-tweets ClaudeDevs 20
  - Named flags:                  browser-cli run x~com/profile-tweets --username ClaudeDevs --limit 20
  - JSON object (back-compat):    browser-cli run x~com/profile-tweets '{"username":"ClaudeDevs","limit":20}'
Use \`browser-cli run <name> --help\` to print parameters without executing.

Workflow files live in ~/.browser-cli/workflows/<name>.ts and must export:
  - schema: Zod object
  - run(stagehand, args): async function returning JSON-serializable data

--cdp-url overrides the default Playwriter relay so a workflow can run inside any
external Chrome (e.g. a fingerprint browser profile). Accepts ws://, wss://,
http:// (DevTools discovery), or https:// — the workflow file does not change.

Environment (resolved in priority order):
  LLM_PROVIDER=claude-agent-sdk            Use your logged-in Claude Code subscription
  LLM_API_KEY + LLM_BASE_URL + LLM_MODEL   Any OpenAI-compatible endpoint
  OPENAI_API_KEY                           Fallback for direct OpenAI
  ANTHROPIC_API_KEY                        Fallback for direct Anthropic
  BROWSER_CLI_CDP_URL                      Default CDP endpoint when --cdp-url not given
  BROWSER_CLI_HOME                         Override the default ~/.browser-cli location
  BROWSER_CLI_DEBUG=1                      Print full stack traces on error
`

async function main(): Promise<void> {
  installShutdownHandlers()
  const argv = process.argv.slice(2)
  const [cmd, ...rest] = argv

  if (!cmd || cmd === '-h' || cmd === '--help') {
    process.stdout.write(USAGE)
    return
  }

  checkForUpdate(cmd)

  switch (cmd) {
    case 'list':
      await runList(rest)
      return
    case 'run':
      await runRunCommand(rest)
      return
    case 'describe':
    case 'show':
      await runDescribe(rest)
      return
    case 'config':
      await runConfig(rest)
      return
    case 'notify':
      await runNotify(rest)
      return
    case 'task':
      await runTask(rest)
      return
    case 'daemon':
      await runDaemon(rest)
      return
    case 'init':
      await runInit(rest)
      return
    case 'sync':
      await runSync(rest)
      return
    case 'sub':
      await runSub(rest)
      return
    case 'home':
      await runHome(rest)
      return
    case 'subs-home':
      await runSubsHome(rest)
      return
    default:
      process.stderr.write(`Unknown command: ${cmd}\n\n${USAGE}`)
      process.exit(2)
  }
}

main().catch((err) => {
  const debug = process.env.BROWSER_CLI_DEBUG === '1'
  const msg = err instanceof Error ? (debug ? (err.stack ?? err.message) : err.message) : String(err)
  process.stderr.write(msg + '\n')
  process.exit(1)
})
