// Visual check + store screenshot drafts (1280×800) of the modal and mini popover. Uses dist-e2e handlers.
import { launch, serveFixtures, sleep } from '../tests/e2e/lib.mjs';
const server = await serveFixtures();
const { browser, sw } = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
await page.goto('http://localhost:8766/article.html');
await page.addStyleTag({ content: '*{font-family: Georgia, serif !important; letter-spacing: normal !important}' });
const tab = await sw.evaluate(async () => (await chrome.tabs.query({ url: 'http://localhost/*' }))[0]);
const sel = (id) => page.evaluate((id) => { const r = document.createRange(); r.selectNodeContents(document.getElementById(id)); getSelection().removeAllRanges(); getSelection().addRange(r); return getSelection().toString(); }, id);
const done = (s) => page.waitForFunction((s) => { const e = document.querySelector('transello-overlay')?.shadowRoot?.querySelector(s); return e && e.textContent && !/Переводим/.test(e.textContent); }, { timeout: 60000 }, s);
for (const scheme of ['light', 'dark']) {
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
  const text = await sel('p2');
  await sw.evaluate((t, tab) => self.__transelloTest.onMenuClick({ menuItemId: 'translate-selection', selectionText: t, frameId: 0 }, tab), text, tab);
  await done('.result');
  await sleep(300);
  await page.screenshot({ path: `docs/screenshots/modal-${scheme}.png` });
  await page.keyboard.press('Escape');
  await sel('p1');
  await sw.evaluate((tab) => self.__transelloTest.onCommand('translate-selection', tab), tab);
  await done('.mini .text');
  await sleep(300);
  await page.screenshot({ path: `docs/screenshots/mini-${scheme}.png` });
  await page.keyboard.press('Escape');
}
await browser.close();
server.close();
