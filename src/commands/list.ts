import fs from 'node:fs'
import path from 'node:path'
import {
  SUBS_DIR,
  WORKFLOWS_DIR,
  listSubWorkflowFiles,
  listWorkflowFiles,
} from '../paths.ts'
import { readRegistry } from '../subs/registry.ts'
import { extractDescription } from '../workflow-meta.ts'

type Row = { name: string; description: string; mtime: string }

export async function runList(): Promise<void> {
  const userFiles = listWorkflowFiles()
  const { subs } = readRegistry()

  const hasAny = userFiles.length > 0 || subs.some((s) => listSubWorkflowFiles(s.name).length > 0)

  if (!hasAny) {
    process.stderr.write(
      [
        '',
        `No workflows found in ${WORKFLOWS_DIR}`,
        '',
        'Create one by writing a .ts file that exports:',
        '  - `schema` (Zod object)',
        '  - `run(stagehand, args)` async function',
        '',
        'Or subscribe to a shared repo:',
        '  browser-cli sub add <git-url>',
        '',
      ].join('\n'),
    )
    return
  }

  const userRows = toRows(userFiles, WORKFLOWS_DIR)
  printSection('── your workflows ──', userRows)

  for (const s of subs) {
    const files = listSubWorkflowFiles(s.name)
    if (files.length === 0) continue
    const rows = toRows(files, path.join(SUBS_DIR, s.name, 'workflows'))
    printSection(`── ${s.name} ──  (subscribed · ${s.url})`, rows, s.name)
  }
}

function toRows(files: string[], baseDir: string): Row[] {
  return files.map((file) => {
    const abs = path.join(baseDir, file)
    const stat = fs.statSync(abs)
    return {
      name: file.replace(/\.ts$/, ''),
      description: extractDescription(abs),
      mtime: stat.mtime.toISOString().slice(0, 10),
    }
  })
}

function printSection(title: string, rows: Row[], subPrefix?: string): void {
  if (rows.length === 0) {
    process.stdout.write(`\n${title}\n  (none)\n`)
    return
  }
  const display = rows.map((r) => ({
    ...r,
    runName: subPrefix ? `${subPrefix}/${r.name}` : r.name,
  }))
  const nameCol = Math.max(4, ...display.map((r) => r.runName.length))
  const dateCol = 10
  process.stdout.write(`\n${title}\n`)
  process.stdout.write(
    `${'NAME'.padEnd(nameCol)}  ${'UPDATED'.padEnd(dateCol)}  DESCRIPTION\n`,
  )
  process.stdout.write('-'.repeat(nameCol + dateCol + 17) + '\n')
  for (const r of display) {
    process.stdout.write(`${r.runName.padEnd(nameCol)}  ${r.mtime.padEnd(dateCol)}  ${r.description}\n`)
  }
}
