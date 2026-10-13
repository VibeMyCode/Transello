// Tiny DOM builder: no innerHTML anywhere (spec §6). Text is always set via textContent.
type Attrs = Record<string, string | boolean | number | ((e: Event) => void) | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | string | null | false)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === 'function') e.addEventListener(k.replace(/^on/, ''), v);
    else if (k === 'text') e.textContent = String(v);
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const k of kids) if (k) e.append(k);
  return e;
}

export const ICONS = {
  close: 'M6 6l12 12M18 6L6 18',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  expand: 'M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7',
};

export function icon(name: keyof typeof ICONS): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', ICONS[name]);
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '1.8');
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  svg.append(p);
  return svg;
}

export function iconButton(name: keyof typeof ICONS, label: string, onclick: () => void): HTMLButtonElement {
  const b = el('button', { type: 'button', class: 'icon-btn', title: label, 'aria-label': label, onclick });
  b.append(icon(name));
  return b;
}
