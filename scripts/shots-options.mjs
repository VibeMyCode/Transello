// Visual check of Settings (local + a provider panel).
import { launch } from '../tests/e2e/lib.mjs';
const { browser, extId } = await launch();
const p = await browser.newPage();
await p.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
await p.goto(`chrome-extension://${extId}/options.html`);
await p.waitForSelector('#provider[data-engine="local"]');
await p.screenshot({ path: 'docs/screenshots/options-local.png', fullPage: true });
await p.click('input[name=engine][value=openrouter]');
await p.waitForSelector('#provider[data-engine="openrouter"]');
await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
await new Promise((r) => setTimeout(r, 600)); // let CSS transitions finish
await p.screenshot({ path: 'docs/screenshots/options-openrouter-dark.png', fullPage: true });
await p.click('input[name=engine][value=local]');
await browser.close();
