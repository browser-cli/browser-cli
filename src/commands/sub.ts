import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import {
  SUBS_DIR,
  ensureHomeDirs,
  listSubTaskFiles,
  listSubWorkflowFiles,
  resolveSubTaskPath,
  resolveSubWorkflowPath,
  resolveTaskPath,
  resolveWorkflowPath,
  TASKS_DIR,
  WORKFLOWS_DIR,
} from '../paths.ts'
import {
  addSub,
  deriveNameFromUrl,
  findSub,
  readRegistry,
  removeSub,
  updateSubMeta,
} from '../subs/registry.ts'
import { cloneRepo, currentCommit, fetchAndReset, isDirty } from '../subs/git.ts'
import { promptAndCommit } from '../git/userRepo.ts'

const USAGE = `Usage:
  browser-cli sub add <git-url> [--name <n>]       Clone a shared repo of workflows/tasks
  browser-cli sub list                             List subscribed repos + counts
  browser-cli sub update [name]                    git fetch + reset; warns if dirty
  browser-cli sub remove <name>                    Delete the clone + registry entry
  browser-cli sub copy <sub>/<workflow-or-task>    Copy a sub file into your own workflows/ or tasks/

Subscribed files are read-only. Edit them by \`sub copy\`-ing first, then modifying your copy.
`

export async function runSub(argv: string[]): Promise<void> {
  const [sub, ...rest] = argv
  if (!sub || sub === '-h' || sub === '--help') {
    process.stdout.write(USAGE)
    return
  }
  switch (sub) {
    case 'add':
      return cmdAdd(rest)
    case 'list':
    case 'ls':
      return cmdList()
    case 'update':
    case 'up':
      return cmdUpdate(rest)
    case 'remove':
    case 'rm':
    case 'delete':
      return cmdRemove(rest)
    case 'copy':
    case 'cp':
    case 'fork':
      return cmdCopy(rest)
    default:
      process.stderr.write(`Unknown subcommand: sub ${sub}\n\n${USAGE}`)
      process.exit(2)
  }
}

async function cmdAdd(args: string[]): Promise<void> {
  let url: string | undefined
  let name: string | undefined
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === '--name') name = args[++i]
    else if (a.startsWith('--name=')) name = a.slice('--name='.length)
    else if (!url) url = a
  }
  if (!url) {
    process.stderr.write('Usage: browser-cli sub add <git-url> [--name <n>]\n')
    process.exit(2)
  }
  ensureHomeDirs()
  const subName = name ?? deriveNameFromUrl(url)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.\-]*$/.test(subName)) {
    process.stderr.write(`invalid sub name "${subName}" — alphanumeric plus _.- only\n`)
    process.exit(2)
  }
  const dest = path.join(SUBS_DIR, subName)
  if (fs.existsSync(dest)) {
    process.stderr.write(`sub "${subName}" already exists at ${dest}\n`)
    process.exit(1)
  }
  process.stdout.write(`cloning ${url} → ${dest}\n`)
  const res = cloneRepo(url, dest)
  if (res.code !== 0) {
    process.stderr.write(res.output)
    process.exit(1)
  }
  const now = new Date().toISOString()
  addSub({
    name: subName,
    url,
    addedAt: now,
    lastUpdate: now,
    commit: currentCommit(dest),
  })
  const wf = listSubWorkflowFiles(subName).length
  const tk = listSubTaskFiles(subName).length
  process.stdout.write(`subscribed "${subName}" — ${wf} workflow(s), ${tk} task(s)\n`)
  await promptAndCommit(`sub add ${subName}`)
}

async function cmdList(): Promise<void> {
  ensureHomeDirs()
  const { subs } = readRegistry()
  if (subs.length === 0) {
    process.stdout.write('no subscriptions — add one with: browser-cli sub add <git-url>\n')
    return
  }
  const nameCol = Math.max(4, ...subs.map((s) => s.name.length))
  process.stdout.write(
    `${'NAME'.padEnd(nameCol)}  WF  TK  LAST UPDATE          URL\n`,
  )
  process.stdout.write('-'.repeat(nameCol + 60) + '\n')
  for (const s of subs) {
    const wf = listSubWorkflowFiles(s.name).length
    const tk = listSubTaskFiles(s.name).length
    const when = s.lastUpdate
      ? new Date(s.lastUpdate).toISOString().slice(0, 19).replace('T', ' ')
      : '—'
    process.stdout.write(
      `${s.name.padEnd(nameCol)}  ${String(wf).padStart(2)}  ${String(tk).padStart(2)}  ${when.padEnd(19)}  ${s.url}\n`,
    )
  }
}

