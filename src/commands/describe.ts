import { loadWorkflow } from '../runner.ts'
import { extractParamSpec, formatType, type ParamSpec } from '../param-spec.ts'
import { extractDescription } from '../workflow-meta.ts'

export async function runDescribe(argv: string[]): Promise<void> {
  const [name] = argv
  if (!name) {
    process.stderr.write('Usage: browser-cli describe <name>\n')
    process.exit(2)
  }

  const out = await renderDescribe(name)
  process.stdout.write(out + '\n')
}

export async function renderDescribe(name: string): Promise<string> {
  const { mod, path } = await loadWorkflow(name)
  const spec = extractParamSpec(mod.schema)
  const description = extractDescription(path)
  return formatDescribe(name, description, spec)
}

export function formatDescribe(name: string, description: string, spec: ParamSpec[]): string {
  const lines: string[] = []
  const header = description ? `${name} — ${description}` : name
  lines.push(header)
  lines.push('')

  if (spec.length === 0) {
    lines.push('PARAMETERS')
    lines.push('  (none)')
  } else {
    lines.push(renderParamTable(spec))
  }

  lines.push('')
  lines.push('USAGE')
  lines.push(...renderUsageExamples(name, spec).map((l) => `  ${l}`))
  return lines.join('\n')
}

function renderParamTable(spec: ParamSpec[]): string {
  const rows = spec.map((s) => ({
    name: s.name,
    type: formatType(s),
    required: s.required ? 'yes' : 'no',
    default: s.hasDefault ? formatDefault(s.defaultValue) : '-',
    desc: s.description ?? '',
  }))

  const widths = {
    name: Math.max(4, ...rows.map((r) => r.name.length), 'PARAMETER'.length),
    type: Math.max(4, ...rows.map((r) => r.type.length), 'TYPE'.length),
    required: Math.max(3, ...rows.map((r) => r.required.length), 'REQUIRED'.length),
    default: Math.max(1, ...rows.map((r) => r.default.length), 'DEFAULT'.length),
  }

  const pad = (s: string, n: number) => s.padEnd(n)
  const header = `${pad('PARAMETER', widths.name)}  ${pad('TYPE', widths.type)}  ${pad('REQUIRED', widths.required)}  ${pad('DEFAULT', widths.default)}  DESCRIPTION`
  const sep = `${'-'.repeat(widths.name)}  ${'-'.repeat(widths.type)}  ${'-'.repeat(widths.required)}  ${'-'.repeat(widths.default)}  -----------`
  const body = rows.map((r) => `${pad(r.name, widths.name)}  ${pad(r.type, widths.type)}  ${pad(r.required, widths.required)}  ${pad(r.default, widths.default)}  ${r.desc}`)
  return [header, sep, ...body].join('\n')
}

function formatDefault(v: unknown): string {
  if (v === undefined) return '-'
  if (typeof v === 'string') return v
  try { return JSON.stringify(v) } catch { return String(v) }
}

function renderUsageExamples(name: string, spec: ParamSpec[]): string[] {
  if (spec.length === 0) return [`browser-cli run ${name}`]

  const sample = spec.map((s) => sampleValue(s))
  const positionalForm = `browser-cli run ${name} ${sample.map((v) => quoteIfNeeded(v)).join(' ')}`
  const namedForm = `browser-cli run ${name} ${spec.map((s, i) => `--${s.name} ${quoteIfNeeded(sample[i]!)}`).join(' ')}`
  const jsonObj: Record<string, unknown> = {}
  for (let i = 0; i < spec.length; i++) jsonObj[spec[i]!.name] = sampleValueTyped(spec[i]!, sample[i]!)
  const jsonForm = `browser-cli run ${name} '${JSON.stringify(jsonObj)}'`

  return [positionalForm, namedForm, jsonForm]
}

function sampleValue(spec: ParamSpec): string {
  if (spec.hasDefault && spec.defaultValue !== undefined) return String(spec.defaultValue)
  if (spec.typeName === 'enum' && spec.enumValues?.length) return spec.enumValues[0]!
  switch (spec.typeName) {
    case 'string': return `<${spec.name}>`
    case 'number': return '0'
    case 'boolean': return 'true'
    case 'array': return 'a,b'
    default: return `<${spec.name}>`
  }
}

function sampleValueTyped(spec: ParamSpec, raw: string): unknown {
  if (spec.typeName === 'number') return Number(raw) || 0
  if (spec.typeName === 'boolean') return raw === 'true'
  if (spec.typeName === 'array') return raw.split(',').map((s) => s.trim())
  return raw
}

function quoteIfNeeded(s: string): string {
  return /[\s"']/.test(s) ? JSON.stringify(s) : s
}
