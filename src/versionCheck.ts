import fs from 'node:fs'
import path from 'node:path'
import { CACHE_DIR, PACKAGE_ROOT } from './paths.ts'

const PACKAGE_NAME = '@browserclijs/browser-cli'
const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`
const CACHE_FILE = path.join(CACHE_DIR, 'version-check.json')
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 1500

const SKIP_COMMANDS = new Set(['daemon', '--help', '-h', '--version', '-v'])

interface VersionCache {
  latestVersion?: string
  lastCheckedAt?: number
}

export function checkForUpdate(cmd: string | undefined): void {
  if (process.env.BROWSER_CLI_NO_UPDATE_CHECK === '1') return
  if (!process.stderr.isTTY) return
  if (!cmd || SKIP_COMMANDS.has(cmd)) return

  const current = getCurrentVersion()
  if (!current) return

  const cache = readCache()

  if (cache.latestVersion && compareVersions(cache.latestVersion, current) > 0) {
    const latest = cache.latestVersion
    process.on('exit', () => {
      process.stderr.write(
        `\n\u001b[33m→ browser-cli ${latest} is available (current ${current}).\u001b[0m\n` +
          `  Run: npm install -g ${PACKAGE_NAME}@latest\n`,
      )
    })
  }

  const stale = !cache.lastCheckedAt || Date.now() - cache.lastCheckedAt > CHECK_INTERVAL_MS
  if (stale) {
    void refreshLatestInBackground()
  }
}

function getCurrentVersion(): string | null {
  try {
    const raw = fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')
    const pkg = JSON.parse(raw) as { version?: unknown }
    return typeof pkg.version === 'string' ? pkg.version : null
  } catch {
    return null
  }
}

function readCache(): VersionCache {
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8')
    const parsed = JSON.parse(raw) as VersionCache
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeCache(cache: VersionCache): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true })
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache))
  } catch {
  }
}

// Numeric compare for plain MAJOR.MINOR.PATCH. Returns 1 if a > b, -1 if a < b, 0 if equal.
// Anything that doesn't parse as a number falls through as 0, which makes unknown formats
// compare equal — safer than crashing or claiming an upgrade exists.
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((s) => Number.parseInt(s, 10))
  const pb = b.split('.').map((s) => Number.parseInt(s, 10))
  for (let i = 0; i < 3; i++) {
    const da = Number.isFinite(pa[i]) ? pa[i] : 0
    const db = Number.isFinite(pb[i]) ? pb[i] : 0
    if (da > db) return 1
    if (da < db) return -1
  }
  return 0
}

async function refreshLatestInBackground(): Promise<void> {
  try {
    const res = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!res.ok) return
    const json = (await res.json()) as { version?: unknown }
    if (typeof json.version !== 'string') return
    writeCache({ latestVersion: json.version, lastCheckedAt: Date.now() })
  } catch {
  }
}
