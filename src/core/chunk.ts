// Structure-preserving text chunking for long inputs (spec §3 UC-01/UC-02 limits).

export const MAX_TEXT = 50_000; // per popup/modal request; longer input is truncated honestly
export const CHUNK = 1_500;

export interface Piece {
  text: string;
  translate: boolean;
}

/** Split text into pieces whose concatenation equals the input. Whitespace runs between chunks are kept verbatim. */
export function splitText(text: string, max = CHUNK): Piece[] {
  const out: Piece[] = [];
  const lead = /^\s*/.exec(text)![0];
  const trail = /\s*$/.exec(text.slice(lead.length))![0];
  const body = text.slice(lead.length, text.length - trail.length);
  if (lead) out.push({ text: lead, translate: false });
  if (body) {
    // The built-in Translator merges lines (live: "a\nb" → "a b"), so each line is translated on its own
    // and newline runs are kept verbatim.
    const parts = body.split(/(\n\s*)/); // [line, sep, line, sep, ...]
    for (let i = 0; i < parts.length; i += 2) {
      const line = parts[i] ?? '';
      const sep = parts[i + 1] ?? '';
      if (line.length > max) out.push(...splitLong(line, max));
      else if (line) out.push({ text: line, translate: true });
      if (sep) out.push({ text: sep, translate: false });
    }
  }
  if (trail) out.push({ text: trail, translate: false });
  return out;
}

function splitLong(line: string, max: number): Piece[] {
  const out: Piece[] = [];
  let cur = '';
  const seg = new Intl.Segmenter(undefined, { granularity: 'sentence' });
  for (const { segment } of seg.segment(line)) {
    if (cur.length + segment.length > max && cur) {
      out.push({ text: cur, translate: true });
      cur = '';
    }
    if (segment.length > max) {
      for (let i = 0; i < segment.length; i += max) out.push({ text: segment.slice(i, i + max), translate: true });
    } else cur += segment;
  }
  if (cur) out.push({ text: cur, translate: true });
  return out;
}

/** Cut to `max` chars at a paragraph/sentence boundary when possible. */
export function limitText(text: string, max = MAX_TEXT): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  const head = text.slice(0, max);
  const cut = Math.max(head.lastIndexOf('\n'), head.lastIndexOf('. '));
  return { text: cut > max * 0.5 ? head.slice(0, cut + 1) : head, truncated: true };
}

/** Translate the translatable pieces sequentially; keep separators untouched. */
export async function translatePieces(
  pieces: Piece[],
  fn: (s: string) => Promise<string>,
  signal?: AbortSignal,
): Promise<string> {
  let out = '';
  for (const p of pieces) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    out += p.translate ? await fn(p.text) : p.text;
  }
  return out;
}
