import { ensureCustomCdpReachable, ensurePlaywriter } from '../preflight.ts'
import { runWorkflow } from '../runner.ts'
import { resolveCdpUrl } from '../stagehand-config.ts'

type ParsedRunArgv = { name?: string; argsJson?: string; cdpUrl?: string }

function parseRunArgv(argv: string[]): ParsedRunArgv {
  const positional: string[] = []
  let cdpUrl: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '--cdp-url') {
      const val = argv[i + 1]
      if (!val || val.startsWith('--')) {
        process.stderr.write(
          '--cdp-url requires a value (e.g. --cdp-url ws://host:9222/devtools/browser/<id>)\n',
        )
        process.exit(2)
      }
      cdpUrl = val
      i++
    } else if (a.startsWith('--cdp-url=')) {
      const val = a.slice('--cdp-url='.length)
      if (!val) {
        process.stderr.write('--cdp-url requires a value\n')
        process.exit(2)
      }
      cdpUrl = val
    } else {
      positional.push(a)
    }
  }
  return { name: positional[0], argsJson: positional[1], cdpUrl }
}

export async function runRunCommand(argv: string[]): Promise<void> {
  const { name, argsJson, cdpUrl } = parseRunArgv(argv)

  if (!name) {
    process.stderr.write('Usage: browser-cli run <name> [json-args] [--cdp-url <url>]\n')
    process.exit(2)
  }

  let parsedArgs: unknown = {}
  if (argsJson !== undefined && argsJson !== '') {
    try {
      parsedArgs = JSON.parse(argsJson)
    } catch (err) {
      process.stderr.write(`Invalid JSON for args: ${(err as Error).message}\n`)
      process.exit(2)
    }
  }

  const { cdpUrl: resolvedUrl, isCustom } = resolveCdpUrl(cdpUrl)
  if (isCustom) {
    await ensureCustomCdpReachable(resolvedUrl)
  } else {
    await ensurePlaywriter()
  }

  const result = await runWorkflow(name, parsedArgs, { cdpUrl })
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
}
