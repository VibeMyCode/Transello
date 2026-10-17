// Translation orchestrator: detect → choose engine → translate → normalize (spec §7).
import { limitText, MAX_TEXT, splitText, translatePieces } from './chunk';
import { CLOUD_TEXT_MAX } from './cloud';
import { TError } from './errors';
import { normalizeLang, retargetFor, type Detection } from './lang';
import { detectLanguage, localApiPresent, localTranslate, pairState, type OnProgress } from './local';
import type { EngineId, Settings } from './settings';

export type Mode = 'text' | 'selection' | 'page_chunk';

export interface TranslateRequest {
  text: string;
  source: string; // 'auto' or language code
  target: string;
  mode: Mode;
  /** The user just picked this target: never switch it, report sameLanguage instead. */
  fixedTarget?: boolean;
  /** The user agreed to download the model for this direction (the "Download" button). */
  allowDownload?: boolean;
}

export interface TranslateResult {
  text: string;
  source: string | null;
  detection?: Detection;
  sameLanguage?: boolean;
  /** Set when the detected language equalled the target and another target was used instead. */
  retarget?: string;
  /** The direction was chosen automatically and its model (~80 MB) is not on the device: nothing was translated,
   *  ask the user first (download, or pick the language). `retarget` is set when the target was the guess. */
  needsDownload?: boolean;
  truncated?: boolean;
  engine: EngineId;
  model?: string;
}

export interface Ctx {
  settings: Settings;
  signal?: AbortSignal;
  onProgress?: OnProgress;
  /** Cloud engines are injected so that document-only contexts can omit them (Phase 4). */
  cloud?: (text: string, req: TranslateRequest, ctx: Ctx) => Promise<{ text: string; model?: string }>;
}

export async function translate(req: TranslateRequest, ctx: Ctx): Promise<TranslateResult> {
  const engine = ctx.settings.engine;
  const { text, truncated } = limitText(req.text, engine === 'local' ? MAX_TEXT : CLOUD_TEXT_MAX);
  if (!text.trim()) return { text: '', source: null, engine };

  if (engine !== 'local') {
    if (!ctx.cloud) throw new TError('local_unavailable_here');
    // Same-language check with the on-device detector when available: saves a paid request, no network.
    let detection: Detection | undefined;
    if (req.source === 'auto' && localApiPresent()) detection = await detectLanguage(text, ctx.signal).catch(() => undefined);
    const src = req.source === 'auto' ? (detection && !detection.uncertain ? detection.lang : null) : req.source;
    let retarget: string | undefined;
    if (src && normalizeLang(src) === normalizeLang(req.target)) {
      retarget = req.source === 'auto' && !req.fixedTarget ? (retargetFor(normalizeLang(src)!, ctx.settings.recentLangs) ?? undefined) : undefined;
      if (!retarget) return { text: '', source: src, detection, sameLanguage: true, engine };
    }
    const r = await ctx.cloud(text, { ...req, source: src ?? 'auto', target: retarget ?? req.target }, ctx); // known source sharpens the prompt
    return { text: r.text, source: src, detection, truncated, engine, model: r.model, retarget };
  }

  let source = req.source;
  let detection: Detection | undefined;
  if (source === 'auto') {
    detection = await detectLanguage(text, ctx.signal);
    if (!detection.lang) throw new TError('unknown_language');
    source = detection.lang;
  }
  const src = normalizeLang(source);
  let tgt = normalizeLang(req.target);
  if (!src || !tgt) throw new TError('unsupported_pair', `${source}>${req.target}`);
  let retarget: string | undefined;
  if (src === tgt) {
    const alt = req.source === 'auto' && !req.fixedTarget ? retargetFor(src, ctx.settings.recentLangs) : null;
    if (!alt) return { text: '', source: src, detection, sameLanguage: true, engine };
    tgt = retarget = alt;
  }
  // Never download a model (~80 MB) for a direction the user didn't choose: a guessed source (user report: a URL
  // "looked like Czech") or a guessed target (a stray recent pulled Lithuanian). Picking a language is consent.
  const chosen = req.allowDownload || req.fixedTarget || req.source !== 'auto';
  if (!chosen) {
    const state = await pairState(src, tgt);
    // Not offered by this browser at all (user report: en→ru on Chrome, Windows 11 ARM): say so, don't offer a download.
    if (state === 'unavailable') throw new TError('unsupported_pair', `${src}>${tgt}`);
    if (state === 'download') return { text: '', source: src, detection, engine, retarget, needsDownload: true };
  }

  const out = await translatePieces(
    splitText(text),
    (s) => localTranslate(s, src, tgt, ctx.signal, ctx.onProgress),
    ctx.signal,
  );
  return { text: out, source: src, detection, truncated, engine, retarget };
}
