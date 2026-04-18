import { runList } from './commands/list.ts'
import { runRunCommand } from './commands/run.ts'
import { runConfig } from './commands/config.ts'

const USAGE = `Usage:
  browser-cli list                                      List workflows in ~/.browser-cli/workflows/
  browser-cli run <name> [json-args] [--cdp-url <url>]  Run a workflow end-to-end
  browser-cli config [--provider <p>]                   Interactively configure the LLM provider in ~/.browser-cli/.env
  browser-cli --help                                    Show this message

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
  const argv = process.argv.slice(2)
  const [cmd, ...rest] = argv

  if (!cmd || cmd === '-h' || cmd === '--help') {
    process.stdout.write(USAGE)
    return
  }

  switch (cmd) {
    case 'list':
      await runList()
      return
    case 'run':
      await runRunCommand(rest)
      return
    case 'config':
      await runConfig(rest)
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
