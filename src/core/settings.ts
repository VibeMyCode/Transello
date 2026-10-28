import { initUiLang, isUiLang, uiLocale, type UiLang } from './i18n';
import { defaultTarget, normalizeLang } from './lang';

export const RECENT_MAX = 5;

export const CLOUD_IDS = ['openai', 'anthropic', 'deepseek', 'openrouter'] as const;
export type CloudId = (typeof CLOUD_IDS)[number];
export type EngineId = 'local' | CloudId;

/** Non-secret settings → chrome.storage.sync (spec §6). Secrets live in ./secrets.ts, never synced. */
export interface Settings {
  uiLang: 'auto' | UiLang;
  target: string;
  theme: 'auto' | 'light' | 'dark';
  engine: EngineId;
  models: Partial<Record<CloudId, string>>;
  /** User confirmed that selected text goes to this provider (first-use notice). */
  cloudAck: Partial<Record<CloudId, boolean>>;
  /** First full-page cloud translation confirmed (spec §3 UC-04). Sensitive domains always ask. */
  pageCloudAck: boolean;
  keepDraft: boolean; // session-only draft in storage.session
  /** Most recently chosen languages, newest first (max 5) — shown first in language lists. */
  recentLangs: string[];
}

export function defaults(): Settings {
  const prefs = [globalThis.chrome?.i18n?.getUILanguage?.() ?? '', ...(globalThis.navigator?.languages ?? [])];
  return {
    uiLang: 'auto',
    target: defaultTarget(prefs),
    theme: 'auto',
    engine: 'local',
    models: {},
    cloudAck: {},
    pageCloudAck: false,
    keepDraft: true,
    recentLangs: [],
  };
}

const KEY = 'settings';

export function sanitize(raw: unknown): Settings {
  const d = defaults();
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Settings>;
  const pick = <T>(v: unknown, ok: readonly T[], dflt: T): T => (ok.includes(v as T) ? (v as T) : dflt);
  return {
    uiLang: r.uiLang === 'auto' || isUiLang(r.uiLang) ? r.uiLang : d.uiLang,
    target: typeof r.target === 'string' && r.target ? r.target : d.target,
    theme: pick(r.theme, ['auto', 'light', 'dark'] as const, d.theme),
    engine: pick(r.engine, ['local', ...CLOUD_IDS] as const, d.engine),
    models: obj(r.models, (v) => typeof v === 'string' && v.length < 200),
    cloudAck: obj(r.cloudAck, (v) => v === true),
    pageCloudAck: r.pageCloudAck === true,
    keepDraft: r.keepDraft !== false,
    recentLangs: Array.isArray(r.recentLangs) ? r.recentLangs.filter((l): l is string => typeof l === 'string' && normalizeLang(l) === l).slice(0, RECENT_MAX) : [],
  };
}

function obj<V>(o: unknown, ok: (v: unknown) => boolean): Partial<Record<CloudId, V>> {
  const out: Partial<Record<CloudId, V>> = {};
  if (o && typeof o === 'object') for (const id of CLOUD_IDS) if (ok((o as never)[id])) out[id] = (o as never)[id];
  return out;
}

export async function getSettings(): Promise<Settings> {
  try {
    return sanitize((await chrome.storage.sync.get(KEY))[KEY]);
  } catch {
    return sanitize((await chrome.storage.local.get(KEY))[KEY]); // sync disabled / unavailable
  }
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = sanitize({ ...(await getSettings()), ...patch });
  try {
    await chrome.storage.sync.set({ [KEY]: next });
  } catch {
    await chrome.storage.local.set({ [KEY]: next });
  }
  return next;
}

export function onSettingsChanged(cb: (s: Settings) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (KEY in changes && (area === 'sync' || area === 'local')) cb(sanitize(changes[KEY]?.newValue));
  });
}

/** Load UI strings for these settings; returns the BCP 47 UI locale (for Intl and <html lang>). */
export async function initUi(s: Settings): Promise<string> {
  await initUiLang(s.uiLang);
  return uiLocale();
}

export function applyTheme(s: Settings, root: HTMLElement = document.documentElement): void {
  if (s.theme === 'auto') delete root.dataset.theme;
  else root.dataset.theme = s.theme;
}

/** "OpenRouter · claude-haiku-5.5": the vendor prefix of a routed model ID ("anthropic/") is noise in a small chip. */
export const engineLabel = (s: Settings, localLabel: string) =>
  s.engine === 'local' ? localLabel : `${ENGINE_NAMES[s.engine]}${s.models[s.engine] ? ' · ' + s.models[s.engine]!.split('/').pop() : ''}`;

export const ENGINE_NAMES: Record<EngineId, string> = {
  local: 'Local',
  openai: 'OpenAI',
  anthropic: 'Claude',
  deepseek: 'DeepSeek',
  openrouter: 'OpenRouter',
};

/** Record a language the user explicitly chose (target or manual source). */
export async function rememberLang(lang: string, patch: Partial<Settings> = {}): Promise<Settings> {
  const cur = await getSettings();
  if (normalizeLang(lang) !== lang) return setSettings(patch);
  return setSettings({ ...patch, recentLangs: [lang, ...cur.recentLangs.filter((l) => l !== lang)].slice(0, RECENT_MAX) });
}
