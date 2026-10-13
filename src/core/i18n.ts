// UI strings in 12 languages (public/_locales/*/messages.json).
// "auto" uses Chrome's own chrome.i18n (browser language, zero loading). A manually chosen language is loaded
// once from the extension package (pages/SW) or via the SW (content scripts), switchable without reload.

export const UI_LANGS = ['en', 'ru', 'zh_CN', 'hi', 'es', 'fr', 'ar', 'bn', 'pt_BR', 'ja', 'de', 'id'] as const;
export type UiLang = (typeof UI_LANGS)[number];
export type Messages = Record<string, { message: string }>;
export type MsgKey = string;

let cur: UiLang = 'en';
let dict: Messages | null = null;

/** Best UI language for a BCP 47 tag; English if we don't ship it. */
export function matchUiLang(tag: string | undefined): UiLang {
  const t = (tag ?? 'en').replace('_', '-').toLowerCase();
  if (t.startsWith('zh')) return 'zh_CN';
  if (t.startsWith('pt')) return 'pt_BR';
  if (t.startsWith('in')) return 'id'; // legacy code for Indonesian
  const base = t.split('-')[0] as UiLang;
  return (UI_LANGS as readonly string[]).includes(base) ? base : 'en';
}

export const isUiLang = (x: unknown): x is UiLang => typeof x === 'string' && (UI_LANGS as readonly string[]).includes(x);

export async function loadMessages(lang: UiLang): Promise<Messages | null> {
  try {
    if (globalThis.location?.protocol === 'chrome-extension:') {
      return (await (await fetch(chrome.runtime.getURL(`_locales/${lang}/messages.json`))).json()) as Messages;
    }
    return ((await chrome.runtime.sendMessage({ type: 'ui_strings', lang })) as Messages | null) ?? null; // content script
  } catch {
    return null;
  }
}

/** Call once per context (and again after the setting changes). Returns the effective UI language. */
export async function initUiLang(pref: 'auto' | UiLang): Promise<UiLang> {
  const tag = globalThis.chrome?.i18n?.getUILanguage?.() ?? 'en';
  // The folder chrome.i18n itself resolves to (exact locale, then base language, else default "en").
  const native = [tag.replace('-', '_'), tag.split(/[-_]/)[0]].find((x): x is UiLang => isUiLang(x)) ?? 'en';
  cur = pref === 'auto' ? matchUiLang(tag) : pref;
  dict = cur === native ? null : await loadMessages(cur);
  if (cur !== native && !dict) cur = native; // could not load: stay consistent with chrome.i18n
  return cur;
}

export const getUiLang = () => cur;
/** BCP 47 form for Intl APIs ("pt_BR" → "pt-BR"). */
export const uiLocale = () => cur.replace('_', '-');
export const isRtl = () => cur === 'ar';

export function t(key: MsgKey, ...subs: (string | number)[]): string {
  const raw = dict?.[key]?.message;
  if (raw !== undefined) return raw.replace(/\$(\d)/g, (_, i) => String(subs[Number(i) - 1] ?? ''));
  const m = globalThis.chrome?.i18n?.getMessage?.(key, subs.map(String));
  return m || key;
}

/** Fill [data-i18n], [data-i18n-title] (title + aria-label), [data-i18n-placeholder]; set lang/dir. */
export function applyI18n(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) el.textContent = t(el.dataset.i18n!);
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-title]')) {
    const s = t(el.dataset.i18nTitle!);
    el.title = s;
    el.setAttribute('aria-label', s);
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-placeholder]')) el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder!));
  if (root === document) {
    document.documentElement.lang = uiLocale();
    document.documentElement.dir = isRtl() ? 'rtl' : 'ltr';
  }
}
