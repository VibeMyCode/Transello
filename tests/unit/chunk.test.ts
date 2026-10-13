import { describe, expect, it } from 'vitest';
import { limitText, splitText, translatePieces } from '../../src/core/chunk';

const join = (t: string, max?: number) => splitText(t, max).map((p) => p.text).join('');

describe('splitText', () => {
  it.each([
    'Hello', '  lead and trail  ', 'a\nb\nc', 'para one\n\npara two\n\n\nthree', '\n\n', 'x'.repeat(5000), 'Привет 👋🏽 мир\r\nhttps://example.com/a?b=c',
  ])('round-trips %#', (s) => expect(join(s, 100)).toBe(s));

  it('never translates pure whitespace', () => {
    for (const p of splitText('  a\n\n  b  ', 10)) if (!p.translate) expect(p.text.trim()).toBe('');
  });
  it('every line is translated separately (Translator merges newlines)', () => {
    const tr = splitText('a\nb\n\nc').filter((p) => p.translate).map((p) => p.text);
    expect(tr).toEqual(['a', 'b', 'c']);
  });
  it('respects max size', () => {
    const long = Array.from({ length: 50 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
    for (const p of splitText(long, 120)) expect(p.text.length).toBeLessThanOrEqual(120);
  });
});

describe('limitText', () => {
  it('no-op under limit', () => expect(limitText('abc', 10)).toEqual({ text: 'abc', truncated: false }));
  it('cuts at a boundary', () => {
    const r = limitText('aaaa. bbbb. cccc', 12);
    expect(r.truncated).toBe(true);
    expect(r.text).toBe('aaaa. bbbb.');
  });
});

describe('translatePieces', () => {
  it('keeps separators and order', async () => {
    const out = await translatePieces(splitText('one\n\ntwo'), async (s) => s.toUpperCase());
    expect(out).toBe('ONE\n\nTWO');
  });
  it('stops on abort', async () => {
    const c = new AbortController();
    c.abort();
    await expect(translatePieces(splitText('a\n\nb'), async (s) => s, c.signal)).rejects.toThrow();
  });
});
