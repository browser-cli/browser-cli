import fs from 'node:fs'
import path from 'node:path'
import { WORKFLOWS_DIR, listWorkflowFiles } from '../paths.ts'
import { extractDescription } from '../workflow-meta.ts'

export async function runList(): Promise<void> {
  const files = listWorkflowFiles()

  if (files.length === 0) {
    process.stderr.write(
      [
        '',
        `No workflows found in ${WORKFLOWS_DIR}`,
        '',
        'Create one by writing a .ts file that exports:',
        '  - `schema` (Zod object)',
        '  - `run(stagehand, args)` async function',
        '',
        'Copy the example workflow to get started:',
        '  mkdir -p ~/.browser-cli/workflows',
        '  cp "$(npm root -g)"/@browserclijs/browser-cli/examples/hn-top.ts ~/.browser-cli/workflows/',
        '',
      ].join('\n'),
    )
    return
  }

  const rows = files.map((file) => {
    const abs = path.join(WORKFLOWS_DIR, file)
    const stat = fs.statSync(abs)
    return {
      name: file.replace(/\.ts$/, ''),
      description: extractDescription(abs),
      mtime: stat.mtime.toISOString().slice(0, 10),
    }
  })

  const nameCol = Math.max(4, ...rows.map((r) => r.name.length))
  const dateCol = 10
  const header = `${'NAME'.padEnd(nameCol)}  ${'UPDATED'.padEnd(dateCol)}  DESCRIPTION`
  process.stdout.write(header + '\n')
  process.stdout.write('-'.repeat(header.length) + '\n')
  for (const r of rows) {
    process.stdout.write(`${r.name.padEnd(nameCol)}  ${r.mtime.padEnd(dateCol)}  ${r.description}\n`)
  }
}

