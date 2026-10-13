// UC-05 Settings + BYOK negative paths against the real provider APIs (invalid keys only → free 401s).
import { assert, check, section, sleep } from './lib.mjs';

const BASE = 'http://localhost:8766';
const status = (p) => p.$eval('#provider [role=status]', (e) => e.textContent);

async function selectEngine(p, id) {
  await p.click(`input[name=engine][value=${id}]`);
  await p.waitForSelector(`#provider[data-engine="${id}"]`);
}

export async function uc05({ browser, extId }) {
  section('UC-05 settings, providers, BYOK (negative live checks)');
  const p = await browser.newPage();
  await p.goto(`chrome-extension://${extId}/options.html`);
  await p.waitForSelector('#engines input');

  await check('UI language switches without reload; target/theme persist', async () => {
    await p.select('#uiLang', 'en');
    await p.waitForFunction(() => document.getElementById('h-general').textContent === 'General');
    await p.select('#uiLang', 'ru');
    await p.waitForFunction(() => document.getElementById('h-general').textContent === 'Основные');
    for (const [lang, dir] of [['ja', 'ltr'], ['ar', 'rtl']]) {
      const want = await p.evaluate(async (l) => (await (await fetch(`/_locales/${l}/messages.json`)).json()).optGeneral.message, lang);
      await p.select('#uiLang', lang);
      await p.waitForFunction((w) => document.getElementById('h-general').textContent === w, {}, want);
      const d = await p.evaluate(() => [document.documentElement.dir, document.documentElement.lang]);
      assert(d[0] === dir && d[1] === lang, `${lang}: ${d}`);
    }
    // Native chrome.i18n positional $1 with no placeholder definitions (auto mode path).
    const hint = await p.evaluate(() => chrome.i18n.getMessage('shortcutHint', ['⌃⇧Y']));
    assert(hint.includes('⌃⇧Y'), hint);
    await p.select('#uiLang', 'ru');
    await p.waitForFunction(() => document.documentElement.dir === 'ltr');
    await p.select('#theme', 'dark');
    await p.select('#target', 'de');
    await sleep(200);
    const s = await p.evaluate(async () => (await chrome.storage.sync.get('settings')).settings);
    await p.select('#theme', 'auto');
    await p.select('#target', 'ru');
    assert(s.theme === 'dark' && s.target === 'de', JSON.stringify(s));
  });

  await check('5 engines; OAuth shown honestly per provider (no fake active buttons)', async () => {
    const engines = await p.$$eval('input[name=engine]', (x) => x.map((i) => i.value));
    const notes = {};
    for (const id of ['openai', 'anthropic', 'deepseek', 'openrouter']) {
      await selectEngine(p, id);
      notes[id] = await p.evaluate(() => ({
        disabled: document.querySelector('#provider .disabled-opt')?.textContent ?? '',
        buttons: [...document.querySelectorAll('#provider button')].map((b) => b.textContent),
      }));
    }
    assert(engines.join() === 'local,openrouter,openai,anthropic,deepseek', engines.join());
    assert(/127\.0\.0\.1/.test(notes.openai.disabled) && !notes.openai.buttons.some((b) => /ChatGPT/.test(b)), JSON.stringify(notes.openai));
    assert(/Claude Console/.test(notes.anthropic.disabled), notes.anthropic.disabled);
    assert(notes.openrouter.buttons.some((b) => /OpenRouter/.test(b)), JSON.stringify(notes.openrouter));
    return JSON.stringify(Object.fromEntries(Object.entries(notes).map(([k, v]) => [k, v.buttons])));
  });

  for (const id of ['openai', 'anthropic', 'deepseek', 'openrouter']) {
    await check(`${id}: invalid key → real 401 mapped to a clear error; key not saved`, async () => {
      await selectEngine(p, id);
      await p.type('#apiKey', 'sk-transello-invalid-test-key-0000');
      await p.click('#provider .btn.primary');
      await p.waitForFunction(() => /err/.test(document.querySelector('#provider [role=status]')?.className ?? ''), { timeout: 30_000 });
      const msg = await status(p);
      const stored = await p.evaluate(async (id) => (await chrome.storage.local.get(`secret.${id}`))[`secret.${id}`] ?? null, id);
      assert(/недействителен|invalid/i.test(msg) && stored === null, JSON.stringify({ msg, stored }));
      return msg;
    });
  }

  await check('stored key is masked; Disconnect deletes it', async () => {
    await p.evaluate(async () => {
      await chrome.storage.local.set({ 'secret.deepseek': { kind: 'api_key', key: 'sk-fake-for-ui-test-1234', savedAt: Date.now() } });
    });
    await selectEngine(p, 'local');
    await selectEngine(p, 'deepseek');
    const shown = await p.$eval('#provider .state.ok', (e) => e.textContent);
    const html = await p.evaluate(() => document.getElementById('provider').textContent);
    const btn = (await p.$$('#provider button')).at(0);
    await btn.click();
    await sleep(300);
    const left = await p.evaluate(async () => (await chrome.storage.local.get('secret.deepseek'))['secret.deepseek'] ?? null);
    assert(/sk-fake…1234/.test(shown) && !html.includes('for-ui-test') && left === null, JSON.stringify({ shown, left }));
    return shown;
  });

  await check('cloud engine without key: popup explains and links to Settings (no request sent)', async () => {
    await selectEngine(p, 'openai');
    await p.evaluate(() => chrome.storage.session.remove('draft')); // earlier suites leave a draft
    const pop = await browser.newPage();
    await pop.goto(`chrome-extension://${extId}/popup.html`);
    await pop.waitForSelector('#input');
    const chip = await pop.$eval('#engine', (e) => e.textContent);
    const hint = await pop.$eval('#status', (e) => e.textContent);
    await pop.evaluate(() => {
      const i = document.getElementById('input');
      i.value = 'Hello world';
      i.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await pop.waitForFunction(() => document.getElementById('status').classList.contains('error'), { timeout: 10_000 });
    const err = await pop.$eval('#status', (e) => e.textContent);
    await pop.close();
    assert(/OpenAI/.test(chip) && /OpenAI/.test(hint) && /подключите|Connect/.test(err), JSON.stringify({ chip, hint, err }));
    return `${chip} | ${err}`;
  });

  await check('secrets: never in sync storage; content scripts cannot read storage.local', async () => {
    await p.evaluate(() => chrome.storage.local.set({ 'secret.openai': { kind: 'api_key', key: 'sk-probe-should-stay-private', savedAt: 1 } }));
    const sync = await p.evaluate(async () => JSON.stringify(await chrome.storage.sync.get(null)));
    const page = await browser.newPage();
    await page.goto(`${BASE}/simple.html`);
    const sw = await (await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes(extId))).worker();
    const res = await sw.evaluate(async () => {
      const tab = (await chrome.tabs.query({ url: 'http://localhost/*' }))[0];
      const [r] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: async () => {
          try {
            return JSON.stringify(await chrome.storage.local.get(null));
          } catch (e) {
            return 'DENIED ' + e.message;
          }
        },
      });
      return r.result;
    });
    await page.close();
    await p.evaluate(() => chrome.storage.local.remove('secret.openai'));
    assert(!/sk-probe/.test(sync) && /DENIED/.test(res) && !/sk-probe/.test(res), JSON.stringify({ sync, res }));
    return res.slice(0, 90);
  });

  await check('About links: privacy + support are external HTTPS, open in a new tab, no popups', async () => {
    const links = await p.$$eval('a.link', (as) => as.filter((a) => !a.hidden).map((a) => ({ id: a.id, href: a.href, target: a.target, rel: a.rel })));
    const ext = links.filter((l) => l.id === 'privacyLink' || l.id === 'supportLink');
    assert(ext.length === 2 && ext.every((l) => l.href.startsWith('https://') && l.target === '_blank' && /noopener/.test(l.rel)), JSON.stringify(links));
    return ext.map((l) => l.href).join(' , ');
  });

  await check('back to Local engine', async () => {
    await selectEngine(p, 'local').catch(() => p.click('input[name=engine][value=local]'));
    const s = await p.evaluate(async () => (await chrome.storage.sync.get('settings')).settings.engine);
    assert(s === 'local', s);
  });
  await p.close();
}
