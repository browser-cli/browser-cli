import { HOME_DIR, ensureHomeDirs } from '../paths.ts'
import { isUserRepoInit, promptAndCommit, statusSummary } from '../git/userRepo.ts'

export async function runSync(_argv: string[] = []): Promise<void> {
  ensureHomeDirs()
  if (!isUserRepoInit()) {
    process.stderr.write(
      `${HOME_DIR} is not a git repo — run 'browser-cli init' first\n`,
    )
    process.exit(1)
  }
  const status = statusSummary()
  if (!status.hasChanges) {
    process.stdout.write('up to date — nothing to commit\n')
    return
  }
  await promptAndCommit('sync')
}
