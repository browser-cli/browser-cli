import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { z } from 'zod'
import {
  applyPathMap,
  canonicalizeSchema,
  extractFromJson,
  type InferPaths,
  type PathMap,
} from '../src/helpers/extract-from-json.ts'

function freshCacheDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bc-ej-'))
}

// ---------------------------------------------------------------------------
// Walker
// ---------------------------------------------------------------------------

test('applyPathMap: leaf path array walks keys', () => {
  const json = { a: { b: { c: 42 } } }
  assert.equal(applyPathMap(json, ['a', 'b', 'c']), 42)
})

test('applyPathMap: missing key returns undefined (no throw)', () => {
  const json = { a: { b: 1 } }
  assert.equal(applyPathMap(json, ['a', 'x', 'y']), undefined)
})

test('applyPathMap: numeric-string segments index arrays', () => {
  const json = { items: ['x', 'y', 'z'] }
  assert.equal(applyPathMap(json, ['items', '1']), 'y')
})

test('applyPathMap: non-numeric key on array returns undefined', () => {
  const json = { items: ['a', 'b'] }
  assert.equal(applyPathMap(json, ['items', 'oops']), undefined)
})

test('applyPathMap: __root descends before fields', () => {
  const json = { data: { user: { name: 'Ada', age: 30 } } }
  const map: PathMap = {
    __root: ['data', 'user'],
    fields: { name: ['name'], age: ['age'] },
  }
  assert.deepEqual(applyPathMap(json, map), { name: 'Ada', age: 30 })
})

test('applyPathMap: __arrayOf iterates elements', () => {
  const json = {
    tweets: [
      { id: '1', legacy: { full_text: 'hi' } },
      { id: '2', legacy: { full_text: 'yo' } },
    ],
  }
  const map: PathMap = {
    fields: {
      tweets: {
        __root: ['tweets'],
        __arrayOf: {
          fields: { id: ['id'], text: ['legacy', 'full_text'] },
        },
      },
    },
  }
  assert.deepEqual(applyPathMap(json, map), {
    tweets: [
      { id: '1', text: 'hi' },
      { id: '2', text: 'yo' },
    ],
  })
})

test('applyPathMap: __arrayOf when scope is not an array returns undefined', () => {
  const json = { tweets: { not: 'array' } }
  const map: PathMap = {
    __root: ['tweets'],
    __arrayOf: { fields: { id: ['id'] } },
  }
  assert.equal(applyPathMap(json, map), undefined)
})

test('applyPathMap: nested __arrayOf (Twitter-shaped)', () => {
  const json = {
    data: {
      user: {
        result: {
          timeline_v2: {
            timeline: {
              instructions: {
                entries: [
                  { content: { itemContent: { tweet_results: { result: { rest_id: 'A', legacy: { full_text: 'hello' } } } } } },
                  { content: { itemContent: { tweet_results: { result: { rest_id: 'B', legacy: { full_text: null } } } } } },
                ],
              },
            },
          },
        },
      },
    },
  }
  const map: PathMap = {
    fields: {
      tweets: {
        __root: ['data', 'user', 'result', 'timeline_v2', 'timeline', 'instructions'],
        __arrayOf: undefined,
      },
    },
  }
  // Actually build the correct nested __arrayOf structure:
  const real: PathMap = {
    fields: {
      tweets: {
        __root: ['data', 'user', 'result', 'timeline_v2', 'timeline', 'instructions', 'entries'],
        __arrayOf: {
          __root: ['content', 'itemContent', 'tweet_results', 'result'],
          fields: {
            id: ['rest_id'],
            text: ['legacy', 'full_text'],
          },
        },
      },
    },
  }
  void map
  assert.deepEqual(applyPathMap(json, real), {
    tweets: [
      { id: 'A', text: 'hello' },
      { id: 'B', text: null },
    ],
  })
})

// ---------------------------------------------------------------------------
// Canonicalizer
// ---------------------------------------------------------------------------

test('canonicalizeSchema: object key order is stable', () => {
  const a = z.object({ a: z.string(), b: z.number() })
  const b = z.object({ b: z.number(), a: z.string() })
  assert.equal(canonicalizeSchema(a), canonicalizeSchema(b))
})

test('canonicalizeSchema: different shapes → different outputs', () => {
  const a = z.object({ a: z.string() })
  const b = z.object({ a: z.number() })
  assert.notEqual(canonicalizeSchema(a), canonicalizeSchema(b))
})

