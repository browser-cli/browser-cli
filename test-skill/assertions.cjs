const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const {
  FIXTURE_LOG_PATH,
  L1_ITEMS,
  L2_QUOTES,
  L3_BOOKS,
} = require('./fixture-server.cjs');

const TEST_SKILL_DIR = __dirname;
const REPO_ROOT = path.resolve(TEST_SKILL_DIR, '..');
const BROWSER_CLI_HOME_DIR = path.join(TEST_SKILL_DIR, 'browser-cli');
const WORKFLOWS_DIR = path.join(BROWSER_CLI_HOME_DIR, 'workflows');

function findWorkflowDir() {
  if (!fs.existsSync(WORKFLOWS_DIR)) {
    throw new Error(`workflow dir not found at ${WORKFLOWS_DIR} — run was expected to generate workflows under test-skill/browser-cli`);
  }
  return WORKFLOWS_DIR;
}

function listTsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

function workflowNameFromPath(workflowsDir, filePath) {
  return path.relative(workflowsDir, filePath).replace(/\.ts$/, '').split(path.sep).join('/');
}

function pickWorkflow(patterns) {
  const workflowsDir = findWorkflowDir();
  const files = listTsFiles(workflowsDir)
    .map((filePath) => ({
      filePath,
      content: fs.readFileSync(filePath, 'utf8'),
      mtimeMs: fs.statSync(filePath).mtimeMs,
    }))
    .filter(({ content }) => patterns.some((pattern) => content.includes(pattern)))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  if (files.length === 0) {
    throw new Error(`no generated workflow matched patterns: ${patterns.join(', ')}`);
  }

  const picked = files[0];
  return {
    content: picked.content,
    filePath: picked.filePath,
    workflowName: workflowNameFromPath(workflowsDir, picked.filePath),
  };
}

async function runWorkflow(workflowName) {
  const { stdout } = await execFileAsync(
    process.execPath,
    ['dist/cli.js', 'run', workflowName],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      env: {
        ...process.env,
        BROWSER_CLI_HOME: BROWSER_CLI_HOME_DIR,
      },
    },
  );
  return JSON.parse(stdout);
}

function readFixtureLogs(fixture) {
  if (!fs.existsSync(FIXTURE_LOG_PATH)) {
    throw new Error(`fixture log not found at ${FIXTURE_LOG_PATH}`);
  }
  return JSON.parse(fs.readFileSync(FIXTURE_LOG_PATH, 'utf8')).filter((entry) => entry.fixture === fixture);
}

function fail(reason) {
  return { pass: false, score: 0, reason };
}

function pass(reason) {
  return { pass: true, score: 1, reason };
}

function normalizeJson(value) {
  return JSON.stringify(value);
}

function forbiddenRawDom(content) {
  return /page\.unsafe\(\)\.v3Page\.evaluate\s*\([^)]*document\.querySelector/is.test(content);
}

async function evaluateL1(_output, context) {
  try {
    const baseUrl = context?.vars?.baseUrl;
    if (!baseUrl) return fail('context.vars.baseUrl missing');
    const workflow = pickWorkflow([`${baseUrl}/l1`, '/l1/api/top']);
    if (/browser\.newPage\s*\(/.test(workflow.content)) {
      return fail('workflow opened a browser on an L1 task');
    }

    const actual = await runWorkflow(workflow.workflowName);
    assert.equal(normalizeJson(actual), normalizeJson(L1_ITEMS));

    const logs = readFixtureLogs('l1');
    if (!logs.some((entry) => entry.path === '/l1/api/top')) {
      return fail('fixture log never saw /l1/api/top');
    }
    if (logs.some((entry) => entry.path === '/l1/')) {
      return fail('fixture log saw /l1/ page access on an L1 task');
    }

    return pass('L1 direct-API path confirmed and workflow output matched expected items');
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

async function evaluateL2(_output, context) {
  try {
    const baseUrl = context?.vars?.baseUrl;
    if (!baseUrl) return fail('context.vars.baseUrl missing');
    const workflow = pickWorkflow([`${baseUrl}/l2`, '/l2/api/quotes']);
    if (!/\bpage\.(waitForJsonResponse|captureResponses|fetch)\s*[<(]/.test(workflow.content)) {
      return fail('workflow did not use a sanctioned L2 network API');
    }
    if (/page\.(extract|observe)\s*\(/.test(workflow.content)) {
      return fail('workflow regressed to DOM extraction on an L2 task');
    }
    if (forbiddenRawDom(workflow.content)) {
      return fail('workflow used raw unsafe DOM evaluation on an L2 task');
    }

    const actual = await runWorkflow(workflow.workflowName);
    assert.equal(normalizeJson(actual), normalizeJson(L2_QUOTES));

    const logs = readFixtureLogs('l2');
    const pageVisit = logs.find((entry) => entry.path === '/l2/' && entry.status === 200);
    const bootstrap = logs.find(
      (entry) => entry.path === '/l2/bootstrap.js' && entry.status === 200 && entry.l2Session,
    );
    const apiSuccess = logs.find(
      (entry) =>
        entry.path === '/l2/api/quotes' &&
        entry.status === 200 &&
        entry.l2Session &&
        entry.l2Browser,
    );

    if (!pageVisit) return fail('fixture log never saw /l2/ page navigation');
    if (!bootstrap) return fail('fixture log never saw browser bootstrap.js load for L2');
    if (!apiSuccess) return fail('fixture log never saw a successful cookie-bound /l2/api/quotes request');
    if (pageVisit.ts > apiSuccess.ts) {
      return fail('successful /l2/api/quotes request happened before /l2/ navigation');
    }

    return pass('L2 page-bound network path confirmed and workflow output matched expected quotes');
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

async function evaluateL3(_output, context) {
  try {
    const baseUrl = context?.vars?.baseUrl;
    if (!baseUrl) return fail('context.vars.baseUrl missing');
    const workflow = pickWorkflow([`${baseUrl}/l3`, '/l3/']);
    if (!/page\.extract\s*\(/.test(workflow.content)) {
      return fail('workflow did not use page.extract on an L3 task');
    }
    if (forbiddenRawDom(workflow.content)) {
      return fail('workflow used raw unsafe DOM evaluation on an L3 task');
    }
    if (/fetch\s*\(\s*['"`][^'"`]*\/l3\//.test(workflow.content)) {
      return fail('workflow attempted direct fetch-based extraction against L3 routes');
    }

    const actual = await runWorkflow(workflow.workflowName);
    assert.equal(normalizeJson(actual), normalizeJson(L3_BOOKS));

    const logs = readFixtureLogs('l3');
    if (!logs.some((entry) => entry.path === '/l3/' && entry.status === 200)) {
      return fail('fixture log never saw /l3/ page access');
    }
    if (logs.some((entry) => entry.path.startsWith('/l3/api/') && entry.status === 200)) {
      return fail('fixture log saw a successful JSON API path on an L3 task');
    }

    return pass('L3 DOM path confirmed and workflow output matched expected books');
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

module.exports = {
  evaluateL1,
  evaluateL2,
  evaluateL3,
};
