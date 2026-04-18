import { pathToFileURL } from 'node:url'

// Always route workflow imports through tsx's tsImport. It resolves the
// workflow's `import 'zod'` / `import '@browserbasehq/stagehand'` relative to
// our package (via `parentURL = import.meta.url`), so users don't need to
// install deps inside ~/.browser-cli/workflows/. Node's native strip-types
// would instead resolve from the workflow file's own directory and fail.
export async function loadTs(absPath: string): Promise<Record<string, unknown>> {
  const href = pathToFileURL(absPath).href
  const { tsImport } = await import('tsx/esm/api')
  return (await tsImport(href, import.meta.url)) as Record<string, unknown>
}
