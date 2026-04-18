import fs from 'node:fs'

export function extractDescription(absPath: string): string {
  try {
    const head = fs.readFileSync(absPath, 'utf8').slice(0, 2048)
    const jsdoc = head.match(/\/\*\*\s*([\s\S]*?)\*\//)
    if (jsdoc) {
      const firstLine = jsdoc[1]!
        .split('\n')
        .map((l) => l.replace(/^\s*\*\s?/, '').trim())
        .find((l) => l.length > 0)
      if (firstLine) return firstLine
    }
    const lineComment = head.match(/^\s*\/\/\s*(.+)$/m)
    if (lineComment) return lineComment[1]!.trim()
  } catch {
  }
  return ''
}
