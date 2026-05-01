import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from './helpers.ts'

test('normalizeSpec: rps shape', async () => {
  await freshDb()
  const { normalizeSpec } = await import('../src/store/rate-limit.ts')
  assert.deepEqual(normalizeSpec({ rps: 5 }), { rps: 5, burst: 5, manual: false })
  assert.deepEqual(normalizeSpec({ rps: 0.5 }), { rps: 0.5, burst: 1, manual: false })
  assert.deepEqual(normalizeSpec({ rps: 2, burst: 10 }), { rps: 2, burst: 10, manual: false })
})

test('normalizeSpec: rpm/rph conversion', async () => {
  await freshDb()
  const { normalizeSpec } = await import('../src/store/rate-limit.ts')
  assert.equal(normalizeSpec({ rpm: 60 }).rps, 1)
  assert.equal(normalizeSpec({ rph: 3600 }).rps, 1)
})

test('normalizeSpec: rejects non-positive rate', async () => {
  await freshDb()
  const { normalizeSpec } = await import('../src/store/rate-limit.ts')
  assert.throws(() => normalizeSpec({ rps: 0 }), /positive/)
  assert.throws(() => normalizeSpec({ rps: -1 }), /positive/)
})

test('normalizeSpec: rejects burst < 1', async () => {
  await freshDb()
  const { normalizeSpec } = await import('../src/store/rate-limit.ts')
  assert.throws(() => normalizeSpec({ rps: 1, burst: 0 }), /burst/)
})

test('normalizeSpec: manual flag preserved', async () => {
  await freshDb()
  const { normalizeSpec } = await import('../src/store/rate-limit.ts')
  assert.equal(normalizeSpec({ rps: 1, manual: true }).manual, true)
})

test('ensureBucket: first call inserts at full burst', async () => {
  await freshDb()
  const { ensureBucket } = await import('../src/store/rate-limit.ts')
  const { getDb } = await import('../src/store/db.ts')
  ensureBucket('host-a', { rps: 2, burst: 5, manual: false })
  const row = getDb()
    .prepare(`SELECT tokens, rps, burst FROM rate_limit_buckets WHERE key = ?`)
    .get('host-a') as { tokens: number; rps: number; burst: number }
  assert.equal(row.tokens, 5)
  assert.equal(row.rps, 2)
  assert.equal(row.burst, 5)
})

test('ensureBucket: strictest-wins on second declaration', async () => {
  await freshDb()
  const { ensureBucket } = await import('../src/store/rate-limit.ts')
  const { getDb } = await import('../src/store/db.ts')
  ensureBucket('host-a', { rps: 5, burst: 10, manual: false })
  ensureBucket('host-a', { rps: 1, burst: 3, manual: false })
  const row = getDb()
    .prepare(`SELECT rps, burst FROM rate_limit_buckets WHERE key = ?`)
    .get('host-a') as { rps: number; burst: number }
  assert.equal(row.rps, 1)
  assert.equal(row.burst, 3)
})

test('ensureBucket: looser declaration is ignored', async () => {
  await freshDb()
  const { ensureBucket } = await import('../src/store/rate-limit.ts')
  const { getDb } = await import('../src/store/db.ts')
  ensureBucket('host-a', { rps: 1, burst: 3, manual: false })
  ensureBucket('host-a', { rps: 10, burst: 100, manual: false })
  const row = getDb()
    .prepare(`SELECT rps, burst FROM rate_limit_buckets WHERE key = ?`)
    .get('host-a') as { rps: number; burst: number }
  assert.equal(row.rps, 1)
  assert.equal(row.burst, 3)
})

test('acquireToken: first burst-many calls return immediately', async () => {
  await freshDb()
  const { ensureBucket, acquireToken } = await import('../src/store/rate-limit.ts')
  ensureBucket('host-a', { rps: 1, burst: 3, manual: false })
  const start = Date.now()
  await acquireToken('host-a')
  await acquireToken('host-a')
  await acquireToken('host-a')
  const elapsed = Date.now() - start
  assert.ok(elapsed < 100, `expected <100ms for burst, got ${elapsed}ms`)
})

test('acquireToken: throttles after burst is exhausted', async () => {
  await freshDb()
  const { ensureBucket, acquireToken } = await import('../src/store/rate-limit.ts')
  // 10 rps, burst=2 → calls 3 and 4 each cost ~100ms
  ensureBucket('host-a', { rps: 10, burst: 2, manual: false })
  const start = Date.now()
  await acquireToken('host-a')
  await acquireToken('host-a')
  await acquireToken('host-a')
  await acquireToken('host-a')
  const elapsed = Date.now() - start
  // expected: 0 + 0 + ~100 + ~100 = ~200ms
  assert.ok(elapsed >= 150, `expected >=150ms, got ${elapsed}ms`)
  assert.ok(elapsed < 500, `expected <500ms, got ${elapsed}ms`)
})

