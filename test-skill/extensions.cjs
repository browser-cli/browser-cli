// Promptfoo extension hook for the browser-cli skill eval harness.
//
// Registered in promptfooconfig.yaml as:
//   extensions:
//     - file://./extensions.cjs:default
//
// Responsibilities:
//   beforeAll — sync ../skills → src/.claude/skills and src/.agents/skills so
//               both Claude Agent SDK and Codex SDK can discover the browser-cli
//               skill in the project fixture, wipe ./browser-cli to a clean
//               slate, and start the local L1/L2/L3 fixture server.
//   afterAll  — remove only the copied skills, stop the local fixture server,
//               and keep ./browser-cli for post-run inspection.

const fs = require('fs');
const path = require('path');
const { startFixtureServer } = require('./fixture-server.cjs');

const SKILLS_SRC = path.resolve(__dirname, '../skills');
const CLAUDE_SKILLS_DEST = path.resolve(__dirname, 'src/.claude/skills');
const CODEX_SKILLS_DEST = path.resolve(__dirname, 'src/.agents/skills');
const BROWSER_CLI_HOME = path.resolve(__dirname, 'browser-cli');
const TMP_DIR = path.resolve(__dirname, '.tmp');
const PROMPTFOO_LOG_DIR = path.resolve(process.env.HOME || '', '.promptfoo/logs');
let fixtureServer = null;

function ensureTmpDir() {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

function appendHookEvent(event) {
  ensureTmpDir();
  fs.appendFileSync(
    path.join(TMP_DIR, 'hook-events.jsonl'),
    JSON.stringify({ ts: Date.now(), ...event }) + '\n',
  );
}

function copyLatestPromptfooLogs() {
  if (!fs.existsSync(PROMPTFOO_LOG_DIR)) return;
  ensureTmpDir();
  const files = fs.readdirSync(PROMPTFOO_LOG_DIR)
    .filter((name) => name.startsWith('promptfoo-') && name.endsWith('.log'))
    .map((name) => ({
      name,
      full: path.join(PROMPTFOO_LOG_DIR, name),
      mtimeMs: fs.statSync(path.join(PROMPTFOO_LOG_DIR, name)).mtimeMs,
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  const latestDebug = files.find((entry) => entry.name.startsWith('promptfoo-debug-'));
  const latestError = files.find((entry) => entry.name.startsWith('promptfoo-error-'));
  if (latestDebug) fs.copyFileSync(latestDebug.full, path.join(TMP_DIR, 'latest-promptfoo-debug.log'));
  if (latestError) fs.copyFileSync(latestError.full, path.join(TMP_DIR, 'latest-promptfoo-error.log'));
}

module.exports = async function (hookName, context) {
  if (hookName === 'beforeAll') {
    ensureTmpDir();
    fs.writeFileSync(path.join(TMP_DIR, 'hook-events.jsonl'), '');
    for (const dest of [CLAUDE_SKILLS_DEST, CODEX_SKILLS_DEST]) {
      fs.rmSync(dest, { recursive: true, force: true });
      fs.cpSync(SKILLS_SRC, dest, {
        recursive: true,
        preserveTimestamps: true,
      });
    }

    // Stabilize cache key: the claude-agent-sdk provider serializes all of
    // process.env into its cache key, and the SDK sets CLAUDE_AGENT_SDK_VERSION
    // lazily on first use. Force it to be present before any test runs so cache
    // keys match across runs even when test 1 is a cache hit.
    if (!process.env.CLAUDE_AGENT_SDK_VERSION) {
      try {
        const sdkMain = require.resolve('@anthropic-ai/claude-agent-sdk', {
          paths: [path.resolve(__dirname, '..')],
        });
        let dir = path.dirname(sdkMain);
        let pkgPath = null;
        while (dir !== path.dirname(dir)) {
          const candidate = path.join(dir, 'package.json');
          if (fs.existsSync(candidate) && fs.readFileSync(candidate, 'utf8').includes('"@anthropic-ai/claude-agent-sdk"')) {
            pkgPath = candidate;
            break;
          }
          dir = path.dirname(dir);
        }
        if (pkgPath) {
          process.env.CLAUDE_AGENT_SDK_VERSION = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
        }
      } catch {
        /* SDK not installed — Codex-only run, safe to ignore. */
      }
    }

    if (process.env.TEST_SKILL_RESET_BROWSER_CLI === '1') {
      fs.rmSync(BROWSER_CLI_HOME, { recursive: true, force: true });
    }
    fixtureServer = await startFixtureServer();
    fixtureServer.resetLogs();
    appendHookEvent({ hook: hookName, baseUrl: fixtureServer.baseUrl });
    return context;
  }

  if (hookName === 'beforeEach') {
    fixtureServer?.resetLogs();
    appendHookEvent({ hook: hookName });
    return context;
  }

  if (hookName === 'afterEach') {
    appendHookEvent({ hook: hookName });
    copyLatestPromptfooLogs();
    return context;
  }

  if (hookName === 'afterAll') {
    fs.rmSync(CLAUDE_SKILLS_DEST, { recursive: true, force: true });
    fs.rmSync(CODEX_SKILLS_DEST, { recursive: true, force: true });
    if (fixtureServer) {
      await fixtureServer.stop();
      fixtureServer = null;
    }
    appendHookEvent({ hook: hookName });
    copyLatestPromptfooLogs();
  }
};
