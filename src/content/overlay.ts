// UC-02 page modal and UC-03 mini popover, rendered in a closed Shadow DOM.
import { request } from '../core/client';
import { isRetryable, TError, toTError } from '../core/errors';
import { isRtl, t, uiLocale } from '../core/i18n';
import { langName, retargetFor } from '../core/lang';
import { errorText, fillLangSelect } from '../ui/langs';
import { ENGINE_NAMES, getSettings, initUi, rememberLang, type Settings } from '../core/settings';
import type { TranslateResult } from '../core/translate';
import { el, iconButton } from './dom';
import { pop, reveal, setPair, springIn } from '../ui/fx';
import tokens from '../ui/tokens.css';
import css from './overlay.css';

declare const __E2E__: boolean;
let host: HTMLElement | null = null;
let layer: HTMLElement;

export async function ctx(): Promise<{ settings: Settings; layer: HTMLElement }> {
  const settings = await getSettings();
  await initUi(settings);
  if (!host?.isConnected) {
    host = document.createElement('transello-overlay');
    host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;';
    // Closed: page scripts can't read translations via host.shadowRoot. E2E builds open it for test selectors.
    const root = host.attachShadow({ mode: __E2E__ ? 'open' : 'closed' });
    // Constructable stylesheets are not subject to the page's style-src CSP.
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(tokens + css);
    root.adoptedStyleSheets = [sheet];
    layer = el('div', { class: 'layer' });
    root.append(layer);
    document.documentElement.append(host);
  }
  layer.dir = isRtl() ? 'rtl' : 'ltr';
  if (settings.theme === 'auto') host.removeAttribute('data-theme');
  else host.setAttribute('data-theme', settings.theme);
  return { settings, layer };
}

export const inOverlay = (e: Event) => !!host && e.composedPath().includes(host);

/** Overlay colours follow the language pair. Set on the host: derived tokens (--glow-*, --accent) resolve at :host. */
export const paintPair = (from?: string | null, to?: string | null) => host && setPair(host, from, to);

function engineLabel(s: Settings) {
  return s.engine === 'local' ? t('engineLocal') : `${ENGINE_NAMES[s.engine]}${s.models[s.engine] ? ' · ' + s.models[s.engine] : ''}`;
}

