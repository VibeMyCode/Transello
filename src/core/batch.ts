// UC-04 page batches: one detection per batch, then per-segment translation (local) or structured cloud call.
import { splitText, translatePieces } from './chunk';
import { TError } from './errors';
import { normalizeLang, retargetFor } from './lang';
import { detectLanguage, localApiPresent, localTranslate, pairReady, pairState } from './local';
import type { Ctx } from './translate';

export interface BatchCtx extends Ctx {
  consent?: boolean;
  /** The user agreed to download the model for the detected direction. */
  allowDownload?: boolean;
  /** A follow-up page translated automatically: a page already in the target is left alone, never retargeted. */
  auto?: boolean;
  cloudBatch?: (segments: string[], target: string, ctx: Ctx) => Promise<{ segments: string[]; model?: string }>;
}

export async function translateBatch(segments: string[], source: string, target: string, ctx: BatchCtx): Promise<{ segments: string[]; engine: string; model?: string; retarget?: string; same?: boolean }> {
  const engine = ctx.settings.engine;
  const sample = () => segments.join('\n').slice(0, 2_000);
  if (engine !== 'local') {
    // Trust boundary: page text goes to the cloud only with the toolbar's explicit confirmation flag
    // (the content script asks on first use and always on sensitive hosts).
    if (!ctx.consent) throw new TError('consent_required');
    if (!ctx.cloudBatch) throw new TError('local_unavailable_here');
    // Page already in the target language → most recent other language (local detector only: free, no network).
    const d = source === 'auto' && localApiPresent() ? await detectLanguage(sample(), ctx.signal).catch(() => null) : null;
    const src = d && !d.uncertain ? normalizeLang(d.lang) : null;
    const retarget = (src && src === normalizeLang(target) && retargetFor(src, ctx.settings.recentLangs)) || undefined;
    const r = await ctx.cloudBatch(segments, retarget ?? target, ctx);
    return { ...r, engine, retarget };
  }
  let tgt = normalizeLang(target);
  if (!tgt) throw new TError('unsupported_pair', target);
  let src = source === 'auto' ? null : normalizeLang(source);
  if (!src) {
    const d = await detectLanguage(sample(), ctx.signal);
    src = d.lang ? normalizeLang(d.lang) : null;
    if (!src) throw new TError('unknown_language');
  }
  let retarget: string | undefined;
  if (src === tgt) {
    const alt = source === 'auto' && !ctx.auto ? retargetFor(src, ctx.settings.recentLangs) : null;
    // Already in the target and no ready alternative: leave the page as is (no surprise model downloads).
    if (!alt || !(await pairReady(src, alt))) return { segments, engine, same: true };
    tgt = retarget = alt;
  }
  // Same rule as single translations: no surprise model download for a detected direction.
  if (source === 'auto' && !ctx.allowDownload) {
    const state = await pairState(src, tgt);
    if (state === 'unavailable') throw new TError('unsupported_pair', `${src}>${tgt}`);
    if (state === 'download') throw new TError('needs_download', `${src}>${tgt}`);
  }
  const out: string[] = [];
  for (const s of segments) out.push(await translatePieces(splitText(s), (p) => localTranslate(p, src!, tgt, ctx.signal, ctx.onProgress), ctx.signal));
  return { segments: out, engine, retarget };
}
