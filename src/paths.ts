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
export const PROJECT_ROOT = findProjectRoot(process.cwd())
export const PROJECT_HOME = PROJECT_ROOT ? path.join(PROJECT_ROOT, '.browser-cli') : null
export const PROJECT_WORKFLOWS_DIR = PROJECT_HOME ? path.join(PROJECT_HOME, 'workflows') : null

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
  ensureNodeModulesLinkAt(HOME_DIR)
}

function ensureNodeModulesLinkAt(homeDir: string): void {
  const link = path.join(homeDir, 'node_modules')
  if (fs.existsSync(link)) return
  const target = path.join(PACKAGE_ROOT, 'node_modules')
  if (!fs.existsSync(target)) return
  try {
    fs.symlinkSync(target, link, 'dir')
  } catch {
  }
}

export function ensureProjectNodeModulesLink(startDir: string = process.cwd()): void {
  const home = getProjectHome(startDir)
  if (!home || !fs.existsSync(home)) return
  ensureNodeModulesLinkAt(home)
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

export function findProjectRoot(startDir: string = process.cwd()): string | null {
  let dir = path.resolve(startDir)
  try {
    if (fs.existsSync(dir) && !fs.statSync(dir).isDirectory()) {
      dir = path.dirname(dir)
    }
  } catch {
    return null
  }

  while (true) {
    if (isProjectRootCandidate(dir)) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function isProjectRootCandidate(dir: string): boolean {
  if (!fs.existsSync(path.join(dir, '.git'))) return false
  const resolved = path.resolve(dir)
  if (isPathInside(resolved, HOME_DIR) || isPathInside(resolved, SUBS_DIR)) return false
  return true
}

function isPathInside(candidate: string, root: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(candidate))
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel))
}

export function hasProjectContext(startDir: string = process.cwd()): boolean {
  return findProjectRoot(startDir) !== null
}

export function getProjectHome(startDir: string = process.cwd()): string | null {
  const root = findProjectRoot(startDir)
  return root ? path.join(root, '.browser-cli') : null
}

export function getProjectWorkflowsDir(startDir: string = process.cwd()): string | null {
  const home = getProjectHome(startDir)
  return home ? path.join(home, 'workflows') : null
}

export function resolveProjectWorkflowPath(name: string, startDir: string = process.cwd()): string | null {
  const dir = getProjectWorkflowsDir(startDir)
  if (!dir) return null
  const clean = name.replace(/\.ts$/, '')
  if (clean.includes('..') || path.isAbsolute(clean)) {
    throw new Error(`Invalid workflow name: ${name}`)
  }
  return path.join(dir, `${clean}.ts`)
}

export function listProjectWorkflowFiles(startDir: string = process.cwd()): string[] {
  const dir = getProjectWorkflowsDir(startDir)
  if (!dir || !fs.existsSync(dir)) return []
  return walkTsFiles(dir, '').sort()
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
