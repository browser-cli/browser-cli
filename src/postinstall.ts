// Runs on `npm install` so a fresh install gets ~/.browser-cli/ set up as a
// git repo automatically. Errors are swallowed — a failing postinstall must
// never block the install itself.
import { ensureHomeDirs } from './paths.ts'

try {
  ensureHomeDirs()
} catch {
  // best-effort only
}
