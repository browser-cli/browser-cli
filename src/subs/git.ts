import { spawnSync } from 'node:child_process'

function run(args: string[], cwd?: string): { code: number; stdout: string; stderr: string } {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' })
  return { code: res.status ?? -1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' }
}

export function cloneRepo(url: string, dest: string): { code: number; output: string } {
  const res = run(['clone', '--depth', '1', url, dest])
  return { code: res.code, output: res.stdout + res.stderr }
}

export function currentCommit(repoPath: string): string | null {
  const res = run(['rev-parse', 'HEAD'], repoPath)
  if (res.code !== 0) return null
  return res.stdout.trim() || null
}

export function isDirty(repoPath: string): boolean {
  const res = run(['status', '--porcelain=v1'], repoPath)
  if (res.code !== 0) return false
  return res.stdout.trim().length > 0
}

// Hard-sync to origin's default branch. Discards any local edits — callers
// should warn the user before invoking.
export function fetchAndReset(repoPath: string): { code: number; output: string } {
  const fetch = run(['fetch', '--depth', '1', 'origin'], repoPath)
  if (fetch.code !== 0) return { code: fetch.code, output: fetch.stdout + fetch.stderr }
  // Find default remote branch (usually main or master).
  const head = run(['symbolic-ref', '-q', 'refs/remotes/origin/HEAD'], repoPath)
  let remoteRef = 'origin/HEAD'
  if (head.code === 0 && head.stdout.trim()) {
    remoteRef = head.stdout.trim().replace(/^refs\/remotes\//, '')
  } else {
    // Probe main then master.
    const main = run(['rev-parse', '--verify', 'origin/main'], repoPath)
    if (main.code === 0) remoteRef = 'origin/main'
    else {
      const master = run(['rev-parse', '--verify', 'origin/master'], repoPath)
      if (master.code === 0) remoteRef = 'origin/master'
    }
  }
  const reset = run(['reset', '--hard', remoteRef], repoPath)
  return { code: reset.code, output: fetch.stdout + reset.stdout + reset.stderr }
}