test('canonicalizeSchema: nullable / optional / array compose', () => {
  const schema = z.object({
    xs: z.array(z.object({ id: z.string(), text: z.string().nullable() })),
    y: z.number().optional(),
  })
  const out = canonicalizeSchema(schema)
  assert.match(out, /object\(/)
  assert.match(out, /array\(/)
  assert.match(out, /nullable\(/)
  assert.match(out, /optional\(/)
})

// ---------------------------------------------------------------------------
// extractFromJson end-to-end w/ injected inferPaths
// ---------------------------------------------------------------------------

test('extractFromJson: first call infers, second call reads cache', async () => {
  const cacheDir = freshCacheDir()
  const schema = z.object({ name: z.string() })
  const json = { data: { user: { name: 'Ada' } } }

  let calls = 0
  const inferPaths: InferPaths = async () => {
    calls++
    return { __root: ['data', 'user'], fields: { name: ['name'] } }
  }

  const first = await extractFromJson(json, 'get the user name', schema, { cacheDir, inferPaths })
  assert.deepEqual(first, { name: 'Ada' })
  assert.equal(calls, 1)

  // file should exist
  const files = fs.readdirSync(cacheDir)
  assert.equal(files.length, 1)
  assert.ok(files[0].endsWith('.json'))

  const second = await extractFromJson(json, 'get the user name', schema, { cacheDir, inferPaths })
  assert.deepEqual(second, { name: 'Ada' })
  assert.equal(calls, 1, 'LLM should not be called a second time')
})

test('extractFromJson: cache is invalidated on zod failure and re-inferred', async () => {
  const cacheDir = freshCacheDir()
  const schema = z.object({ name: z.string() })
  const json = { data: { user: { name: 'Ada' } } }

  // Pre-populate cache with a BAD map (points at non-existent path)
  const instruction = 'get the user name'
  // Construct the same key the implementation uses
  const crypto = await import('node:crypto')
  const key = crypto.createHash('sha256').update(instruction).update('\u0000').update(canonicalizeSchema(schema)).digest('hex')
  fs.mkdirSync(cacheDir, { recursive: true })
  const cachePath = path.join(cacheDir, `${key}.json`)
  fs.writeFileSync(
    cachePath,
    JSON.stringify({ version: 1, map: { __root: ['nope'], fields: { name: ['x'] } }, createdAt: 1 }),
    'utf8',
  )

  let calls = 0
  const inferPaths: InferPaths = async () => {
    calls++
    return { __root: ['data', 'user'], fields: { name: ['name'] } }
  }

  const result = await extractFromJson(json, instruction, schema, { cacheDir, inferPaths })
  assert.deepEqual(result, { name: 'Ada' })
  assert.equal(calls, 1, 'bad cache should force re-inference')

  // The same key file should still exist and now hold the good map.
  const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'))
  assert.deepEqual(cache.map, { __root: ['data', 'user'], fields: { name: ['name'] } })
})

test('extractFromJson: different schemas produce different cache keys', async () => {
  const cacheDir = freshCacheDir()
  const schemaA = z.object({ name: z.string() })
  const schemaB = z.object({ age: z.number() })
  const json = { data: { user: { name: 'Ada', age: 30 } } }

  const inferA: InferPaths = async () => ({ __root: ['data', 'user'], fields: { name: ['name'] } })
  const inferB: InferPaths = async () => ({ __root: ['data', 'user'], fields: { age: ['age'] } })

  await extractFromJson(json, 'same instruction', schemaA, { cacheDir, inferPaths: inferA })
  await extractFromJson(json, 'same instruction', schemaB, { cacheDir, inferPaths: inferB })

  const files = fs.readdirSync(cacheDir)
  assert.equal(files.length, 2, `expected 2 cache files, got ${files.length}`)
})

test('extractFromJson: canonicalizer produces same key regardless of zod object key order', async () => {
  const cacheDir = freshCacheDir()
  const schemaA = z.object({ a: z.string(), b: z.number() })
  const schemaB = z.object({ b: z.number(), a: z.string() })
  const json = { a: 'hi', b: 3 }

  const infer: InferPaths = async () => ({ fields: { a: ['a'], b: ['b'] } })

  await extractFromJson(json, 'same instruction', schemaA, { cacheDir, inferPaths: infer })
  await extractFromJson(json, 'same instruction', schemaB, { cacheDir, inferPaths: infer })

  const files = fs.readdirSync(cacheDir)
  assert.equal(files.length, 1, `expected 1 cache file (same key), got ${files.length}`)
})

test('extractFromJson: freshly-inferred bad map throws and removes cache', async () => {
  const cacheDir = freshCacheDir()
  const schema = z.object({ name: z.string() })
  const json = { data: { user: { name: 'Ada' } } }

  const infer: InferPaths = async () => ({ fields: { name: ['nope', 'nada'] } })

  await assert.rejects(
    () => extractFromJson(json, 'find name', schema, { cacheDir, inferPaths: infer }),
    /did not produce a valid schema match/,
  )

  const files = fs.readdirSync(cacheDir)
  assert.equal(files.length, 0, 'bad freshly-inferred map should not remain cached')
})
