// Real-Chrome E2E harness (branded Chrome: puppeteer's default flags disable the Translator API and Chrome for Testing never downloads language packs).
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

export const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
export const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const PROFILE = process.env.E2E_PROFILE || path.join(root, '.profile-e2e');

export const results = [];
export const swLogs = [];
let current = '';
export function section(name) {
  current = name;
  console.log(`\n== ${name}`);
}
/** `slow` checks (minutes in Brave, untouched by most fixes) run only with E2E_SLOW=1, e.g. before a release. */
export async function check(name, fn, { slow = false } = {}) {
  if (slow && !process.env.E2E_SLOW) {
    results.push({ section: current, name, status: 'SKIP', ms: 0, note: 'slow: set E2E_SLOW=1' });
    return console.log(`  SKIP ${name} (slow: set E2E_SLOW=1)`);
  }
  const t0 = Date.now();
  try {
    const note = await fn();
    results.push({ section: current, name, status: 'PASS', ms: Date.now() - t0, note: note ?? '' });
    console.log(`  PASS ${name}${note ? ' — ' + note : ''}`);
  } catch (e) {
    results.push({ section: current, name, status: 'FAIL', ms: Date.now() - t0, note: String(e?.message ?? e).slice(0, 300) });
    console.log(`  FAIL ${name} — ${String(e?.message ?? e).slice(0, 300)}`);
  }
}
export function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Static fixture server for tests/fixtures (+ a CSP-strict and a Permissions-Policy-blocking variant). */
export function serveFixtures(port = 8766) {
  const dir = path.join(root, 'tests/fixtures');
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const file = path.join(dir, url.pathname === '/' ? 'simple.html' : url.pathname.replace(/^\/(csp|pp)\//, '/'));
    if (!file.startsWith(dir) || !fs.existsSync(file)) return res.writeHead(404).end('not found');
    res.setHeader('content-type', file.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain');
    if (url.pathname.startsWith('/csp/')) res.setHeader('content-security-policy', "default-src 'none'; style-src 'none'; script-src 'none'");
    if (url.pathname.startsWith('/pp/')) res.setHeader('permissions-policy', 'translator=(), language-detector=()');
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(port, () => r(server)));
}

export async function launch() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: false,
    pipe: true,
    enableExtensions: true,
    userDataDir: PROFILE,
    ignoreDefaultArgs: true, // puppeteer defaults disable Translate/OptimizationHints/component updates
    defaultViewport: null,
    protocolTimeout: 300_000,
    args: [`--user-data-dir=${PROFILE}`, '--no-first-run', '--disable-session-crashed-bubble', '--hide-crash-restore-bubble', '--no-default-browser-check', '--remote-debugging-pipe', '--enable-unsafe-extension-debugging', '--use-mock-keychain', '--password-store=basic', '--window-size=1280,800', '--window-position=3000,0', ...(process.env.E2E_CHROME_ARGS ? process.env.E2E_CHROME_ARGS.split(' ') : []), 'about:blank'],
  });
  // A persistent profile can keep a previous build's service worker running (same id + version):
  // uninstall + reinstall guarantees the fresh build and a clean extension storage for every run.
  // A crashed previous run makes the browser restore old tabs; tests look tabs up by URL, so close them.
  for (const pg of await browser.pages()) if (pg.url() !== 'about:blank') await pg.close().catch(() => {});
  const dir = path.join(root, 'dist-e2e');
  let extId = await browser.installExtension(dir);
  await browser.uninstallExtension(extId);
  extId = await browser.installExtension(dir);
  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().startsWith(`chrome-extension://${extId}/`));
  const sw = await swTarget.worker();
  // Collect SW console + lifecycle for diagnostics (codes only; the extension never logs text or keys).
  const attach = async (t) => {
    const s = await t.createCDPSession();
    await s.send('Runtime.enable');
    s.on('Runtime.consoleAPICalled', (e) => swLogs.push(`${new Date().toISOString()} ${e.type} ${e.args.map((a) => a.value ?? a.description).join(' ')}`));
    s.on('Runtime.exceptionThrown', (e) => swLogs.push(`${new Date().toISOString()} EXC ${e.exceptionDetails.exception?.description ?? e.exceptionDetails.text}`));
  };
  await attach(swTarget);
  browser.on('targetcreated', (t) => t.type() === 'service_worker' && t.url().startsWith(`chrome-extension://${extId}/`) && (swLogs.push(`${new Date().toISOString()} SW (re)started`), attach(t)));
  browser.on('targetdestroyed', (t) => t.type() === 'service_worker' && t.url().startsWith(`chrome-extension://${extId}/`) && swLogs.push(`${new Date().toISOString()} SW stopped`));
  await browser.defaultBrowserContext().overridePermissions(`chrome-extension://${extId}`, ['clipboard-read', 'clipboard-sanitized-write']);
  return { browser, extId, sw, swTarget };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Record network requests from a page and the SW (privacy check NFR-07). */
export async function recordNetwork(targets) {
  const seen = [];
  const sessions = [];
  for (const t of targets) {
    const s = await t.createCDPSession();
    await s.send('Network.enable');
    s.on('Network.requestWillBeSent', (e) => seen.push(e.request.url));
    sessions.push(s);
  }
  return { seen, stop: () => Promise.all(sessions.map((s) => s.detach().catch(() => {}))) };
}

export function writeResults(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ date: new Date().toISOString(), results }, null, 2));
}
