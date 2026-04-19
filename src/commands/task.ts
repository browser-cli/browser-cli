import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { Cron } from 'croner'
import { resolveTaskPath, TASKS_DIR, listWorkflowFiles, WORKFLOWS_DIR, ensureHomeDirs } from '../paths.ts'
import { loadTask } from '../task/loader.ts'
import { executeTask } from '../daemon/executor.ts'
import {
  getTaskRow,
  listTaskRows,
  removeTaskRow,
  setEnabled,
  syncAllTasks,
} from '../task/registry.ts'
import { countItems, listItems } from '../store/items.ts'
import { getSnapshot } from '../store/snapshots.ts'
import { recentRuns } from '../store/runs.ts'
import { listChannels } from '../store/channels.ts'
import { ensureCustomCdpReachable, ensurePlaywriter } from '../preflight.ts'
import { resolveCdpUrl } from '../stagehand-config.ts'

const USAGE = `Usage:
  browser-cli task list                      List all tasks with status and next run
  browser-cli task create <name>             Interactive scaffolder for a new task
  browser-cli task show <name>               Config, recent runs, item/snapshot state
  browser-cli task run <name> [--cdp-url]    Run once (same code path as daemon tick)
  browser-cli task enable <name>             Enable scheduling for a task
  browser-cli task disable <name>            Disable scheduling
  browser-cli task rm <name>                 Remove the task file and its db row

Tasks are .ts files in ~/.browser-cli/tasks/ that export a \`config\` object.
`

export async function runTask(argv: string[]): Promise<void> {
  const [sub, ...rest] = argv
  if (!sub || sub === '-h' || sub === '--help') {
    process.stdout.write(USAGE)
    return
  }
  switch (sub) {
    case 'list':
    case 'ls':
      return cmdList()
    case 'create':
    case 'new':
      return cmdCreate(rest)
    case 'show':
      return cmdShow(rest)
    case 'run':
      return cmdRun(rest)
    case 'enable':
      return cmdEnable(rest, true)
    case 'disable':
      return cmdEnable(rest, false)
    case 'rm':
    case 'remove':
    case 'delete':
      return cmdRemove(rest)
    default:
      process.stderr.write(`Unknown subcommand: task ${sub}\n\n${USAGE}`)
      process.exit(2)
  }
}

async function cmdList(): Promise<void> {
  ensureHomeDirs()
  const { synced, errors } = await syncAllTasks()
  const rows = listTaskRows()
  for (const err of errors) {
    process.stderr.write(`task ${err.name}: load error — ${err.error}\n`)
  }
  if (rows.length === 0 && errors.length === 0) {
    process.stderr.write(
      `no tasks in ${TASKS_DIR}\ncreate one with: browser-cli task create <name>\n`,
    )
    return
  }
  const nameCol = Math.max(4, ...rows.map((r) => r.name.length))
  process.stdout.write(
    `${'NAME'.padEnd(nameCol)}  STATUS    LAST RUN             NEXT RUN\n`,
  )
  process.stdout.write('-'.repeat(nameCol + 55) + '\n')
  for (const r of rows) {
    const status = r.enabled ? 'enabled' : 'disabled'
    const last = r.lastRunAt ? new Date(r.lastRunAt).toISOString().slice(0, 19).replace('T', ' ') : '—'
    const next = r.nextRunAt ? new Date(r.nextRunAt).toISOString().slice(0, 19).replace('T', ' ') : '—'
    process.stdout.write(
      `${r.name.padEnd(nameCol)}  ${status.padEnd(8)}  ${last.padEnd(19)}  ${next}\n`,
    )
  }
  if (synced.length === 0 && rows.length > 0) {
    process.stderr.write(
      '\nnote: the on-disk tasks dir is empty; showing historical rows from sqlite.\n',
    )
  }
}

