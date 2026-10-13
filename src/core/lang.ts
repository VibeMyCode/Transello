// Languages supported by Chrome's built-in Translator, verified live with Translator.availability()
// on Chrome 155 (live probe, 2026-10-12). Runtime availability is still checked per pair.
export const LANGS = [
  'ar', 'bg', 'bn', 'cs', 'da', 'de', 'el', 'en', 'es', 'fi', 'fr', 'he', 'hi', 'hr', 'hu', 'id', 'it', 'ja', 'kn',
  'ko', 'lt', 'mr', 'nl', 'no', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'ta', 'te', 'th', 'tr', 'uk', 'vi', 'zh',
  'zh-Hant',
] as const;
export type Lang = (typeof LANGS)[number];

const SET = new Set<string>(LANGS);
const ALIASES: Record<string, Lang> = { iw: 'he', nb: 'no', nn: 'no' };

/** Normalize a BCP 47 tag (e.g. "en-US", "zh_TW", "nb") to a supported language, or null. */
export function normalizeLang(tag: string | null | undefined): Lang | null {
  if (!tag) return null;
  let canon: string;
  try {
    canon = Intl.getCanonicalLocales(tag.replace(/_/g, '-'))[0] ?? '';
  } catch {
    return null;
  }
  const loc = new Intl.Locale(canon);
  const base = loc.language;
  if (base === 'zh') {
    const traditional = loc.script === 'Hant' || (!loc.script && ['TW', 'HK', 'MO'].includes(loc.region ?? ''));
    return traditional ? 'zh-Hant' : 'zh';
  }
  const mapped = ALIASES[base] ?? base;
  return SET.has(mapped) ? (mapped as Lang) : null;
}

/** First supported language from the browser/OS preference list; Russian if none (spec §2). */
export function defaultTarget(prefs: readonly string[]): Lang {
  for (const p of prefs) {
    const l = normalizeLang(p);
    if (l) return l;
  }
  return 'ru';
}

/** Text is already in the target: the most recent other language, else another browser language; null → ask the user (user request). */
export function retargetFor(src: string, recents: readonly string[]): Lang | null {
  for (const p of [...recents, ...(globalThis.navigator?.languages ?? [])]) {
    const l = normalizeLang(p);
    if (l && l !== src) return l;
  }
  return null;
}

export function langName(code: string, uiLang: string): string {
  try {
    const n = new Intl.DisplayNames([uiLang], { type: 'language' }).of(code);
    return n ? n.charAt(0).toUpperCase() + n.slice(1) : code;
  } catch {
    return code;
  }
}

export const LOW_CONFIDENCE = 0.6;

export interface Detection {
  lang: string | null; // null = unknown
  confidence: number;
  uncertain: boolean;
}

/** Pick the top detection result; never present a weak guess as certain (spec §2, §4). */
export function pickDetection(results: readonly { detectedLanguage: string; confidence: number }[]): Detection {
  const top = results.find((r) => r.detectedLanguage !== 'und');
  if (!top) return { lang: null, confidence: 0, uncertain: true };
  const lang = normalizeLang(top.detectedLanguage) ?? top.detectedLanguage;
  return { lang, confidence: top.confidence, uncertain: top.confidence < LOW_CONFIDENCE };
}
