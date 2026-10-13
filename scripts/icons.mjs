// Render assets/icons/transello.svg → public/icons/*.png via headless Chrome (no image deps).
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const svg = fs.readFileSync(path.join(root, 'assets/icons/transello.svg'), 'utf8');
const out = path.join(root, 'public/icons');
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage();
// CWS: 128px store icon = 96px artwork + 16px transparent padding. Toolbar sizes are full-bleed.
for (const [size, pad] of [[16, 0], [32, 0], [48, 0], [128, 16]]) {
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  await page.setContent(`<html><body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px;padding:${pad}px;box-sizing:border-box">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div></body></html>`);
  await page.screenshot({ path: path.join(out, `icon-${size}.png`), omitBackground: true });
}
await browser.close();
console.log('icons written to', path.relative(root, out));
