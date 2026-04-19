import { execa, ExecaError } from 'execa'
import readline from 'node:readline/promises'
import { PLAYWRITER_CDP_HOST } from './stagehand-config.ts'

const RELAY_HEALTH_URL = `http://${PLAYWRITER_CDP_HOST}/`
const CHROME_EXT_URL = 'https://playwriter.dev/'

export async function ensurePlaywriter(): Promise<void> {
  if (await isRelayReachable()) return

  const version = await detectPlaywriterVersion()
  if (version !== null) {
    printRelayDownHelp(version)
    process.exit(1)
  }

  const ok = await promptInstall()
  if (!ok) {
    process.stderr.write('Aborted. Install playwriter manually and re-run.\n')
    process.exit(1)
  }

  const installed = await tryInstallPlaywriter()
  if (!installed) {
    process.stderr.write('\nAutomatic install unavailable in this environment.\n')
    printManualInstallHelp()
    process.exit(1)
  }

  printRelayDownHelp(installed)
  process.exit(1)
}

async function isRelayReachable(): Promise<boolean> {
  try {
    const res = await fetch(RELAY_HEALTH_URL, {
      signal: AbortSignal.timeout(800),
    })
    return res.status === 200
  } catch {
    return false
  }
}

function toHttpProbe(cdpUrl: string): string {
  const u = new URL(cdpUrl)
  const httpProto =
    u.protocol === 'wss:' ? 'https:' : u.protocol === 'ws:' ? 'http:' : u.protocol
  return `${httpProto}//${u.host}/json/version`
}

export async function ensureCustomCdpReachable(cdpUrl: string): Promise<void> {
  const probe = toHttpProbe(cdpUrl)
  try {
    const res = await fetch(probe, { signal: AbortSignal.timeout(1500) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  } catch (err) {
    process.stderr.write(
      [
        '',
        `Cannot reach CDP endpoint at ${cdpUrl}`,
        `  Probe: GET ${probe} -> ${(err as Error).message}`,
        '',
        'Checks:',
        '  1) Is your fingerprint browser running with remote-debugging exposed?',
        `  2) Verify with:  curl ${new URL(probe).origin}/json/version`,
        '',
      ].join('\n'),
    )
    process.exit(1)
  }
}

async function detectPlaywriterVersion(): Promise<string | null> {
  try {
    const { stdout } = await execa('playwriter', ['--version'], { timeout: 3000 })
    return stdout.trim() || 'unknown'
  } catch (err) {
    if (err instanceof ExecaError && (err.code === 'ENOENT' || err.exitCode !== 0)) return null
    return null
  }
}

function detectPackageManager(): 'pnpm' | 'yarn' | 'npm' | 'unknown' {
  if (process.env.VOLTA_HOME) return 'unknown'
  const ua = process.env.npm_config_user_agent ?? ''
  if (ua.startsWith('pnpm')) return 'pnpm'
  if (ua.startsWith('yarn')) return 'yarn'
  if (ua.startsWith('npm')) return 'npm'
  return 'npm'
}

function installCommand(pm: ReturnType<typeof detectPackageManager>): string {
  switch (pm) {
    case 'pnpm':
      return 'pnpm add -g playwriter@latest'
    case 'yarn':
      return 'yarn global add playwriter'
    case 'npm':
      return 'npm install -g playwriter@latest'
    case 'unknown':
      return 'npm install -g playwriter@latest   # or your preferred package manager'
  }
}

async function promptInstall(): Promise<boolean> {
  if (!process.stdin.isTTY) {
    process.stderr.write(
      'playwriter not installed and stdin is not a TTY; cannot prompt. Install manually:\n',
    )
    printManualInstallHelp()
    return false
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
  try {
    const ans = await rl.question('playwriter not installed. Install it now? [Y/n] ')
    return /^(y(es)?)?$/i.test(ans.trim())
  } finally {
    rl.close()
  }
}

async function tryInstallPlaywriter(): Promise<string | null> {
  const pm = detectPackageManager()
  if (pm === 'unknown') return null

  const cmd = installCommand(pm).split(/\s+/)
  process.stderr.write(`\nRunning: ${cmd.join(' ')}\n`)
  try {
    await execa(cmd[0]!, cmd.slice(1), { stdio: 'inherit' })
  } catch {
    return null
  }
  return detectPlaywriterVersion()
}

function printRelayDownHelp(version: string): void {
  process.stderr.write(
    [
      '',
      `playwriter ${version} is installed but the relay is not running at ${RELAY_HEALTH_URL}.`,
      '',
      'Next steps:',
      '  1) Start the relay in another terminal:   playwriter serve --replace',
      `  2) Install the Chrome extension:          ${CHROME_EXT_URL}`,
      '  3) Open Chrome, click the extension icon (it turns green when connected).',
      '  4) Re-run your browser-cli command.',
      '',
    ].join('\n'),
  )
}

function printManualInstallHelp(): void {
  const pm = detectPackageManager()
  process.stderr.write(
    [
      '',
      'Install playwriter manually:',
      `  ${installCommand(pm)}`,
      '',
      `Then install the Chrome extension at ${CHROME_EXT_URL} and run:`,
      '  playwriter serve --replace',
      '',
    ].join('\n'),
  )
}
