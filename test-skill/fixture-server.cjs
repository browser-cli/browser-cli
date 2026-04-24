const fs = require('fs');
const http = require('http');
const path = require('path');
const { randomUUID } = require('crypto');

const FIXTURE_HOST = process.env.TEST_SKILL_FIXTURE_HOST || '127.0.0.1';
const DEFAULT_FIXTURE_PORT = Number(process.env.TEST_SKILL_FIXTURE_PORT || 4173);
const TMP_DIR = path.resolve(__dirname, '.tmp');
const FIXTURE_LOG_PATH = path.join(TMP_DIR, 'fixture-log.json');
const HARNESS_LOG_PATH = path.join(TMP_DIR, 'harness-log.jsonl');

const L1_ITEMS = [
  { title: 'Comet Cache', url: 'https://example.test/news/comet-cache' },
  { title: 'Typed Rivers', url: 'https://example.test/news/typed-rivers' },
  { title: 'Render Budget', url: 'https://example.test/news/render-budget' },
  { title: 'Session Atlas', url: 'https://example.test/news/session-atlas' },
  { title: 'Latency Lantern', url: 'https://example.test/news/latency-lantern' },
];

const L2_QUOTES = [
  { text: 'Life is like riding a bicycle. To keep your balance, you must keep moving.', author: 'Albert Einstein' },
  { text: 'The truth is rarely pure and never simple.', author: 'Oscar Wilde' },
  { text: 'We accept the love we think we deserve.', author: 'Stephen Chbosky' },
  { text: 'Imperfection is beauty, madness is genius and it is better to be absolutely ridiculous than absolutely boring.', author: 'Marilyn Monroe' },
  { text: 'Try not to become a man of success. Rather become a man of value.', author: 'Albert Einstein' },
  { text: 'It is never too late to be what you might have been.', author: 'George Eliot' },
  { text: 'The only way to do great work is to love what you do.', author: 'Steve Jobs' },
  { text: 'Simplicity is the ultimate sophistication.', author: 'Leonardo da Vinci' },
  { text: 'Everything should be made as simple as possible, but not simpler.', author: 'Albert Einstein' },
  { text: 'Turn your wounds into wisdom.', author: 'Oprah Winfrey' },
];

const L3_BOOKS = [
  { title: 'A Light in the Attic', price: '£51.77' },
  { title: 'Tipping the Velvet', price: '£53.74' },
  { title: 'Soumission', price: '£50.10' },
  { title: 'Sharp Objects', price: '£47.82' },
  { title: 'Sapiens', price: '£54.23' },
];

