// UC-02 (context menu → modal) and UC-03 (shortcut → mini popover) in real Chrome.
// Native menu/shortcut triggers are replaced by calling the same SW handlers (dist-e2e hook); see run.mjs.
import { assert, check, section, sleep } from './lib.mjs';

const CYR = /[а-яё]/i;
const BASE = 'http://localhost:8766';

async function tabOf(sw, urlPrefix) {
  // Without the `tabs` permission chrome:// URLs are hidden; Chrome passes the tab to real handlers, tests use the active one.
  return sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url?.startsWith(u)) ?? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0], urlPrefix);
}

async function selectText(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const r = document.createRange();
    r.selectNodeContents(el);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    const b = r.getBoundingClientRect();
    return { text: getSelection().toString(), rect: { left: b.left, top: b.top, bottom: b.bottom, right: b.right } };
  }, selector);
}

const menu = (sw, tab, info) => sw.evaluate((info, tab) => self.__transelloTest.onMenuClick(info, tab), info, tab);
const command = (sw, tab) => sw.evaluate((tab) => self.__transelloTest.onCommand('translate-selection', tab), tab);

async function waitOverlay(page, sel, timeout = 60_000) {
  await page.waitForSelector(`transello-overlay >>> ${sel}`, { timeout });
  return page.$(`transello-overlay >>> ${sel}`);
}

async function overlayText(page, sel) {
  const h = await page.$(`transello-overlay >>> ${sel}`);
  return h ? h.evaluate((e) => e.textContent) : null;
}

async function waitResult(page, sel) {
  await page.waitForFunction(
    (sel) => {
      const root = document.querySelector('transello-overlay')?.shadowRoot;
      const el = root?.querySelector(sel);
      const st = root?.querySelector('.status, .meta');
      return (el && el.textContent && !/Переводим|Translating/.test(el.textContent)) || (st && /error/.test(st.className));
    },
    { timeout: 60_000, polling: 100 },
    sel,
  );
  return overlayText(page, sel);
}

