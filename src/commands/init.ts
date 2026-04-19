import { HOME_DIR, SUBS_DIR, ensureHomeDirs } from '../paths.ts'
import { hasRemote, isUserRepoInit, statusSummary } from '../git/userRepo.ts'

export async function runInit(_argv: string[] = []): Promise<void> {
  const wasInit = isUserRepoInit()
  ensureHomeDirs()
  const nowInit = isUserRepoInit()

  process.stdout.write(`home:  ${HOME_DIR}\n`)
  process.stdout.write(`subs:  ${SUBS_DIR}\n`)
  process.stdout.write(`git:   ${nowInit ? 'initialized' : 'unavailable'}`)
  if (!wasInit && nowInit) process.stdout.write(' (just now)')
  process.stdout.write('\n')

  if (!nowInit) {
    process.stderr.write(
      `\ngit not available — install git to enable cross-device sync.\n`,
    )
    return
  }

  const status = statusSummary()
  if (status.hasChanges) {
    process.stdout.write(`\n${status.entries.length} uncommitted change(s) — run 'browser-cli sync' to commit.\n`)
  }

  if (!hasRemote()) {
    process.stdout.write(
      `\nnext: add a remote so you can push between devices:\n` +
        `  git -C ${HOME_DIR} remote add origin <your-repo-url>\n` +
        `  git -C ${HOME_DIR} push -u origin main\n`,
    )
  }
}
