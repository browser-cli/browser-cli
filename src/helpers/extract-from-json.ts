import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { CACHE_DIR } from '../paths.ts'
import { resolveLanguageModel } from '../stagehand-config.ts'

// Cached JSON path self-heal extractor. First call asks an LLM to infer a
// path map from JSON → schema; subsequent calls replay the cached paths with
// no LLM round-trip. On zod failure the cache is invalidated and we re-infer
// once, mirroring Stagehand's DOM-selector self-heal but for API responses.

export type PathMap = {
  __root?: string[]
  __arrayOf?: PathMap
  fields?: Record<string, PathMap | string[]>
}

export type InferPaths = (args: {
  json: unknown
  instruction: string
  schema: z.ZodTypeAny
}) => Promise<PathMap>

export type ExtractFromJsonOpts = {
  /** Override cache directory (useful in tests). Defaults to CACHE_DIR/extract-json. */
  cacheDir?: string
  /** Override the path-inference LLM call (useful in tests). */
  inferPaths?: InferPaths
}

const CACHE_FILE_VERSION = 1

type CacheFile = {
  version: number
  map: PathMap
  createdAt: number
}

// ---------------------------------------------------------------------------
// Walker
// ---------------------------------------------------------------------------

/**
 * Apply a PathMap to a JSON document. Returns `undefined` for missing paths
 * (never throws); the caller is expected to zod-validate the result.
 */
export function applyPathMap(json: unknown, map: PathMap | string[]): unknown {
  // Leaf: a raw path array.
  if (Array.isArray(map)) {
    return walkPath(json, map)
  }

  let scope: unknown = json

  if (map.__root && map.__root.length > 0) {
    scope = walkPath(scope, map.__root)
    if (scope === undefined) return undefined
  }

  if (map.__arrayOf) {
    if (!Array.isArray(scope)) return undefined
    const child = map.__arrayOf
    return scope.map((elem) => applyPathMap(elem, child))
  }

  if (map.fields) {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(map.fields)) {
      out[key] = applyPathMap(scope, map.fields[key])
    }
    return out
  }

  // PathMap with only __root applied, no __arrayOf/fields: return the scope.
  return scope
}

