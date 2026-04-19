import { runWorkflow } from '../runner.ts'
import { diffAndStore } from '../store/items.ts'
import { diffSnapshot } from '../store/snapshots.ts'
import { insertRun } from '../store/runs.ts'
import { markRan } from '../task/registry.ts'
import { writeRssFile } from '../sinks/rss.ts'
import { notify } from '../notify/index.ts'
import type { LoadedTask } from '../task/types.ts'

export type ExecutionResult = {
  status: 'ok' | 'error'
  mode: 'items' | 'snapshot'
  newItemsCount: number
  error?: string
  runId: number
}

export type ExecutorOptions = {
  cdpUrl?: string
}

export async function executeTask(
  task: LoadedTask,
  opts: ExecutorOptions = {},
): Promise<ExecutionResult> {
  const startedAt = Date.now()
  try {
    const result = await runWorkflow(task.config.workflow, task.config.args ?? {}, {
      cdpUrl: opts.cdpUrl,
    })
    return await applyResult(task, result, startedAt)
  } catch (err) {
    return await finalizeError(task, startedAt, err)
  }
}

/**
 * Apply a workflow result through the diff/sink pipeline.
 * Exposed so tests and external drivers can exercise the pipeline without Stagehand.
 */
export async function applyResult(
  task: LoadedTask,
  result: unknown,
  startedAt: number = Date.now(),
): Promise<ExecutionResult> {
  const mode: 'items' | 'snapshot' = task.config.itemKey ? 'items' : 'snapshot'
  try {
    const newItemsCount = mode === 'items'
      ? await handleItemsMode(task, result)
      : await handleSnapshotMode(task, result)

    const endedAt = Date.now()
    const runId = insertRun({
      taskName: task.name,
      status: 'ok',
      startedAt,
      endedAt,
      newItemsCount,
      error: null,
    })
    markRan(task.name, endedAt, task.config.schedule)
    return { status: 'ok', mode, newItemsCount, runId }
  } catch (err) {
    return await finalizeError(task, startedAt, err)
  }
}

async function finalizeError(
  task: LoadedTask,
  startedAt: number,
  err: unknown,
): Promise<ExecutionResult> {
  const mode: 'items' | 'snapshot' = task.config.itemKey ? 'items' : 'snapshot'
  const endedAt = Date.now()
  const message = err instanceof Error ? err.message : String(err)
  const runId = insertRun({
    taskName: task.name,
    status: 'error',
    startedAt,
    endedAt,
    newItemsCount: 0,
    error: message,
  })
  markRan(task.name, endedAt, task.config.schedule)

  const onError = task.config.notify?.onError ?? []
  if (onError.length > 0) {
    await notify(onError, {
      title: `task ${task.name} failed`,
      body: `Workflow "${task.config.workflow}" threw an error:\n\n${message}`,
    }).catch(() => {})
  }

  return { status: 'error', mode, newItemsCount: 0, error: message, runId }
}

async function handleItemsMode(task: LoadedTask, result: unknown): Promise<number> {
  const itemKey = task.config.itemKey!
  if (!Array.isArray(result)) {
    throw new Error(
      `task ${task.name} uses itemKey="${itemKey}" but workflow "${task.config.workflow}" returned ${typeof result} — return an array or remove itemKey to switch to snapshot mode`,
    )
  }
  const { newItems } = diffAndStore(task.name, result, itemKey)

  if (newItems.length === 0) return 0

  if (task.config.output?.rss) {
    try {
      writeRssFile(task.name, task.config.output.rss)
    } catch (err) {
      process.stderr.write(`task ${task.name}: rss write failed: ${(err as Error).message}\n`)
    }
  }

  const channels = task.config.notify?.channels ?? []
  if (channels.length > 0) {
    const body = renderItemsBody(task.name, newItems, task.config.itemKey!)
    await notify(channels, {
      title: `${task.name}: ${newItems.length} new item${newItems.length === 1 ? '' : 's'}`,
      body,
    }).catch((err) => {
      process.stderr.write(`task ${task.name}: notify failed: ${(err as Error).message}\n`)
    })
  }

  return newItems.length
}

async function handleSnapshotMode(task: LoadedTask, result: unknown): Promise<number> {
  const d = diffSnapshot(task.name, result)
  if (d.isFirstRun) return 0
  if (!d.changed) return 0

  const channels = task.config.notify?.channels ?? []
  if (channels.length > 0) {
    const { title, body } = renderSnapshotBody(task, d.before, d.after)
    await notify(channels, { title, body }).catch((err) => {
      process.stderr.write(`task ${task.name}: notify failed: ${(err as Error).message}\n`)
    })
  }
  return 1
}

function renderItemsBody(taskName: string, items: unknown[], itemKey: string): string {
  const preview = items.slice(0, 5).map((it) => {
    if (!it || typeof it !== 'object') return `- ${String(it)}`
    const rec = it as Record<string, unknown>
    const title = rec.title ?? rec.name ?? rec.headline ?? rec[itemKey]
    return `- ${String(title)}`
  })
  const more = items.length > 5 ? `\n… and ${items.length - 5} more` : ''
  return `${taskName}: ${items.length} new item${items.length === 1 ? '' : 's'}\n\n${preview.join('\n')}${more}`
}

function renderSnapshotBody(
  task: LoadedTask,
  before: unknown,
  after: unknown,
): { title: string; body: string } {
  const template = task.config.notify?.onChangeTemplate
  if (template) {
    return {
      title: `${task.name} changed`,
      body: renderTemplate(template, { workflow: task.config.workflow, task: task.name, before, after }),
    }
  }
  return {
    title: `${task.name} changed`,
    body: `workflow: ${task.config.workflow}\n\nbefore:\n${preview(before)}\n\nafter:\n${preview(after)}`,
  }
}

function preview(v: unknown): string {
  if (typeof v === 'string') return v.slice(0, 500)
  const s = JSON.stringify(v, null, 2)
  if (!s) return String(v)
  return s.length > 500 ? s.slice(0, 500) + '…' : s
}

function renderTemplate(tpl: string, ctx: Record<string, unknown>): string {
  return tpl.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, pathExpr: string) => {
    const parts = pathExpr.split('.').map((p: string) => p.trim()).filter(Boolean)
    let cur: unknown = ctx
    for (const p of parts) {
      if (cur && typeof cur === 'object') cur = (cur as Record<string, unknown>)[p]
      else {
        cur = undefined
        break
      }
    }
    if (cur === undefined || cur === null) return ''
    return typeof cur === 'string' ? cur : JSON.stringify(cur)
  })
}
