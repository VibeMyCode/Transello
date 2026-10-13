// UC-01 (action popup) in real Chrome with the real built-in Translator.
import { assert, check, recordNetwork, section, sleep } from './lib.mjs';

const CYR = /[а-яё]/i;

export async function openPopupTab(browser, extId, query = '') {
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${extId}/popup.html${query}`);
  await page.waitForSelector('#input');
  return page;
}

export async function paste(page, text) {
  await page.evaluate((t) => {
    const i = document.getElementById('input');
    i.value = t;
    i.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
}

const snapshot = (page) =>
  page.evaluate(() => ({
    result: document.getElementById('result').textContent,
    status: document.getElementById('status').textContent,
    meta: document.getElementById('meta').textContent,
    error: document.getElementById('status').classList.contains('error'),
  }));

/** Run `action` in the page and wait for the next busy→idle cycle of #output (or a quick no-op render). */
export async function cycle(page, action, timeout = 180_000) {
  // action: { input: text } | { click: selector }. Extension CSP forbids eval, so no function strings.
  await page.evaluate(
    (action, timeout) =>
      new Promise((resolve, reject) => {
        const out = document.getElementById('output');
        let sawBusy = false;
        const ob = new MutationObserver(() => {
          if (out.getAttribute('aria-busy') === 'true') sawBusy = true;
          else if (sawBusy) done();
        });
        const done = () => (ob.disconnect(), clearTimeout(to), resolve());
        const to = setTimeout(() => (ob.disconnect(), reject(new Error('timeout'))), timeout);
        ob.observe(out, { attributes: true, attributeFilter: ['aria-busy'] });
        if (action.click) document.querySelector(action.click).click();
        else {
          const i = document.getElementById('input');
          i.value = action.input;
          i.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }),
    action,
    timeout,
  );
  return snapshot(page);
}

/** Wait until idle (used after clicks that start a new translation). */
export async function settled(page, timeout = 180_000) {
  await page.waitForFunction(() => document.getElementById('output').getAttribute('aria-busy') === 'false', { timeout, polling: 50 });
  return snapshot(page);
}

async function translateVia(page, text) {
  if (!text.trim()) {
    await paste(page, text);
    await new Promise((r) => setTimeout(r, 500));
    return snapshot(page);
  }
  return cycle(page, { input: text });
}

export async function uc01({ browser, extId, sw, swTarget }) {
  section('UC-01 action popup');
  await check('real toolbar popup opens via chrome.action.openPopup()', async () => {
    await sw.evaluate(() => chrome.action.openPopup());
    const t = await browser.waitForTarget((t) => t.url() === `chrome-extension://${extId}/popup.html` && t.type() !== 'service_worker', { timeout: 5000 });
    const p = await t.asPage();
    await new Promise((r) => setTimeout(r, 400));
    const nav = await p.evaluate(() => {
      const n = performance.getEntriesByType('navigation')[0];
      return { dcl: Math.round(n.domContentLoadedEventEnd), focus: document.activeElement?.id, w: innerWidth, h: innerHeight };
    });
    await p.close();
    assert(nav.focus === 'input', 'focus not in input: ' + nav.focus);
    assert(nav.w >= 400 && nav.h >= 500, 'popup window too small: ' + JSON.stringify(nav)); // regression: vw/vh collapsed it to 28 px
    return `DOMContentLoaded ${nav.dcl} ms, focus=#input, popup window ${nav.w}×${nav.h}`;
  });

  const page = await openPopupTab(browser, extId);
  await page.evaluate(() => chrome.storage.sync.set({ settings: { target: 'ru' } }));
  await page.reload();
  await page.waitForSelector('#input');

  await check('popup size stays fixed while text grows (no jumping window)', async () => {
    const size = () => page.evaluate(() => { const r = document.querySelector('.app').getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; });
    await page.setViewport({ width: 420, height: 560 });
    const s0 = await size();
    await translateVia(page, Array.from({ length: 40 }, (_, i) => `Line number ${i} of a long pasted text.`).join('\n'));
    const s1 = await size();
    const scrolls = await page.evaluate(() => document.getElementById('output').scrollHeight > document.getElementById('output').clientHeight);
    await translateVia(page, '');
    const s2 = await size();
    await page.setViewport(null);
    assert(s0 === s1 && s1 === s2 && scrolls, JSON.stringify({ s0, s1, s2, scrolls }));
    return `${s0} constant; long result scrolls inside`;
  });

  await check('cursor is in the input on open (NFR-06: open → paste)', async () => {
    assert((await page.evaluate(() => document.activeElement?.id)) === 'input', 'focus');
  });

  await check('empty input shows ready hint', async () => {
    const r = await translateVia(page, '');
    assert(r.result === '' && !r.error, JSON.stringify(r));
    return r.status;
  });

  for (const [lang, text] of [
    ['EN', 'The weather is lovely today, and we are going to the park.'],
    ['DE', 'Das Wetter ist heute schön und wir gehen in den Park.'],
    ['ES', 'Hoy hace buen tiempo y vamos al parque.'],
  ]) {
    await check(`${lang} → RU (auto-detect, first run may download pack)`, async () => {
      const t0 = Date.now();
      const r = await translateVia(page, text);
      assert(!r.error && CYR.test(r.result), JSON.stringify(r));
      return `"${r.result}" (${r.meta}; ${Date.now() - t0} ms incl. any download)`;
    });
  }

  await check('multiline + emoji + URL + code preserved', async () => {
    const src = 'First line 👋\nSecond line: https://example.com/path?q=1\n\nThird paragraph with `code`.';
    const r = await translateVia(page, src);
    assert(!r.error, r.status);
    assert(r.result.split('\n').length === src.split('\n').length, 'line count ' + JSON.stringify(r.result));
    assert(r.result.includes('https://example.com/path?q=1'), 'url lost');
    assert(r.result.includes('👋'), 'emoji lost');
    return JSON.stringify(r.result);
  });

  await check('mixed Latin + Cyrillic input', async () => {
    const r = await translateVia(page, 'Please send the отчёт by Friday, thanks.');
    assert(!r.error && CYR.test(r.result), JSON.stringify(r));
    return r.result;
  });

  await check('auto: text already in target → switches to the other recent language, both ways (user case)', async () => {
    const stored = () => page.evaluate(async () => (await chrome.storage.sync.get('settings')).settings.target);
    const r = await translateVia(page, 'Привет! Как у тебя дела сегодня?'); // ru text, target ru
    await page.waitForFunction(() => document.getElementById('target').value !== 'ru', { timeout: 5_000 });
    const t1 = await page.$eval('#target', (s) => s.value);
    assert(!r.error && !CYR.test(r.result) && t1 !== 'ru' && (await stored()) === t1, JSON.stringify({ r, t1 }));
    await page.select('#target', 'en');
    await settled(page);
    const r2 = await translateVia(page, 'The weather is lovely today, let us go for a walk.'); // en text, target en
    await page.waitForFunction(() => document.getElementById('target').value === 'ru', { timeout: 5_000 }).catch(() => {});
    const t2 = await page.$eval('#target', (s) => s.value);
    assert(!r2.error && CYR.test(r2.result) && t2 === 'ru' && (await stored()) === 'ru', JSON.stringify({ r2, t2 }));
    return `ru→${t1}: "${r.result}"; en→ru: "${r2.result}"`;
  });

  await check('explicit source == target → honest message + swap action', async () => {
    await page.select('#source', 'ru');
    const r = await translateVia(page, 'Привет! Как у тебя дела сегодня?');
    assert(/русск|russian/i.test(r.status), r.status);
    const r2 = await cycle(page, { click: '#meta button' });
    await page.select('#source', 'auto');
    await page.select('#target', 'ru');
    await settled(page);
    assert(!r2.error && !CYR.test(r2.result) && r2.result.length > 3, JSON.stringify(r2));
    return `"${r.status}" → button → "${r2.result}"`;
  });

  await check('target change persists and applies to next request (RU → EN)', async () => {
    await page.select('#target', 'en');
    await settled(page);
    const r = await translateVia(page, 'Сегодня отличная погода.');
    assert(!r.error && !CYR.test(r.result), JSON.stringify(r));
    const stored = await page.evaluate(async () => (await chrome.storage.sync.get('settings')).settings.target);
    assert(stored === 'en', 'stored ' + stored);
    await page.select('#target', 'ru');
    await settled(page);
    return r.result;
  });

  await check('recently used languages are listed first', async () => {
    await page.select('#target', 'de');
    await settled(page);
    await page.select('#target', 'fr');
    await settled(page);
    await page.select('#target', 'ru');
    await settled(page);
    const g = await page.$eval('#target', (s) => [...s.querySelectorAll('optgroup')].map((o) => ({ label: o.label, first: [...o.children].slice(0, 3).map((x) => x.value) })));
    assert(g[0].label.length > 0 && g[0].first.join() === 'ru,fr,de' && g.length === 2, JSON.stringify(g));
    return JSON.stringify(g.map((x) => `${x.label}: ${x.first.join(',')}…`));
  });

  await check('single word: detector guess marked uncertain', async () => {
    const r = await translateVia(page, 'Hund');
    assert(/not sure|не уверены/i.test(r.meta), 'meta: ' + r.meta);
    return r.meta + ' / result: ' + r.result;
  });

  await check('manual source language overrides detection', async () => {
    await page.select('#source', 'de');
    await settled(page);
    const r = await translateVia(page, 'Hund ');
    await page.select('#source', 'auto');
    assert(/собак|пёс|пес/i.test(r.result), r.result);
    return r.result;
  });

  await check('stale responses never overwrite newer input (NFR-03)', async () => {
    // A: ~300 lines → in flight for a while. B pasted while A runs. No render of A may appear after B is pasted.
    const longA = Array.from({ length: 300 }, (_, i) => `This is discarded line number ${i}.`).join('\n');
    await page.evaluate(() => {
      window.__renders = [];
      new MutationObserver(() => window.__renders.push(document.getElementById('result').textContent)).observe(document.getElementById('result'), { childList: true, characterData: true, subtree: true });
    });
    await paste(page, longA);
    await page.waitForFunction(() => document.getElementById('output').getAttribute('aria-busy') === 'true', { polling: 10 });
    await sleep(150);
    const r = await cycle(page, { input: 'Good morning.' });
    await sleep(1500);
    const renders = await page.evaluate(() => window.__renders.filter(Boolean));
    const stale = renders.filter((x) => /отбро|строк|номер|discard/i.test(x));
    assert(/утр/i.test(r.result) && stale.length === 0, JSON.stringify({ final: r.result, stale: stale.map((x) => x.slice(0, 40)) }));
    return `final "${r.result}", ${renders.length} renders, 0 stale`;
  });

  await check('rapid typing debounced (no request per keystroke)', async () => {
    await paste(page, '');
    await settled(page);
    const net = await recordNetwork([swTarget]);
    await page.bringToFront();
    await page.focus('#input');
    await page.evaluate(() => {
      window.__runs = 0;
      new MutationObserver(() => document.getElementById('output').getAttribute('aria-busy') === 'true' && window.__runs++).observe(document.getElementById('output'), { attributes: true });
    });
    await page.keyboard.type('Nice to meet you', { delay: 30 });
    await new Promise((r) => setTimeout(r, 600));
    const r = await settled(page);
    await net.stop();
    const runs = await page.evaluate(() => window.__runs);
    assert(CYR.test(r.result) && runs === 1, JSON.stringify({ r, runs }));
    return `${runs} request for 16 keystrokes → ${r.result}`;
  });

  await check('copy passes exactly the translation to the clipboard API', async () => {
    const r = await translateVia(page, 'Line one.\nLine two.');
    // Stub the API: the test must not read or overwrite the tester's real system clipboard.
    await page.evaluate(() => (navigator.clipboard.writeText = async (s) => void (window.__copied = s)));
    await page.click('#copy');
    const clip = await page.evaluate(() => window.__copied);
    const label = await page.$eval('#copy', (b) => b.textContent);
    assert(clip === r.result, JSON.stringify({ clip, result: r.result }));
    return `${JSON.stringify(clip)}; button shows "${label}"`;
  });

  await check('local mode sends no network requests (NFR-07)', async () => {
    const net = await recordNetwork([swTarget, await page.target()]);
    await translateVia(page, 'Privacy check sentence number ' + Date.now());
    await net.stop();
    const external = net.seen.filter((u) => !u.startsWith('chrome-extension://') && !u.startsWith('data:'));
    assert(external.length === 0, external.join(', '));
    return `${net.seen.length} requests, 0 external`;
  });

  await check('draft survives closing and reopening the popup (session storage)', async () => {
    await paste(page, 'Draft text to keep');
    await sleep(200);
    await page.close();
    const p2 = await openPopupTab(browser, extId);
    const v = await p2.$eval('#input', (i) => i.value);
    await p2.close();
    assert(v === 'Draft text to keep', v);
  });

  await check('standalone window keeps the text (open in window)', async () => {
    const p = await openPopupTab(browser, extId);
    await paste(p, 'Window handoff text');
    const wait = browser.waitForTarget((t) => t.url().includes('popup.html?window=1'));
    await p.click('#openWindow').catch(() => {}); // popup closes itself
    const win = await (await wait).asPage();
    await win.waitForSelector('#input');
    await win.waitForFunction(() => document.getElementById('input').value.length > 0);
    const v = await win.$eval('#input', (i) => i.value);
    const r = await settled(win);
    await win.close();
    assert(v === 'Window handoff text' && CYR.test(r.result), JSON.stringify({ v, r }));
    return r.result;
  });

  await check('warm local latency through the UI: 20 short phrases', async () => {
    const p = await openPopupTab(browser, extId);
    const times = [];
    for (let i = 0; i < 20; i++) {
      await paste(p, '');
      await settled(p);
      const t = await p.evaluate(async (n) => {
        const i = document.getElementById('input');
        const out = document.getElementById('output');
        i.value = `The meeting starts at ${n} o'clock.`;
        const t0 = performance.now();
        i.dispatchEvent(new Event('input', { bubbles: true }));
        document.getElementById('translate').click(); // skip debounce: measure engine+UI only
        await new Promise((r) => {
          const ob = new MutationObserver(() => document.getElementById('result').textContent && out.getAttribute('aria-busy') === 'false' && (ob.disconnect(), r()));
          ob.observe(out, { subtree: true, childList: true, characterData: true, attributes: true });
        });
        return performance.now() - t0;
      }, i + 1);
      times.push(t);
    }
    await p.close();
    times.sort((a, b) => a - b);
    const p50 = Math.round(times[9]);
    const p95 = Math.round(times[18]);
    assert(p95 < 2000, 'p95 ' + p95);
    return `P50 ${p50} ms, P95 ${p95} ms (NFR-02 target < 2000 ms)`;
  });
}
