// UC-04 DOM text collection: visible, user-facing text nodes only (spec §3 UC-04). Pure DOM, unit-tested.

const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'CODE', 'PRE', 'KBD', 'SAMP', 'VAR', 'TEXTAREA', 'INPUT', 'SELECT',
  'OPTION', 'DATALIST', 'SVG', 'MATH', 'CANVAS', 'IFRAME', 'OBJECT', 'EMBED', 'TRANSELLO-OVERLAY', 'HEAD', 'TITLE',
]);
// What users type (field values, editable areas) is never touched; attributes (aria-label, placeholder) neither.
// Static text inside a <form> is translated: real sites wrap whole hero sections in forms (user report: brave.com
// card waitlist stayed English while only the menu was translated). Only text nodes change, so forms still submit.
const SKIP_CLOSEST = '[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"], [translate="no"], .notranslate, [aria-hidden="true"], [hidden]';

export const MAX_NODES = 2_000; // ponytail: hard cap on very large pages; partial result is reported honestly

export interface Segment {
  node: Text;
  original: string;
  /** Leading/trailing whitespace preserved around the translated core. */
  lead: string;
  trail: string;
  core: string;
}

function visible(el: Element): boolean {
  const cs = getComputedStyle(el);
  return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.visibility !== 'collapse';
}

/** Collect translatable text nodes in document order. Returns at most `max` segments plus the total found. */
export function collectSegments(root: Node = document.body, max = MAX_NODES): { segments: Segment[]; total: number } {
  const segments: Segment[] = [];
  let total = 0;
  const visCache = new Map<Element, boolean>();
  const isVisible = (el: Element) => {
    let v = visCache.get(el);
    if (v === undefined) visCache.set(el, (v = visible(el)));
    return v;
  };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (n.nodeType === Node.ELEMENT_NODE) {
        const el = n as Element;
        if (SKIP_TAGS.has(el.tagName.toUpperCase()) || el.matches(SKIP_CLOSEST) || !isVisible(el)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_SKIP; // descend
      }
      const text = (n as Text).data;
      return /\p{L}/u.test(text) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    total++;
    if (segments.length >= max) continue;
    const t = n as Text;
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(t.data)!;
    segments.push({ node: t, original: t.data, lead: m[1]!, core: m[2]!, trail: m[3]! });
  }
  return { segments, total };
}

/** Group segments into batches bounded by count and characters (spec: "batch/chunks по разумному бюджету"). */
export function batches(segs: Segment[], maxItems = 40, maxChars = 3_000): Segment[][] {
  const out: Segment[][] = [];
  let cur: Segment[] = [];
  let chars = 0;
  for (const s of segs) {
    const len = Math.min(s.core.length, 3_900);
    if (cur.length && (cur.length >= maxItems || chars + len > maxChars)) {
      out.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(s);
    chars += len;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Apply a translation to a text node, unless the page changed it meanwhile. Returns whether applied. */
export function apply(seg: Segment, translated: string): boolean {
  if (!seg.node.isConnected || seg.node.data !== seg.original) return false;
  seg.node.data = seg.lead + translated + seg.trail; // text only, never HTML
  return true;
}

/** Restore original text where our translation is still in place. */
export function restore(applied: Map<Text, { original: string; translated: string }>): number {
  let n = 0;
  for (const [node, v] of applied) {
    if (node.isConnected && node.data === v.translated) {
      node.data = v.original;
      n++;
    }
  }
  applied.clear();
  return n;
}
