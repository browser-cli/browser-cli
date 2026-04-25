import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import './helpers.ts'
import { TEST_HOME } from './helpers.ts'
import {
  WORKFLOWS_DIR,
  findProjectRoot,
  getProjectHome,
  getProjectWorkflowsDir,
  listProjectWorkflowFiles,
  resolveProjectWorkflowPath,
} from '../src/paths.ts'
import { loadWorkflow, runWorkflow } from '../src/runner.ts'
import { formatDescribe, renderDescribe } from '../src/commands/describe.ts'
import { runList } from '../src/commands/list.ts'

function makeProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-project-'))
  fs.mkdirSync(path.join(root, '.git'), { recursive: true })
  return fs.realpathSync(root)
}

function writeWorkflow(baseDir: string, name: string, source: string): void {
  const file = path.join(baseDir, `${name}.ts`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, source, 'utf8')
}

async function withCwd<T>(dir: string, fn: () => Promise<T> | T): Promise<T> {
  const before = process.cwd()
  process.chdir(dir)
  try {
    return await fn()
  } finally {
    process.chdir(before)
  }
}

async function captureOutput(fn: () => Promise<void>): Promise<{ stdout: string; stderr: string }> {
  let stdout = ''
  let stderr = ''
  const oldStdoutWrite = process.stdout.write
  const oldStderrWrite = process.stderr.write
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += String(chunk)
    return true
  }) as typeof process.stdout.write
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += String(chunk)
    return true
  }) as typeof process.stderr.write
  try {
    await fn()
  } finally {
    process.stdout.write = oldStdoutWrite
    process.stderr.write = oldStderrWrite
  }
  return { stdout, stderr }
}

test('project discovery finds nearest git root from nested directories', () => {
  const root = makeProject()
  const nested = path.join(root, 'packages', 'app')
  fs.mkdirSync(nested, { recursive: true })

  assert.equal(findProjectRoot(nested), root)
  assert.equal(getProjectHome(nested), path.join(root, '.browser-cli'))
  assert.equal(getProjectWorkflowsDir(nested), path.join(root, '.browser-cli', 'workflows'))
})

test('project workflow helpers return empty/null outside git repos', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-no-project-'))

  assert.equal(findProjectRoot(dir), null)
  assert.equal(resolveProjectWorkflowPath('x', dir), null)
  assert.deepEqual(listProjectWorkflowFiles(dir), [])
})

test('loadWorkflow and runWorkflow prefer project workflow over global workflow', async () => {
  const root = makeProject()
  const projectWorkflows = path.join(root, '.browser-cli', 'workflows')
  writeWorkflow(WORKFLOWS_DIR, 'same', `
    import { z } from 'zod'
    export const schema = z.object({})
    export async function run() { return { source: 'global' } }
  `)
  writeWorkflow(projectWorkflows, 'same', `
    import { z } from 'zod'
    export const schema = z.object({})
    export async function run() { return { source: 'project' } }
  `)

  await withCwd(root, async () => {
    const loaded = await loadWorkflow('same')
    assert.equal(loaded.path, path.join(projectWorkflows, 'same.ts'))
    assert.deepEqual(await runWorkflow('same'), { source: 'project' })
  })
})

test('loadWorkflow falls back to global workflow when project file is absent', async () => {
  const root = makeProject()
  writeWorkflow(WORKFLOWS_DIR, 'global-only', `
    import { z } from 'zod'
    export const schema = z.object({})
    export async function run() { return { source: 'global' } }
  `)

  await withCwd(root, async () => {
    const loaded = await loadWorkflow('global-only')
    assert.equal(loaded.path, path.join(WORKFLOWS_DIR, 'global-only.ts'))
    assert.deepEqual(await runWorkflow('global-only'), { source: 'global' })
  })
})

test('list shows project workflows before global workflows', async () => {
  const root = makeProject()
  const projectWorkflows = path.join(root, '.browser-cli', 'workflows')
  writeWorkflow(projectWorkflows, 'project-only', `
    /** Project workflow. */
    import { z } from 'zod'
    export const schema = z.object({})
    export async function run() { return [] }
  `)
  writeWorkflow(WORKFLOWS_DIR, 'global-list', `
    /** Global workflow. */
    import { z } from 'zod'
    export const schema = z.object({})
    export async function run() { return [] }
  `)

  const out = await withCwd(root, () => captureOutput(() => runList([])))
  assert.match(out.stdout, /── project workflows ──/)
  assert.match(out.stdout, /project-only/)
  assert.match(out.stdout, /── your workflows ──/)
  assert.match(out.stdout, /global-list/)
  assert.ok(out.stdout.indexOf('── project workflows ──') < out.stdout.indexOf('── your workflows ──'))
})

test('describe uses project workflow metadata and schema when names overlap', async () => {
  const root = makeProject()
  const projectWorkflows = path.join(root, '.browser-cli', 'workflows')
  writeWorkflow(WORKFLOWS_DIR, 'describe-same', `
    /** Global description. */
    import { z } from 'zod'
    export const schema = z.object({ globalArg: z.string() })
    export async function run() { return null }
  `)
  writeWorkflow(projectWorkflows, 'describe-same', `
    /** Project description. */
    import { z } from 'zod'
    export const schema = z.object({ projectArg: z.string().describe('from project') })
    export async function run() { return null }
  `)

  const described = await withCwd(root, () => renderDescribe('describe-same'))
  assert.match(described, /Project description/)
  assert.match(described, /projectArg/)
  assert.doesNotMatch(described, /globalArg/)
})

test('formatDescribe remains subscription-name agnostic', () => {
  const out = formatDescribe('pack/workflow', '', [])
  assert.match(out, /browser-cli run pack\/workflow/)
})

test('project tests use isolated global home', () => {
  assert.ok(WORKFLOWS_DIR.startsWith(TEST_HOME), 'test global workflows dir should use TEST_HOME')
})
