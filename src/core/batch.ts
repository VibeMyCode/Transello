// UC-04 page batches: one detection per batch, then per-segment translation (local) or structured cloud call.
import { splitText, translatePieces } from './chunk';
import { TError } from './errors';
import { normalizeLang, retargetFor } from './lang';
import { detectLanguage, localApiPresent, localTranslate } from './local';
import type { Ctx } from './translate';

export interface BatchCtx extends Ctx {
  consent?: boolean;
  cloudBatch?: (segments: string[], target: string, ctx: Ctx) => Promise<{ segments: string[]; model?: string }>;
}

export async function translateBatch(segments: string[], source: string, target: string, ctx: BatchCtx): Promise<{ segments: string[]; engine: string; model?: string; retarget?: string }> {
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
    const alt = source === 'auto' ? retargetFor(src, ctx.settings.recentLangs) : null;
    if (!alt) return { segments, engine }; // already in the target language, nothing else to go to
    tgt = retarget = alt;
  }
  const out: string[] = [];
  for (const s of segments) out.push(await translatePieces(splitText(s), (p) => localTranslate(p, src!, tgt, ctx.signal, ctx.onProgress), ctx.signal));
  return { segments: out, engine, retarget };
}
