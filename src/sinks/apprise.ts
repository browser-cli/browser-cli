import { spawn, spawnSync } from 'node:child_process'

let cachedAvailable: boolean | null = null
let missingWarned = false

export function isAppriseAvailable(): boolean {
  if (cachedAvailable !== null) return cachedAvailable
  try {
    const r = spawnSync('apprise', ['--version'], { stdio: 'ignore' })
    cachedAvailable = r.status === 0
  } catch {
    cachedAvailable = false
  }
  return cachedAvailable
}

export function warnIfAppriseMissing(): void {
  if (isAppriseAvailable() || missingWarned) return
  missingWarned = true
  process.stderr.write(
    'warning: `apprise` CLI not found on PATH. Notifications will be skipped.\n' +
      '         Install with: pipx install apprise  (or `brew install apprise`)\n',
  )
}

export async function sendApprise(
  urls: string[],
  title: string,
  body: string,
): Promise<{ ok: boolean; code: number | null; stderr: string }> {
  if (urls.length === 0) return { ok: true, code: 0, stderr: '' }
  if (!isAppriseAvailable()) {
    warnIfAppriseMissing()
    return { ok: false, code: null, stderr: 'apprise not installed' }
  }

  const args = ['-t', title, '-b', body, ...urls]

  return await new Promise((resolve) => {
    const child = spawn('apprise', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('close', (code) => {
      resolve({ ok: code === 0, code, stderr })
    })
    child.on('error', (err) => {
      resolve({ ok: false, code: null, stderr: err.message })
    })
  })
}
