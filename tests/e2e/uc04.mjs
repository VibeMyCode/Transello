// UC-04 page translation in real Chrome (handlers invoked via dist-e2e hook, see run.mjs).
import { assert, check, recordNetwork, section, sleep } from './lib.mjs';

const CYR = /[а-яё]/i;
const BASE = 'http://localhost:8766';

const tabOf = (sw, u) => sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url?.startsWith(u)) ?? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0], u);
const menuPage = (sw, tab) => sw.evaluate((tab) => self.__transelloTest.onMenuClick({ menuItemId: 'translate-page', frameId: 0 }, tab), tab);
const barText = (page) => page.evaluate(() => document.querySelector('transello-overlay')?.shadowRoot?.querySelector('.toolbar')?.textContent ?? '');
const clickBar = (page, label) =>
  page.evaluate((label) => {
    const b = [...document.querySelector('transello-overlay').shadowRoot.querySelectorAll('.toolbar button')].find((x) => x.textContent.match(new RegExp(label)));
    if (!b) throw new Error('no button ' + label);
    b.click();
  }, label);
const waitBar = (page, re, timeout = 240_000) =>
  page.waitForFunction((src) => new RegExp(src).test(document.querySelector('transello-overlay')?.shadowRoot?.querySelector('.toolbar')?.textContent ?? ''), { timeout, polling: 200 }, re.source);
const pageSnapshot = (page) =>
  page.evaluate(() => {
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll('transello-overlay').forEach((n) => n.remove());
    return { html: clone.innerHTML, elements: clone.querySelectorAll('*').length };
  });