function walkPath(value: unknown, path: string[]): unknown {
  let cur: unknown = value
  for (const segRaw of path) {
    if (cur === null || cur === undefined) return undefined
    // Numeric-string index into arrays (LLM may emit these).
    if (Array.isArray(cur)) {
      if (!/^\d+$/.test(segRaw)) return undefined
      const idx = Number(segRaw)
      cur = cur[idx]
      continue
    }
    if (typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[segRaw]
  }
  return cur
}

// ---------------------------------------------------------------------------
// Cache key
// ---------------------------------------------------------------------------

/**
 * Produce a stable string describing a zod schema's shape. Same shape produces
 * same key regardless of property-declaration order.
 */
export function canonicalizeSchema(schema: z.ZodTypeAny): string {
  const def = (schema as unknown as { _def: { typeName?: string } })._def
  const typeName = def?.typeName ?? 'Unknown'

  switch (typeName) {
    case 'ZodString':
      return 'string'
    case 'ZodNumber':
      return 'number'
    case 'ZodBoolean':
      return 'boolean'
    case 'ZodNull':
      return 'null'
    case 'ZodUndefined':
      return 'undefined'
    case 'ZodAny':
      return 'any'
    case 'ZodUnknown':
      return 'unknown'
    case 'ZodDate':
      return 'date'
    case 'ZodObject': {
      const shape = (schema as unknown as { shape: Record<string, z.ZodTypeAny> }).shape
      const keys = Object.keys(shape).sort()
      const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalizeSchema(shape[k])}`)
      return `object({${parts.join(',')}})`
    }
    case 'ZodArray': {
      const inner = (def as unknown as { type: z.ZodTypeAny }).type
      return `array(${canonicalizeSchema(inner)})`
    }
    case 'ZodNullable': {
      const inner = (def as unknown as { innerType: z.ZodTypeAny }).innerType
      return `nullable(${canonicalizeSchema(inner)})`
    }
    case 'ZodOptional': {
      const inner = (def as unknown as { innerType: z.ZodTypeAny }).innerType
      return `optional(${canonicalizeSchema(inner)})`
    }
    case 'ZodUnion': {
      const options = (def as unknown as { options: z.ZodTypeAny[] }).options
      const parts = options.map((o) => canonicalizeSchema(o)).sort()
      return `union(${parts.join('|')})`
    }
    case 'ZodLiteral': {
      const value = (def as unknown as { value: unknown }).value
      return `literal(${JSON.stringify(value)})`
    }
    case 'ZodEnum': {
      const values = (def as unknown as { values: string[] }).values
      return `enum(${[...values].sort().join(',')})`
    }
    case 'ZodRecord': {
      const valueType = (def as unknown as { valueType?: z.ZodTypeAny }).valueType
      return `record(${valueType ? canonicalizeSchema(valueType) : 'any'})`
    }
    case 'ZodTuple': {
      const items = (def as unknown as { items: z.ZodTypeAny[] }).items
      return `tuple(${items.map((i) => canonicalizeSchema(i)).join(',')})`
    }
    default:
      return typeName
  }
}

function cacheKey(instruction: string, schema: z.ZodTypeAny): string {
  const canon = canonicalizeSchema(schema)
  return crypto.createHash('sha256').update(instruction).update('\u0000').update(canon).digest('hex')
}

// ---------------------------------------------------------------------------
// Cache IO
// ---------------------------------------------------------------------------

function readCache(cachePath: string): CacheFile | null {
  try {
    const raw = fs.readFileSync(cachePath, 'utf8')
    const parsed = JSON.parse(raw) as CacheFile
    if (!parsed || parsed.version !== CACHE_FILE_VERSION || !parsed.map) return null
    return parsed
  } catch {
    return null
  }
}

function writeCache(cachePath: string, map: PathMap): void {
  fs.mkdirSync(path.dirname(cachePath), { recursive: true })
  const file: CacheFile = { version: CACHE_FILE_VERSION, map, createdAt: Date.now() }
  fs.writeFileSync(cachePath, JSON.stringify(file, null, 2), 'utf8')
}

function tryUnlink(p: string): void {
  try {
    fs.unlinkSync(p)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      // Non-missing error — log but don't blow up the workflow.
      process.stderr.write(`extractFromJson: failed to unlink ${p}: ${(err as Error).message}\n`)
    }
  }
}

// ---------------------------------------------------------------------------
// Default LLM inference
// ---------------------------------------------------------------------------

const PATH_MAP_META_SCHEMA = {
  type: 'object',
  properties: {
    __root: { type: 'array', items: { type: 'string' } },
    __arrayOf: { $ref: '#' },
    fields: {
      type: 'object',
      additionalProperties: {
        oneOf: [{ $ref: '#' }, { type: 'array', items: { type: 'string' } }],
      },
    },
  },
  additionalProperties: false,
}

export const defaultInferPaths: InferPaths = async ({ json, instruction, schema }) => {
  const model = await resolveLanguageModel()
  if (!model) {
    throw new Error(
      'extractFromJson: no LanguageModelV2-backed provider configured. ' +
        'Run `browser-cli config` or set LLM_PROVIDER (claude-agent-sdk / codex / opencode) or LLM_API_KEY+LLM_BASE_URL+LLM_MODEL. ' +
        'OPENAI_API_KEY / ANTHROPIC_API_KEY alone are not supported for the JSON path-inference step.',
    )
  }
  const jsonSample = JSON.stringify(json).slice(0, 6000)
  const jsonSchemaRendered = JSON.stringify(zodToJsonSchema(schema), null, 2)

  const promptText = `You are given a JSON sample and a target schema. Produce a "path map" that
describes how to extract values matching the schema from the JSON.

Output ONLY a JSON object matching this meta-schema:
  {
    "__root"?: string[],                         // applied before descending
    "__arrayOf"?: <PathMap recursively>,         // if present, current scope maps an array
    "fields"?: { [key: string]: <PathMap or string[]> }  // leaves are string[] paths
  }

Rules:
- Leaf values: provide a string[] path of object keys from the current scope.
- Array of keys, e.g. ["data", "user", "name"] — NOT dotted strings, NOT JSONPath expressions.
- For arrays, use __arrayOf and express element-relative paths inside it.
- Array indices (when needed) are numeric strings like "0", "1".
- __root applies to the current scope before descending into fields or __arrayOf.
- Do NOT invent paths for fields missing from the sample. Omit them.
- Do NOT include \`\`\`json\`\`\` fences, no prose. Return the JSON object only.

USER INSTRUCTION:
${instruction}

SAMPLE JSON (truncated to 6KB):
${jsonSample}

TARGET SCHEMA (as JSON Schema):
${jsonSchemaRendered}
`

  const result = await model.doGenerate({
    prompt: [{ role: 'user', content: [{ type: 'text', text: promptText }] }],
    responseFormat: { type: 'json', schema: PATH_MAP_META_SCHEMA },
  } as unknown as Parameters<typeof model.doGenerate>[0])

  const first = result.content[0]
  if (!first || first.type !== 'text') {
    throw new Error('extractFromJson: LLM returned no text content for path inference.')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(first.text)
  } catch (err) {
    throw new Error(`extractFromJson: LLM returned non-JSON content for path inference: ${(err as Error).message}`)
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('extractFromJson: LLM returned a non-object path map.')
  }
  return parsed as PathMap
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function extractFromJson<T extends z.ZodTypeAny>(
  json: unknown,
  instruction: string,
  schema: T,
  opts: ExtractFromJsonOpts = {},
): Promise<z.infer<T>> {
  const cacheDir = opts.cacheDir ?? path.join(CACHE_DIR, 'extract-json')
  const key = cacheKey(instruction, schema)
  const cachePath = path.join(cacheDir, `${key}.json`)

  const cached = readCache(cachePath)
  if (cached) {
    const extracted = applyPathMap(json, cached.map)
    const parsed = schema.safeParse(extracted)
    if (parsed.success) return parsed.data as z.infer<T>
    // Bad cache — wipe and re-infer.
    tryUnlink(cachePath)
  }

  const inferPaths = opts.inferPaths ?? defaultInferPaths
  const map = await inferPaths({ json, instruction, schema })
  writeCache(cachePath, map)

  const extracted = applyPathMap(json, map)
  const parsed = schema.safeParse(extracted)
  if (!parsed.success) {
    // Freshly-inferred map didn't even satisfy zod — don't keep it around.
    tryUnlink(cachePath)
    throw new Error(
      `extractFromJson: path inference returned a map that did not produce a valid schema match. Zod errors: ${JSON.stringify(parsed.error.issues)}`,
    )
  }
  return parsed.data as z.infer<T>
}