function ensureTmpDir() {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

function writeLogFile(logs) {
  ensureTmpDir();
  fs.writeFileSync(FIXTURE_LOG_PATH, JSON.stringify(logs, null, 2));
}

function appendHarnessEvent(event) {
  ensureTmpDir();
  fs.appendFileSync(HARNESS_LOG_PATH, JSON.stringify({ ts: Date.now(), ...event }) + '\n');
}

function readCookieMap(cookieHeader) {
  const out = new Map();
  for (const piece of String(cookieHeader || '').split(';')) {
    const trimmed = piece.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    out.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
  }
  return out;
}

function classifyFixture(urlPath) {
  if (urlPath.startsWith('/l1')) return 'l1';
  if (urlPath.startsWith('/l2')) return 'l2';
  if (urlPath.startsWith('/l3')) return 'l3';
  return 'control';
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

function sendHtml(res, statusCode, body, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

function sendJs(res, statusCode, body) {
  res.writeHead(statusCode, {
    'content-type': 'text/javascript; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

function notFound(res) {
  sendJson(res, 404, { error: 'not_found' });
}

function l1Page() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Fixture L1</title>
  </head>
  <body>
    <main>
      <h1>Signal Dispatch Board</h1>
      <p>This page intentionally does not render the feed data.</p>
      <p>The task is solvable without opening a browser.</p>
    </main>
  </body>
</html>`;
}

function l2Page() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Fixture L2</title>
    <script defer src="/l2/bootstrap.js"></script>
  </head>
  <body>
    <main>
      <h1>Quote Stream</h1>
      <p id="status">Loading quotes...</p>
      <div id="app-shell">The JSON payload is not rendered into the DOM.</div>
    </main>
  </body>
</html>`;
}

function l2BootstrapScript(browserToken) {
  return `(() => {
  const browserToken = ${JSON.stringify(browserToken)};
  document.cookie = 'l2_browser=' + browserToken + '; Path=/l2; SameSite=Lax';
  fetch('/l2/api/quotes', {
    credentials: 'same-origin',
    headers: { 'x-l2-browser': browserToken },
  })
    .then((r) => r.json())
    .then((items) => {
      const status = document.getElementById('status');
      if (status) status.textContent = 'Quotes ready (' + items.length + ')';
    })
    .catch(() => {
      const status = document.getElementById('status');
      if (status) status.textContent = 'Quotes failed';
    });
})();`;
}

function l3Page() {
  const cards = L3_BOOKS.map(
    (book, index) => `<article class="shelf-card shelf-card-${index + 1}">
  <h2>${book.title}</h2>
  <p class="price-tag">${book.price}</p>
</article>`,
  ).join('\n');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Fixture L3</title>
    <link rel="stylesheet" href="/l3/styles.css" />
  </head>
  <body>
    <main>
      <h1>Book Shelf</h1>
      <section class="book-grid">
        ${cards}
      </section>
    </main>
  </body>
</html>`;
}

function l3Styles() {
  return `.book-grid { display: grid; gap: 12px; }
.shelf-card { border: 1px solid #ccc; padding: 12px; }
.price-tag { font-weight: 700; }`;
}

function canServeL2Bootstrap(req, sessionState) {
  const cookies = readCookieMap(req.headers.cookie);
  const sessionId = cookies.get('l2_session');
  const secFetchDest = String(req.headers['sec-fetch-dest'] || '');
  const referer = String(req.headers.referer || '');
  return Boolean(
    sessionId &&
      sessionState.has(sessionId) &&
      secFetchDest === 'script' &&
      referer.includes('/l2/'),
  );
}

function canServeL2Json(req, sessionState) {
  const cookies = readCookieMap(req.headers.cookie);
  const sessionId = cookies.get('l2_session');
  const browserCookie = cookies.get('l2_browser');
  const browserHeader = req.headers['x-l2-browser'];
  const ua = String(req.headers['user-agent'] || '');
  const secFetchMode = req.headers['sec-fetch-mode'];
  const state = sessionId ? sessionState.get(sessionId) : null;
  return Boolean(
    sessionId &&
      state &&
      browserCookie &&
      browserHeader &&
      state.browserToken === browserCookie &&
      state.browserToken === browserHeader &&
      (ua.includes('Mozilla/') || typeof secFetchMode === 'string'),
  );
}

function resetLogs(logs) {
  logs.length = 0;
  writeLogFile(logs);
  ensureTmpDir();
  fs.writeFileSync(HARNESS_LOG_PATH, '');
}

async function startFixtureServer(options = {}) {
  const host = options.host || FIXTURE_HOST;
  const port = options.port ?? DEFAULT_FIXTURE_PORT;
  const logs = [];
  const sessionState = new Map();

  ensureTmpDir();
  writeLogFile(logs);
  fs.writeFileSync(HARNESS_LOG_PATH, '');

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${host}:${port}`);
    const fixture = classifyFixture(url.pathname);
    const cookies = readCookieMap(req.headers.cookie);

    res.on('finish', () => {
      logs.push({
        fixture,
        path: url.pathname,
        method: req.method || 'GET',
        status: res.statusCode,
        l2Session: cookies.has('l2_session'),
        l2Browser: cookies.has('l2_browser'),
        secFetchMode: String(req.headers['sec-fetch-mode'] || ''),
        secFetchDest: String(req.headers['sec-fetch-dest'] || ''),
        referer: String(req.headers.referer || ''),
        ts: Date.now(),
      });
      writeLogFile(logs);
    });

    if (req.method === 'POST' && url.pathname === '/__reset') {
      resetLogs(logs);
      sessionState.clear();
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'GET' && url.pathname === '/__log') {
      return sendJson(res, 200, logs);
    }

    if (req.method === 'GET' && url.pathname === '/__health') {
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'GET' && url.pathname === '/l1/') {
      return sendHtml(res, 200, l1Page());
    }

    if (req.method === 'GET' && url.pathname === '/l1/api/top') {
      return sendJson(res, 200, L1_ITEMS);
    }

    if (req.method === 'GET' && url.pathname === '/l2/') {
      const sessionId = randomUUID();
      sessionState.set(sessionId, { browserToken: null });
      return sendHtml(res, 200, l2Page(), {
        'set-cookie': `l2_session=${sessionId}; Path=/l2; HttpOnly; SameSite=Lax`,
      });
    }

    if (req.method === 'GET' && url.pathname === '/l2/bootstrap.js') {
      if (!canServeL2Bootstrap(req, sessionState)) {
        return sendJson(res, 403, { error: 'l2_bootstrap_requires_browser_navigation' });
      }
      const sessionId = readCookieMap(req.headers.cookie).get('l2_session');
      const browserToken = randomUUID();
      sessionState.set(sessionId, { browserToken });
      return sendJs(res, 200, l2BootstrapScript(browserToken));
    }

    if (req.method === 'GET' && url.pathname === '/l2/api/quotes') {
      if (!canServeL2Json(req, sessionState)) {
        return sendJson(res, 401, { error: 'l2_requires_page_session' });
      }
      return sendJson(res, 200, L2_QUOTES);
    }

    if (req.method === 'GET' && url.pathname === '/l3/') {
      return sendHtml(res, 200, l3Page());
    }

    if (req.method === 'GET' && url.pathname === '/l3/styles.css') {
      res.writeHead(200, {
        'content-type': 'text/css; charset=utf-8',
        'content-length': Buffer.byteLength(l3Styles()),
        'cache-control': 'no-store',
      });
      return res.end(l3Styles());
    }

    if (url.pathname.startsWith('/l3/api/')) {
      return sendJson(res, 404, { error: 'l3_has_no_json_data_api' });
    }

    return notFound(res);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const baseUrl = `http://${host}:${actualPort}`;
  appendHarnessEvent({ type: 'fixture-start', baseUrl });

  return {
    baseUrl,
    host,
    port: actualPort,
    server,
    resetLogs: () => {
      resetLogs(logs);
      sessionState.clear();
      appendHarnessEvent({ type: 'fixture-reset' });
    },
    stop: () =>
      new Promise((resolve, reject) => {
        if (typeof server.closeAllConnections === 'function') {
          server.closeAllConnections();
        }
        server.close((err) => {
          if (!err) appendHarnessEvent({ type: 'fixture-stop' });
          err ? reject(err) : resolve();
        });
      }),
  };
}

module.exports = {
  DEFAULT_FIXTURE_PORT,
  FIXTURE_HOST,
  FIXTURE_LOG_PATH,
  HARNESS_LOG_PATH,
  L1_ITEMS,
  L2_QUOTES,
  L3_BOOKS,
  appendHarnessEvent,
  startFixtureServer,
};
