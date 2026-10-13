/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import en from '../../public/_locales/en/messages.json';
import { ERROR_CODES } from '../../src/core/errors';
import { getUiLang, initUiLang, isRtl, matchUiLang, t, UI_LANGS, type Messages } from '../../src/core/i18n';

const FILES = import.meta.glob<Messages>('../../public/_locales/*/messages.json', { eager: true, import: 'default' });
const ALL = Object.fromEntries(Object.entries(FILES).map(([p, m]) => [p.split('/').at(-2)!, m]));
const load = (l: string) => ALL[l]!;
const subs = (s: string) => [...s.matchAll(/\$\d/g)].map((m) => m[0]).sort();

/** chrome.i18n behaves as if the browser language is `tag` (resolving to `native`); manual dicts come from the SW. */
function mockChrome(tag: string, native: string) {
  const nat = load(native);
  (globalThis as unknown as { chrome: unknown }).chrome = {
    i18n: {
      getUILanguage: () => tag,
      getMessage: (k: string, s: string[] = []) => nat[k]?.message.replace(/\$(\d)/g, (_, i) => s[Number(i) - 1] ?? '') ?? '',
    },
    runtime: { sendMessage: async (m: { lang: string }) => load(m.lang) },
  };
}

describe('i18n', () => {
  it('ships exactly the declared locales', () => expect(Object.keys(ALL).sort()).toEqual([...UI_LANGS].sort()));

  it.each(UI_LANGS.filter((l) => l !== 'en'))('%s has the same keys and placeholders as en', (l) => {
    const m = load(l);
    expect(Object.keys(m)).toEqual(Object.keys(en));
    for (const [k, v] of Object.entries(en)) expect(subs(m[k]!.message), `${l}.${k}`).toEqual(subs(v.message));
    expect(m.extDescription!.message.length).toBeLessThanOrEqual(132);
  });

  it('every error code has a message', () => {
    for (const c of ERROR_CODES) expect(Object.keys(en)).toContain(`err_${c}`);
  });

  it('matches browser tags to shipped languages', () => {
    expect(matchUiLang('pt-PT')).toBe('pt_BR');
    expect(matchUiLang('zh-TW')).toBe('zh_CN');
    expect(matchUiLang('in')).toBe('id');
    expect(matchUiLang('de-AT')).toBe('de');
    expect(matchUiLang('uk')).toBe('en');
  });

  it('auto uses chrome.i18n; a manual choice loads its dict and switches at runtime', async () => {
    mockChrome('ru-RU', 'ru');
    expect(await initUiLang('auto')).toBe('ru');
    expect(t('downloading', 42)).toContain('42%');
    expect(await initUiLang('ja')).toBe('ja');
    expect(t('translate')).toBe(load('ja').translate!.message);
    expect(await initUiLang('ar')).toBe('ar');
    expect(isRtl()).toBe(true);
    expect(await initUiLang('en')).toBe('en');
    expect(t('translate')).toBe('Translate');
  });

  it('falls back to the browser language when a dict cannot load', async () => {
    mockChrome('fr', 'fr');
    (globalThis as unknown as { chrome: { runtime: unknown } }).chrome.runtime = { sendMessage: async () => null };
    await initUiLang('de');
    expect(getUiLang()).toBe('fr');
    expect(t('translate')).toBe(load('fr').translate!.message);
  });
});
