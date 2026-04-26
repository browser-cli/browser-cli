export function normalizeSite(s: string): string {
  return s.toLowerCase()
}

export function matchesSite(candidate: string, pattern: string | undefined): boolean {
  if (!pattern) return true
  return normalizeSite(candidate).includes(normalizeSite(pattern))
}

export function parseSiteArg(argv: string[]): { site: string | undefined; rest: string[] } {
  const rest: string[] = []
  let site: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--site' || a === '-s') {
      site = argv[++i]
      continue
    }
    if (a.startsWith('--site=')) {
      site = a.slice('--site='.length)
      continue
    }
    rest.push(a)
  }
  if (site === undefined && rest.length > 0) site = rest.shift()
  return { site, rest }
}
