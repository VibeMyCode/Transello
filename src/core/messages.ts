// Typed messaging between UIs/content scripts and the service worker, with runtime validation (spec §6, §7).
import type { ErrorCode } from './errors';
import { isUiLang, type UiLang } from './i18n';
import type { Mode, TranslateRequest, TranslateResult } from './translate';

export const PORT_TRANSLATE = 'translate';

/** Client → SW over a `translate` port. Disconnecting the port cancels the request. */
export type PortRequest =
  | { type: 'translate'; req: TranslateRequest }
  | { type: 'batch'; segments: string[]; source: string; target: string; consent?: boolean; allowDownload?: boolean; auto?: boolean };

/** SW → client. */
export type PortReply =
  | { type: 'progress'; loaded: number }
  | { type: 'result'; result: TranslateResult }
  | { type: 'batch_result'; segments: string[]; engine: string; model?: string; retarget?: string; same?: boolean }
  | { type: 'error'; code: ErrorCode; detail?: string };

/** SW → content script (tabs.sendMessage). */
export type TabCommand =
  | { type: 'show_modal'; text: string }
  | { type: 'show_mini' }
  | { type: 'translate_page'; auto?: boolean }
  | { type: 'ping' };

/** Extension pages → SW one-shot messages. */
export type RuntimeMessage =
  | { type: 'open_window'; text?: string }
  | { type: 'open_options' }
  | { type: 'ui_strings'; lang: UiLang }
  | { type: 'page_auto'; on: boolean }; // keep translating this tab's next pages on the same site

export const LIMITS = { text: 60_000, segments: 120, segment: 4_000, lang: 20 } as const;

const MODES: readonly Mode[] = ['text', 'selection', 'page_chunk'];
const isLang = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= LIMITS.lang && /^[A-Za-z-]+$/.test(x);

export function parsePortRequest(m: unknown): PortRequest | null {
  if (!m || typeof m !== 'object') return null;
  const o = m as Record<string, unknown>;
  if (o.type === 'translate') {
    const r = o.req as Record<string, unknown> | undefined;
    if (!r || typeof r.text !== 'string' || r.text.length > LIMITS.text) return null;
    if (!isLang(r.source) || !isLang(r.target) || !MODES.includes(r.mode as Mode)) return null;
    return { type: 'translate', req: { text: r.text, source: r.source, target: r.target, mode: r.mode as Mode, ...(r.fixedTarget === true && { fixedTarget: true }), ...(r.allowDownload === true && { allowDownload: true }) } };
  }
  if (o.type === 'batch') {
    const s = o.segments;
    if (!Array.isArray(s) || s.length === 0 || s.length > LIMITS.segments) return null;
    if (!s.every((x) => typeof x === 'string' && x.length <= LIMITS.segment)) return null;
    if (!isLang(o.source) || !isLang(o.target)) return null;
    return { type: 'batch', segments: s as string[], source: o.source, target: o.target, consent: o.consent === true, ...(o.allowDownload === true && { allowDownload: true }), ...(o.auto === true && { auto: true }) };
  }
  return null;
}

export function parseRuntimeMessage(m: unknown): RuntimeMessage | null {
  if (!m || typeof m !== 'object') return null;
  const o = m as Record<string, unknown>;
  if (o.type === 'open_window') return { type: 'open_window', text: typeof o.text === 'string' ? o.text.slice(0, LIMITS.text) : undefined };
  if (o.type === 'open_options') return { type: 'open_options' };
  if (o.type === 'ui_strings' && isUiLang(o.lang)) return { type: 'ui_strings', lang: o.lang };
  if (o.type === 'page_auto' && typeof o.on === 'boolean') return { type: 'page_auto', on: o.on };
  return null;
}

/** Only our own extension's contexts may talk to the SW. No externally_connectable is declared. */
export function isTrustedSender(sender: chrome.runtime.MessageSender, extId = chrome.runtime.id): boolean {
  return sender.id === extId;
}
