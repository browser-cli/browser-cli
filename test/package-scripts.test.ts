import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

type PackageJson = {
  scripts?: Record<string, string>
}

function readPackageJson(): PackageJson {
  return JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as PackageJson
}

test('link script installs Codex skill into global agents skills dir', () => {
  const { scripts } = readPackageJson()
  const link = scripts?.link ?? ''

  assert.match(link, /\$HOME\/\.claude\/skills/)
  assert.match(link, /\$HOME\/\.agents\/skills/)
  assert.doesNotMatch(link, /\$HOME\/\.codex\/skills/)
})

test('unlink script removes current Codex skill link and stale legacy link', () => {
  const { scripts } = readPackageJson()
  const unlink = scripts?.unlink ?? ''

  assert.match(unlink, /\$HOME\/\.claude\/skills\/browser-cli/)
  assert.match(unlink, /\$HOME\/\.agents\/skills\/browser-cli/)
  assert.match(unlink, /\$HOME\/\.codex\/skills\/browser-cli/)
})