export async function uc04({ browser, sw, swTarget }) {
  section('UC-04 translate page');
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto(`${BASE}/docs.html`);
  const tab = await tabOf(sw, `${BASE}/docs.html`);
  const before = await pageSnapshot(page);

  await check('docs page: prose and form labels translated; code/pre/field values/translate=no untouched; structure kept', async () => {
    const net = await recordNetwork([swTarget, await page.target()]);
    await menuPage(sw, tab);
    await waitBar(page, /Переведено блоков|Translated \d/);
    await net.stop();
    const v = await page.evaluate(() => {
      const tx = (id) => document.getElementById(id).textContent;
      return { h1: tx('h1'), intro: tx('intro'), td1: tx('td1'), li1: tx('li1'), nav1: tx('nav1'), pre: tx('pre'), code: tx('code'), flabel: tx('flabel'), submit: tx('submit'), tn: tx('tn'), email: document.getElementById('email').value, href: document.getElementById('nav1').getAttribute('href') };
    });
    const after = await pageSnapshot(page);
    for (const k of ['h1', 'intro', 'td1', 'li1', 'nav1']) assert(CYR.test(v[k]), `${k} not translated: ${v[k]}`);
    assert(v.pre === 'npm install example-package --save' && v.code === 'createClient', 'code changed');
    assert(CYR.test(v.flabel) && CYR.test(v.submit) && v.email === 'person@example.com', `form: ${JSON.stringify(v)}`); // labels yes, values never
    assert(v.tn === 'Example Cloud' && v.href === '#install', 'translate=no / href changed');
    assert(after.elements === before.elements, `element count ${before.elements} → ${after.elements}`);
    const ext = net.seen.filter((u) => !u.startsWith('chrome-extension://') && !u.startsWith(BASE));
    assert(ext.length === 0, 'network: ' + ext.join(','));
    return `${await barText(page)} | h1: ${v.h1}`;
  });

  await check('links and handlers still work after translation', async () => {
    await page.click('#nav1');
    await page.click('#submit');
    assert((await page.evaluate(() => window.__events)) === 2, 'events');
  });

  await check('"Show original" restores the exact original DOM', async () => {
    await clickBar(page, 'оригинал|original');
    await waitBar(page, /Восстановлен|restored/);
    const after = await pageSnapshot(page);
    assert(after.html === before.html, 'DOM differs after restore');
  });

  await check('"Translate again" works after restore', async () => {
    await clickBar(page, 'заново|again');
    await waitBar(page, /Переведено блоков|Translated \d/);
    assert(CYR.test(await page.$eval('#h1', (e) => e.textContent)), 'not translated');
    await clickBar(page, 'оригинал|original');
  });

  await check('SPA view change: no errors, new content untouched, restore safe', async () => {
    const p = await browser.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(`${BASE}/spa.html`);
    const t = await tabOf(sw, `${BASE}/spa.html`);
    await menuPage(sw, t);
    await waitBar(p, /Переведено блоков|Translated \d/);
    assert(CYR.test(await p.$eval('#view-text', (e) => e.textContent)), 'first view not translated');
    await p.click('#nav');
    await clickBar(p, 'оригинал|original');
    await waitBar(p, /Восстановлен|restored/);
    const txt = await p.$eval('#view-text', (e) => e.textContent);
    await clickBar(p, 'заново|again');
    await waitBar(p, /Переведено блоков|Translated \d/);
    const txt2 = await p.$eval('#view-text', (e) => e.textContent);
    await p.close();
    assert(errors.length === 0, errors.join('; '));
    assert(txt === 'Change your notification preferences here.' && CYR.test(txt2), JSON.stringify({ txt, txt2 }));
    return txt2;
  });

  await check('long page: viewport first, cancel midway keeps partial result reversible', async () => {
    const p = await browser.newPage();
    await p.setViewport({ width: 1280, height: 720 });
    await p.goto(`${BASE}/long.html`);
    const t = await tabOf(sw, `${BASE}/long.html`);
    const orig = await pageSnapshot(p);
    await menuPage(sw, t);
    await waitBar(p, /\b[1-9]\d* \/ /); // first batch done
    const top = await p.$eval('#top', (e) => e.textContent);
    await sleep(500);
    await clickBar(p, 'Отмена|Cancel');
    await waitBar(p, /Отменено|Cancelled/);
    const bar = await barText(p);
    await clickBar(p, 'оригинал|original');
    await waitBar(p, /Восстановлен|restored/);
    const restored = await pageSnapshot(p);
    await p.close();
    assert(CYR.test(top), 'heading in viewport not translated first: ' + top);
    assert(restored.html === orig.html, 'restore after cancel differs');
    return bar;
  });

  await check('long page full run: honest node cap message', async () => {
    const p = await browser.newPage();
    await p.goto(`${BASE}/long.html`);
    const t = await tabOf(sw, `${BASE}/long.html`);
    const t0 = Date.now();
    await menuPage(sw, t);
    await waitBar(p, /Переведено блоков|Translated \d/, 600_000);
    const bar = await barText(p);
    await p.close();
    assert(/2000/.test(bar) && /2601/.test(bar), bar);
    return `${bar} (${Math.round((Date.now() - t0) / 1000)} s)`;
  }, { slow: true });

  await check('invoking again while running cancels', async () => {
    const p = await browser.newPage();
    await p.goto(`${BASE}/long.html`);
    const t = await tabOf(sw, `${BASE}/long.html`);
    await menuPage(sw, t);
    await waitBar(p, /\b[1-9]\d* \/ /);
    await menuPage(sw, t);
    await waitBar(p, /Отменено|Cancelled/);
    await p.close();
  });

  await check('follow-up pages on the same site translate by themselves; a page already in the target stays; Show original stops it', async () => {
    const p = await browser.newPage();
    await p.goto(`${BASE}/simple.html`);
    const t = await tabOf(sw, `${BASE}/simple.html`);
    await menuPage(sw, t);
    await waitBar(p, /Переведено блоков|Translated \d/);
    const note = await barText(p);
    await p.goto(`${BASE}/article.html`); // same origin, plain link navigation
    await p.waitForFunction(() => /[а-яё]/i.test(document.getElementById('title')?.textContent ?? ''), { timeout: 120_000 });
    await p.goto(`${BASE}/ru.html`); // already Russian: nothing happens, no toolbar
    await sleep(2500);
    const ruBar = await barText(p);
    const ruTitle = await p.$eval('#title', (e) => e.textContent);
    await p.goto(`${BASE}/article.html`);
    await p.waitForFunction(() => /[а-яё]/i.test(document.getElementById('title')?.textContent ?? ''), { timeout: 120_000 });
    await waitBar(p, /Показать оригинал|Show original/);
    await clickBar(p, 'Показать оригинал|Show original');
    await p.goto(`${BASE}/simple.html`);
    await sleep(2500);
    const after = await p.evaluate(() => document.body.innerText);
    await p.close();
    assert(/автоматически|automatically/.test(note) && ruTitle === 'Прогноз погоды' && !ruBar && !/[а-яё]/i.test(after), JSON.stringify({ note, ruBar, ruTitle, after: after.slice(0, 80) }));
    return note;
  });

  await check('page shortcut translates the page, pressing again shows the original', async () => {
    const p = await browser.newPage();
    await p.goto(`${BASE}/article.html`);
    const t = await tabOf(sw, `${BASE}/article.html`);
    const cmd = () => sw.evaluate((tab) => self.__transelloTest.onCommand('translate-page', tab), t);
    await cmd();
    await p.waitForFunction(() => /[а-яё]/i.test(document.getElementById('title')?.textContent ?? ''), { timeout: 120_000 });
    await waitBar(p, /Показать оригинал|Show original/);
    await cmd();
    await p.waitForFunction(() => document.getElementById('title').textContent === 'Weather report', { timeout: 10_000 });
    await p.close();
  });

  await check('restricted page → Transello window with explanation', async () => {
    const p = await browser.newPage();
    await p.goto('chrome://version');
    const t = await tabOf(sw, 'chrome://version');
    const wait = browser.waitForTarget((x) => x.url().includes('popup.html?window=1'));
    await menuPage(sw, t);
    const win = await (await wait).asPage();
    await win.waitForSelector('#input');
    await sleep(300);
    const meta = await win.$eval('#meta', (m) => m.textContent);
    await win.close();
    await p.close();
    assert(/Chrome/.test(meta), meta);
  });
  await page.close();
}
