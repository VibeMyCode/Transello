// Minimal in-memory chrome.* mock for unit tests.
import { vi } from 'vitest';

export function installChrome(opts: { uiLang?: string; syncFails?: boolean } = {}) {
  const areas: Record<string, Record<string, unknown>> = { sync: {}, local: {}, session: {} };
  const listeners: ((c: Record<string, { newValue?: unknown }>, area: string) => void)[] = [];
  const area = (name: string) => ({
    get: vi.fn(async (k: string | string[]) => {
      if (name === 'sync' && opts.syncFails) throw new Error('sync disabled');
      const keys = Array.isArray(k) ? k : [k];
      return Object.fromEntries(keys.filter((x) => x in areas[name]!).map((x) => [x, areas[name]![x]]));
    }),
    set: vi.fn(async (o: Record<string, unknown>) => {
      if (name === 'sync' && opts.syncFails) throw new Error('sync disabled');
      Object.assign(areas[name]!, o);
      for (const l of listeners) l(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { newValue: v }])), name);
    }),
    remove: vi.fn(async (k: string) => void delete areas[name]![k]),
    clear: vi.fn(async () => void (areas[name] = {})),
    setAccessLevel: vi.fn(async () => {}),
  });
  const chrome = {
    runtime: { id: 'ext-id', getManifest: () => ({ version: '1.0.0' }) },
    i18n: { getUILanguage: () => opts.uiLang ?? 'ru' },
    storage: { sync: area('sync'), local: area('local'), session: area('session'), onChanged: { addListener: (l: (typeof listeners)[number]) => listeners.push(l) } },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = chrome;
  return { chrome, areas };
}
