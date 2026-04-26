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

type Row = { name: string; site: string; description: string; mtime: string }

const NO_SITE = '(no site)'

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
    printSection(`── ${s.name} ──  (subscribed · ${s.url})`, rows)
  }
}

function toRows(files: string[], baseDir: string): Row[] {
  return files.map((file) => {
    const abs = path.join(baseDir, file)
    const stat = fs.statSync(abs)
    const clean = file.replace(/\.ts$/, '')
    const slash = clean.indexOf('/')
    const site = slash >= 0 ? clean.slice(0, slash) : NO_SITE
    const name = slash >= 0 ? clean.slice(slash + 1) : clean
    return {
      name,
      site,
      description: extractDescription(abs),
      mtime: stat.mtime.toISOString().slice(0, 10),
    }
  })
}

function printSection(title: string, rows: Row[]): void {
  process.stdout.write(`\n${title}\n`)
  if (rows.length === 0) {
    process.stdout.write('  (none)\n')
    return
  }

  const groups = new Map<string, Row[]>()
  for (const r of rows) {
    const list = groups.get(r.site) ?? []
    list.push(r)
    groups.set(r.site, list)
  }
  const sites = Array.from(groups.keys()).sort((a, b) => {
    if (a === NO_SITE) return 1
    if (b === NO_SITE) return -1
    return a.localeCompare(b)
  })

  const termWidth = process.stdout.columns && process.stdout.columns > 0 ? process.stdout.columns : 80

  for (const site of sites) {
    const items = groups.get(site)!
    items.sort((a, b) => a.name.localeCompare(b.name))
    const nameCol = Math.max(4, ...items.map((r) => r.name.length))
    const dateCol = 10
    const fixed = nameCol + 2 + dateCol + 2
    const descCol = Math.max(20, termWidth - fixed)
    const indent = ' '.repeat(fixed)

    process.stdout.write(`\n${site}\n`)
    process.stdout.write(
      `${'NAME'.padEnd(nameCol)}  ${'UPDATED'.padEnd(dateCol)}  DESCRIPTION\n`,
    )
    process.stdout.write('-'.repeat(Math.min(termWidth, fixed + 11)) + '\n')
    for (const r of items) {
      const lines = wrapText(r.description, descCol)
      process.stdout.write(`${r.name.padEnd(nameCol)}  ${r.mtime.padEnd(dateCol)}  ${lines[0] ?? ''}\n`)
      for (let i = 1; i < lines.length; i++) {
        process.stdout.write(`${indent}${lines[i]}\n`)
      }
    }
  }
}

function wrapText(text: string, width: number): string[] {
  if (!text) return ['']
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0) return ['']
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    if (word.length > width) {
      if (current) {
        lines.push(current)
        current = ''
      }
      let w = word
      while (w.length > width) {
        lines.push(w.slice(0, width))
        w = w.slice(width)
      }
      current = w
      continue
    }
    if (!current) {
      current = word
    } else if (current.length + 1 + word.length <= width) {
      current += ` ${word}`
    } else {
      lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)
  return lines
}
