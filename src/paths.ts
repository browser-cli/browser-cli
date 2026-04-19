import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ensureUserRepo } from './git/userRepo.ts'

export const HOME_DIR = process.env.BROWSER_CLI_HOME
  ? path.resolve(process.env.BROWSER_CLI_HOME)
  : path.join(os.homedir(), '.browser-cli')

export const SUBS_DIR = process.env.BROWSER_CLI_SUBS_HOME
  ? path.resolve(process.env.BROWSER_CLI_SUBS_HOME)
  : path.join(os.homedir(), '.browser-cli-subs')

export const WORKFLOWS_DIR = path.join(HOME_DIR, 'workflows')
export const TASKS_DIR = path.join(HOME_DIR, 'tasks')
export const FEEDS_DIR = path.join(HOME_DIR, 'feeds')
export const CACHE_DIR = path.join(HOME_DIR, '.cache')
export const ENV_FILE = path.join(HOME_DIR, '.env')
export const DB_PATH = path.join(HOME_DIR, 'db.sqlite')
export const DAEMON_PID_PATH = path.join(HOME_DIR, 'daemon.pid')
export const DAEMON_LOG_PATH = path.join(HOME_DIR, 'daemon.log')
export const NODE_MODULES_LINK = path.join(HOME_DIR, 'node_modules')
export const SUBS_REGISTRY = path.join(HOME_DIR, 'subs.json')
export const GITIGNORE_PATH = path.join(HOME_DIR, '.gitignore')

const THIS_FILE = fileURLToPath(import.meta.url)
export const PACKAGE_ROOT = path.resolve(path.dirname(THIS_FILE), '..')

let initHintPrinted = false

export function ensureHomeDirs(): void {
  fs.mkdirSync(WORKFLOWS_DIR, { recursive: true })
  fs.mkdirSync(TASKS_DIR, { recursive: true })
  fs.mkdirSync(FEEDS_DIR, { recursive: true })
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  fs.mkdirSync(SUBS_DIR, { recursive: true })
  ensureNodeModulesLink()
  ensureSubNodeModulesLinks()
  ensureUserRepoWithHint()
}

// Subscribed workflows/tasks live under ~/.browser-cli-subs/<name>/ and import
// `zod` / `@browserbasehq/stagehand` the same way user-local scripts do. Node's
// ESM resolver walks up from the file dir looking for node_modules; our subs
// sit in a sibling tree, so we symlink node_modules into each sub root the
// same way we do for HOME_DIR.
export function ensureSubNodeModulesLinks(): void {
  if (!fs.existsSync(SUBS_DIR)) return
  const target = path.join(PACKAGE_ROOT, 'node_modules')
  if (!fs.existsSync(target)) return
  for (const name of listSubNames()) {
    const link = path.join(SUBS_DIR, name, 'node_modules')
    if (fs.existsSync(link)) continue
    try {
      fs.symlinkSync(target, link, 'dir')
    } catch {
    }
  }
}

function ensureUserRepoWithHint(): void {
  try {
    const { justInitialized } = ensureUserRepo()
    if (justInitialized && !initHintPrinted) {
      initHintPrinted = true
      if (process.stdout.isTTY) {
        process.stdout.write(
          `initialized ${HOME_DIR} as a git repo — run 'git -C ${HOME_DIR} remote add origin <url>' to sync across devices\n`,
        )
      }
    }
  } catch {
    // Git missing or unavailable — user can still use browser-cli, just without sync.
  }
}

export function resolveTaskPath(name: string): string {
  const clean = name.replace(/\.ts$/, '')
  if (clean.includes('..') || path.isAbsolute(clean)) {
    throw new Error(`Invalid task name: ${name}`)
  }
  return path.join(TASKS_DIR, `${clean}.ts`)
}

export function listTaskFiles(): string[] {
  if (!fs.existsSync(TASKS_DIR)) return []
  return walkTsFiles(TASKS_DIR, '').sort()
}

