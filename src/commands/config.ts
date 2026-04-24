import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
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

type ProviderName = 'claude-agent-sdk' | 'codex' | 'opencode' | 'openai-compat'

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
  const modelArg = parseModelFlag(argv)
  const yesArg = argv.includes('--yes') || argv.includes('-y')
  const nonInteractive = !process.stdin.isTTY

  // When provider is given via --provider for one of the agent SDK paths AND
  // (a) --model is given, OR (b) stdin is not a TTY, OR (c) --yes is passed,
  // we treat the run as fully non-interactive and skip all prompts. This lets
  // a code-agent (Claude Code / Codex / opencode) self-configure browser-cli
  // without any tty tricks — see docs/.../install.md "Self-configure" section.
  const autoNonInteractive = providerArg !== null && (modelArg !== null || nonInteractive || yesArg)

  const reader = autoNonInteractive ? null : createLineReader()

  try {
    const provider = providerArg ?? (await askProvider(reader!, existing))
    if (provider === null) {
      process.stderr.write('Cancelled.\n')
      return
    }

    clearLlmKeys(existing)

    if (provider === 'claude-agent-sdk' || provider === 'codex' || provider === 'opencode') {
      existing.set('LLM_PROVIDER', provider)
      const model = modelArg ?? (autoNonInteractive ? '' : await askOptionalModel(reader!, provider))
      if (model) existing.set('LLM_MODEL', model)
    } else if (provider === 'openai-compat') {
      // openai-compat needs secrets (LLM_API_KEY) that can't be inferred from
      // any local code-agent login, so we always prompt unless every field is
      // supplied via flags.
      if (autoNonInteractive && modelArg && hasFlag(argv, '--base-url') && hasFlag(argv, '--api-key')) {
        existing.set('LLM_BASE_URL', getFlag(argv, '--base-url')!)
        existing.set('LLM_MODEL', modelArg)
        existing.set('LLM_API_KEY', getFlag(argv, '--api-key')!)
      } else {
        if (!reader) throw new Error('openai-compat requires interactive stdin or --base-url/--model/--api-key flags')
        const baseUrl = await askRequired(reader, 'LLM_BASE_URL', 'https://api.openai.com/v1')
        const model = await askRequired(reader, 'LLM_MODEL', 'openai/gpt-4o-mini')
        const apiKey = await askRequired(reader, 'LLM_API_KEY', '')
        existing.set('LLM_BASE_URL', baseUrl)
        existing.set('LLM_MODEL', model)
        existing.set('LLM_API_KEY', apiKey)
      }
    } else {
      throw new Error(`Unknown provider: ${String(provider)}`)
    }

    writeEnv(ENV_FILE, existing)
    process.stderr.write(
      `\n✓ Wrote ${ENV_FILE}\n` +
        `  Active provider: ${provider}\n` +
        (existing.get('LLM_MODEL') ? `  LLM_MODEL: ${existing.get('LLM_MODEL')}\n` : '') +
        providerNote(provider),
    )
  } finally {
    reader?.close()
  }
}

async function askOptionalModel(reader: LineReader, provider: ProviderName): Promise<string> {
  switch (provider) {
    case 'claude-agent-sdk':
      return askOptional(reader, 'LLM_MODEL (optional model hint, e.g. claude-sonnet-4-5)', '')
    case 'codex':
      return askOptional(reader, 'LLM_MODEL (optional, overrides ~/.codex/config.toml)', '')
    case 'opencode':
      return askOptional(
        reader,
        'LLM_MODEL (optional, format: provider/model — e.g. anthropic/claude-sonnet-4-5)',
        '',
      )
    case 'openai-compat':
      return ''
  }
}

function providerNote(provider: ProviderName): string {
  switch (provider) {
    case 'claude-agent-sdk':
      return '  Note: each LLM call spawns a Claude Code subprocess (~6-10s/call). Make sure `claude` is authenticated.\n'
    case 'codex':
      return '  Note: uses `@openai/codex-sdk` to spawn `codex` for each call (~2-5s/call). Make sure you ran `codex login` or have OPENAI_API_KEY set.\n'
    case 'opencode':
      return '  Note: uses `@opencode-ai/sdk` — first call boots a local opencode server (~2-3s), subsequent calls are fast. Make sure ~/.config/opencode/opencode.json has a provider configured.\n'
    case 'openai-compat':
      return `  Note: LLM_API_KEY is stored in plaintext — keep ${ENV_FILE} out of version control.\n`
  }
}

function parseProviderFlag(argv: string[]): ProviderName | null {
  const idx = argv.indexOf('--provider')
  if (idx === -1) return null
  const v = argv[idx + 1]
  if (v === 'claude-agent-sdk' || v === 'codex' || v === 'opencode' || v === 'openai-compat') return v
  throw new Error(
    `--provider must be one of: claude-agent-sdk, codex, opencode, openai-compat (got: ${v ?? 'missing'})`,
  )
}

function parseModelFlag(argv: string[]): string | null {
  return getFlag(argv, '--model')
}

function hasFlag(argv: string[], name: string): boolean {
  return getFlag(argv, name) !== null
}

function getFlag(argv: string[], name: string): string | null {
  const idx = argv.indexOf(name)
  if (idx === -1) return null
  const v = argv[idx + 1]
  if (v === undefined || v.startsWith('--')) {
    throw new Error(`${name} requires a value`)
  }
  return v
}

async function askProvider(reader: LineReader, existing: EnvMap): Promise<ProviderName | null> {
  const current = existing.get('LLM_PROVIDER') || (existing.has('LLM_API_KEY') ? 'openai-compat (inferred)' : 'none')
  const detected = detectInstalledAgents()
  const detectedLine = detected.length
    ? `Detected local code-agent configs: ${detected.join(', ')}`
    : 'No local code-agent configs detected in ~/.claude, ~/.codex, ~/.config/opencode.'
  process.stderr.write(
    [
      '',
      `Current LLM provider: ${current}`,
      detectedLine,
      '',
      'Choose LLM provider:',
      '  1) claude-agent-sdk   — use your logged-in Claude Code subscription (6-10s/call, free on Max)',
      '  2) codex              — use your Codex CLI login (ChatGPT subscription or OPENAI_API_KEY)',
      '  3) opencode           — use your opencode.json config (multi-provider)',
      '  4) openai-compat      — any OpenAI-compatible endpoint (gateway, ollama, vllm, OpenAI itself)',
      '  5) cancel',
      '',
    ].join('\n'),
  )
  process.stderr.write('> ')
  const ans = ((await reader.next()) ?? '').trim()
  if (ans === '1' || ans === 'claude-agent-sdk') return 'claude-agent-sdk'
  if (ans === '2' || ans === 'codex') return 'codex'
  if (ans === '3' || ans === 'opencode') return 'opencode'
  if (ans === '4' || ans === 'openai-compat') return 'openai-compat'
  return null
}

function detectInstalledAgents(): string[] {
  const home = os.homedir()
  const found: string[] = []
  const checks: Array<[string, string]> = [
    [path.join(home, '.claude'), 'claude-agent-sdk'],
    [path.join(home, '.codex', 'auth.json'), 'codex'],
    [path.join(home, '.codex', 'config.toml'), 'codex'],
    [path.join(home, '.config', 'opencode', 'opencode.json'), 'opencode'],
    [path.join(home, '.opencode'), 'opencode'],
  ]
  const seen = new Set<string>()
  for (const [p, name] of checks) {
    if (!seen.has(name) && fs.existsSync(p)) {
      found.push(name)
      seen.add(name)
    }
  }
  return found
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
