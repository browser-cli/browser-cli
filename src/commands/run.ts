import { ensureCustomCdpReachable, ensurePlaywriter } from '../preflight.ts'
import { loadWorkflow, runWorkflow } from '../runner.ts'
import { resolveCdpUrl } from '../stagehand-config.ts'
import { extractParamSpec } from '../param-spec.ts'
import { parseRunArgs, coerceToObject } from '../arg-coerce.ts'
import { renderDescribe } from './describe.ts'

type ParsedRunArgv = { name?: string; rest: string[]; cdpUrl?: string; help: boolean }

function parseRunArgv(argv: string[]): ParsedRunArgv {
  const rest: string[] = []
  let cdpUrl: string | undefined
  let help = false
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
    } else if (a === '-h' || a === '--help') {
      help = true
    } else {
      rest.push(a)
    }
  }
  return { name: rest[0], rest: rest.slice(1), cdpUrl, help }
}

export async function runRunCommand(argv: string[]): Promise<void> {
  const { name, rest, cdpUrl, help } = parseRunArgv(argv)

  if (!name) {
    process.stderr.write('Usage: browser-cli run <name> [args] [--cdp-url <url>]\n')
    process.exit(2)
  }

  const { mod } = await loadWorkflow(name)

  if (help) {
    const out = await renderDescribe(name)
    process.stdout.write(out + '\n')
    return
  }

  const spec = extractParamSpec(mod.schema)

  let parsedArgs: unknown
  try {
    const input = parseRunArgs(rest)
    if (input.kind === 'empty') {
      parsedArgs = {}
    } else if (input.kind === 'json') {
      parsedArgs = input.value
    } else {
      parsedArgs = coerceToObject(input, spec)
    }
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`)
    process.exit(2)
  }

  const { cdpUrl: resolvedUrl, isCustom } = resolveCdpUrl(cdpUrl)
  if (isCustom) {
    await ensureCustomCdpReachable(resolvedUrl)
  } else {
    await ensurePlaywriter()
  }

  const result = await runWorkflow(name, parsedArgs, { cdpUrl, preloaded: mod })
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
}
