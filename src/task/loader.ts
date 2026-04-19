import fs from 'node:fs'
import crypto from 'node:crypto'
import { Cron } from 'croner'
import { listTaskFiles, resolveTaskPath, TASKS_DIR } from '../paths.ts'
import { loadTs } from '../ts-loader.ts'
import type { LoadedTask, TaskConfig } from './types.ts'

function unwrapModule(mod: Record<string, unknown>): Record<string, unknown> {
  const candidate = mod.default && typeof mod.default === 'object'
    ? (mod.default as Record<string, unknown>)
    : mod
  if ('config' in candidate) return candidate
  return mod
}

export function validateTaskConfig(raw: unknown, name: string): TaskConfig {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Task "${name}": \`config\` must be an object`)
  }
  const c = raw as Record<string, unknown>
  if (typeof c.workflow !== 'string' || !c.workflow) {
    throw new Error(`Task "${name}": config.workflow must be a non-empty string`)
  }
  if (typeof c.schedule !== 'string' || !c.schedule) {
    throw new Error(`Task "${name}": config.schedule must be a cron string`)
  }
  try {
    new Cron(c.schedule, { paused: true })
  } catch (err) {
    throw new Error(`Task "${name}": invalid cron expression "${c.schedule}": ${(err as Error).message}`)
  }
  if (c.args !== undefined && (typeof c.args !== 'object' || c.args === null || Array.isArray(c.args))) {
    throw new Error(`Task "${name}": config.args must be a plain object if provided`)
  }
  if (c.itemKey !== undefined && (typeof c.itemKey !== 'string' || !c.itemKey)) {
    throw new Error(`Task "${name}": config.itemKey must be a non-empty string if provided`)
  }
  if (c.notify !== undefined) {
    if (typeof c.notify !== 'object' || c.notify === null) {
      throw new Error(`Task "${name}": config.notify must be an object`)
    }
    const n = c.notify as Record<string, unknown>
    if (!Array.isArray(n.channels) || n.channels.some((x) => typeof x !== 'string')) {
      throw new Error(`Task "${name}": config.notify.channels must be a string[]`)
    }
    if (n.onError !== undefined && (!Array.isArray(n.onError) || n.onError.some((x) => typeof x !== 'string'))) {
      throw new Error(`Task "${name}": config.notify.onError must be a string[] if provided`)
    }
  }
  if (c.output !== undefined) {
    if (typeof c.output !== 'object' || c.output === null) {
      throw new Error(`Task "${name}": config.output must be an object`)
    }
    const o = c.output as Record<string, unknown>
    if (o.rss !== undefined) {
      if (typeof o.rss !== 'object' || o.rss === null) {
        throw new Error(`Task "${name}": config.output.rss must be an object`)
      }
      const rss = o.rss as Record<string, unknown>
      if (typeof rss.title !== 'string' || typeof rss.link !== 'string') {
        throw new Error(`Task "${name}": config.output.rss requires string title + link`)
      }
    }
  }
  return c as unknown as TaskConfig
}

export function hashConfig(config: TaskConfig): string {
  const json = JSON.stringify(config, Object.keys(config).sort())
  return crypto.createHash('sha256').update(json).digest('hex').slice(0, 16)
}

export async function loadTask(name: string): Promise<LoadedTask> {
  const p = resolveTaskPath(name)
  if (!fs.existsSync(p)) {
    throw new Error(`Task not found: ${p}\nRun \`browser-cli task list\` to see available tasks in ${TASKS_DIR}`)
  }
  const mod = unwrapModule(await loadTs(p))
  if (!('config' in mod)) {
    throw new Error(`Task "${name}" is missing a \`config\` export`)
  }
  const config = validateTaskConfig(mod.config, name)
  return { name, path: p, config, configHash: hashConfig(config) }
}

export async function loadAllTasks(): Promise<{ loaded: LoadedTask[]; errors: { name: string; error: string }[] }> {
  const loaded: LoadedTask[] = []
  const errors: { name: string; error: string }[] = []
  for (const file of listTaskFiles()) {
    const name = file.replace(/\.ts$/, '')
    try {
      loaded.push(await loadTask(name))
    } catch (err) {
      errors.push({ name, error: (err as Error).message })
    }
  }
  return { loaded, errors }
}