export function feedPath(taskName: string): string {
  const clean = taskName.replace(/\.ts$/, '').replace(/\//g, '__')
  return path.join(FEEDS_DIR, `${clean}.xml`)
}

// Workflow files live outside our package (in ~/.browser-cli/workflows/) and
// import packages like `zod` and `@browserbasehq/stagehand` directly. Node's
// ESM resolver walks up from the workflow file's directory, so we expose our
// own node_modules to the home dir via a symlink. If the user has already
// materialized their own node_modules (e.g. ran `pnpm install` there), leave
// it alone.
export function ensureNodeModulesLink(): void {
  if (fs.existsSync(NODE_MODULES_LINK)) return
  const target = path.join(PACKAGE_ROOT, 'node_modules')
  if (!fs.existsSync(target)) return
  try {
    fs.symlinkSync(target, NODE_MODULES_LINK, 'dir')
  } catch {
  }
}

export function resolveWorkflowPath(name: string): string {
  const clean = name.replace(/\.ts$/, '')
  if (clean.includes('..') || path.isAbsolute(clean)) {
    throw new Error(`Invalid workflow name: ${name}`)
  }
  return path.join(WORKFLOWS_DIR, `${clean}.ts`)
}

export function listWorkflowFiles(): string[] {
  if (!fs.existsSync(WORKFLOWS_DIR)) return []
  return walkTsFiles(WORKFLOWS_DIR, '').sort()
}

// Returns names of all subscribed repos (directory basenames under SUBS_DIR).
export function listSubNames(): string[] {
  if (!fs.existsSync(SUBS_DIR)) return []
  const out: string[] = []
  for (const e of fs.readdirSync(SUBS_DIR, { withFileTypes: true })) {
    if (e.isDirectory() && !e.name.startsWith('.')) out.push(e.name)
  }
  return out.sort()
}

function subDir(subName: string): string {
  if (subName.includes('..') || subName.includes('/') || subName.includes('\\')) {
    throw new Error(`Invalid sub name: ${subName}`)
  }
  return path.join(SUBS_DIR, subName)
}

export function resolveSubWorkflowPath(subName: string, workflow: string): string {
  const clean = workflow.replace(/\.ts$/, '')
  if (clean.includes('..') || path.isAbsolute(clean)) {
    throw new Error(`Invalid workflow name: ${workflow}`)
  }
  return path.join(subDir(subName), 'workflows', `${clean}.ts`)
}

export function resolveSubTaskPath(subName: string, task: string): string {
  const clean = task.replace(/\.ts$/, '')
  if (clean.includes('..') || path.isAbsolute(clean)) {
    throw new Error(`Invalid task name: ${task}`)
  }
  return path.join(subDir(subName), 'tasks', `${clean}.ts`)
}

export function listSubWorkflowFiles(subName: string): string[] {
  const dir = path.join(subDir(subName), 'workflows')
  if (!fs.existsSync(dir)) return []
  return walkTsFiles(dir, '').sort()
}

export function listSubTaskFiles(subName: string): string[] {
  const dir = path.join(subDir(subName), 'tasks')
  if (!fs.existsSync(dir)) return []
  return walkTsFiles(dir, '').sort()
}

// Parses "<sub>/<rest>" and detects whether the first segment matches a
// registered subscription. Falls back to treating the whole string as a
// user-local name when it doesn't.
export function parseNamespaced(ref: string): { sub?: string; rest: string } {
  const slash = ref.indexOf('/')
  if (slash <= 0) return { rest: ref }
  const first = ref.slice(0, slash)
  const rest = ref.slice(slash + 1)
  const subs = listSubNames()
  if (subs.includes(first)) return { sub: first, rest }
  return { rest: ref }
}

function walkTsFiles(dir: string, prefix: string): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue
    const rel = prefix ? `${prefix}/${e.name}` : e.name
    if (e.isDirectory()) {
      out.push(...walkTsFiles(path.join(dir, e.name), rel))
    } else if (e.isFile() && e.name.endsWith('.ts')) {
      out.push(rel)
    }
  }
  return out
}

export function loadDotEnv(): void {
  if (!fs.existsSync(ENV_FILE)) return
  try {
    process.loadEnvFile(ENV_FILE)
  } catch {
  }
}
