// Chrome Web Store assets from the real UI (dist-e2e build, real local translations):
// 4 screenshots 1280×800 + small promo tile 440×280 → store/ (Russian UI, en→ru).
// STORE_LOCALE=en → store/en/: English UI, en→fr, for the English listing.
import fs from 'node:fs';
import path from 'node:path';
import { launch, root, serveFixtures, sleep } from '../tests/e2e/lib.mjs';

const en = process.env.STORE_LOCALE === 'en';
const out = path.join(root, 'store', en ? 'en' : '');
fs.mkdirSync(out, { recursive: true });
const server = await serveFixtures();
const { browser, sw, extId } = await launch();
const saved = await sw.evaluate(async () => (await chrome.storage.sync.get('settings')).settings);
if (en) await sw.evaluate(async (s) => chrome.storage.sync.set({ settings: { ...s, uiLang: 'en', target: 'fr', recentLangs: ['fr', 'en'] } }), saved);
const shot = (p, name) => p.screenshot({ path: path.join(out, name) });
const tabOf = (u) => sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url?.startsWith(u)), u);
const overlayDone = (p, sel) =>
  p.waitForFunction((s) => {
    const e = document.querySelector('transello-overlay')?.shadowRoot?.querySelector(s);
    return e && e.textContent && !/Переводим|Translating/.test(e.textContent);
  }, { timeout: 60_000 }, sel);
const select = (p, id) =>
  p.evaluate((id) => {
    const r = document.createRange();
    r.selectNodeContents(document.getElementById(id));
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    return getSelection().toString();
  }, id);

// 1) Popup, composed on a calm backdrop with a caption (popup itself is 420 px wide).
{
  const pop = await browser.newPage();
  await pop.setViewport({ width: 420, height: 560, deviceScaleFactor: 2 }); // real popup size
  await pop.goto(`chrome-extension://${extId}/popup.html`);
  await pop.evaluate(() => {
    const i = document.getElementById('input');
    i.value = 'Transello translates text, selections and whole pages right in your browser.\n\nNo account, no API key.';
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(600);
  // A pair without a model asks first (by design): agree once in this test profile, then wait for the result.
  await pop.waitForFunction(() => document.getElementById('result').textContent.length > 10 || document.querySelector('#status .ask'), { timeout: 60_000 });
  if (await pop.$('#status .ask')) await pop.click('#status .ask .primary');
  await pop.waitForFunction(() => document.getElementById('result').textContent.length > 10, { timeout: 180_000 });
  await sleep(1200); // let the decode effect settle
  const img = (await pop.screenshot({ encoding: 'base64' })).toString();
  await pop.close();
  const p = await browser.newPage();
  await p.setViewport({ width: 1280, height: 800 });
  await p.setContent(`<html><body style="margin:0;height:800px;display:flex;align-items:center;justify-content:center;gap:72px;
    background:radial-gradient(50% 60% at 12% 10%,oklch(0.8 0.12 25/.55),transparent 70%),radial-gradient(55% 60% at 95% 15%,oklch(0.8 0.12 255/.6),transparent 70%),#f6f7fb;font-family:system-ui,-apple-system,sans-serif">
    <div style="max-width:440px"><div style="font-size:46px;font-weight:800;letter-spacing:-.03em;color:#14161c;line-height:1.1">Speak fluent<br><span style="background:linear-gradient(110deg in oklch,oklch(0.6 0.19 25),oklch(0.55 0.19 255));-webkit-background-clip:text;color:transparent">internet.</span></div>
    <div style="margin-top:18px;font-size:22px;color:#4a5170;line-height:1.45">Paste and it is translated. Private on your device, or with your favorite AI.</div></div>
    <img src="data:image/png;base64,${img}" style="width:420px;border-radius:14px;box-shadow:0 24px 60px rgba(30,40,90,.25)"></body></html>`);
  await shot(p, 'screenshot-1-popup.png');
  await p.close();
}

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
await page.goto('http://localhost:8766/docs.html');
const tab = await tabOf('http://localhost:8766/docs.html');

// 2) Modal from the context menu.
await select(page, 'intro');
await sw.evaluate((t, tab) => self.__transelloTest.onMenuClick({ menuItemId: 'translate-selection', selectionText: t, frameId: 0 }, tab), await select(page, 'intro'), tab);
await overlayDone(page, '.result');
await sleep(1200);
await shot(page, 'screenshot-2-modal.png');
await page.keyboard.press('Escape');

// 3) Mini popup from the shortcut.
await select(page, 'li2');
await sw.evaluate((tab) => self.__transelloTest.onCommand('translate-selection', tab), tab);
await overlayDone(page, '.mini .text');
await sleep(1200);
await shot(page, 'screenshot-3-mini.png');
await page.keyboard.press('Escape');
await page.evaluate(() => getSelection().removeAllRanges());

// 4) Whole page translated, toolbar visible.
await sw.evaluate((tab) => self.__transelloTest.onMenuClick({ menuItemId: 'translate-page', frameId: 0 }, tab), tab);
await page.waitForFunction(() => /Переведено блоков|Translated/.test(document.querySelector('transello-overlay')?.shadowRoot?.querySelector('.toolbar')?.textContent ?? ''), { timeout: 120_000 });
await sleep(300);
await shot(page, 'screenshot-4-page.png');

// Small promo tile 440×280.
const tile = await browser.newPage();
await tile.setViewport({ width: 440, height: 280 });
const icon = fs.readFileSync(path.join(root, 'public/icons/icon-128.png')).toString('base64');
await tile.setContent(`<html><body style="margin:0;width:440px;height:280px;display:flex;flex-direction:column;justify-content:center;padding:0 34px;box-sizing:border-box;
  background:radial-gradient(70% 80% at 0% 0%,oklch(0.55 0.19 25/.75),transparent 70%),radial-gradient(70% 80% at 100% 10%,oklch(0.55 0.19 255/.8),transparent 70%),radial-gradient(80% 60% at 50% 120%,oklch(0.6 0.15 320/.45),transparent 70%),#0e1015;color:#fff;font-family:system-ui,-apple-system,sans-serif">
  <div style="display:flex;align-items:center;gap:14px"><img src="data:image/png;base64,${icon}" style="width:60px;height:60px;border-radius:14px;box-shadow:0 10px 30px -8px rgba(0,0,0,.6)">
  <div style="font-size:40px;font-weight:800;letter-spacing:-.03em">Transello</div></div>
  <div style="margin-top:18px;font-size:21px;line-height:1.35;color:#eef0ff;font-weight:600">Speak fluent internet.</div>
  <div style="margin-top:4px;font-size:15px;line-height:1.4;color:#c9cde0">Private on-device translation, or your favorite AI.</div></body></html>`);
await shot(tile, 'promo-small-440x280.png');

await sw.evaluate(async (s) => chrome.storage.sync.set({ settings: s }), saved); // the E2E profile expects its own settings
await browser.close();
server.close();
console.log('store assets →', fs.readdirSync(out).join(', '));
