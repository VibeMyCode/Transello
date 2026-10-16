// UC-01: action popup (and the same page as a standalone window with ?window=1).
import { request } from '../core/client';
import { isRetryable, TError, toTError } from '../core/errors';
import { applyI18n, t, uiLocale, type MsgKey } from '../core/i18n';
import { langName, retargetFor } from '../core/lang';
import { fillLangSelect } from '../ui/langs';
import { enter, pop, reveal, setPair, spin } from '../ui/fx';
import { applyTheme, ENGINE_NAMES, getSettings, initUi, rememberLang, type Settings } from '../core/settings';
import type { TranslateResult } from '../core/translate';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = $<HTMLTextAreaElement>('input');
const source = $<HTMLSelectElement>('source');
const target = $<HTMLSelectElement>('target');
const result = $('result');
const status = $('status');
const meta = $('meta');
const output = $('output');
const btnTranslate = $<HTMLButtonElement>('translate');
const btnCopy = $<HTMLButtonElement>('copy');

const isWindow = new URLSearchParams(location.search).has('window');
const DEBOUNCE_MS = 350;
let settings: Settings;
let gen = 0; // generation id: only the latest request may render (NFR-03)
let cancelCurrent: (() => void) | null = null;
let last: TranslateResult | null = null;
let debounce: ReturnType<typeof setTimeout> | undefined;
let notice: string | null = null; // persistent hint, e.g. "page is restricted" handoff

function fillLangs() {
  const ui = uiLocale();
  fillLangSelect(source, ui, settings, source.value || 'auto', true);
  fillLangSelect(target, ui, settings, settings.target);
  paint();
}

/** The whole popup takes the colours of the current language pair (source: chosen, else last detected). */
const paint = () => setPair(document.documentElement, source.value !== 'auto' ? source.value : (last?.source ?? null), target.value);

function engineLabel(): string {
  if (settings.engine === 'local') return t('engineLocal');
  const model = settings.models[settings.engine];
  return `${ENGINE_NAMES[settings.engine]}${model ? ' · ' + model : ''}`;
}

function setBusy(busy: boolean) {
  output.setAttribute('aria-busy', String(busy));
  btnTranslate.textContent = t(busy ? 'cancel' : 'translate');
}

function showStatus(text: string, opts: { progress?: number; error?: boolean; dots?: boolean; retry?: boolean } = {}) {
  status.replaceChildren();
  status.className = 'status' + (opts.error ? ' error' : '');
  const line = document.createElement('div');
  line.textContent = text;
  if (opts.dots) line.className = 'dots';
  status.append(line);
  if (opts.progress !== undefined) {
    const p = document.createElement('progress');
    p.max = 100;
    p.value = Math.round(opts.progress * 100);
    const note = document.createElement('div');
    note.textContent = t('downloadingNote');
    status.append(p, note);
  }
  if (opts.retry) {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = t('retry');
    b.onclick = () => run();
    status.append(b);
  }
}

function setMeta(nodes: (string | Node)[]) {
  meta.replaceChildren(...(notice ? [notice, ...nodes] : nodes));
}

function linkButton(label: string, onClick: () => void) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.onclick = onClick;
  return b;
}

function render(r: TranslateResult) {
  last = r;
  const ui = uiLocale();
  status.replaceChildren();
  reveal(result, r.text, input.value); // plain text only, never HTML (spec §6); the decode effect is visual only
  paint();
  btnCopy.disabled = !r.text;
  if (r.retarget && !r.needsDownload) void getSettings().then((s) => ((settings = s), fillLangs())); // SW already saved the switched target
  const m: (string | Node)[] = [];
  if (r.needsDownload && r.source && r.retarget) {
    // Auto-chosen language without a model on the device: download only on request, or let the user pick.
    const alt = r.retarget;
    showStatus(t('needDownload', langName(r.source, ui), langName(alt, ui)));
    m.push(linkButton(t('downloadModel'), () => setTarget(alt)), linkButton(t('chooseTarget'), () => (target.focus(), target.showPicker?.())));
  } else if (r.sameLanguage && r.source) {
    const alt = retargetFor(r.source, settings.recentLangs);
    showStatus(t('sameLanguage', langName(r.source, ui)));
    // Nothing sensible to switch to (e.g. English-only browser, English text): ask instead of guessing.
    m.push(alt ? linkButton(t('translateTo', langName(alt, ui)), () => setTarget(alt)) : linkButton(t('chooseTarget'), () => (target.focus(), target.showPicker?.())));
  } else if (r.detection?.lang) {
    const name = langName(r.detection.lang, ui);
    m.push(r.detection.uncertain ? t('detectedUncertain', name) : t('detected', name));
  }
  if (r.truncated) m.push(t('truncated', r.text.length));
  setMeta(m);
}

