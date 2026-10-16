// LocalAdapter: Chrome built-in Translator + LanguageDetector. Runs in any context that exposes them
// (extension SW on Chrome 155, extension documents; see ADR-001). No network except Chrome's own pack download.
import { TError, toTError } from './errors';
import { LOW_CONFIDENCE, normalizeLang, pickDetection, type Detection } from './lang';

export type OnProgress = (loaded: number) => void; // 0..1 model download

// Live: LanguageDetector on a fresh profile emits no progress for ~26 s, then 0→1 at once. Keep this generous.
export const STALL_MS = 120_000;

/** Only Translator is required: detection falls back to CLD and a script heuristic (Brave on Windows has no LanguageDetector at all). */
export function localApiPresent(): boolean {
  return typeof globalThis.Translator !== 'undefined';
}

/** A shared model creation: one download, many waiters. Request cancellation never aborts the download. */
interface Pending<T> {
  promise: Promise<T>;
  listeners: Set<OnProgress>;
}

function create<T>(make: (signal: AbortSignal, monitor: CreateMonitorCallback) => Promise<T>): Pending<T> {
  const listeners = new Set<OnProgress>();
  const ctl = new AbortController();
  let stalled = false;
  const stall = () => {
    stalled = true;
    ctl.abort();
  };
  let timer = setTimeout(stall, STALL_MS); // ADR-001 §5: no progress for STALL_MS → honest error
  const promise = make(ctl.signal, (m) =>
    m.addEventListener('downloadprogress', (e) => {
      clearTimeout(timer);
      timer = setTimeout(stall, STALL_MS);
      for (const l of listeners) l((e as ProgressEvent).loaded);
    }),
  )
    .catch((e) => {
      if (stalled) throw new TError('download_stalled');
      const te = toTError(e);
      throw te.code === 'internal' || te.code === 'network' ? new TError('download_failed', te.detail) : te;
    })
    .finally(() => clearTimeout(timer));
  return { promise, listeners };
}

