import { z } from 'zod'
import type { Browser, RateLimits } from '@browserclijs/browser-cli'

/**
 * Demonstrates the workflow-declared rate-limit API.
 *
 * Two ways to throttle:
 *   1. Auto-applied by host: any `page.fetch(...)` whose URL matches a
 *      declaration key is throttled transparently. No code change at the
 *      call site.
 *   2. Explicit `browser.rateLimit(name, fn)`: wrap any block of code under
 *      a named bucket (use `manual: true` to opt the bucket out of auto-match).
 *
 * Buckets are coordinated **across processes** via the SQLite store, so two
 * `browser-cli run rate-limited-fetch` invocations against the same host will
 * share the same token budget.
 */
export const schema = z.object({
  owner: z.string().min(1).default('browser-cli'),
  repo: z.string().min(1).default('browser-cli'),
})

export const rateLimits: RateLimits = {
  // Auto-applied to any page.fetch() targeting api.github.com.
  'api.github.com': { rps: 1, burst: 3 },
  // Manual bucket — only applies to blocks wrapped with browser.rateLimit('summary-build', fn).
  'summary-build': { rpm: 10, manual: true },
}

// At most 2 instances of this workflow run simultaneously across all
// `browser-cli run` invocations. The 3rd blocks until a slot frees.
export const concurrency = 2

type RepoData = {
  full_name: string
  stargazers_count: number
  forks_count: number
}

export async function run(browser: Browser, args: z.infer<typeof schema>) {
  const page = await browser.newPage()
  await page.goto('https://github.com/', { waitUntil: 'domcontentloaded' })

  // Auto-throttled — URL matches `api.github.com` declaration.
  const data = await page.fetch<RepoData>(
    `https://api.github.com/repos/${args.owner}/${args.repo}`,
    { headers: { Accept: 'application/vnd.github+json' } },
  )

  // Manual bucket: wraps an arbitrary block, not just a fetch.
  return await browser.rateLimit('summary-build', async () => ({
    name: data.full_name,
    stars: data.stargazers_count,
    forks: data.forks_count,
  }))
}
