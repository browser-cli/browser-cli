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
import { buildRateLimiter, type RateLimits } from './store/rate-limit.ts'
import { acquireSlot } from './store/concurrency.ts'

export type WorkflowModule<S extends ZodSchema = ZodSchema> = {
  schema: S
  run: (browser: Browser, args: z.infer<S>) => Promise<unknown>
  rateLimits?: RateLimits
  /** Max concurrent runs of this workflow allowed across all processes. */
  concurrency?: number
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
  if (mod.concurrency !== undefined) {
    const c = mod.concurrency as unknown
    if (typeof c !== 'number' || !Number.isInteger(c) || c < 0) {
      throw new Error(
        `Workflow "${name}" \`concurrency\` must be a non-negative integer (got ${String(c)}). Use 0 to opt out of the default single-instance cap.`,
      )
    }
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
  let mod: WorkflowModule
  let resolvedPath: string | null = null
  if (options.preloaded) {
    mod = options.preloaded
  } else {
    const loaded = await loadWorkflow(name)
    mod = loaded.mod
    resolvedPath = loaded.path
  }

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

  const rateLimiter = buildRateLimiter(mod.rateLimits)

  // Use the resolved file path as the slot key when available so two ways to
  // invoke the same workflow (project vs global, namespaced vs bare) share the
  // same concurrency budget. Fall back to the user-supplied name for preloaded
  // SDK callers that bypass loadWorkflow.
  const slotKey = `workflow:${resolvedPath ?? name}`

  // Default behavior: every workflow is single-instance (concurrency=1) unless
  // explicitly opted out with `export const concurrency = 0` (unlimited) or
  // raised to a higher number. Most personal automation scripts want this —
  // running the same workflow twice in parallel is usually a mistake.
  const declared = mod.concurrency
  const isDefaultConcurrency = declared === undefined
  const cap = declared ?? 1
  if (typeof cap !== 'number' || !Number.isInteger(cap) || cap < 0) {
    throw new Error(
      `Workflow "${name}" \`concurrency\` must be a non-negative integer (got ${String(declared)}). Use 0 to opt out of the default single-instance cap.`,
    )
  }

  const slotStart = Date.now()
  const slot = cap > 0 ? await acquireSlot(slotKey, cap) : null
  const slotWaited = Date.now() - slotStart
  if (slot && slotWaited > 100 && isDefaultConcurrency) {
    emitConcurrencyHint(name)
  }

  try {
    return await withBrowser({ cdpUrl: options.cdpUrl, rateLimiter }, (browser) =>
      mod.run(browser, parsed),
    )
  } finally {
    slot?.release()
  }
}

const concurrencyHintEmitted = new Set<string>()
function emitConcurrencyHint(name: string): void {
  if (concurrencyHintEmitted.has(name)) return
  concurrencyHintEmitted.add(name)
  process.stderr.write(
    `[browser-cli] workflow "${name}" defaults to single-instance (concurrency=1). Another run held the slot.\n` +
      `   → To allow more parallel runs, ask your AI: "raise concurrency for this workflow"\n` +
      `   → Use \`export const concurrency = 0\` to opt out entirely.\n` +
      `   → Docs: https://browser-cli.zerith.app/concepts/rate-limit/\n`,
  )
}
