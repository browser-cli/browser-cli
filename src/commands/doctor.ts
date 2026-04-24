import fs from 'node:fs'
import {
  CHROME_EXT_URL,
  RELAY_HEALTH_URL,
  detectPlaywriterVersion,
  isRelayReachable,
} from '../preflight.ts'
import { isAppriseAvailable } from '../sinks/apprise.ts'
import { isUserRepoInit } from '../git/userRepo.ts'
import { HOME_DIR, loadDotEnv } from '../paths.ts'

const INSTALL_DOC = 'https://browser-cli.zerith.app/en/install/'
const NODE_MIN_MAJOR = 22
const NODE_MIN_MINOR = 18

type Check = {
  label: 'ok' | 'missing' | 'warn'
  line: string
  hint?: string
}

export async function runDoctor(_argv: string[] = []): Promise<void> {
  loadDotEnv()

  const checks: Check[] = []

  checks.push(checkNode())
  checks.push(await checkPlaywriter())
  checks.push(await checkRelay())
  checks.push(checkApprise())
  checks.push(checkLlmCreds())
  checks.push(checkHomeDir())

  for (const c of checks) {
    process.stdout.write(formatCheck(c))
  }

  const missing = checks.filter((c) => c.label === 'missing').length
  const warn = checks.filter((c) => c.label === 'warn').length

  process.stdout.write('\n')
  if (missing === 0 && warn === 0) {
    process.stdout.write(`All checks passed. Install docs: ${INSTALL_DOC}\n`)
  } else {
    process.stdout.write(
      `${missing} missing, ${warn} warning${warn === 1 ? '' : 's'}.\n` +
        `Docs: ${INSTALL_DOC}\n` +
        `If you're using an LLM assistant, paste this output and ask it to guide you through install.\n`,
    )
  }
}

function formatCheck(c: Check): string {
  const tag = c.label === 'ok' ? '[ok]     ' : c.label === 'warn' ? '[warn]   ' : '[missing]'
  const out = `${tag} ${c.line}\n`
  if (c.hint) return out + `          → ${c.hint}\n`
  return out
}

function checkNode(): Check {
  const v = process.version.replace(/^v/, '')
  const [maj, min] = v.split('.').map((x) => parseInt(x, 10))
  const ok =
    (maj ?? 0) > NODE_MIN_MAJOR ||
    ((maj ?? 0) === NODE_MIN_MAJOR && (min ?? 0) >= NODE_MIN_MINOR)
  if (ok) return { label: 'ok', line: `Node ${v}` }
  return {
    label: 'missing',
    line: `Node ${v} — need >= ${NODE_MIN_MAJOR}.${NODE_MIN_MINOR}`,
    hint: `${INSTALL_DOC}#base-install`,
  }
}

async function checkPlaywriter(): Promise<Check> {
  const version = await detectPlaywriterVersion()
  if (version) return { label: 'ok', line: `playwriter ${version}` }
  return {
    label: 'missing',
    line: `playwriter CLI not on PATH — required to drive your Chrome`,
    hint: `${INSTALL_DOC}#base-install`,
  }
}

async function checkRelay(): Promise<Check> {
  const up = await isRelayReachable()
  if (up) return { label: 'ok', line: `relay ${RELAY_HEALTH_URL}` }
  return {
    label: 'missing',
    line: `relay ${RELAY_HEALTH_URL} unreachable — run \`playwriter serve --replace\` and install the Chrome extension`,
    hint: `${CHROME_EXT_URL}`,
  }
}

function checkApprise(): Check {
  if (isAppriseAvailable()) return { label: 'ok', line: 'apprise CLI' }
  return {
    label: 'warn',
    line: 'apprise CLI — optional, needed to send notifications',
    hint: `${INSTALL_DOC}#notifications`,
  }
}

function checkLlmCreds(): Check {
  const src = resolveLlmSource()
  if (src) return { label: 'ok', line: `LLM creds (${src})` }
  return {
    label: 'missing',
    line: 'LLM creds — run `browser-cli config`',
    hint: `${INSTALL_DOC}#llm-provider`,
  }
}

function resolveLlmSource(): string | null {
  const e = process.env
  if (e.LLM_PROVIDER === 'claude-agent-sdk') return 'claude-agent-sdk'
  if (e.LLM_API_KEY && e.LLM_BASE_URL && e.LLM_MODEL) return `${e.LLM_BASE_URL} (${e.LLM_MODEL})`
  if (e.OPENAI_API_KEY) return 'OPENAI_API_KEY'
  if (e.ANTHROPIC_API_KEY) return 'ANTHROPIC_API_KEY'
  return null
}

function checkHomeDir(): Check {
  if (!fs.existsSync(HOME_DIR)) {
    return {
      label: 'missing',
      line: `home ${HOME_DIR} does not exist — run \`browser-cli init\``,
    }
  }
  if (!isUserRepoInit()) {
    return {
      label: 'warn',
      line: `home ${HOME_DIR} is not a git repo — run \`browser-cli init\` to enable history`,
    }
  }
  return { label: 'ok', line: `home ${HOME_DIR}` }
}
