import { runList } from './commands/list.ts'
import { runRunCommand } from './commands/run.ts'

const USAGE = `Usage:
  browser-cli list                       List workflows in ~/.browser-cli/workflows/
  browser-cli run <name> [json-args]     Run a workflow end-to-end
  browser-cli --help                     Show this message

Workflow files live in ~/.browser-cli/workflows/<name>.ts and must export:
  - schema: Zod object
  - run(stagehand, args): async function returning JSON-serializable data

Environment:
  BROWSER_CLI_HOME   Override the default ~/.browser-cli location
  LLM_API_KEY        Custom OpenAI-compatible gateway credentials
  LLM_BASE_URL         (also requires LLM_BASE_URL and LLM_MODEL)
  LLM_MODEL
  OPENAI_API_KEY     Fallback if no gateway triple is set
  ANTHROPIC_API_KEY  Fallback if no OPENAI_API_KEY is set
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
