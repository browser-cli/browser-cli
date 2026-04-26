import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchesSite, normalizeSite, parseSiteArg } from '../src/commands/parse-site-arg.ts'

test('normalizeSite: lowercases', () => {
  assert.equal(normalizeSite('News.YCombinator.COM'), 'news.ycombinator.com')
  assert.equal(normalizeSite('X.COM'), 'x.com')
  assert.equal(normalizeSite(''), '')
})

test('matchesSite: case-insensitive substring match', () => {
  const path = 'news.ycombinator.com/top.ts'
  assert.equal(matchesSite(path, undefined), true, 'undefined pattern passes through')
  assert.equal(matchesSite(path, 'hn'), false, 'hn is not a substring of the folder')
  assert.equal(matchesSite(path, 'ycombinator'), true)
  assert.equal(matchesSite(path, 'news.ycombinator.com'), true, 'full domain matches')
  assert.equal(matchesSite(path, 'NEWS.YCOMBINATOR'), true, 'case-insensitive')
  assert.equal(matchesSite(path, 'top'), true, 'matches workflow name too')
  assert.equal(matchesSite(path, 'nope'), false)
})

test('parseSiteArg: positional only', () => {
  const r = parseSiteArg(['hn'])
  assert.equal(r.site, 'hn')
  assert.deepEqual(r.rest, [])
})

test('parseSiteArg: --site flag, space-separated', () => {
  const r = parseSiteArg(['--site', 'ycombinator'])
  assert.equal(r.site, 'ycombinator')
  assert.deepEqual(r.rest, [])
})

test('parseSiteArg: --site= flag, equals form', () => {
  const r = parseSiteArg(['--site=news.ycombinator.com'])
  assert.equal(r.site, 'news.ycombinator.com')
  assert.deepEqual(r.rest, [])
})

test('parseSiteArg: -s short flag', () => {
  const r = parseSiteArg(['-s', 'x.com'])
  assert.equal(r.site, 'x.com')
})

test('parseSiteArg: flag takes precedence over positional', () => {
  const r = parseSiteArg(['--site', 'flag-wins', 'ignored-positional'])
  assert.equal(r.site, 'flag-wins')
  assert.deepEqual(r.rest, ['ignored-positional'])
})

test('parseSiteArg: no args', () => {
  const r = parseSiteArg([])
  assert.equal(r.site, undefined)
  assert.deepEqual(r.rest, [])
})