function showError(e: TError) {
  reveal(result, '');
  btnCopy.disabled = true;
  showStatus(t(`err_${e.code}` as MsgKey), { error: true, retry: isRetryable(e.code) });
  if (e.code === 'unknown_language' || e.code === 'unsupported_pair') source.focus();
  if (e.code === 'no_key' || e.code === 'api_missing' || e.code === 'no_permission')
    status.append(linkButton(t('settings'), () => chrome.runtime.openOptionsPage()));
}

async function run(fixedTarget = false) {
  clearTimeout(debounce);
  cancelCurrent?.();
  const my = ++gen;
  const text = input.value;
  if (!text.trim()) {
    last = null;
    reveal(result, '');
    btnCopy.disabled = true;
    setMeta([]);
    showStatus(t('emptyHint'));
    if (settings.engine !== 'local') status.append(Object.assign(document.createElement('div'), { textContent: t('cloudNotice', ENGINE_NAMES[settings.engine]) }));
    void hotkeyHint();
    setBusy(false);
    return;
  }
  setBusy(true);
  showStatus(t('translating'), { dots: true });
  const req = { text, source: source.value, target: target.value, mode: 'text' as const, fixedTarget };
  const onProgress = (loaded: number) => my === gen && showStatus(t('downloading', Math.round(loaded * 100)), { progress: loaded });
  try {
    const p = request({ type: 'translate', req }, onProgress);
    cancelCurrent = p.cancel;
    const r = ((await p.promise) as { result: TranslateResult }).result;
    if (my === gen) render(r);
  } catch (e) {
    const te = toTError(e);
    if (my === gen && te.code !== 'cancelled') showError(te);
  } finally {
    if (my === gen) {
      setBusy(false);
      cancelCurrent = null;
    }
  }
}

async function saveDraft() {
  if (settings.keepDraft) await chrome.storage.session.set({ draft: input.value });
  else await chrome.storage.session.remove('draft');
}

async function setTarget(lang: string) {
  settings = await rememberLang(lang, { target: lang });
  fillLangs();
  void run(true);
}

async function hotkeyHint() {
  if (input.value.trim()) return;
  const cmd = (await chrome.commands.getAll()).find((c) => c.name === 'translate-selection');
  const hint = document.createElement('div');
  hint.textContent = t('shortcutHint', cmd?.shortcut || t('shortcutNotSet'));
  if (!input.value.trim() && status.childElementCount < 2) status.append(hint);
}

async function init() {
  settings = await getSettings();
  await initUi(settings);
  applyTheme(settings);
  applyI18n();
  if (isWindow) document.body.classList.add('window');
  enter([...document.querySelectorAll('.app > *')]);
  setTimeout(() => document.documentElement.classList.add('ready'), 60); // first colours instantly, later ones glide
  fillLangs();
  $('engine').textContent = engineLabel();

  const { handoff, draft } = (await chrome.storage.session.get(['handoff', 'draft'])) as { handoff?: { text?: string; notice?: string | null }; draft?: unknown };
  if (isWindow && handoff) {
    await chrome.storage.session.remove('handoff');
    input.value = handoff.text ?? '';
    if (handoff.notice) {
      notice = t('restrictedHere');
      setMeta([]);
    }
  } else if (typeof draft === 'string') input.value = draft;

  input.addEventListener('input', () => {
    void saveDraft();
    clearTimeout(debounce);
    debounce = setTimeout(run, DEBOUNCE_MS);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void run();
    }
  });
  btnTranslate.onclick = () => (cancelCurrent ? (cancelCurrent(), setBusy(false), showStatus(t('err_cancelled'))) : run());
  $('clear').onclick = () => {
    input.value = '';
    void saveDraft();
    void run();
    input.focus();
  };
  btnCopy.onclick = async () => {
    if (!last?.text) return;
    await navigator.clipboard.writeText(last.text);
    pop(btnCopy);
    btnCopy.textContent = t('copied');
    btnCopy.classList.add('copied');
    setTimeout(() => {
      btnCopy.textContent = t('copyShort');
      btnCopy.classList.remove('copied');
    }, 1500);
  };
  source.onchange = async () => {
    if (source.value !== 'auto') {
      settings = await rememberLang(source.value);
      fillLangs();
    }
    paint();
    void run();
  };
  target.onchange = () => setTarget(target.value);
  $('swap').onclick = () => {
    const from = source.value === 'auto' ? last?.source : source.value;
    if (!from) return;
    spin($('swap').firstElementChild!);
    const to = target.value;
    if (source.value !== 'auto') source.value = to; // auto stays auto: detection + retarget handle both directions
    void rememberLang(to).then(() => setTarget(from));
  };
  $('settings').onclick = () => chrome.runtime.openOptionsPage();
  $('engine').onclick = () => chrome.runtime.openOptionsPage();
  const openWin = $('openWindow');
  if (isWindow) openWin.hidden = true;
  openWin.onclick = async () => {
    await chrome.runtime.sendMessage({ type: 'open_window', text: input.value });
    window.close();
  };
  input.focus();
  void run();
}

window.addEventListener('pagehide', () => cancelCurrent?.()); // closing the popup cancels in-flight work
void init();
