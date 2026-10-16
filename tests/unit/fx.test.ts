import { describe, expect, it, vi } from 'vitest';
import { glyphPool, langHue, reveal, setPair } from '../../src/ui/fx';

// happy-dom has no Web Animations API; motion/mini only needs element.animate() to exist.
const fakeAnimation = () => ({ finished: Promise.resolve(), cancel() {}, onfinish: null, playState: 'finished', currentTime: 0, effect: null, commitStyles() {} });
(Element.prototype as unknown as { animate: unknown }).animate ??= vi.fn(fakeAnimation);

describe('fx', () => {
  it('stable, distinct language hues; unknown codes hash, auto is neutral', () => {
    expect(langHue('en')).toBe(langHue('en-US'));
    expect(langHue('en')).not.toBe(langHue('ru'));
    expect(langHue('auto')).toBe(langHue(null));
    expect(langHue('xx')).toBeGreaterThanOrEqual(0);
  });

  it('hue glides the short way round the wheel', () => {
    const el = document.createElement('div');
    setPair(el, 'en', 'auto'); // --hb 290
    setPair(el, 'en', 'ru'); // ru 12 → nearest equivalent to 290 is 372, not 12
    expect(Number(el.style.getPropertyValue('--hb'))).toBe(372);
  });

  it('scramble glyphs come from the source writing system', () => {
    expect(glyphPool('Привет')).toContain('ж');
    expect(glyphPool('こんにちは')).toContain('あ');
    expect(glyphPool('Hello')).toContain('a');
  });

  it('reveal keeps the exact text in the DOM from the first frame (copy, a11y, tests)', () => {
    const el = document.createElement('div');
    const text = 'Привет, мир!\n\nВторая строка с   пробелами.';
    reveal(el, text, 'Hello, world!');
    expect(el.textContent).toBe(text);
    expect(el.querySelectorAll('.w').length).toBeGreaterThan(3);
    reveal(el, '');
    expect(el.textContent).toBe('');
  });
});
