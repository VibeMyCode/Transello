// Visual check: popup in light/dark with a real local translation.
import { launch } from '../tests/e2e/lib.mjs';
import { openPopupTab, paste, settled } from '../tests/e2e/uc01.mjs';
const { browser, extId } = await launch();
for (const scheme of ['light', 'dark']) {
  const p = await openPopupTab(browser, extId);
  await p.setViewport({ width: 420, height: 560, deviceScaleFactor: 2 });
  await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
  await paste(p, 'Transello translates text, selections and whole pages — locally, right in your browser.\n\nNo account, no API key.');
  await new Promise((r) => setTimeout(r, 500));
  await settled(p);
  await p.screenshot({ path: `docs/screenshots/popup-${scheme}.png` });
  await p.close();
}
await browser.close();
