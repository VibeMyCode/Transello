import { describe, expect, it, vi } from 'vitest';
import { defaultTarget, retargetFor, normalizeLang, pickDetection } from '../../src/core/lang';

describe('normalizeLang', () => {
  it.each([
    ['en-US', 'en'], ['ru_RU', 'ru'], ['RU', 'ru'], ['iw', 'he'], ['nb-NO', 'no'], ['zh-TW', 'zh-Hant'], ['zh-Hant-HK', 'zh-Hant'],
    ['zh-CN', 'zh'], ['zh', 'zh'], ['pt-BR', 'pt'], ['xx', null], ['', null], ['not a tag!', null], ['fa', null],
  ])('%s → %s', (input, out) => expect(normalizeLang(input)).toBe(out));
});

describe('defaultTarget', () => {
  it('uses first supported preference', () => expect(defaultTarget(['fa-IR', 'de-DE', 'en'])).toBe('de'));
  it('falls back to Russian', () => expect(defaultTarget(['fa', 'sw'])).toBe('ru'));
  it('empty prefs → ru', () => expect(defaultTarget([])).toBe('ru'));
});

describe('retargetFor', () => {
  const langs = (l: string[]) => vi.spyOn(navigator, 'languages', 'get').mockReturnValue(l);
  it('most recent other language first, then the browser languages', () => {
    langs(['ru-RU', 'en-US']);
    expect(retargetFor('en', ['en', 'de'])).toBe('de');
    expect(retargetFor('en', ['en'])).toBe('ru');
  });
  it('user report: en text, target en, stray recents (lt) → the browser UI language (ru), not lt', () => {
    langs(['ru-RU', 'ru', 'en-US', 'en']);
    (globalThis as { chrome?: unknown }).chrome = { i18n: { getUILanguage: () => 'ru' } };
    expect(retargetFor('en', ['en', 'lt', 'de'])).toBe('ru');
    expect(retargetFor('ru', ['ru', 'en', 'lt'])).toBe('en'); // text already in the home language → most recent other
    delete (globalThis as { chrome?: unknown }).chrome;
  });
  it('English-only browser, English text, no history → null (ask, never guess)', () => {
    langs(['en-US', 'en']);
    expect(retargetFor('en', ['en'])).toBeNull();
  });
});

describe('pickDetection', () => {
  it('weak single-word guess is uncertain (live: "Hund" → en 0.189)', () =>
    expect(pickDetection([{ detectedLanguage: 'en', confidence: 0.189 }, { detectedLanguage: 'sv', confidence: 0.178 }])).toEqual({ lang: 'en', confidence: 0.189, uncertain: true }));
  it('confident sentence', () => expect(pickDetection([{ detectedLanguage: 'de', confidence: 0.999 }]).uncertain).toBe(false));
  it('skips und', () => expect(pickDetection([{ detectedLanguage: 'und', confidence: 1 }]).lang).toBeNull());
  it('empty → unknown', () => expect(pickDetection([]).lang).toBeNull());
});
