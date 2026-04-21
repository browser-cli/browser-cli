import { HOME_DIR, SUBS_DIR, ensureHomeDirs } from '../paths.ts'

export async function runHome(_argv: string[] = []): Promise<void> {
  ensureHomeDirs()
  process.stdout.write(`${HOME_DIR}\n`)
}

export async function runSubsHome(_argv: string[] = []): Promise<void> {
  ensureHomeDirs()
  process.stdout.write(`${SUBS_DIR}\n`)
}
