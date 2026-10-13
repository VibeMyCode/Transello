// Chrome Web Store assets from the real UI (dist-e2e build, real local translations):
// 4 screenshots 1280×800 + small promo tile 440×280 → store/.
import fs from 'node:fs';
import path from 'node:path';
import { launch, root, serveFixtures, sleep } from '../tests/e2e/lib.mjs';

const out = path.join(root, 'store');
fs.mkdirSync(out, { recursive: true });
const server = await serveFixtures();
const { browser, sw, extId } = await launch();
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
  await pop.waitForFunction(() => document.getElementById('result').textContent.length > 10, { timeout: 60_000 });
  const img = (await pop.screenshot({ encoding: 'base64' })).toString();
  await pop.close();
  const p = await browser.newPage();
  await p.setViewport({ width: 1280, height: 800 });
  await p.setContent(`<html><body style="margin:0;height:800px;display:flex;align-items:center;justify-content:center;gap:72px;
    background:linear-gradient(135deg,#eef0fb,#dfe4fb);font-family:system-ui,-apple-system,sans-serif">
    <div style="max-width:440px"><div style="font-size:44px;font-weight:800;letter-spacing:-.02em;color:#1d2340;line-height:1.1">Paste. Translated.</div>
    <div style="margin-top:18px;font-size:22px;color:#4a5170;line-height:1.45">Auto-detected language, local and private by default. No account, no key.</div></div>
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
await sleep(300);
await shot(page, 'screenshot-2-modal.png');
await page.keyboard.press('Escape');

// 3) Mini popup from the shortcut.
await select(page, 'li2');
await sw.evaluate((tab) => self.__transelloTest.onCommand('translate-selection', tab), tab);
await overlayDone(page, '.mini .text');
await sleep(300);
await shot(page, 'screenshot-3-mini.png');
await page.keyboard.press('Escape');
await page.evaluate(() => getSelection().removeAllRanges());

// 4) Whole page translated, toolbar visible.
await sw.evaluate((tab) => self.__transelloTest.onMenuClick({ menuItemId: 'translate-page', frameId: 0 }, tab), tab);
await page.waitForFunction(() => /Переведено блоков/.test(document.querySelector('transello-overlay')?.shadowRoot?.querySelector('.toolbar')?.textContent ?? ''), { timeout: 120_000 });
await sleep(300);
await shot(page, 'screenshot-4-page.png');

// Small promo tile 440×280.
const tile = await browser.newPage();
await tile.setViewport({ width: 440, height: 280 });
const icon = fs.readFileSync(path.join(root, 'public/icons/icon-128.png')).toString('base64');
await tile.setContent(`<html><body style="margin:0;width:440px;height:280px;display:flex;flex-direction:column;justify-content:center;padding:0 36px;box-sizing:border-box;
  background:linear-gradient(135deg,#4a59e0,#28349e);color:#fff;font-family:system-ui,-apple-system,sans-serif">
  <div style="display:flex;align-items:center;gap:14px"><img src="data:image/png;base64,${icon}" style="width:64px;height:64px;margin:-8px">
  <div style="font-size:38px;font-weight:800;letter-spacing:-.02em">Transello</div></div>
  <div style="margin-top:16px;font-size:19px;line-height:1.35;color:#dfe3ff">Translate with your favorite AI.<br>Local &amp; private by default.</div></body></html>`);
await shot(tile, 'promo-small-440x280.png');

await browser.close();
server.close();
console.log('store assets →', fs.readdirSync(out).join(', '));
