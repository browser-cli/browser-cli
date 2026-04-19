import type { ParamSpec, ParamType } from './param-spec.ts'

export type StructuredInput = { kind: 'structured'; positional: string[]; named: Record<string, string> }
export type JsonInput = { kind: 'json'; value: unknown }
export type EmptyInput = { kind: 'empty' }
export type RawInput = StructuredInput | JsonInput | EmptyInput

function isLikelyJson(s: string): boolean {
  const t = s.trimStart()
  return t.startsWith('{') || t.startsWith('[')
}

export function parseRunArgs(tokens: string[]): RawInput {
  if (tokens.length === 0) return { kind: 'empty' }

  if (tokens.length === 1 && isLikelyJson(tokens[0]!)) {
    try {
      return { kind: 'json', value: JSON.parse(tokens[0]!) }
    } catch (err) {
      throw new Error(`Invalid JSON for args: ${(err as Error).message}`)
    }
  }

  const positional: string[] = []
  const named: Record<string, string> = {}
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!
    if (tok.startsWith('--')) {
      const eq = tok.indexOf('=')
      if (eq > -1) {
        named[tok.slice(2, eq)] = tok.slice(eq + 1)
      } else {
        const key = tok.slice(2)
        const next = tokens[i + 1]
        if (next === undefined || next.startsWith('--')) {
          named[key] = 'true'
        } else {
          named[key] = next
          i++
        }
      }
    } else {
      positional.push(tok)
    }
  }
  return { kind: 'structured', positional, named }
}

function coercePrimitive(raw: string, type: ParamType, paramName: string): unknown {
  switch (type) {
    case 'string':
    case 'enum':
      return raw
    case 'number': {
      const n = Number(raw)
      if (Number.isNaN(n)) throw new Error(`--${paramName}: expected number, got "${raw}"`)
      return n
    }
    case 'boolean': {
      const v = raw.toLowerCase()
      if (v === 'true' || v === '1' || v === 'yes' || v === 'y') return true
      if (v === 'false' || v === '0' || v === 'no' || v === 'n') return false
      throw new Error(`--${paramName}: expected boolean (true/false), got "${raw}"`)
    }
    case 'array':
      return raw
    case 'other':
      if (isLikelyJson(raw)) {
        try { return JSON.parse(raw) } catch { /* fall through */ }
      }
      return raw
  }
}

function coerceArray(raw: string, element: ParamType | undefined, paramName: string): unknown {
  if (isLikelyJson(raw)) {
    try { return JSON.parse(raw) } catch { /* fall through to CSV */ }
  }
  if (raw === '') return []
  const parts = raw.split(',').map((p) => p.trim())
  if (!element || element === 'string' || element === 'enum') return parts
  return parts.map((p) => coercePrimitive(p, element, paramName))
}

function coerceValue(raw: string, spec: ParamSpec): unknown {
  if (spec.typeName === 'array') {
    return coerceArray(raw, spec.arrayElement, spec.name)
  }
  return coercePrimitive(raw, spec.typeName, spec.name)
}

export function coerceToObject(input: StructuredInput, spec: ParamSpec[]): unknown {
  const result: Record<string, unknown> = {}
  const byName = new Map(spec.map((s) => [s.name, s] as const))

  for (let i = 0; i < input.positional.length; i++) {
    const value = input.positional[i]!
    const paramSpec = spec[i]
    if (!paramSpec) {
      throw new Error(
        `Too many positional args. Schema declares ${spec.length} param(s): ${spec.map((s) => s.name).join(', ') || '(none)'}. ` +
        `Use --flag=value for extras or JSON for complex inputs.`,
      )
    }
    result[paramSpec.name] = coerceValue(value, paramSpec)
  }

  for (const [key, rawVal] of Object.entries(input.named)) {
    const paramSpec = byName.get(key)
    if (!paramSpec) {
      result[key] = rawVal
      continue
    }
    result[key] = coerceValue(rawVal, paramSpec)
  }

  return result
}
