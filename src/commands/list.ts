import fs from 'node:fs'
import path from 'node:path'
import {
  SUBS_DIR,
  WORKFLOWS_DIR,
  getProjectWorkflowsDir,
  listProjectWorkflowFiles,
  listSubWorkflowFiles,
  listWorkflowFiles,
} from '../paths.ts'
import { readRegistry } from '../subs/registry.ts'
import { extractDescription } from '../workflow-meta.ts'
import { matchesSite, parseSiteArg } from './parse-site-arg.ts'

type Row = { name: string; description: string; mtime: string }

export async function runList(argv: string[] = []): Promise<void> {
  const { site } = parseSiteArg(argv)

  const projectWorkflowsDir = getProjectWorkflowsDir()
  const projectFiles = listProjectWorkflowFiles().filter((f) => matchesSite(f, site))
  const userFiles = listWorkflowFiles().filter((f) => matchesSite(f, site))
  const { subs } = readRegistry()
  const subFiles = new Map<string, string[]>()
  for (const s of subs) {
    const files = listSubWorkflowFiles(s.name).filter((f) => matchesSite(f, site))
    if (files.length > 0) subFiles.set(s.name, files)
  }

  const hasAny = projectFiles.length > 0 || userFiles.length > 0 || subFiles.size > 0

  if (!hasAny) {
    if (site) {
      process.stderr.write(`no workflows match "${site}"\n`)
      return
    }
    process.stderr.write(
      [
        '',
        `No workflows found in ${WORKFLOWS_DIR}`,
        '',
        'Create one by writing a .ts file that exports:',
        '  - `schema` (Zod object)',
        '  - `run(browser, args)` async function',
        '',
        projectWorkflowsDir
          ? `Project workflows are loaded first from ${projectWorkflowsDir}`
          : 'Global workflows are loaded from your browser-cli home.',
        '',
        'Or subscribe to a shared repo:',
        '  browser-cli sub add <git-url>',
        '',
      ].join('\n'),
    )
    return
  }

  if (projectFiles.length > 0 && projectWorkflowsDir) {
    const projectRows = toRows(projectFiles, projectWorkflowsDir)
    printSection('── project workflows ──', projectRows)
  }

  if (userFiles.length > 0) {
    const userRows = toRows(userFiles, WORKFLOWS_DIR)
    printSection('── your workflows ──', userRows)
  }

  for (const s of subs) {
    const files = subFiles.get(s.name)
    if (!files || files.length === 0) continue
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
