import type { ZodTypeAny } from 'zod'

export type ParamType = 'string' | 'number' | 'boolean' | 'enum' | 'array' | 'other'

export type ParamSpec = {
  name: string
  typeName: ParamType
  enumValues?: string[]
  arrayElement?: ParamType
  required: boolean
  hasDefault: boolean
  defaultValue?: unknown
  description?: string
}

type ZodDef = { typeName?: string; innerType?: ZodTypeAny; schema?: ZodTypeAny; values?: unknown; value?: unknown; type?: ZodTypeAny; defaultValue?: unknown; description?: string }
type ZodLike = { _def?: ZodDef; shape?: Record<string, ZodTypeAny> }

function def(z: ZodTypeAny): ZodDef {
  return ((z as ZodLike)._def ?? {}) as ZodDef
}

function typeName(z: ZodTypeAny): string {
  return def(z).typeName ?? ''
}

function unwrap(z: ZodTypeAny): { inner: ZodTypeAny; hasDefault: boolean; defaultValue?: unknown; optional: boolean; description?: string } {
  let cur = z
  let hasDefault = false
  let defaultValue: unknown
  let optional = false
  let description: string | undefined = def(cur).description

  for (let i = 0; i < 10; i++) {
    const d = def(cur)
    if (!description && d.description) description = d.description
    const tn = d.typeName
    if (tn === 'ZodOptional') {
      optional = true
      if (d.innerType) { cur = d.innerType; continue }
    } else if (tn === 'ZodNullable') {
      optional = true
      if (d.innerType) { cur = d.innerType; continue }
    } else if (tn === 'ZodDefault') {
      hasDefault = true
      const dv = d.defaultValue
      defaultValue = typeof dv === 'function' ? (dv as () => unknown)() : dv
      if (d.innerType) { cur = d.innerType; continue }
    } else if (tn === 'ZodEffects') {
      if (d.schema) { cur = d.schema; continue }
    }
    break
  }

  return { inner: cur, hasDefault, defaultValue, optional, description }
}

function classifyPrimitive(z: ZodTypeAny): ParamType {
  const tn = typeName(z)
  switch (tn) {
    case 'ZodString': return 'string'
    case 'ZodNumber':
    case 'ZodBigInt':
      return 'number'
    case 'ZodBoolean': return 'boolean'
    case 'ZodEnum':
    case 'ZodNativeEnum':
      return 'enum'
    case 'ZodLiteral': {
      const v = def(z).value
      if (typeof v === 'string') return 'string'
      if (typeof v === 'number') return 'number'
      if (typeof v === 'boolean') return 'boolean'
      return 'other'
    }
    default:
      return 'other'
  }
}

function enumValues(z: ZodTypeAny): string[] | undefined {
  const tn = typeName(z)
  if (tn === 'ZodEnum') {
    const v = def(z).values
    if (Array.isArray(v)) return v.map(String)
  }
  if (tn === 'ZodNativeEnum') {
    const v = def(z).values
    if (v && typeof v === 'object') {
      return Object.values(v as Record<string, unknown>).filter((x) => typeof x === 'string').map(String)
    }
  }
  return undefined
}

function getShape(z: ZodTypeAny): Record<string, ZodTypeAny> | undefined {
  const d = def(z)
  if (typeName(z) !== 'ZodObject') return undefined
  const raw = (z as ZodLike).shape
  if (raw && typeof raw === 'object') return raw
  const shapeFn = (d as unknown as { shape?: () => Record<string, ZodTypeAny> }).shape
  if (typeof shapeFn === 'function') return shapeFn()
  return undefined
}

export function extractParamSpec(schema: unknown): ParamSpec[] {
  if (!schema || typeof schema !== 'object') return []
  const outer = unwrap(schema as ZodTypeAny)
  const shape = getShape(outer.inner)
  if (!shape) return []

  const out: ParamSpec[] = []
  for (const [name, fieldSchema] of Object.entries(shape)) {
    const u = unwrap(fieldSchema)
    const spec: ParamSpec = {
      name,
      typeName: 'other',
      required: !u.optional && !u.hasDefault,
      hasDefault: u.hasDefault,
    }
    if (u.defaultValue !== undefined) spec.defaultValue = u.defaultValue
    if (u.description) spec.description = u.description

    if (typeName(u.inner) === 'ZodArray') {
      spec.typeName = 'array'
      const el = def(u.inner).type
      if (el) spec.arrayElement = classifyPrimitive(unwrap(el).inner)
    } else {
      spec.typeName = classifyPrimitive(u.inner)
      const ev = enumValues(u.inner)
      if (ev) spec.enumValues = ev
    }
    out.push(spec)
  }
  return out
}

export function formatType(spec: ParamSpec): string {
  if (spec.typeName === 'array') return `${spec.arrayElement ?? 'any'}[]`
  if (spec.typeName === 'enum' && spec.enumValues) return spec.enumValues.join('|')
  return spec.typeName
}