async function cmdShow(args: string[]): Promise<void> {
  const [name] = args
  if (!name) {
    process.stderr.write('Usage: browser-cli task show <name>\n')
    process.exit(2)
  }
  ensureHomeDirs()
  const task = await loadTask(name)
  const row = getTaskRow(name)
  const runs = recentRuns(name, 5)

  process.stdout.write(`task: ${name}\n`)
  process.stdout.write(`workflow: ${task.config.workflow}\n`)
  process.stdout.write(`schedule: ${task.config.schedule}\n`)
  process.stdout.write(`mode: ${task.config.itemKey ? `items (key="${task.config.itemKey}")` : 'snapshot'}\n`)
  if (row) {
    process.stdout.write(`enabled: ${row.enabled ? 'yes' : 'no'}\n`)
    process.stdout.write(
      `next run: ${row.nextRunAt ? new Date(row.nextRunAt).toISOString() : '—'}\n`,
    )
  } else {
    process.stdout.write('(not yet registered — run `task list` to sync)\n')
  }

  if (task.config.notify?.channels) {
    process.stdout.write(`notify: ${task.config.notify.channels.join(', ')}\n`)
  }
  if (task.config.notify?.onError) {
    process.stdout.write(`notify.onError: ${task.config.notify.onError.join(', ')}\n`)
  }
  if (task.config.output?.rss) {
    process.stdout.write(`rss: ${task.config.output.rss.title} <${task.config.output.rss.link}>\n`)
  }

  if (task.config.itemKey) {
    const n = countItems(name)
    process.stdout.write(`\nitems: ${n}\n`)
    if (n > 0) {
      const latest = listItems(name, 5)
      for (const it of latest) {
        process.stdout.write(
          `  - ${it.itemKey}  (first seen ${new Date(it.firstSeenAt).toISOString()})\n`,
        )
      }
    }
  } else {
    const snap = getSnapshot(name)
    if (snap) {
      process.stdout.write(
        `\nsnapshot: hash=${snap.payloadHash.slice(0, 12)}, updated ${new Date(snap.updatedAt).toISOString()}\n`,
      )
    } else {
      process.stdout.write('\nsnapshot: none yet\n')
    }
  }

  process.stdout.write('\nrecent runs:\n')
  if (runs.length === 0) {
    process.stdout.write('  (none)\n')
  } else {
    for (const r of runs) {
      const ts = new Date(r.startedAt).toISOString().slice(0, 19).replace('T', ' ')
      const dur = `${r.endedAt - r.startedAt}ms`
      const tail = r.status === 'error' ? `error: ${r.error}` : `new=${r.newItemsCount}`
      process.stdout.write(`  ${ts}  ${r.status.padEnd(5)}  ${dur.padEnd(8)}  ${tail}\n`)
    }
  }
}

async function cmdRun(args: string[]): Promise<void> {
  let cdpUrl: string | undefined
  const rest: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === '--cdp-url') {
      cdpUrl = args[++i]
    } else if (a.startsWith('--cdp-url=')) {
      cdpUrl = a.slice('--cdp-url='.length)
    } else {
      rest.push(a)
    }
  }
  const [name] = rest
  if (!name) {
    process.stderr.write('Usage: browser-cli task run <name> [--cdp-url <url>]\n')
    process.exit(2)
  }
  ensureHomeDirs()
  const task = await loadTask(name)

  const { cdpUrl: resolved, isCustom } = resolveCdpUrl(cdpUrl)
  if (isCustom) {
    await ensureCustomCdpReachable(resolved)
  } else {
    await ensurePlaywriter()
  }

  process.stdout.write(`running task "${name}" (mode=${task.config.itemKey ? 'items' : 'snapshot'})…\n`)
  const result = await executeTask(task, { cdpUrl })
  if (result.status === 'ok') {
    process.stdout.write(
      `ok — ${result.mode} mode, ${result.newItemsCount} ${result.mode === 'items' ? 'new items' : 'change'}\n`,
    )
  } else {
    process.stderr.write(`error: ${result.error}\n`)
    process.exit(1)
  }
}

