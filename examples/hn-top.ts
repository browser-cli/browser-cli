import { z } from 'zod'
import type { Stagehand } from '@browserbasehq/stagehand'

/** Fetch top N stories from the Hacker News front page. */
export const schema = z.object({
  limit: z.number().int().positive().max(30).default(5),
})

export async function run(stagehand: Stagehand, args: z.infer<typeof schema>) {
  const page = await stagehand.context.newPage()
  await page.goto('https://news.ycombinator.com/', { waitUntil: 'domcontentloaded' })

  return await page.evaluate((limit) => {
    const rows = Array.from(document.querySelectorAll('tr.athing')).slice(0, limit)
    return rows.map((row) => {
      const link = row.querySelector('.titleline a') as HTMLAnchorElement | null
      const rankEl = row.querySelector('.rank')
      const subtextRow = row.nextElementSibling
      const scoreEl = subtextRow?.querySelector('.score')
      const userEl = subtextRow?.querySelector('.hnuser')
      return {
        rank: rankEl?.textContent?.replace(/\.$/, '').trim() ?? null,
        title: link?.textContent?.trim() ?? null,
        url: link?.href ?? null,
        score: scoreEl?.textContent?.trim() ?? null,
        user: userEl?.textContent?.trim() ?? null,
      }
    })
  }, args.limit)
}
