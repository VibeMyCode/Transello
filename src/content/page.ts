// UC-04 page translation controller: toolbar, batches, progress, cancel, restore. No observers, no auto-translate.
import { request } from '../core/client';
import { TError, toTError } from '../core/errors';
import { t, uiLocale, type MsgKey } from '../core/i18n';
import { langName } from '../core/lang';
import { isSensitiveHost } from '../core/sensitive';
import { ENGINE_NAMES, setSettings, type Settings } from '../core/settings';
import { el, iconButton } from './dom';
import { springIn } from '../ui/fx';
import { ctx, paintPair } from './overlay';
import { apply, batches, collectSegments, MAX_NODES, restore, type Segment } from './segments';

type State = 'idle' | 'running' | 'translated' | 'original';
let state: State = 'idle';
let cancel: (() => void) | null = null;
const applied = new Map<Text, { original: string; translated: string }>();
let bar: HTMLElement | null = null;
const CLOUD_PAGE_MAX = 40_000; // chars per cloud page run

async function toolbar(): Promise<{ msg: HTMLElement; actions: HTMLElement; settings: Settings }> {
  const { settings, layer } = await ctx();
  if (!bar?.isConnected) {
    bar = el('div', { class: 'toolbar glass', role: 'status', 'aria-live': 'polite' }, el('span', { class: 'beam', 'aria-hidden': 'true' }), el('span', { class: 'msg' }), el('span', { class: 'actions' }));
    bar.append(iconButton('close', t('close'), closeBar));
    paintPair(null, settings.target);
    layer.append(bar);
    springIn(bar, '100% 100%', { y: 10, scale: 0.96 });
  }
  return { msg: bar.querySelector('.msg')!, actions: bar.querySelector('.actions')!, settings };
}

function closeBar() {
  cancel?.();
  bar?.remove();
  bar = null;
}

function button(label: string, onclick: () => void, primary = false) {
  return el('button', { type: 'button', class: primary ? 'btn primary' : 'btn', text: label, onclick });
}

async function show(text: string, buttons: HTMLButtonElement[] = [], progress?: number) {
  const { msg, actions } = await toolbar();
  msg.replaceChildren(text);
  bar?.classList.toggle('busy', progress !== undefined);
  if (progress !== undefined) msg.append(el('progress', { max: 100, value: Math.round(progress * 100) }));
  actions.replaceChildren(...buttons);
}

/** Entry point from the context menu. Re-invoking while running cancels; after translation toggles views. */
export async function togglePage() {
  if (state === 'running') return cancel?.();
  if (state === 'translated') return showOriginal();
  return start();
}

function showOriginal() {
  restore(applied);
  state = 'original';
  void show(t('pageOriginal'), [button(t('translateAgain'), () => void start(), true)]);
}

/** Viewport-first order so the user sees the visible part translated first. */
function viewportFirst(segs: Segment[]): Segment[] {
  const vh = innerHeight;
  const inView = (s: Segment) => {
    const r = s.node.parentElement?.getBoundingClientRect();
    return !!r && r.bottom > 0 && r.top < vh;
  };
  return [...segs.filter(inView), ...segs.filter((s) => !inView(s))];
}

async function confirmCloud(settings: Settings, chars: number): Promise<boolean> {
  const sensitive = isSensitiveHost(location.hostname);
  if (settings.pageCloudAck && !sensitive) return true;
  const name = ENGINE_NAMES[settings.engine];
  return new Promise((resolve) => {
    void show((sensitive ? t('pageSensitive') + ' ' : '') + t('pageCloudConfirm', chars.toLocaleString(), name), [
      button(t('confirmSend'), async () => {
        if (!sensitive) await setSettings({ pageCloudAck: true });
        resolve(true);
      }, true),
      button(t('cancel'), () => {
        void show(t('err_cancelled'));
        resolve(false);
      }),
    ]);
  });
}

async function start(allowDownload = false) {
  restore(applied);
  const { settings } = await toolbar();
  const { segments, total } = collectSegments();
  if (!segments.length) return show(t('pageNothing'));
  let ordered = viewportFirst(segments);
  const cloud = settings.engine !== 'local';
  let capped = false;
  if (cloud) {
    // Cost safety: cap characters sent to a paid API per page run; report the partial result honestly.
    let sum = 0;
    const cut = ordered.findIndex((s) => (sum += s.core.length) > CLOUD_PAGE_MAX);
    if (cut >= 0) [ordered, capped] = [ordered.slice(0, cut), true];
  }
  const chars = ordered.reduce((n, s) => n + s.core.length, 0);
  if (cloud && !(await confirmCloud(settings, chars))) return;

  state = 'running';
  let stopped = false;
  let pending: { cancel(): void } | null = null;
  cancel = () => {
    stopped = true;
    pending?.cancel();
  };
  let done = 0;
  let ok = 0;
  const progress = () => show(t('pageTranslating', done, ordered.length), [button(t('cancel'), () => cancel?.())], done / ordered.length);
  await progress();
  try {
    for (const batch of batches(ordered)) {
      if (stopped) throw new TError('cancelled');
      const p = request(
        { type: 'batch', segments: batch.map((s) => s.core), source: 'auto', target: settings.target, consent: cloud, allowDownload },
        (loaded) => void show(t('downloading', Math.round(loaded * 100)), [button(t('cancel'), () => cancel?.())], loaded),
      );
      pending = p;
      const r = (await p.promise) as { segments: string[] };
      batch.forEach((s, i) => {
        const tr = r.segments[i];
        if (typeof tr === 'string' && tr && apply(s, tr)) {
          applied.set(s.node, { original: s.original, translated: s.node.data });
          ok++;
        }
      });
      done += batch.length;
      await progress();
    }
    state = 'translated';
    const summary = [t('pageDone', ok, total)];
    if (total > MAX_NODES || capped) summary.push(t('pageLimited', ordered.length));
    await show(summary.join(' '), [button(t('showOriginal'), showOriginal, true)]);
  } catch (e) {
    const te = e instanceof TError ? e : toTError(e);
    state = applied.size ? 'translated' : 'idle';
    if (te.code === 'needs_download') {
      // Detected page language has no model on the device: download only on request.
      const [a = '', b = ''] = (te.detail ?? '').split('>');
      return void show(t('needDownload', langName(a, uiLocale()), langName(b, uiLocale())), [button(t('downloadModel'), () => void start(true), true), button(t('cancel'), closeBar)]);
    }
    const msg = te.code === 'cancelled' ? t('err_cancelled') : t(`err_${te.code}` as MsgKey);
    const actions = [button(t('translateAgain'), () => void start())];
    if (applied.size) actions.unshift(button(t('showOriginal'), showOriginal, true));
    await show(`${msg} ${t('pageDone', ok, total)}`, actions);
  } finally {
    cancel = null;
  }
}

addEventListener('pagehide', () => {
  cancel?.();
  applied.clear(); // bfcache/navigation: drop references to old nodes
});