async function cmdEnable(args: string[], enabled: boolean): Promise<void> {
  const [name] = args
  if (!name) {
    process.stderr.write(`Usage: browser-cli task ${enabled ? 'enable' : 'disable'} <name>\n`)
    process.exit(2)
  }
  // Make sure task exists on disk and registry is in sync.
  ensureHomeDirs()
  await loadTask(name)
  await syncAllTasks()
  const changed = setEnabled(name, enabled)
  if (!changed) {
    process.stderr.write(`task "${name}" not registered\n`)
    process.exit(1)
  }
  process.stdout.write(`task "${name}" ${enabled ? 'enabled' : 'disabled'}\n`)
}

async function cmdRemove(args: string[]): Promise<void> {
  const [name] = args
  if (!name) {
    process.stderr.write('Usage: browser-cli task rm <name>\n')
    process.exit(2)
  }
  ensureHomeDirs()
  const p = resolveTaskPath(name)
  if (fs.existsSync(p)) {
    fs.unlinkSync(p)
    process.stdout.write(`deleted ${p}\n`)
  }
  const removed = removeTaskRow(name)
  if (removed) process.stdout.write(`removed db row for "${name}"\n`)
  if (!fs.existsSync(p) && !removed) {
    process.stderr.write(`task "${name}" not found\n`)
    process.exit(1)
  }
}

async function cmdCreate(args: string[]): Promise<void> {
  const [name] = args
  if (!name) {
    process.stderr.write('Usage: browser-cli task create <name>\n')
    process.exit(2)
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_/\-.~]{0,99}$/.test(name)) {
    process.stderr.write('name must be 1-100 chars, alphanumeric plus _/-.~\n')
    process.exit(2)
  }
  ensureHomeDirs()
  const p = resolveTaskPath(name)
  if (fs.existsSync(p)) {
    process.stderr.write(`task already exists: ${p}\n`)
    process.exit(1)
  }

  const workflows = listWorkflowFiles().map((f) => f.replace(/\.ts$/, ''))
  if (workflows.length === 0) {
    process.stderr.write(
      `no workflows found in ${WORKFLOWS_DIR}\ncreate a workflow first, then come back.\n`,
    )
    process.exit(1)
  }

  const rl = readline.createInterface({ input: stdin, output: stdout })
  try {
    process.stdout.write('\nAvailable workflows:\n')
    workflows.forEach((w, i) => process.stdout.write(`  ${i + 1}. ${w}\n`))
    const wfIdxStr = (await rl.question('\nPick workflow (number or name): ')).trim()
    const wfIdx = Number(wfIdxStr)
    const workflow = Number.isFinite(wfIdx) && wfIdx >= 1 && wfIdx <= workflows.length
      ? workflows[wfIdx - 1]!
      : wfIdxStr
    if (!workflows.includes(workflow)) {
      process.stderr.write(`workflow "${workflow}" not found\n`)
      process.exit(1)
    }

    const argsJson = (await rl.question(`args for "${workflow}" as JSON (or blank for {}): `)).trim()
    const parsedArgs = argsJson ? JSON.parse(argsJson) : {}

    let schedule = (await rl.question('schedule (cron, e.g. "*/30 * * * *"): ')).trim()
    if (!schedule) schedule = '0 * * * *'
    try {
      new Cron(schedule, { paused: true })
    } catch (err) {
      process.stderr.write(`invalid cron "${schedule}": ${(err as Error).message}\n`)
      process.exit(1)
    }

    const modeAns = (await rl.question('mode: [i]tems (RSS/new-item) or [s]napshot (page-change)? [i/s]: '))
      .trim()
      .toLowerCase()
    const isItems = modeAns.startsWith('i')

    let itemKey: string | undefined
    let rss: { title: string; link: string; itemTitle?: string; itemLink?: string } | undefined
    if (isItems) {
      itemKey = (await rl.question('itemKey (field name in result items, e.g. "url"): ')).trim() || 'url'
      const wantRss = (await rl.question('generate RSS feed? [y/N]: ')).trim().toLowerCase().startsWith('y')
      if (wantRss) {
        const rssTitle = (await rl.question('  feed title: ')).trim() || name
        const rssLink = (await rl.question('  feed link: ')).trim() || 'https://example.com'
        const rssItemTitle = (await rl.question('  field used as item title [title]: ')).trim() || 'title'
        const rssItemLink = (await rl.question('  field used as item link [url]: ')).trim() || 'url'
        rss = { title: rssTitle, link: rssLink, itemTitle: rssItemTitle, itemLink: rssItemLink }
      }
    }

    const channels = listChannels()
    let notifyChannels: string[] = []
    let onError: string[] = []
    if (channels.length === 0) {
      const wantNotify = (
        await rl.question('no notification channels saved. notifications will be skipped. continue? [Y/n]: ')
      )
        .trim()
        .toLowerCase()
      if (wantNotify === 'n') {
        process.stderr.write('cancelled. Run `browser-cli notify add <name> <url>` and re-run this scaffolder.\n')
        process.exit(0)
      }
    } else {
      process.stdout.write('\nSaved notification channels:\n')
      channels.forEach((c, i) => process.stdout.write(`  ${i + 1}. ${c.name}\n`))
      const picked = (await rl.question('channels to notify on new items/changes (comma-separated numbers or names, blank to skip): ')).trim()
      notifyChannels = parseChannelPicker(picked, channels.map((c) => c.name))
      const errPicked = (await rl.question('channels to notify on task ERROR (comma-separated, blank to skip): ')).trim()
      onError = parseChannelPicker(errPicked, channels.map((c) => c.name))
    }

    const file = renderTaskFile({
      workflow,
      args: parsedArgs,
      schedule,
      itemKey,
      rss,
      notifyChannels,
      onError,
    })

    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, file, 'utf8')
    process.stdout.write(`\nwrote ${p}\n`)
    process.stdout.write('next: `browser-cli task run ' + name + '` to try it, or start the daemon.\n')
  } finally {
    rl.close()
  }
}

