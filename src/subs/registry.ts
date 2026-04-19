import fs from 'node:fs'
import { SUBS_REGISTRY } from '../paths.ts'

export type SubEntry = {
  name: string
  url: string
  addedAt: string
  lastUpdate: string | null
  commit: string | null
}

export type SubsFile = { subs: SubEntry[] }

export function readRegistry(): SubsFile {
  if (!fs.existsSync(SUBS_REGISTRY)) return { subs: [] }
  try {
    const raw = JSON.parse(fs.readFileSync(SUBS_REGISTRY, 'utf8')) as unknown
    if (!raw || typeof raw !== 'object') return { subs: [] }
    const maybe = raw as { subs?: unknown }
    if (!Array.isArray(maybe.subs)) return { subs: [] }
    return { subs: maybe.subs.filter(isEntry) }
  } catch {
    return { subs: [] }
  }
}

function isEntry(v: unknown): v is SubEntry {
  if (!v || typeof v !== 'object') return false
  const e = v as Record<string, unknown>
  return typeof e.name === 'string' && typeof e.url === 'string'
}

export function writeRegistry(file: SubsFile): void {
  fs.writeFileSync(SUBS_REGISTRY, JSON.stringify(file, null, 2) + '\n', 'utf8')
}

export function findSub(name: string): SubEntry | undefined {
  return readRegistry().subs.find((s) => s.name === name)
}

export function addSub(entry: SubEntry): void {
  const file = readRegistry()
  const idx = file.subs.findIndex((s) => s.name === entry.name)
  if (idx >= 0) file.subs[idx] = entry
  else file.subs.push(entry)
  writeRegistry(file)
}

export function removeSub(name: string): boolean {
  const file = readRegistry()
  const before = file.subs.length
  file.subs = file.subs.filter((s) => s.name !== name)
  if (file.subs.length === before) return false
  writeRegistry(file)
  return true
}

export function updateSubMeta(name: string, patch: Partial<SubEntry>): void {
  const file = readRegistry()
  const idx = file.subs.findIndex((s) => s.name === name)
  if (idx < 0) return
  file.subs[idx] = { ...file.subs[idx]!, ...patch }
  writeRegistry(file)
}

// Derive a sub name from a git URL when --name isn't provided.
// Handles https://host/owner/repo(.git)? and git@host:owner/repo(.git)? forms.
export function deriveNameFromUrl(url: string): string {
  const cleaned = url.trim().replace(/\.git$/, '')
  const parts = cleaned.split(/[/:]/)
  const tail = parts[parts.length - 1] ?? 'sub'
  return tail || 'sub'
}
