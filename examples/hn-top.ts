import { z } from 'zod'
import type { Browser } from '@browserclijs/browser-cli'

/**
 * Fetch top N stories from the Hacker News front page.
 *
 * Layer 3 (DOM) example — Hacker News has no public JSON endpoint for
 * its ranked front page, so the resilient path is `page.extract` with
 * a Zod schema. Stagehand caches the resolved selectors per (URL,
 * instruction) pair and self-heals if HN tweaks `tr.athing` or `.score`
 * tomorrow. Hand-rolled `document.querySelectorAll` would just break.
 */
export const schema = z.object({
  limit: z.number().int().positive().max(30).default(5),
})

export async function run(browser: Browser, args: z.infer<typeof schema>) {
  const page = await browser.newPage()
  await page.goto('https://news.ycombinator.com/', { waitUntil: 'domcontentloaded' })

  const result = await page.extract(
    `extract the top ${args.limit} stories from the Hacker News front page in the order they appear; for each story return rank, title, url, score, and user`,
    z.object({
      stories: z.array(
        z.object({
          rank: z.string().nullable(),
          title: z.string().nullable(),
          url: z.string().nullable(),
          score: z.string().nullable(),
          user: z.string().nullable(),
        }),
      ),
    }),
  )

  return result.stories.slice(0, args.limit)
}