/** Run a translation into status/result elements. Returns cancel(). */
function translateInto(
  text: string,
  s: Settings,
  view: { status: HTMLElement; result: HTMLElement; copy?: HTMLButtonElement; target?: HTMLSelectElement },
  onDone?: (r: TranslateResult) => void,
  target = s.target,
  fixedTarget = false,
  allowDownload = false,
): () => void {
  const ui = uiLocale();
  const setStatus = (msg: string, error = false, progress?: number) => {
    view.status.className = 'status' + (error ? ' error' : '');
    view.status.replaceChildren(msg);
    if (progress !== undefined) view.status.append(el('progress', { max: 100, value: Math.round(progress * 100) }));
  };
  // The card (modal / mini) wears the language pair's colours and a border beam while working.
  const card = view.status.closest<HTMLElement>('.modal, .mini');
  const busy = (on: boolean) => card?.classList.toggle('busy', on);
  paintPair(null, target);
  reveal(view.result, '');
  if (view.copy) view.copy.disabled = true;
  setStatus(t('translating'));
  busy(true);
  const p = request({ type: 'translate', req: { text, source: 'auto', target, mode: 'selection', fixedTarget, allowDownload } }, (loaded) =>
    setStatus(t('downloading', Math.round(loaded * 100)), false, loaded),
  );
  p.promise
    .then((m) => {
      const r = (m as { result: TranslateResult }).result;
      busy(false);
      paintPair(r.source, r.needsDownload ? target : (r.retarget ?? target));
      // Ask the user: the modal has a language select; the mini popup hands over to the modal.
      const choose = () => (view.target ? (view.target.focus(), view.target.showPicker?.()) : void showModal(text));
      const button = (label: string, onclick: () => void, primary = false) => el('button', { type: 'button', class: primary ? 'btn primary' : 'btn', text: label, onclick });
      if (r.needsDownload && r.source) {
        // Guessed direction without a model on the device: download only on request, or let the user pick.
        const to = r.retarget ?? target;
        const from = langName(r.source, ui);
        setStatus(!r.retarget && r.detection?.uncertain ? t('needDownloadUnsure', from, langName(to, ui)) : t('needDownload', from, langName(to, ui)));
        const download = async () => {
          if (!r.retarget) return void translateInto(text, s, view, onDone, target, fixedTarget, true);
          await rememberLang(to, { target: to });
          if (view.target) fillLangSelect(view.target, ui, await getSettings(), to);
          translateInto(text, s, view, onDone, to, true);
        };
        // A guessed target is picked here (modal select); a guessed source only in the Transello window (source select).
        const pick = r.retarget ? choose : () => void chrome.runtime.sendMessage({ type: 'open_window', text });
        view.status.append(el('div', { class: 'ask' }, button(t('downloadModel'), () => void download(), true), button(t('chooseTarget'), pick)));
        return;
      }
      if (r.sameLanguage && r.source) {
        const alt = retargetFor(r.source, s.recentLangs);
        setStatus(t('sameLanguage', langName(r.source, ui)));
        view.status.append(' ', alt ? el('button', { type: 'button', class: 'btn', text: t('translateTo', langName(alt, ui)), onclick: () => translateInto(text, s, view, onDone, alt, true) }) : el('button', { type: 'button', class: 'btn', text: t('chooseTarget'), onclick: choose }));
        return;
      }
      view.status.replaceChildren();
      if (r.detection?.lang && r.detection.uncertain) view.status.append(t('detectedUncertain', langName(r.detection.lang, ui)));
      if (r.truncated) view.status.append(t('truncated', r.text.length));
      if (r.retarget && view.target) void getSettings().then((fresh) => fillLangSelect(view.target!, ui, fresh, r.retarget!));
      reveal(view.result, r.text, text); // plain text only; the decode effect is visual
      if (view.copy) view.copy.disabled = !r.text;
      onDone?.(r);
    })
    .catch((e: unknown) => {
      busy(false);
      const te = e instanceof TError ? e : toTError(e);
      if (te.code === 'cancelled') return;
      setStatus(errorText(te), true);
      if (isRetryable(te.code)) view.status.append(' ', el('button', { type: 'button', class: 'btn', text: t('retry'), onclick: () => translateInto(text, s, view, onDone, target, fixedTarget) }));
      if (te.code === 'local_unavailable_here' || te.code === 'unknown_language' || te.code === 'unsupported_pair')
        view.status.append(' ', el('button', { type: 'button', class: 'btn', text: t('openTransello'), onclick: () => chrome.runtime.sendMessage({ type: 'open_window', text }) }));
      if (te.code === 'no_key' || te.code === 'no_permission' || te.code === 'api_missing' || te.code === 'local_failed')
        view.status.append(' ', el('button', { type: 'button', class: 'btn', text: t('settings'), onclick: () => chrome.runtime.sendMessage({ type: 'open_options' }) }));
    });
  return p.cancel;
}

/** Copy icon, the same in the modal and the mini popup: turns green and pops when copied. */
function copyButton(get: () => string, disabled = true): HTMLButtonElement {
  const b = iconButton('copy', t('copy'), async () => {
    await navigator.clipboard.writeText(get());
    pop(b);
    b.classList.add('copied');
    b.title = t('copied');
    b.setAttribute('aria-label', t('copied'));
    setTimeout(() => {
      b.classList.remove('copied');
      b.title = t('copy');
      b.setAttribute('aria-label', t('copy'));
    }, 1500);
  });
  b.disabled = disabled;
  return b;
}

// ---------------- UC-02 modal ----------------
let closeModal: (() => void) | null = null;

