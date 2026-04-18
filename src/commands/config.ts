import fs from 'node:fs'
import readline from 'node:readline'
import { ENV_FILE, ensureHomeDirs } from '../paths.ts'

const LLM_KEYS = [
  'LLM_PROVIDER',
  'LLM_API_KEY',
  'LLM_BASE_URL',
  'LLM_MODEL',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
] as const

type EnvMap = Map<string, string>

type LineReader = {
  next(): Promise<string | undefined>
  close(): void
}

function createLineReader(): LineReader {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
    terminal: process.stdin.isTTY ?? false,
  })
  const iter = rl[Symbol.asyncIterator]()
  return {
    async next() {
      const r = await iter.next()
      return r.done ? undefined : r.value
    },
    close() {
      rl.close()
    },
  }
}

export async function runConfig(argv: string[]): Promise<void> {
  ensureHomeDirs()
  const existing = readEnv(ENV_FILE)

  const providerArg = parseProviderFlag(argv)
  const reader = createLineReader()

  try {
    const provider = providerArg ?? (await askProvider(reader, existing))
    if (provider === null) {
      process.stderr.write('Cancelled.\n')
      return
    }

    clearLlmKeys(existing)

    if (provider === 'claude-agent-sdk') {
      existing.set('LLM_PROVIDER', 'claude-agent-sdk')
      const modelHint = await askOptional(reader, 'LLM_MODEL (optional model hint, e.g. claude-sonnet-4-5)', '')
      if (modelHint) existing.set('LLM_MODEL', modelHint)
    } else if (provider === 'openai-compat') {
      const baseUrl = await askRequired(reader, 'LLM_BASE_URL', 'https://api.openai.com/v1')
      const model = await askRequired(reader, 'LLM_MODEL', 'openai/gpt-4o-mini')
      const apiKey = await askRequired(reader, 'LLM_API_KEY', '')
      existing.set('LLM_BASE_URL', baseUrl)
      existing.set('LLM_MODEL', model)
      existing.set('LLM_API_KEY', apiKey)
    } else {
      throw new Error(`Unknown provider: ${String(provider)}`)
    }

    writeEnv(ENV_FILE, existing)
    process.stderr.write(
      `\n✓ Wrote ${ENV_FILE}\n` +
        `  Active provider: ${provider}\n` +
        (provider === 'claude-agent-sdk'
          ? `  Note: each LLM call spawns a Claude Code subprocess (~6-10s/call). Make sure \`claude\` is authenticated.\n`
          : `  Note: LLM_API_KEY is stored in plaintext — keep ~/.browser-cli/.env out of version control.\n`),
    )
  } finally {
    reader.close()
  }
}

function parseProviderFlag(argv: string[]): 'claude-agent-sdk' | 'openai-compat' | null {
  const idx = argv.indexOf('--provider')
  if (idx === -1) return null
  const v = argv[idx + 1]
  if (v === 'claude-agent-sdk' || v === 'openai-compat') return v
  throw new Error(`--provider must be one of: claude-agent-sdk, openai-compat (got: ${v ?? 'missing'})`)
}

async function askProvider(
  reader: LineReader,
  existing: EnvMap,
): Promise<'claude-agent-sdk' | 'openai-compat' | null> {
  const current = existing.get('LLM_PROVIDER') || (existing.has('LLM_API_KEY') ? 'openai-compat (inferred)' : 'none')
  process.stderr.write(
    [
      '',
      `Current LLM provider: ${current}`,
      '',
      'Choose LLM provider:',
      '  1) claude-agent-sdk   — use your logged-in Claude Code subscription (6-10s/call, free on Max)',
      '  2) openai-compat      — any OpenAI-compatible endpoint (gateway, ollama, vllm, OpenAI itself)',
      '  3) cancel',
      '',
    ].join('\n'),
  )
  process.stderr.write('> ')
  const ans = ((await reader.next()) ?? '').trim()
  if (ans === '1' || ans === 'claude-agent-sdk') return 'claude-agent-sdk'
  if (ans === '2' || ans === 'openai-compat') return 'openai-compat'
  return null
}

async function askRequired(reader: LineReader, key: string, defaultValue: string): Promise<string> {
  const suffix = defaultValue ? ` [${defaultValue}]` : ''
  while (true) {
    process.stderr.write(`${key}${suffix}: `)
    const raw = await reader.next()
    const ans = (raw ?? '').trim()
    if (ans) return ans
    if (defaultValue) return defaultValue
    if (raw === undefined) throw new Error(`${key} is required (stdin closed without input)`)
    process.stderr.write(`  ${key} is required.\n`)
  }
}

async function askOptional(reader: LineReader, key: string, defaultValue: string): Promise<string> {
  const suffix = defaultValue ? ` [${defaultValue}]` : ' (optional, enter to skip)'
  process.stderr.write(`${key}${suffix}: `)
  const ans = ((await reader.next()) ?? '').trim()
  return ans || defaultValue
}

function clearLlmKeys(env: EnvMap): void {
  for (const k of LLM_KEYS) env.delete(k)
}

function readEnv(path: string): EnvMap {
  const out: EnvMap = new Map()
  if (!fs.existsSync(path)) return out
  const content = fs.readFileSync(path, 'utf8')
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const k = trimmed.slice(0, eq).trim()
    let v = trimmed.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    if (k) out.set(k, v)
  }
  return out
}

function writeEnv(path: string, env: EnvMap): void {
  const lines = ['# Managed by `browser-cli config`. Edit by hand if you prefer.']
  for (const [k, v] of env) {
    const needsQuotes = /[\s#"']/.test(v)
    const value = needsQuotes ? `"${v.replace(/"/g, '\\"')}"` : v
    lines.push(`${k}=${value}`)
  }
  const tmp = `${path}.tmp`
  fs.writeFileSync(tmp, lines.join('\n') + '\n', { mode: 0o600 })
  fs.renameSync(tmp, path)
  try {
    fs.chmodSync(path, 0o600)
  } catch {
  }
}