function parseChannelPicker(raw: string, valid: string[]): string[] {
  if (!raw) return []
  const out: string[] = []
  for (const tok of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const idx = Number(tok)
    if (Number.isFinite(idx) && idx >= 1 && idx <= valid.length) {
      out.push(valid[idx - 1]!)
    } else if (valid.includes(tok)) {
      out.push(tok)
    } else {
      process.stderr.write(`warning: unknown channel "${tok}" — skipping\n`)
    }
  }
  return out
}

function renderTaskFile(opts: {
  workflow: string
  args: Record<string, unknown>
  schedule: string
  itemKey?: string
  rss?: { title: string; link: string; itemTitle?: string; itemLink?: string }
  notifyChannels: string[]
  onError: string[]
}): string {
  const lines: string[] = []
  lines.push(`import type { TaskConfig } from '@browserclijs/browser-cli'`)
  lines.push('')
  lines.push('export const config: TaskConfig = {')
  lines.push(`  workflow: ${JSON.stringify(opts.workflow)},`)
  lines.push(`  args: ${JSON.stringify(opts.args)},`)
  lines.push(`  schedule: ${JSON.stringify(opts.schedule)},`)
  if (opts.itemKey) lines.push(`  itemKey: ${JSON.stringify(opts.itemKey)},`)
  if (opts.rss) {
    lines.push('  output: {')
    lines.push('    rss: {')
    lines.push(`      title: ${JSON.stringify(opts.rss.title)},`)
    lines.push(`      link: ${JSON.stringify(opts.rss.link)},`)
    if (opts.rss.itemTitle) lines.push(`      itemTitle: ${JSON.stringify(opts.rss.itemTitle)},`)
    if (opts.rss.itemLink) lines.push(`      itemLink: ${JSON.stringify(opts.rss.itemLink)},`)
    lines.push('    },')
    lines.push('  },')
  }
  if (opts.notifyChannels.length > 0 || opts.onError.length > 0) {
    lines.push('  notify: {')
    if (opts.notifyChannels.length > 0) {
      lines.push(`    channels: ${JSON.stringify(opts.notifyChannels)},`)
    } else {
      lines.push('    channels: [],')
    }
    if (opts.onError.length > 0) {
      lines.push(`    onError: ${JSON.stringify(opts.onError)},`)
    }
    lines.push('  },')
  }
  lines.push('}')
  lines.push('')
  return lines.join('\n')
}