export async function showModal(text: string) {
  closeMini?.();
  closeModal?.();
  const { settings, layer } = await ctx();
  const ui = uiLocale();
  const prevFocus = document.activeElement as HTMLElement | null;
  let cancel = () => {};

  const status = el('div', { class: 'status', role: 'status' });
  const result = el('p', { class: 'text result', dir: 'auto', tabindex: 0 });
  const copy = copyButton(() => result.textContent ?? '');
  const target = el('select', { title: t('targetLang'), 'aria-label': t('targetLang') });
  fillLangSelect(target, ui, settings, settings.target);
  const run = (tgt: string, fixed = false) => {
    cancel();
    cancel = translateInto(text, settings, { status, result, copy, target }, undefined, tgt, fixed);
  };
  target.onchange = async () => {
    await rememberLang(target.value, { target: target.value });
    run(target.value, true);
  };

  const close = () => {
    cancel();
    backdrop.remove();
    closeModal = null;
    prevFocus?.focus?.({ preventScroll: true });
  };
  const closeBtn = iconButton('close', t('close'), close);
  const dialog = el(
    'div',
    { class: 'modal glass', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Transello' },
    el('span', { class: 'beam', 'aria-hidden': 'true' }),
    el(
      'div',
      { class: 'head' },
      el('span', { class: 'brand', text: 'Transello' }),
      el('span', { class: 'chip', text: engineLabel(settings) }),
      el('span', { class: 'spacer' }),
      copy,
      iconButton('expand', t('openWindow'), () => (chrome.runtime.sendMessage({ type: 'open_window', text }), close())),
      closeBtn,
    ),
    el(
      'div',
      { class: 'body' },
      el('div', {}, el('div', { class: 'label', text: t('original') }), el('p', { class: 'text source', dir: 'auto', text })),
      el('div', { 'aria-live': 'polite' }, el('div', { class: 'label', text: t('resultLabel') }), status, result),
    ),
    el('div', { class: 'foot' }, el('span', { class: 'label', text: t('targetLang') }), target),
  );
  const backdrop = el('div', { class: 'backdrop' }, dialog);
  backdrop.addEventListener('mousedown', (e) => e.target === backdrop && close());
  dialog.addEventListener('keydown', (e) => {
    e.stopPropagation(); // page shortcuts must not fire while typing in our modal
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') trapFocus(e, dialog);
  });
  layer.append(backdrop);
  springIn(dialog, 'center', { y: 14, scale: 0.97 });
  closeModal = close;
  closeBtn.focus({ preventScroll: true });
  run(settings.target);
}

function trapFocus(e: KeyboardEvent, container: HTMLElement) {
  const f = [...container.querySelectorAll<HTMLElement>('button:not([disabled]), select, [tabindex="0"]')];
  if (!f.length) return;
  const root = container.getRootNode() as ShadowRoot;
  const i = f.indexOf(root.activeElement as HTMLElement);
  const next = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : i === f.length - 1 ? 0 : i + 1;
  e.preventDefault();
  f[next]!.focus();
}

// ---------------- UC-03 mini popover ----------------
let closeMini: (() => void) | null = null;
let miniText = '';

interface Sel {
  text: string;
  rect: () => DOMRect | null;
}

export function readSelection(): Sel {
  const sel = getSelection();
  const hasDocSel = !!sel && !sel.isCollapsed && sel.rangeCount > 0 && sel.toString().trim() !== '';
  const ae = document.activeElement;
  // Text fields keep their own selection; use it only when the document has no live selection elsewhere.
  if (!hasDocSel && (ae instanceof HTMLTextAreaElement || (ae instanceof HTMLInputElement && /^(text|search|url|email|tel)$/.test(ae.type)))) {
    const text = ae.value.slice(ae.selectionStart ?? 0, ae.selectionEnd ?? 0);
    return { text, rect: () => ae.getBoundingClientRect() }; // caret rect is not exposed for inputs → element rect
  }
  if (!hasDocSel) return { text: '', rect: () => null };
  const range = sel!.getRangeAt(0).cloneRange();
  return {
    text: sel!.toString(),
    rect: () => {
      const r = range.getBoundingClientRect();
      return r.width || r.height ? r : (range.getClientRects()[0] ?? null);
    },
  };
}

export function place(box: HTMLElement, anchor: DOMRect | null) {
  const m = 8;
  const w = box.offsetWidth;
  const h = box.offsetHeight;
  const vw = document.documentElement.clientWidth || innerWidth;
  const vh = document.documentElement.clientHeight || innerHeight;
  let left: number, top: number;
  if (!anchor) {
    left = (vw - w) / 2;
    top = (vh - h) / 3;
  } else {
    left = anchor.left;
    top = anchor.bottom + m;
    if (top + h > vh - m && anchor.top - h - m >= m) top = anchor.top - h - m; // flip above
  }
  box.style.left = `${Math.round(Math.max(m, Math.min(left, vw - w - m)))}px`;
  box.style.top = `${Math.round(Math.max(m, Math.min(top, vh - h - m)))}px`;
}

export async function toggleMini() {
  const sel = readSelection();
  const text = sel.text.trim() ? sel.text : '';
  if (closeMini && text === miniText) return closeMini(); // second press on same selection closes
  closeMini?.();
  closeModal?.();
  const { settings, layer } = await ctx();
  let cancel = () => {};
  const status = el('div', { class: 'meta', role: 'status' });
  const result = el('div', { class: 'text', dir: 'auto' });
  const close = () => {
    cancel();
    box.remove();
    removeEventListener('scroll', reposition, true);
    removeEventListener('resize', reposition);
    removeEventListener('keydown', onKey, true);
    removeEventListener('pointerdown', onOutside, true);
    ro.disconnect();
    closeMini = null;
    miniText = '';
  };
  const copy = copyButton(() => result.textContent ?? '', false);
  const tools = el('div', { class: 'tools' });
  const box = el(
    'div',
    { class: 'mini glass', role: 'dialog', 'aria-label': 'Transello', 'aria-live': 'polite' },
    el('span', { class: 'beam', 'aria-hidden': 'true' }),
    el('div', { class: 'row' }, result, tools),
    status,
  );

  if (!text) {
    result.textContent = t('selectText');
    tools.append(iconButton('expand', t('openTransello'), () => (chrome.runtime.sendMessage({ type: 'open_window' }), close())), iconButton('close', t('close'), close));
    setTimeout(() => closeMini === close && close(), 4000);
  } else {
    tools.append(copy, iconButton('expand', t('expand'), () => (close(), void showModal(text))), iconButton('close', t('close'), close));
    // Mini shows the loading state immediately; result fills in when ready.
    cancel = translateInto(text, settings, { status, result }, () => {
      status.textContent = engineLabel(settings);
      reposition();
    });
  }
  // Direct, not via requestAnimationFrame: rAF is paused in occluded windows (live in Brave). Cheap at this size.
  const reposition = () => box.isConnected && place(box, sel.rect());
  const ro = new ResizeObserver(reposition);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  const onOutside = (e: Event) => !inOverlay(e) && close();
  layer.append(box);
  place(box, sel.rect());
  // Grow out of the selection: from its left edge, downwards (or upwards when flipped above it).
  const a = sel.rect();
  const b = box.getBoundingClientRect();
  springIn(box, a ? `${Math.round(a.left - b.left)}px ${b.top < a.top ? '100%' : '0%'}` : 'center', { y: 0, scale: 0.92 });
  ro.observe(box);
  addEventListener('scroll', reposition, { capture: true, passive: true });
  addEventListener('resize', reposition);
  addEventListener('keydown', onKey, true);
  addEventListener('pointerdown', onOutside, true);
  closeMini = close;
  miniText = text;
}

/** Prefer the live selection (keeps line breaks) when it matches Chrome's selectionText. */
export function bestSelectionText(selectionText: string): string {
  const live = getSelection()?.toString() ?? '';
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  return live && norm(live) === norm(selectionText) ? live : selectionText;
}
