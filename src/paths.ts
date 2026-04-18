import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

export const HOME_DIR = process.env.BROWSER_CLI_HOME
  ? path.resolve(process.env.BROWSER_CLI_HOME)
  : path.join(os.homedir(), '.browser-cli')

export const WORKFLOWS_DIR = path.join(HOME_DIR, 'workflows')
export const CACHE_DIR = path.join(HOME_DIR, '.cache')
export const ENV_FILE = path.join(HOME_DIR, '.env')
export const NODE_MODULES_LINK = path.join(HOME_DIR, 'node_modules')

const THIS_FILE = fileURLToPath(import.meta.url)
export const PACKAGE_ROOT = path.resolve(path.dirname(THIS_FILE), '..')

export function ensureHomeDirs(): void {
  fs.mkdirSync(WORKFLOWS_DIR, { recursive: true })
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  ensureNodeModulesLink()
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
  return fs
    .readdirSync(WORKFLOWS_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.ts'))
    .map((e) => e.name)
    .sort()
}

export function loadDotEnv(): void {
  if (!fs.existsSync(ENV_FILE)) return
  try {
    process.loadEnvFile(ENV_FILE)
  } catch {
  }
}
