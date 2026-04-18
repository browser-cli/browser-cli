import { ensurePlaywriter } from '../preflight.ts'
import { runWorkflow } from '../runner.ts'

export async function runRunCommand(argv: string[]): Promise<void> {
  const [name, argsJson] = argv

  if (!name) {
    process.stderr.write('Usage: browser-cli run <name> [json-args]\n')
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

  await ensurePlaywriter()

  const result = await runWorkflow(name, parsedArgs)
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
}
