import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const {
  FIXTURE_LOG_PATH,
  L1_ITEMS,
  L2_QUOTES,
  startFixtureServer,
} = require('../test-skill/fixture-server.cjs')

test('fixture server serves L1 data without requiring page access', async () => {
  const fixture = await startFixtureServer({ port: 0 })
  try {
    const res = await fetch(`${fixture.baseUrl}/l1/api/top`)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), L1_ITEMS)
  } finally {
    await fixture.stop()
  }
})

test('fixture server requires page session for L2 JSON access', async () => {
  const fixture = await startFixtureServer({ port: 0 })
  try {
    const denied = await fetch(`${fixture.baseUrl}/l2/api/quotes`)
    assert.equal(denied.status, 401)

    const page = await fetch(`${fixture.baseUrl}/l2/`)
    assert.equal(page.status, 200)
    const cookie = page.headers.get('set-cookie') ?? ''
    await page.text()

    const badBootstrap = await fetch(`${fixture.baseUrl}/l2/bootstrap.js`, {
      headers: {
        cookie,
        'user-agent': 'Mozilla/5.0 fixture-test',
      },
    })
    assert.equal(badBootstrap.status, 403)

    const bootstrap = await fetch(`${fixture.baseUrl}/l2/bootstrap.js`, {
      headers: {
        cookie,
        'user-agent': 'Mozilla/5.0 fixture-test',
        referer: `${fixture.baseUrl}/l2/`,
        'sec-fetch-dest': 'script',
      },
    })
    assert.equal(bootstrap.status, 200)
    const js = await bootstrap.text()
    const browserToken = /const browserToken = "([^"]+)"/.exec(js)?.[1]
    assert.ok(browserToken, 'expected L2 bootstrap token in bootstrap.js')

    const allowed = await fetch(`${fixture.baseUrl}/l2/api/quotes`, {
      headers: {
        cookie: `${cookie}; l2_browser=${browserToken}`,
        'user-agent': 'Mozilla/5.0 fixture-test',
        'x-l2-browser': browserToken!,
        'sec-fetch-mode': 'cors',
      },
    })
    assert.equal(allowed.status, 200)
    assert.deepEqual(await allowed.json(), L2_QUOTES)
  } finally {
    await fixture.stop()
  }
})

test('fixture server renders L3 data only in HTML and records logs', async () => {
  const fixture = await startFixtureServer({ port: 0 })
  try {
    const page = await fetch(`${fixture.baseUrl}/l3/`)
    const html = await page.text()
    assert.equal(page.status, 200)
    assert.match(html, /A Light in the Attic/)
    assert.match(html, /£51\.77/)

    const api = await fetch(`${fixture.baseUrl}/l3/api/books`)
    assert.equal(api.status, 404)

    const logs = JSON.parse(await (await fetch(`${fixture.baseUrl}/__log`)).text())
    assert.ok(logs.some((entry: { path: string }) => entry.path === '/l3/'))
    assert.ok(logs.some((entry: { path: string }) => entry.path === '/l3/api/books'))
  } finally {
    await fixture.stop()
  }

  const persisted = JSON.parse(require('node:fs').readFileSync(FIXTURE_LOG_PATH, 'utf8'))
  assert.ok(Array.isArray(persisted))
})
