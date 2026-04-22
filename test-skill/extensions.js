// Promptfoo extension hook for the browser-cli skill eval harness.
//
// Registered in promptfooconfig.yaml as:
//   extensions:
//     - file://./extensions.js:default
//
// If promptfoo's resolver rejects `:default`, switch the export to:
//   module.exports.extensionHook = async function (hookName, context) { ... }
// and register as `file://./extensions.js:extensionHook`.
//
// Responsibilities:
//   beforeAll — sync ../skills → src/.claude/skills (so claude-agent-sdk's
//               Skill tool can discover it in its project dir), and wipe
//               ./browser-cli (BROWSER_CLI_HOME, sibling of src/) to a clean
//               slate so stale workflows from a crashed run can't satisfy this
//               run's assertions.
//   afterAll  — remove only the skills copy. ./browser-cli is intentionally
//               kept so the user can inspect / manually re-run the generated
//               workflows (useful for debugging eval failures and for confirming
//               the workflow actually works). It's wiped at the next beforeAll.
//
// Cache-stability notes:
//   • BROWSER_CLI_HOME lives OUTSIDE `working_dir` (./src/). Agent-generated
//     workflows/tasks/db.sqlite never touch src/, so src/'s own mtime — and
//     every descendant mtime — stays constant across runs. This lets
//     claude-agent-sdk's workingDirFingerprint be stable, which is a prereq
//     for cache hits.
//   • The skill copy uses `cp -Rp` (preserves source mtimes). A plain `cp -R`
//     stamps fresh mtimes on every copy, guaranteeing a fingerprint miss.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SKILLS_SRC = path.resolve(__dirname, '../skills');
const SKILLS_DEST = path.resolve(__dirname, 'src/.claude/skills');
const BROWSER_CLI_HOME = path.resolve(__dirname, 'browser-cli');

module.exports = async function (hookName, context) {
  if (hookName === 'beforeAll') {
    fs.rmSync(SKILLS_DEST, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(SKILLS_DEST), { recursive: true });
    execSync(`cp -Rp "${SKILLS_SRC}/." "${SKILLS_DEST}/"`);

    fs.rmSync(BROWSER_CLI_HOME, { recursive: true, force: true });
    return context;
  }

  if (hookName === 'afterAll') {
    fs.rmSync(SKILLS_DEST, { recursive: true, force: true });
    // BROWSER_CLI_HOME is kept around on purpose — see header comment.
  }
};
