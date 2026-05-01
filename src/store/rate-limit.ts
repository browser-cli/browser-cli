import { getDb } from './db.ts'

export type RateLimitDecl =
  | { rps: number; burst?: number; manual?: boolean }
  | { rpm: number; burst?: number; manual?: boolean }
  | { rph: number; burst?: number; manual?: boolean }

export type RateLimits = Record<string, RateLimitDecl>

export type BucketSpec = {
  rps: number
  burst: number
  manual: boolean
}

export function normalizeSpec(decl: RateLimitDecl): BucketSpec {
  let rps: number
  if ('rps' in decl) rps = decl.rps
  else if ('rpm' in decl) rps = decl.rpm / 60
  else if ('rph' in decl) rps = decl.rph / 3600
  else throw new Error('rate limit declaration must include one of: rps, rpm, rph')
  if (!isFinite(rps) || rps <= 0) {
    throw new Error(`rate limit must be a positive number (got ${rps})`)
  }
  const burst = decl.burst ?? Math.max(1, Math.ceil(rps))
  if (!isFinite(burst) || burst < 1) {
    throw new Error(`rate limit burst must be >= 1 (got ${burst})`)
  }
  return { rps, burst, manual: !!decl.manual }
}

/**
 * Strictest-wins upsert. If the row exists with looser limits, tighten them in
 * place; existing tokens are not refunded. Existing-row reads under WAL are
 * race-free because the UPDATE is conditional on the new values being lower.
 */
export function ensureBucket(key: string, spec: BucketSpec): void {
  const db = getDb()
  const now = Date.now()
  const existing = db
    .prepare(`SELECT rps, burst FROM rate_limit_buckets WHERE key = ?`)
    .get(key) as { rps: number; burst: number } | undefined

  if (!existing) {
    db.prepare(
      `INSERT OR IGNORE INTO rate_limit_buckets (key, tokens, last_refill_ms, rps, burst)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(key, spec.burst, now, spec.rps, spec.burst)
    return
  }

  const newRps = Math.min(existing.rps, spec.rps)
  const newBurst = Math.min(existing.burst, spec.burst)
  if (newRps < existing.rps || newBurst < existing.burst) {
    db.prepare(
      `UPDATE rate_limit_buckets SET rps = ?, burst = ? WHERE key = ?`,
    ).run(newRps, newBurst, key)
    process.stderr.write(
      `browser-cli: tightened rate limit "${key}" to rps=${newRps}, burst=${newBurst}\n`,
    )
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Acquire one token from the named bucket. Blocks (via setTimeout) until a
 * token is available. Uses BEGIN IMMEDIATE so concurrent processes serialize
 * on the bucket row; under WAL the contention window is sub-millisecond.
 *
 * Cross-process correctness: each acquire reads the persisted token count,
 * applies the elapsed-time refill, deducts 1, and writes back atomically.
 * Two processes can never both decide they have a token from the same time
 * window because BEGIN IMMEDIATE blocks the second writer until the first
 * COMMITs.
 */
export async function acquireToken(key: string): Promise<void> {
  const db = getDb()

  for (;;) {
    const waitMs = db.transaction(() => {
      const row = db
        .prepare(
          `SELECT tokens, last_refill_ms, rps, burst FROM rate_limit_buckets WHERE key = ?`,
        )
        .get(key) as
        | { tokens: number; last_refill_ms: number; rps: number; burst: number }
        | undefined
      if (!row) {
        throw new Error(
          `rate limit bucket "${key}" was not registered (call ensureBucket first)`,
        )
      }
      const now = Date.now()
      const elapsedSec = Math.max(0, (now - row.last_refill_ms) / 1000)
      const refilled = Math.min(row.burst, row.tokens + elapsedSec * row.rps)

      if (refilled >= 1) {
        db.prepare(
          `UPDATE rate_limit_buckets SET tokens = ?, last_refill_ms = ? WHERE key = ?`,
        ).run(refilled - 1, now, key)
        return 0
      }
      // Don't write a partial state here — let the next attempt re-read fresh
      // (avoids a write storm where every process pings the row each loop).
      return Math.ceil(((1 - refilled) / row.rps) * 1000)
    }).immediate()

    if (waitMs === 0) return
    await sleep(waitMs)
  }
}

/**
 * Resolve a fetch URL to a bucket key declared in `rateLimits`.
 *
 * Match rules (longest declaration-key first):
 *   - hostname-only key (e.g. "api.cloudflare.com"): matches if URL hostname equals key
 *   - host+path key (e.g. "api.github.com/graphql"): matches if `host + pathname` starts with key
 * Manual buckets (manual: true) never match auto-fetch.
 */
export type ResolvedBucket = { key: string; spec: BucketSpec }

export class RateLimiter {
  private autoMatchers: Array<{ key: string; spec: BucketSpec }>
  private byName: Map<string, BucketSpec>

  constructor(decls: Record<string, BucketSpec>) {
    this.byName = new Map(Object.entries(decls))
    this.autoMatchers = Object.entries(decls)
      .filter(([, s]) => !s.manual)
      .sort(([a], [b]) => b.length - a.length)
      .map(([key, spec]) => ({ key, spec }))
  }

  matchUrl(rawUrl: string): ResolvedBucket | null {
    let parsed: URL
    try {
      parsed = new URL(rawUrl)
    } catch {
      return null
    }
    const hostPath = parsed.host + parsed.pathname
    for (const m of this.autoMatchers) {
      if (m.key.includes('/')) {
        if (hostPath.startsWith(m.key)) return m
      } else {
        if (parsed.host === m.key) return m
      }
    }
    return null
  }

  getByName(name: string): BucketSpec | null {
    return this.byName.get(name) ?? null
  }

  hasAny(): boolean {
    return this.byName.size > 0
  }
}

/**
 * Validate + normalize a `rateLimits` export from a workflow module, then
 * register every bucket so that subsequent acquireToken calls see them.
 */
export function buildRateLimiter(rateLimits: unknown): RateLimiter {
  if (!rateLimits || typeof rateLimits !== 'object') return new RateLimiter({})
  const normalized: Record<string, BucketSpec> = {}
  for (const [key, decl] of Object.entries(rateLimits as Record<string, unknown>)) {
    if (!decl || typeof decl !== 'object') {
      throw new Error(`rateLimits["${key}"] must be an object`)
    }
    const spec = normalizeSpec(decl as RateLimitDecl)
    normalized[key] = spec
    ensureBucket(key, spec)
  }
  return new RateLimiter(normalized)
}
