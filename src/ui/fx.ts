// Visual effects shared by the popup and the page overlays. Purely visual: the real text is always in the DOM
// from the first frame (copy, screen readers and tests read textContent), and everything is off under reduced motion.
// motion/mini (WAAPI, ~3 kB) + the spring generator: a fraction of the hybrid engine, enough for these effects.
import { animate } from 'motion/mini';
import { spring, stagger } from 'motion';

export const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? true;

// Every language gets its own colour (OKLCH hue angle), so a language pair has a recognisable look: en blue → ru rose.
const HUES: Record<string, number> = {
  en: 255, ru: 12, zh: 32, ja: 350, ko: 300, de: 80, fr: 275, es: 52, it: 150, pt: 172, ar: 185, hi: 62, bn: 140,
  id: 215, tr: 25, uk: 95, pl: 5, nl: 58, sv: 235, fi: 225, no: 245, da: 20, cs: 262, el: 230, he: 268, th: 320, vi: 135,
};
export function langHue(code?: string | null): number {
  const base = (code ?? '').split('-')[0]!.toLowerCase();
  if (!base || base === 'auto') return 290;
  if (base in HUES) return HUES[base]!;
  let h = 0;
  for (const c of base) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

/** Paint a language pair onto an element as --ha / --hb (registered properties, so CSS transitions them). */
export function setPair(el: HTMLElement, from?: string | null, to?: string | null) {
  for (const [name, code] of [['--ha', from], ['--hb', to]] as const) {
    // Hue angles are plain numbers to CSS: pick the equivalent angle nearest to the current one, so the colour
    // glides the short way round the wheel (violet → rose, not violet → green → rose). OKLCH accepts any angle.
    const cur = parseFloat(el.style.getPropertyValue(name) || getComputedStyle(el).getPropertyValue(name));
    const h = langHue(code);
    el.style.setProperty(name, String(Number.isFinite(cur) ? h + 360 * Math.round((cur - h) / 360) : h));
  }
}

// Scramble glyphs come from the *source* writing system: the text visibly turns from one script into the other.
const POOLS: [RegExp, string][] = [
  [/\p{Script=Cyrillic}/u, 'абвгдежзийклмнопрстуфхцчшщыэюя'],
  [/[\p{Script=Hiragana}\p{Script=Katakana}]/u, 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめも'],
  [/\p{Script=Han}/u, '的一是不了人我在有他这中大来上国个到说们为子和你地出道也时年得就那要下以生会'],
  [/\p{Script=Hangul}/u, '가나다라마바사아자차카타파하거너더러머버서어저처'],
  [/\p{Script=Arabic}/u, 'ابتثجحخدذرزسشصضطظعغفقكلمنهوي'],
  [/\p{Script=Devanagari}/u, 'अआइईउऊएओकखगघचछजझटठडढतथदधनपफबभमयरलवशसह'],
  [/\p{Script=Bengali}/u, 'অআইউএওকখগঘচছজঝটঠডতথদধনপফবভমযরলশসহ'],
  [/\p{Script=Greek}/u, 'αβγδεζηθικλμνξοπρστυφχψω'],
  [/\p{Script=Hebrew}/u, 'אבגדהוזחטיכלמנסעפצקרשת'],
  [/\p{Script=Thai}/u, 'กขคงจฉชซดตถทธนบปผพฟมยรลวสหอ'],
];
export function glyphPool(sample: string): string[] {
  for (const [re, pool] of POOLS) if (re.test(sample)) return [...pool];
  return [...'abcdefghijklmnopqrstuvwxyz'];
}

const MAX_WORDS = 80; // ponytail: only the first words scramble; the rest fades in. Enough for the visible area.
const running = new WeakMap<HTMLElement, () => void>();
const graphemes = (s: string) => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].map((g) => g.segment);

/**
 * Show `text` in `el` with a decode effect: each word briefly cycles through glyphs of the source script, then settles.
 * The words are real text inside spans (textContent === text at once); the scramble lives in ::before via data-s.
 */
export function reveal(el: HTMLElement, text: string, sourceSample = '') {
  running.get(el)?.();
  el.textContent = text;
  if (!text.trim() || reducedMotion() || text.length > 20_000) return;

  const words: HTMLElement[] = [];
  const nodes: Node[] = [];
  let tail = '';
  for (const s of new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text)) {
    if (words.length >= MAX_WORDS) tail += s.segment;
    else if (s.isWordLike) {
      const w = document.createElement('span');
      w.className = 'w';
      w.textContent = s.segment;
      words.push(w);
      nodes.push(w);
    } else nodes.push(document.createTextNode(s.segment));
  }
  const rest = document.createElement('span');
  rest.className = 'rest';
  rest.textContent = tail;
  el.replaceChildren(...nodes, ...(tail ? [rest] : []));

  const pool = glyphPool(sourceSample);
  const pick = () => pool[(Math.random() * pool.length) | 0]!;
  const parts = words.map((w) => graphemes(w.textContent ?? ''));
  const step = Math.min(28, 450 / Math.max(1, words.length)); // ms between word starts; whole effect ≤ ~0.75 s
  const dur = 300;
  const t0 = performance.now();
  let raf = 0;
  let lastSwap = 0;

  const finish = () => {
    cancelAnimationFrame(raf);
    clearTimeout(guard);
    for (const w of words) w.classList.remove('scr');
    running.delete(el);
  };
  const tick = (now: number) => {
    let active = false;
    const swap = now - lastSwap > 45; // ~22 glyph changes per second: legible, not noisy
    if (swap) lastSwap = now;
    words.forEach((w, i) => {
      const p = (now - t0 - i * step) / dur;
      if (p >= 1) return void (w.classList.contains('scr') && w.classList.remove('scr'));
      active = true;
      if (!swap) return;
      const g = parts[i]!;
      const keep = Math.max(0, Math.floor(p * g.length));
      w.dataset.s = g.map((c, j) => (j < keep || !c.trim() ? c : pick())).join('');
      w.classList.add('scr');
    });
    if (active) raf = requestAnimationFrame(tick);
    else finish();
  };
  // rAF pauses in hidden/occluded windows (seen in Brave): the guard always lands on the real text.
  const guard = setTimeout(finish, words.length * step + dur + 400);
  running.set(el, finish);
  raf = requestAnimationFrame(tick);
  animate(words, { opacity: [0.25, 1], filter: ['blur(3px)', 'blur(0px)'] }, { delay: stagger(step / 1000), duration: 0.36, ease: 'easeOut' });
  if (tail) animate(rest, { opacity: [0, 1] }, { delay: (words.length * step) / 1000, duration: 0.5 });
}

/** Springy entrance for floating surfaces; `origin` is where it grows from (e.g. the selection). */
export function springIn(el: HTMLElement, origin = 'center', from = { y: 8, scale: 0.96 }) {
  if (reducedMotion()) return;
  el.style.transformOrigin = origin;
  animate(el, { opacity: [0, 1], transform: [`translateY(${from.y}px) scale(${from.scale})`, 'none'] }, { type: spring, bounce: 0.28, duration: 0.45 });
}

/** Small "it worked" pop (copy). */
export const pop = (el: Element) => !reducedMotion() && animate(el, { transform: ['scale(1)', 'scale(1.12)', 'scale(1)'] }, { duration: 0.32, ease: 'easeOut' });

/** Half-turn with a spring (swap languages). */
export const spin = (el: Element) => !reducedMotion() && animate(el, { transform: ['rotate(0deg)', 'rotate(180deg)'] }, { type: spring, bounce: 0.35, duration: 0.55 });

/** Gentle staggered build of a page's main blocks on open. */
export function enter(els: Element[]) {
  if (reducedMotion()) return;
  animate(els, { opacity: [0, 1], transform: ['translateY(4px)', 'none'] }, { delay: stagger(0.025), duration: 0.26, ease: 'easeOut' });
}
