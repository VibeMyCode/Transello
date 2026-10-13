import { beforeEach, describe, expect, it } from 'vitest';
import { apply, batches, collectSegments, restore } from '../../src/content/segments';

beforeEach(() => {
  document.body.replaceChildren();
});

function html(markup: string) {
  // Test fixture only (trusted string); production code never parses HTML.
  const t = document.createElement('template');
  t.innerHTML = markup; // eslint-disable-line no-restricted-properties
  document.body.append(t.content);
}

describe('collectSegments', () => {
  it('takes visible prose, skips code/scripts/forms/editable/hidden/notranslate', () => {
    html(`
      <h1>Title here</h1><p>Hello <b>bold</b> world <a href="#">link text</a></p>
      <pre>keep pre</pre><code>keep code</code><script>var x = "no"</script><style>p{}</style>
      <form><label>Form label</label><input value="v"></form>
      <textarea>no textarea</textarea><div contenteditable="true">no editable</div>
      <div style="display:none">no hidden</div><div hidden>no hidden attr</div>
      <span translate="no">no brand</span><span class="notranslate">no class</span>
      <p aria-hidden="true">no aria hidden</p><p>   </p><p>12345 — 678</p>
      <svg><text>no svg</text></svg><transello-overlay>no overlay</transello-overlay>`);
    const texts = collectSegments().segments.map((s) => s.core);
    expect(texts).toEqual(['Title here', 'Hello', 'bold', 'world', 'link text']);
  });

  it('preserves surrounding whitespace separately', () => {
    html('<p>  spaced text \n</p>');
    const [s] = collectSegments().segments;
    expect(s).toMatchObject({ lead: '  ', core: 'spaced text', trail: ' \n' });
  });

  it('caps the number of nodes and reports the total', () => {
    html(Array.from({ length: 30 }, (_, i) => `<p>Paragraph ${i}</p>`).join(''));
    const r = collectSegments(document.body, 10);
    expect(r.segments.length).toBe(10);
    expect(r.total).toBe(30);
  });
});

describe('batches', () => {
  it('bounds items and characters, keeps order', () => {
    html(Array.from({ length: 100 }, (_, i) => `<p>${'word '.repeat(10)}${i}</p>`).join(''));
    const segs = collectSegments().segments;
    const b = batches(segs, 40, 500);
    expect(b.flat()).toEqual(segs);
    for (const x of b) {
      expect(x.length).toBeLessThanOrEqual(40);
      expect(x.reduce((n, s) => n + s.core.length, 0)).toBeLessThanOrEqual(500);
    }
  });
});

describe('apply / restore', () => {
  it('replaces text only, keeps elements/listeners, and restores exactly', () => {
    html('<p id="p">Hello <a id="a" href="#x">world</a>!</p>');
    let clicks = 0;
    document.getElementById('a')!.addEventListener('click', () => clicks++);
    const before = document.body.innerHTML; // eslint-disable-line no-restricted-properties
    const applied = new Map<Text, { original: string; translated: string }>();
    for (const s of collectSegments().segments) {
      apply(s, `<i>${s.core.toUpperCase()}</i>`);
      applied.set(s.node, { original: s.original, translated: s.node.data });
    }
    expect(document.getElementById('p')!.textContent).toBe('<i>HELLO</i> <i>WORLD</i>!');
    expect(document.querySelectorAll('i').length).toBe(0); // never parsed as HTML
    document.getElementById('a')!.click();
    expect(clicks).toBe(1);
    expect(restore(applied)).toBe(2);
    expect(document.body.innerHTML).toBe(before); // eslint-disable-line no-restricted-properties
  });

  it('does not overwrite text the page changed meanwhile', () => {
    html('<p>Hello</p>');
    const [s] = collectSegments().segments;
    s!.node.data = 'Changed by app';
    expect(apply(s!, 'Привет')).toBe(false);
    expect(s!.node.data).toBe('Changed by app');
  });

  it('restore skips nodes the page modified after translation', () => {
    html('<p>Hello</p>');
    const [s] = collectSegments().segments;
    apply(s!, 'Привет');
    const applied = new Map([[s!.node, { original: s!.original, translated: s!.node.data }]]);
    s!.node.data = 'App update';
    expect(restore(applied)).toBe(0);
    expect(s!.node.data).toBe('App update');
  });
});