test('acquireToken: throws when bucket missing', async () => {
  await freshDb()
  const { acquireToken } = await import('../src/store/rate-limit.ts')
  await assert.rejects(() => acquireToken('nope'), /not registered/)
})

test('RateLimiter.matchUrl: hostname-only match', async () => {
  await freshDb()
  const { RateLimiter } = await import('../src/store/rate-limit.ts')
  const r = new RateLimiter({
    'api.example.com': { rps: 1, burst: 1, manual: false },
  })
  assert.equal(r.matchUrl('https://api.example.com/v1/foo')?.key, 'api.example.com')
  assert.equal(r.matchUrl('https://other.example.com/'), null)
  assert.equal(r.matchUrl('https://api.example.com')?.key, 'api.example.com')
})

test('RateLimiter.matchUrl: host+path prefix match', async () => {
  await freshDb()
  const { RateLimiter } = await import('../src/store/rate-limit.ts')
  const r = new RateLimiter({
    'api.example.com/graphql': { rps: 1, burst: 1, manual: false },
  })
  assert.equal(
    r.matchUrl('https://api.example.com/graphql?op=foo')?.key,
    'api.example.com/graphql',
  )
  assert.equal(r.matchUrl('https://api.example.com/rest/foo'), null)
})

test('RateLimiter.matchUrl: longest key wins', async () => {
  await freshDb()
  const { RateLimiter } = await import('../src/store/rate-limit.ts')
  const r = new RateLimiter({
    'api.example.com': { rps: 10, burst: 10, manual: false },
    'api.example.com/slow': { rps: 1, burst: 1, manual: false },
  })
  assert.equal(r.matchUrl('https://api.example.com/slow/x')?.key, 'api.example.com/slow')
  assert.equal(r.matchUrl('https://api.example.com/fast/x')?.key, 'api.example.com')
})

test('RateLimiter.matchUrl: manual buckets do not auto-match', async () => {
  await freshDb()
  const { RateLimiter } = await import('../src/store/rate-limit.ts')
  const r = new RateLimiter({
    'api.example.com': { rps: 1, burst: 1, manual: true },
  })
  assert.equal(r.matchUrl('https://api.example.com/x'), null)
  assert.ok(r.getByName('api.example.com'))
})

test('RateLimiter.matchUrl: invalid URL returns null', async () => {
  await freshDb()
  const { RateLimiter } = await import('../src/store/rate-limit.ts')
  const r = new RateLimiter({
    'api.example.com': { rps: 1, burst: 1, manual: false },
  })
  assert.equal(r.matchUrl('not a url'), null)
})

test('buildRateLimiter: validates and registers all declarations', async () => {
  await freshDb()
  const { buildRateLimiter } = await import('../src/store/rate-limit.ts')
  const { getDb } = await import('../src/store/db.ts')
  const limiter = buildRateLimiter({
    'api.example.com': { rps: 2 },
    'manual-bucket': { rpm: 30, manual: true },
  })
  assert.ok(limiter.matchUrl('https://api.example.com/x'))
  assert.equal(limiter.matchUrl('https://manual.example.com/x'), null)
  const rows = getDb()
    .prepare(`SELECT key FROM rate_limit_buckets ORDER BY key`)
    .all() as { key: string }[]
  assert.deepEqual(rows.map((r) => r.key), ['api.example.com', 'manual-bucket'])
})

test('buildRateLimiter: empty input is fine', async () => {
  await freshDb()
  const { buildRateLimiter } = await import('../src/store/rate-limit.ts')
  const limiter = buildRateLimiter(undefined)
  assert.equal(limiter.hasAny(), false)
  assert.equal(limiter.matchUrl('https://example.com'), null)
})

test('acquireToken: 30 concurrent in-process acquires serialize correctly', async () => {
  await freshDb()
  const { ensureBucket, acquireToken } = await import('../src/store/rate-limit.ts')
  // 100 rps, burst=5 → first 5 free, remaining 25 serialized at ~10ms each ≈ 250ms
  ensureBucket('contention', { rps: 100, burst: 5, manual: false })
  const start = Date.now()
  await Promise.all(
    Array.from({ length: 30 }, () => acquireToken('contention')),
  )
  const elapsed = Date.now() - start
  // (30 - 5) tokens at 100 rps = 250ms minimum; allow generous upper bound for CI
  assert.ok(elapsed >= 200, `expected >=200ms, got ${elapsed}ms`)
  assert.ok(elapsed < 2000, `expected <2000ms, got ${elapsed}ms`)
})
