import fs from 'node:fs'
import type { Stagehand } from '@browserbasehq/stagehand'
import type { ZodSchema, z } from 'zod'
import { ZodError } from 'zod'
import { Stagehand as StagehandCtor } from '@browserbasehq/stagehand'
import { makeStagehandConfig } from './stagehand-config.ts'
import { CACHE_DIR, WORKFLOWS_DIR, ensureHomeDirs, loadDotEnv, resolveWorkflowPath } from './paths.ts'
import { loadTs } from './ts-loader.ts'

export type WorkflowModule<S extends ZodSchema = ZodSchema> = {
  schema: S
  run: (stagehand: Stagehand, args: z.infer<S>) => Promise<unknown>
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
    throw new Error(`Workflow "${name}" is missing an async \`run(stagehand, args)\` export.`)
  }
  return mod as unknown as WorkflowModule
}

export async function loadWorkflow(name: string): Promise<{ mod: WorkflowModule; path: string }> {
  loadDotEnv()
  ensureHomeDirs()

  const workflowPath = resolveWorkflowPath(name)
  if (!fs.existsSync(workflowPath)) {
    throw new Error(`Workflow not found: ${workflowPath}\nRun \`browser-cli list\` to see available workflows in ${WORKFLOWS_DIR}`)
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

  const stagehand = new StagehandCtor(await makeStagehandConfig(CACHE_DIR, { cdpUrl: options.cdpUrl }))
  await stagehand.init()

  const preExisting = new Map<unknown, string>()
  for (const p of stagehand.context.pages()) preExisting.set(p, p.url())

  try {
    return await mod.run(stagehand, parsed)
  } finally {
    for (const p of stagehand.context.pages()) {
      const wasPre = preExisting.has(p)
      const wasBlank = preExisting.get(p) === 'about:blank'
      const stillBlank = p.url() === 'about:blank'
      const shouldClose = !wasPre || (wasBlank && stillBlank)
      if (shouldClose) await p.close().catch(() => {})
    }
    await stagehand.close().catch(() => {})
  }
}