export async function uc02({ browser, sw }) {
  section('UC-02 selection → context menu → modal');
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto(`${BASE}/article.html`);
  const tab = await tabOf(sw, `${BASE}/article.html`);
  const before = await page.evaluate(() => document.body.innerHTML);

  await check('modal opens with original + translation, dialog semantics, focus inside', async () => {
    await page.focus('#name');
    const { text } = await selectText(page, '#p1');
    await menu(sw, tab, { menuItemId: 'translate-selection', selectionText: text, frameId: 0 });
    await waitOverlay(page, '.modal');
    const out = await waitResult(page, '.result');
    const a11y = await page.$eval('transello-overlay >>> .modal', (m) => ({ role: m.getAttribute('role'), modal: m.getAttribute('aria-modal'), focusInside: m.getRootNode().activeElement !== null }));
    assert(CYR.test(out), out);
    assert(a11y.role === 'dialog' && a11y.modal === 'true' && a11y.focusInside, JSON.stringify(a11y));
    return out;
  });

  await check('page CSS does not leak into the overlay (Shadow DOM)', async () => {
    const st = await page.$eval('transello-overlay >>> .result', (e) => ({ ls: getComputedStyle(e).letterSpacing, ff: getComputedStyle(e).fontFamily }));
    assert(st.ls === 'normal' && !/comic/i.test(st.ff), JSON.stringify(st));
    return JSON.stringify(st);
  });

  await check('Tab focus is trapped inside the modal', async () => {
    for (let i = 0; i < 8; i++) await page.keyboard.press('Tab');
    const inside = await page.evaluate(() => document.activeElement?.tagName === 'TRANSELLO-OVERLAY');
    assert(inside, 'focus escaped to ' + (await page.evaluate(() => document.activeElement?.tagName)));
  });

  await check('page key handlers do not fire while typing in the modal', async () => {
    const k0 = await page.evaluate(() => window.__pageKeys);
    await page.keyboard.press('ArrowDown');
    const k1 = await page.evaluate(() => window.__pageKeys);
    assert(k1 === k0, `${k0} → ${k1}`);
  });

  await check('Escape closes, focus returns, page DOM unchanged', async () => {
    await page.keyboard.press('Escape');
    await sleep(100);
    const st = await page.evaluate(() => ({ overlay: !!document.querySelector('transello-overlay')?.shadowRoot?.querySelector('.modal'), focus: document.activeElement?.id }));
    const after = await page.evaluate(() => document.body.innerHTML);
    assert(!st.overlay, 'modal still open');
    assert(st.focus === 'name', 'focus ' + st.focus);
    assert(after === before, 'page DOM changed');
    return 'focus back on #name';
  });

  await check('repeated invocation keeps a single modal; backdrop click closes', async () => {
    const { text } = await selectText(page, '#p2');
    await menu(sw, tab, { menuItemId: 'translate-selection', selectionText: text, frameId: 0 });
    await menu(sw, tab, { menuItemId: 'translate-selection', selectionText: text, frameId: 0 });
    await waitResult(page, '.result');
    const n = await page.evaluate(() => document.querySelector('transello-overlay').shadowRoot.querySelectorAll('.modal').length);
    await page.mouse.click(10, 10);
    await sleep(100);
    const open = await page.evaluate(() => !!document.querySelector('transello-overlay').shadowRoot.querySelector('.modal'));
    assert(n === 1 && !open, JSON.stringify({ n, open }));
  });

  await check('selection inside textarea (selectionText from menu)', async () => {
    await page.evaluate(() => {
      const ta = document.getElementById('ta');
      ta.focus();
      ta.setSelectionRange(0, ta.value.length);
    });
    await menu(sw, tab, { menuItemId: 'translate-selection', selectionText: 'Good evening, my friend.', frameId: 0 });
    const out = await waitResult(page, '.result');
    await page.keyboard.press('Escape');
    assert(CYR.test(out), out);
    return out;
  });

  await check('hostile text is shown as plain text; no HTML executed', async () => {
    const { text } = await selectText(page, '#evil');
    await page.evaluate(() => (window.__alerts = 0, (window.alert = () => window.__alerts++)));
    await menu(sw, tab, { menuItemId: 'translate-selection', selectionText: text, frameId: 0 });
    const out = await waitResult(page, '.result');
    const st = await page.evaluate(() => ({ imgs: document.querySelector('transello-overlay').shadowRoot.querySelectorAll('img').length, alerts: window.__alerts }));
    const src = await overlayText(page, '.source');
    await page.keyboard.press('Escape');
    assert(st.imgs === 0 && st.alerts === 0 && src.includes('<img src=x'), JSON.stringify({ st, src }));
    return out;
  });

  await check('long selection is limited honestly', async () => {
    const long = Array.from({ length: 3000 }, (_, i) => `Sentence ${i} is here.`).join(' '); // ~68k chars > limits
    await menu(sw, tab, { menuItemId: 'translate-selection', selectionText: long, frameId: 0 });
    await waitOverlay(page, '.modal');
    await page
      .waitForFunction(() => /символ|characters/.test(document.querySelector('transello-overlay').shadowRoot.querySelector('.status')?.textContent ?? ''), { timeout: 300_000 })
      .catch(async (e) => assert(false, `${e.message}; status: ${await overlayText(page, '.status')}`));
    const status = await overlayText(page, '.status');
    await page.keyboard.press('Escape');
    return status;
  }, { slow: true });

  await check('strict-CSP site: overlay still styled (constructable stylesheet)', async () => {
    const p = await browser.newPage();
    await p.goto(`${BASE}/csp/article.html`);
    const t = await tabOf(sw, `${BASE}/csp/article.html`);
    const { text } = await selectText(p, '#p1');
    await menu(sw, t, { menuItemId: 'translate-selection', selectionText: text, frameId: 0 });
    await waitOverlay(p, '.modal');
    const out = await waitResult(p, '.result');
    const bg = await p.$eval('transello-overlay >>> .modal', (m) => getComputedStyle(m).borderRadius);
    await p.close();
    assert(bg === '20px' && CYR.test(out), JSON.stringify({ bg, out }));
    return `border-radius ${bg}; ${out}`;
  });

  await check('Permissions-Policy translator=() site still translates (engine runs in SW)', async () => {
    const p = await browser.newPage();
    await p.goto(`${BASE}/pp/article.html`);
    const t = await tabOf(sw, `${BASE}/pp/article.html`);
    const { text } = await selectText(p, '#p2');
    await menu(sw, t, { menuItemId: 'translate-selection', selectionText: text, frameId: 0 });
    const out = await waitResult(p, '.result');
    await p.close();
    assert(CYR.test(out), out);
    return out;
  });

  await check('same-origin iframe selection opens the modal inside that frame', async () => {
    const p = await browser.newPage();
    await p.goto(`${BASE}/frame.html`);
    await p.waitForSelector('iframe');
    const t = await tabOf(sw, `${BASE}/frame.html`);
    const frames = await sw.evaluate((id) => chrome.scripting.executeScript({ target: { tabId: id, allFrames: true }, func: () => location.pathname }), t.id);
    const sub = frames.find((f) => f.result === '/article.html');
    const frame = p.frames().find((f) => f.url().endsWith('/article.html'));
    const { text } = await selectText(frame, '#p1');
    await menu(sw, t, { menuItemId: 'translate-selection', selectionText: text, frameId: sub.frameId });
    await frame.waitForSelector('transello-overlay >>> .modal', { timeout: 30_000 });
    await p.close();
    return `frameId ${sub.frameId}`;
  });

  await check('restricted page (chrome://) → falls back to Transello window with the text', async () => {
    const p = await browser.newPage();
    await p.goto('chrome://version');
    const t = await tabOf(sw, 'chrome://version');
    const wait = browser.waitForTarget((x) => x.url().includes('popup.html?window=1'));
    await menu(sw, t, { menuItemId: 'translate-selection', selectionText: 'Hello from a protected page', frameId: 0 });
    const win = await (await wait).asPage();
    await win.waitForFunction(() => document.getElementById('input').value.length > 0);
    const v = await win.evaluate(() => ({ text: document.getElementById('input').value, meta: document.getElementById('meta').textContent }));
    await win.close();
    await p.close();
    assert(v.text === 'Hello from a protected page' && /Chrome/.test(v.meta), JSON.stringify(v));
    return v.meta;
  });
  await page.close();
}

