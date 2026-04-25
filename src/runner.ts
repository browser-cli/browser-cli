import fs from 'node:fs'
import type { ZodSchema, z } from 'zod'
import { ZodError } from 'zod'
import { withBrowser, type Browser } from './browser.ts'
import {
  WORKFLOWS_DIR,
  ensureProjectNodeModulesLink,
  ensureHomeDirs,
  getProjectWorkflowsDir,
  loadDotEnv,
  parseNamespaced,
  resolveProjectWorkflowPath,
  resolveSubWorkflowPath,
  resolveWorkflowPath,
} from './paths.ts'
import { loadTs } from './ts-loader.ts'

export type WorkflowModule<S extends ZodSchema = ZodSchema> = {
  schema: S
  run: (browser: Browser, args: z.infer<S>) => Promise<unknown>
}

function unwrapModule(mod: Record<string, unknown>): Record<string, unknown> {
  // `tsx/esm/api` transpiles workflow files as CJS; the named exports land
  // under `mod.default`. Native ESM keeps them at the top level. Support both.
  const candidate = (mod.default && typeof mod.default === 'object')
    ? (mod.default as Record<string, unknown>)
    : mod
  if ('schema' in candidate || 'run' in candidate) return candidate
  return mod
}

function assertWorkflowModule(rawMod: Record<string, unknown>, name: string): WorkflowModule {
  const mod = unwrapModule(rawMod)
  if (!mod.schema || typeof (mod.schema as { parse?: unknown }).parse !== 'function') {
    throw new Error(`Workflow "${name}" is missing a Zod \`schema\` export.`)
  }
  if (typeof mod.run !== 'function') {
    throw new Error(`Workflow "${name}" is missing an async \`run(browser, args)\` export.`)
  }
  return mod as unknown as WorkflowModule
}

export async function loadWorkflow(name: string): Promise<{ mod: WorkflowModule; path: string }> {
  loadDotEnv()
  ensureHomeDirs()

  const { sub, rest } = parseNamespaced(name)
  if (sub) {
    const workflowPath = resolveSubWorkflowPath(sub, rest)
    if (!fs.existsSync(workflowPath)) {
      throw new Error(`Workflow not found: ${workflowPath}\nRun \`browser-cli list\` to see available workflows in ${WORKFLOWS_DIR}`)
    }

    const mod = assertWorkflowModule(await loadTs(workflowPath), name)
    return { mod, path: workflowPath }
  }

  const searched: string[] = []
  const projectWorkflowPath = resolveProjectWorkflowPath(name)
  if (projectWorkflowPath) {
    searched.push(projectWorkflowPath)
    if (fs.existsSync(projectWorkflowPath)) {
      ensureProjectNodeModulesLink()
      const mod = assertWorkflowModule(await loadTs(projectWorkflowPath), name)
      return { mod, path: projectWorkflowPath }
    }
  }

  const workflowPath = resolveWorkflowPath(name)
  searched.push(workflowPath)
  if (!fs.existsSync(workflowPath)) {
    const locations = searched.map((p) => `  - ${p}`).join('\n')
    const projectWorkflowsDir = getProjectWorkflowsDir()
    const projectHint = projectWorkflowsDir ? `\nProject workflows dir: ${projectWorkflowsDir}` : ''
    throw new Error(
      `Workflow not found: ${name}\nSearched:\n${locations}${projectHint}\nGlobal workflows dir: ${WORKFLOWS_DIR}\nRun \`browser-cli list\` to see available workflows.`,
    )
  }

  const mod = assertWorkflowModule(await loadTs(workflowPath), name)
  return { mod, path: workflowPath }
}

export async function runWorkflow(
  name: string,
  rawArgs: unknown = {},
  options: { cdpUrl?: string; preloaded?: WorkflowModule } = {},
): Promise<unknown> {
  const mod = options.preloaded ?? (await loadWorkflow(name)).mod

  let parsed: unknown
  try {
    parsed = mod.schema.parse(rawArgs)
  } catch (err) {
    if (err instanceof ZodError) {
      const issues = err.issues
        .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('\n')
      throw new Error(`Invalid args for "${name}":\n${issues}`)
    }
    throw err
  }

  return await withBrowser({ cdpUrl: options.cdpUrl }, (browser) => mod.run(browser, parsed))
}
