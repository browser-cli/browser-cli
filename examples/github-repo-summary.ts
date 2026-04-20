import { z } from 'zod'
import type { Browser } from '@browserclijs/browser-cli'

/**
 * Fetch a GitHub repo summary (description, stars, language, topics) via the JSON API.
 *
 * Layer 2 example — GitHub exposes a JSON API, so we land on github.com
 * to inherit the user's session (higher rate limits than anonymous calls)
 * and then call `page.fetch`. No DOM scraping involved; markup changes
 * to github.com cannot break this workflow.
 */
export const schema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
})

type RepoData = {
  full_name: string
  description: string | null
  stargazers_count: number
  forks_count: number
  open_issues_count: number
  language: string | null
  topics: string[]
  default_branch: string
  html_url: string
}

export async function run(browser: Browser, args: z.infer<typeof schema>) {
  const page = await browser.newPage()
  // Land on github.com first so the fetch runs from a real page origin and
  // inherits the user's logged-in session (higher rate limits than anonymous).
  await page.goto('https://github.com/', { waitUntil: 'domcontentloaded' })

  const data = await page.fetch<RepoData>(
    `https://api.github.com/repos/${args.owner}/${args.repo}`,
    { headers: { Accept: 'application/vnd.github+json' } },
  )

  return {
    name: data.full_name,
    description: data.description,
    stars: data.stargazers_count,
    forks: data.forks_count,
    openIssues: data.open_issues_count,
    language: data.language,
    topics: data.topics,
    defaultBranch: data.default_branch,
    url: data.html_url,
  }
}
