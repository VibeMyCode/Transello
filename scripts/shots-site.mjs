import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage();
await p.setViewport({ width: 900, height: 900 });
for (const f of ['privacy', 'support']) {
  await p.goto(`https://vibemycode.github.io/transello-site/${f}.html`, { waitUntil: 'networkidle0' });
  await p.screenshot({ path: `docs/screenshots/site-${f}.png` });
}
await b.close();