export async function uc03({ browser, sw }) {
  section('UC-03 selection → shortcut → mini popover');
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto(`${BASE}/article.html`);
  const tab = await tabOf(sw, `${BASE}/article.html`);
  const box = () => page.$eval('transello-overlay >>> .mini', (m) => { const r = m.getBoundingClientRect(); return { left: r.left, top: r.top, bottom: r.bottom, right: r.right }; });
  const miniOpen = () => page.evaluate(() => !!document.querySelector('transello-overlay')?.shadowRoot?.querySelector('.mini'));

  await check('popover appears right under the selection with a loading state, then the result', async () => {
    const { rect } = await selectText(page, '#p1');
    const t0 = Date.now();
    await command(sw, tab);
    await waitOverlay(page, '.mini');
    const firstPaint = Date.now() - t0;
    const out = await waitResult(page, '.mini .text');
    const b = await box();
    assert(CYR.test(out), out);
    assert(b.top >= rect.bottom && b.top - rect.bottom < 20 && Math.abs(b.left - rect.left) < 2, JSON.stringify({ b, rect }));
    return `popover in ${firstPaint} ms; "${out}"`;
  });

  await check('same shortcut again on the same selection closes it', async () => {
    await command(sw, tab);
    await sleep(150);
    assert(!(await miniOpen()), 'still open');
  });

  await check('new selection while open updates the single popover', async () => {
    await selectText(page, '#p1');
    await command(sw, tab);
    await waitResult(page, '.mini .text');
    await selectText(page, '#p2');
    await command(sw, tab);
    const out = await waitResult(page, '.mini .text');
    const n = await page.evaluate(() => document.querySelector('transello-overlay').shadowRoot.querySelectorAll('.mini').length);
    assert(n === 1 && /дожд|завтра/i.test(out), JSON.stringify({ n, out }));
    return out;
  });

  await check('Escape closes; ordinary typing on the page is not intercepted', async () => {
    await page.keyboard.press('Escape');
    await sleep(100);
    assert(!(await miniOpen()), 'still open');
    const k0 = await page.evaluate(() => window.__pageKeys);
    await page.click('#name');
    await page.keyboard.type('abc');
    const k1 = await page.evaluate(() => window.__pageKeys);
    assert(k1 - k0 === 3, `${k0}→${k1}`);
  });

  await check('no selection → neutral hint + open-window action', async () => {
    await page.evaluate(() => { getSelection().removeAllRanges(); document.activeElement?.blur(); });
    await command(sw, tab);
    await waitOverlay(page, '.mini');
    const txt = await overlayText(page, '.mini .text');
    await page.keyboard.press('Escape');
    assert(/Выделите|Select/.test(txt), txt);
    return txt;
  });

  await check('password field selection is never read', async () => {
    await page.evaluate(() => { const pw = document.getElementById('pw'); pw.focus(); pw.select(); });
    await command(sw, tab);
    await waitOverlay(page, '.mini');
    const txt = await overlayText(page, '.mini .text');
    await page.keyboard.press('Escape');
    assert(/Выделите|Select/.test(txt), txt);
  });

  await check('selection inside a textarea', async () => {
    await page.evaluate(() => { const ta = document.getElementById('ta'); ta.focus(); ta.setSelectionRange(0, 12); });
    await command(sw, tab);
    const out = await waitResult(page, '.mini .text');
    await page.keyboard.press('Escape');
    assert(CYR.test(out), out);
    return out;
  });

  await check('follows scrolling; stays inside a narrow viewport', async () => {
    await page.setViewport({ width: 420, height: 600 });
    await page.evaluate(() => document.getElementById('bottom').scrollIntoView({ block: 'center' }));
    await selectText(page, '#bottom');
    await command(sw, tab);
    await waitResult(page, '.mini .text');
    const b1 = await box();
    await page.evaluate(() => scrollBy(0, -60)); // page is at max scroll; scroll up
    await sleep(200);
    const b2 = await box();
    await page.keyboard.press('Escape');
    await page.setViewport({ width: 1280, height: 720 });
    assert(b1.left >= 8 && b1.right <= 412, 'outside viewport ' + JSON.stringify(b1));
    assert(Math.abs(b2.top - b1.top - 60) < 3, JSON.stringify({ b1, b2 }));
    return `moved ${Math.round(b2.top - b1.top)}px with 60px scroll`;
  });

  await check('click outside closes the popover', async () => {
    await selectText(page, '#p1');
    await command(sw, tab);
    await waitOverlay(page, '.mini');
    await page.mouse.click(1200, 650);
    await sleep(100);
    assert(!(await miniOpen()), 'still open');
  });

  await check('restricted page → Transello window instead of failing silently', async () => {
    const p = await browser.newPage();
    await p.goto('chrome://version');
    const t = await tabOf(sw, 'chrome://version');
    const wait = browser.waitForTarget((x) => x.url().includes('popup.html?window=1'));
    await command(sw, t);
    const win = await (await wait).asPage();
    await win.waitForSelector('#input');
    await sleep(300);
    const meta = await win.$eval('#meta', (m) => m.textContent);
    await win.close();
    await p.close();
    assert(/Chrome/.test(meta), meta);
    return meta;
  });
  await page.close();
}