/** Await a shared pending creation as one cancellable waiter. */
async function wait<T>(p: Pending<T>, signal?: AbortSignal, onProgress?: OnProgress): Promise<T> {
  if (signal?.aborted) throw new TError('cancelled');
  if (onProgress) p.listeners.add(onProgress);
  let onAbort = () => {};
  try {
    return await Promise.race([
      p.promise,
      new Promise<never>((_, reject) => {
        onAbort = () => reject(new TError('cancelled'));
        signal?.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
  } finally {
    if (onProgress) p.listeners.delete(onProgress);
    signal?.removeEventListener('abort', onAbort);
  }
}

const translators = new Map<string, Pending<Translator>>();
let detector: Pending<LanguageDetector> | null = null;

/**
 * Language detection chain (user report: LanguageDetector returned nothing in a real profile):
 * 1) built-in LanguageDetector if its model is already available (never blocks on a model download);
 * 2) chrome.i18n.detectLanguage (CLD, ships with Chrome, no download);
 * 3) script heuristic (Latin → en, Cyrillic → ru, …), always marked uncertain so the user can correct it.
 */
export async function detectLanguage(text: string, signal?: AbortSignal): Promise<Detection> {
  const sample = text.slice(0, 2000);
  let d = await detectWithModel(sample, signal).catch(() => {
    if (signal?.aborted) throw new TError('cancelled');
    return null;
  });
  if (!supported(d, sample)) d = await detectWithCld(sample);
  if (!supported(d, sample)) d = scriptGuess(sample);
  return d ?? { lang: null, confidence: 0, uncertain: true };
}

/** Usable = a supported language whose writing system matches the text (live in Brave: CLD said "Good evening" → ru,
 *  and a repeated English sentence → ja "reliable"). */
const supported = (d: Detection | null, text = ''): d is Detection => !!d?.lang && normalizeLang(d.lang) !== null && scriptMatches(d.lang, text);

async function detectWithModel(text: string, signal?: AbortSignal): Promise<Detection | null> {
  if (typeof globalThis.LanguageDetector === 'undefined') return null;
  if (!detector) {
    const avail = await LanguageDetector.availability();
    if (avail === 'unavailable') return null;
    const p = (detector = create((s, monitor) => LanguageDetector.create({ signal: s, monitor })));
    p.promise.catch(() => detector === p && (detector = null));
    // Model not on disk yet: let it download in the background and answer with the fallback now.
    if (avail !== 'available') return null;
  }
  const d = await wait(detector, signal);
  return pickDetection(await d.detect(text, { signal }));
}

async function detectWithCld(text: string): Promise<Detection | null> {
  if (typeof globalThis.chrome?.i18n?.detectLanguage !== 'function') return null;
  try {
    const r = await chrome.i18n.detectLanguage(text);
    const top = r.languages?.find((l) => normalizeLang(l.language));
    if (!top) return null;
    const confidence = (top.percentage / 100) * (r.isReliable ? 1 : 0.5);
    return { lang: normalizeLang(top.language), confidence, uncertain: !r.isReliable || confidence < LOW_CONFIDENCE };
  } catch {
    return null;
  }
}

// Writing systems: [pattern, default language, languages written in it].
const SCRIPTS: [RegExp, string, string[]][] = [
  [/\p{Script=Cyrillic}/gu, 'ru', ['ru', 'uk', 'bg']],
  [/\p{Script=Latin}/gu, 'en', ['en', 'cs', 'da', 'de', 'es', 'fi', 'fr', 'hr', 'hu', 'id', 'it', 'lt', 'nl', 'no', 'pl', 'pt', 'ro', 'sk', 'sl', 'sv', 'tr', 'vi']],
  [/[\p{Script=Hiragana}\p{Script=Katakana}]/gu, 'ja', ['ja']],
  [/\p{Script=Hangul}/gu, 'ko', ['ko']],
  [/\p{Script=Han}/gu, 'zh', ['zh', 'zh-Hant', 'ja']],
  [/\p{Script=Arabic}/gu, 'ar', ['ar']],
  [/\p{Script=Hebrew}/gu, 'he', ['he']],
  [/\p{Script=Greek}/gu, 'el', ['el']],
  [/\p{Script=Thai}/gu, 'th', ['th']],
  [/\p{Script=Devanagari}/gu, 'hi', ['hi', 'mr']],
  [/\p{Script=Bengali}/gu, 'bn', ['bn']],
  [/\p{Script=Tamil}/gu, 'ta', ['ta']],
  [/\p{Script=Telugu}/gu, 'te', ['te']],
  [/\p{Script=Kannada}/gu, 'kn', ['kn']],
];

function dominantScript(text: string): (typeof SCRIPTS)[number] | null {
  // Japanese mixes kanji (Han) with kana: any kana means Japanese.
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) return SCRIPTS[2]!;
  let best: [(typeof SCRIPTS)[number], number] | null = null;
  for (const s of SCRIPTS) {
    const n = text.match(s[0])?.length ?? 0;
    if (n && (!best || n > best[1])) best = [s, n];
  }
  return best?.[0] ?? null;
}

function scriptMatches(lang: string, text: string): boolean {
  const s = dominantScript(text);
  return !s || s[2].includes(normalizeLang(lang) ?? lang);
}

/** Last resort: dominant writing system. A guess, always flagged uncertain. */
export function scriptGuess(text: string): Detection | null {
  const s = dominantScript(text);
  return s ? { lang: s[1], confidence: 0.3, uncertain: true } : null;
}

/** Diagnostics for Settings → About (what this Chrome actually offers). */
export async function localDiagnostics(): Promise<string> {
  const tr = typeof globalThis.Translator === 'undefined' ? 'missing' : await Translator.availability({ sourceLanguage: 'en', targetLanguage: 'ru' }).catch((e) => 'error ' + (e as Error).name);
  const ld = typeof globalThis.LanguageDetector === 'undefined' ? 'missing' : await LanguageDetector.availability().catch((e) => 'error ' + (e as Error).name);
  const cld = typeof globalThis.chrome?.i18n?.detectLanguage === 'function' ? 'ok' : 'missing';
  return `Translator(en→ru): ${tr} · LanguageDetector: ${ld} · CLD: ${cld}`;
}

export const MAX_TRANSLATORS = 4; // NFR-04: bounded cache; evicted instances are destroyed

async function getTranslator(source: string, target: string, signal?: AbortSignal, onProgress?: OnProgress) {
  if (!localApiPresent()) throw new TError('api_missing');
  const key = `${source}>${target}`;
  let p = translators.get(key);
  if (p) {
    translators.delete(key); // LRU: re-insert as most recent
    translators.set(key, p);
  } else {
    const avail = await Translator.availability({ sourceLanguage: source, targetLanguage: target });
    if (avail === 'unavailable') throw new TError('unsupported_pair', key);
    const created = create((s, monitor) => Translator.create({ sourceLanguage: source, targetLanguage: target, signal: s, monitor }));
    created.promise.catch(() => translators.get(key) === created && translators.delete(key)); // NFR-05: retry after failure
    translators.set(key, (p = created));
    for (const [k, old] of translators) {
      if (translators.size <= MAX_TRANSLATORS) break;
      evict(k, old);
    }
  }
  return wait(p, signal, onProgress);
}

function evict(key: string, p: Pending<Translator>) {
  if (translators.get(key) === p) translators.delete(key);
  p.promise.then((t) => t.destroy()).catch(() => {});
}

/** True when this pair's model is already on the device (no download needed). */
export async function pairReady(source: string, target: string): Promise<boolean> {
  if (!localApiPresent()) return false;
  return (await Translator.availability({ sourceLanguage: source, targetLanguage: target }).catch(() => 'unavailable')) === 'available';
}

export async function localTranslate(text: string, source: string, target: string, signal?: AbortSignal, onProgress?: OnProgress): Promise<string> {
  // Live finding: installing another language pack can invalidate an already-created Translator
  // ("UnknownError: Other generic failures occurred"). Recreate once before reporting an error.
  for (let attempt = 0; ; attempt++) {
    const tr = await getTranslator(source, target, signal, onProgress);
    try {
      return await tr.translate(text, { signal });
    } catch (e) {
      if (signal?.aborted) throw new TError('cancelled');
      const te = toTError(e);
      const p = translators.get(`${source}>${target}`);
      if (attempt > 0 || te.code === 'too_long' || !p) throw te;
      evict(`${source}>${target}`, p);
    }
  }
}

/** Test hook. */
export function _resetLocalCache() {
  translators.clear();
  detector = null;
}