async function cmdUpdate(args: string[]): Promise<void> {
  ensureHomeDirs()
  const { subs } = readRegistry()
  const targets = args.length > 0 ? subs.filter((s) => args.includes(s.name)) : subs
  if (targets.length === 0) {
    process.stderr.write('no matching subs\n')
    process.exit(1)
  }
  let anyChange = false
  for (const s of targets) {
    const dest = path.join(SUBS_DIR, s.name)
    if (!fs.existsSync(dest)) {
      process.stderr.write(`${s.name}: clone missing at ${dest} — skipping\n`)
      continue
    }
    if (isDirty(dest)) {
      const cont = await confirm(
        `files in "${s.name}" were modified — updating will discard your changes. continue? [y/N]: `,
      )
      if (!cont) {
        process.stdout.write(`${s.name}: skipped\n`)
        continue
      }
    }
    process.stdout.write(`${s.name}: fetching…\n`)
    const res = fetchAndReset(dest)
    if (res.code !== 0) {
      process.stderr.write(`${s.name}: update failed\n${res.output}\n`)
      continue
    }
    const before = s.commit
    const after = currentCommit(dest)
    updateSubMeta(s.name, { lastUpdate: new Date().toISOString(), commit: after })
    if (before !== after) {
      anyChange = true
      process.stdout.write(`${s.name}: ${before?.slice(0, 7) ?? '—'} → ${after?.slice(0, 7) ?? '—'}\n`)
    } else {
      process.stdout.write(`${s.name}: already up to date\n`)
    }
  }
  if (anyChange) await promptAndCommit('sub update')
}

async function cmdRemove(args: string[]): Promise<void> {
  const [name] = args
  if (!name) {
    process.stderr.write('Usage: browser-cli sub remove <name>\n')
    process.exit(2)
  }
  ensureHomeDirs()
  const existed = removeSub(name)
  const dest = path.join(SUBS_DIR, name)
  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true })
  if (!existed && !fs.existsSync(dest)) {
    process.stderr.write(`sub "${name}" not found\n`)
    process.exit(1)
  }
  process.stdout.write(`removed sub "${name}"\n`)
  await promptAndCommit(`sub remove ${name}`)
}

async function cmdCopy(args: string[]): Promise<void> {
  let ref: string | undefined
  let asName: string | undefined
  let force = false
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === '--as') asName = args[++i]
    else if (a.startsWith('--as=')) asName = a.slice('--as='.length)
    else if (a === '--force' || a === '-f') force = true
    else if (!ref) ref = a
  }
  if (!ref) {
    process.stderr.write(
      'Usage: browser-cli sub copy <sub>/<workflow-or-task> [--as <name>] [--force]\n',
    )
    process.exit(2)
  }
  ensureHomeDirs()
  const slash = ref.indexOf('/')
  if (slash <= 0) {
    process.stderr.write(`expected "<sub>/<path>", got "${ref}"\n`)
    process.exit(2)
  }
  const subName = ref.slice(0, slash)
  const rest = ref.slice(slash + 1)
  if (!findSub(subName)) {
    process.stderr.write(`sub "${subName}" not found\n`)
    process.exit(1)
  }

  // Try workflow first, then task.
  const wfSrc = resolveSubWorkflowPath(subName, rest)
  const tkSrc = resolveSubTaskPath(subName, rest)
  let src: string
  let kind: 'workflow' | 'task'
  if (fs.existsSync(wfSrc)) {
    src = wfSrc
    kind = 'workflow'
  } else if (fs.existsSync(tkSrc)) {
    src = tkSrc
    kind = 'task'
  } else {
    process.stderr.write(
      `not found inside "${subName}":\n  tried ${wfSrc}\n  tried ${tkSrc}\n`,
    )
    process.exit(1)
  }

  const destName = asName ?? rest
  const dest = kind === 'workflow' ? resolveWorkflowPath(destName) : resolveTaskPath(destName)
  if (fs.existsSync(dest) && !force) {
    process.stderr.write(`destination exists: ${dest} — pass --force to overwrite\n`)
    process.exit(1)
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(src, dest)
  const destRel = kind === 'workflow'
    ? path.relative(WORKFLOWS_DIR, dest)
    : path.relative(TASKS_DIR, dest)
  process.stdout.write(`copied ${subName}/${rest} → ${kind}s/${destRel}\n`)
  if (kind === 'task') {
    process.stdout.write(`next: browser-cli task enable ${destName.replace(/\.ts$/, '')}\n`)
  }
  await promptAndCommit(`sub copy ${subName}/${rest}`)
}

async function confirm(question: string): Promise<boolean> {
  if (!stdin.isTTY || !stdout.isTTY) return false
  const rl = readline.createInterface({ input: stdin, output: stdout })
  try {
    const ans = (await rl.question(question)).trim().toLowerCase()
    return ans === 'y' || ans === 'yes'
  } finally {
    rl.close()
  }
}
