// MV3 service worker: event routing (menus, commands), translation port, window fallback.
// Holds no long-lived state except in-memory model caches (ADR-001); everything is re-creatable.
import { isErrorCode, TError, toTError } from '../core/errors';
import { loadMessages, t } from '../core/i18n';
import { localApiPresent } from '../core/local';
import { isTrustedSender, parsePortRequest, parseRuntimeMessage, PORT_TRANSLATE, type PortReply, type TabCommand } from '../core/messages';
import { getSettings, initUi, onSettingsChanged, rememberLang, setSettings, type Settings } from '../core/settings';
import { translate } from '../core/translate';
import { translateBatch } from '../core/batch';
import { cloudBatch, cloudTranslate } from '../core/cloud';

// Secrets in storage.local must not be readable by content scripts (spec §6).
void chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {});

const MENU_SELECTION = 'translate-selection';
const MENU_PAGE = 'translate-page';

async function setupMenus(s?: Settings) {
  await initUi(s ?? (await getSettings()));
  await chrome.contextMenus.removeAll(); // idempotent: no duplicates on update/reinstall
  chrome.contextMenus.create({ id: MENU_SELECTION, title: t('menuTranslateSelection'), contexts: ['selection'] });
  chrome.contextMenus.create({ id: MENU_PAGE, title: t('menuTranslatePage'), contexts: ['page'] });
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  // Persist first-run defaults (target from Chrome/OS language, else ru) so they don't drift later.
  const s = reason === 'install' ? await setSettings({}) : await getSettings();
  await setupMenus(s);
});
chrome.runtime.onStartup.addListener(() => void setupMenus());
onSettingsChanged((s) => void setupMenus(s));

// ---------- translation port ----------
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_TRANSLATE || !port.sender || !isTrustedSender(port.sender)) return port.disconnect();
  const ctl = new AbortController();
  let open = true;
  port.onDisconnect.addListener(() => {
    open = false;
    ctl.abort();
  });
  const post = (m: PortReply) => {
    if (open) port.postMessage(m);
  };
  port.onMessage.addListener(async (raw) => {
    const m = parsePortRequest(raw);
    if (!m) return post({ type: 'error', code: 'internal', detail: 'bad request' });
    try {
      const settings = await getSettings();
      // No Translator in the SW means none in this browser at all (live: Brave on Windows has it off everywhere; ADR-001 amendment).
      if (settings.engine === 'local' && !localApiPresent()) throw new TError('api_missing');
      if (settings.engine === 'local') {
        const broken = await localBroken();
        if (broken !== null) throw new TError('local_failed', broken);
      }
      const ctx = { settings, signal: ctl.signal, onProgress: (loaded: number) => post({ type: 'progress', loaded }), cloud: cloudTranslate };
      // Text was already in the target language: the language we switched to becomes the new default.
      const adopt = async (l?: string) => void (l && l !== settings.target && (await rememberLang(l, { target: l })));
      if (m.type === 'translate') {
        const result = await translate(m.req, ctx);
        if (!result.needsDownload) await adopt(result.retarget); // not before the user agrees to the download
        post({ type: 'result', result });
      } else {
        const r = await translateBatch(m.segments, m.source, m.target, { ...ctx, consent: m.consent, allowDownload: m.allowDownload, auto: m.auto, cloudBatch });
        await adopt(r.retarget);
        post({ type: 'batch_result', ...r });
      }
    } catch (e) {
      const te = toTError(e);
      if (te.code === 'local_failed') void chrome.storage.local.set({ [BROKEN_KEY]: { chrome: CHROME_VERSION, at: Date.now(), detail: te.detail ?? '' } });
      if (te.code !== 'cancelled') console.warn('[transello]', te.code, te.detail ?? ''); // codes only, never text/keys
      post({ type: 'error', code: isErrorCode(te.code) ? te.code : 'internal', detail: te.detail });
    }
  });
});

// Chrome's translator would not start on this device although models install (Windows on ARM: the TranslateKit engine
// component stays 0.0.0.0). Remember it per Chrome version for a day, so nobody is offered 80 MB downloads that cannot work.
const BROKEN_KEY = 'localBroken';
const CHROME_VERSION = /Chrome\/([\d.]+)/.exec(navigator.userAgent)?.[1] ?? '';
async function localBroken(): Promise<string | null> {
  const { localBroken: b } = (await chrome.storage.local.get(BROKEN_KEY)) as { localBroken?: { chrome: string; at: number; detail: string } };
  return b && b.chrome === CHROME_VERSION && Date.now() - b.at < 86_400_000 ? b.detail : null;
}

// ---------- one-shot messages (extension pages and our content scripts) ----------
chrome.runtime.onMessage.addListener((raw, sender, send) => {
  const m = parseRuntimeMessage(raw);
  if (!m || !isTrustedSender(sender)) return;
  if (m.type === 'open_window') void openWindow(m.text).then(() => send(true));
  else if (m.type === 'ui_strings') void loadMessages(m.lang).then(send); // for content scripts (no package fetch)
  else if (m.type === 'page_auto') void setAutoPage(sender, m.on).then(() => send(true));
  else if (m.type === 'open_options') void chrome.runtime.openOptionsPage().then(() => send(true));
  return true;
});

/** Option D (ADR-001): our own small window, prefilled via storage.session (not the URL). */
export async function openWindow(text?: string, notice?: 'restricted_page') {
  await chrome.storage.session.set({ handoff: { text: text ?? '', notice: notice ?? null } });
  await chrome.windows.create({ url: chrome.runtime.getURL('popup.html?window=1'), type: 'popup', width: 460, height: 640, focused: true });
}

// ---------- context menus & command ----------
async function inject(tabId: number, frameId?: number): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId ?? 0] }, files: ['content.js'] });
    return true;
  } catch {
    return false; // chrome://, Web Store, PDF viewer, other restricted pages
  }
}

async function send(tabId: number, frameId: number, cmd: TabCommand) {
  await chrome.tabs.sendMessage(tabId, cmd, { frameId });
}

async function onMenuClick(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) {
  const text = info.selectionText ?? '';
  if (!tab?.id || tab.id < 0) return openWindow(text);
  const frameId = info.frameId ?? 0;
  if (info.menuItemId === MENU_SELECTION) {
    if (await inject(tab.id, frameId)) await send(tab.id, frameId, { type: 'show_modal', text });
    else await openWindow(text, 'restricted_page');
  } else if (info.menuItemId === MENU_PAGE) {
    if (await inject(tab.id, 0)) await send(tab.id, 0, { type: 'translate_page' });
    else await openWindow('', 'restricted_page');
  }
}

async function onCommand(command: string, tab?: chrome.tabs.Tab) {
  if (command !== 'translate-selection' && command !== 'translate-page') return;
  const t = tab ?? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (!t?.id) return;
  // translate-page: the whole page (any engine); pressing it again shows the original.
  if (await inject(t.id, 0)) await send(t.id, 0, command === 'translate-page' ? { type: 'translate_page' } : { type: 'show_mini' });
  else await openWindow('', 'restricted_page');
}

// ---------- follow-up pages: keep translating this tab on the same site ----------
// After a successful local page translation the tab is remembered with its origin. Its next page loads on that origin
// are translated automatically; "Show original", another site or closing the tab ends it. No extra permissions:
// activeTab lasts across same-origin navigations and ends on another origin, which is exactly the scope.
// Cloud engines are never automatic (each page costs money): there the page shortcut does it on request.
const AUTO_KEY = 'autoPages';
type AutoPages = Record<string, string>; // tabId → origin
const autoPages = async () => ((await chrome.storage.session.get(AUTO_KEY))[AUTO_KEY] ?? {}) as AutoPages;
async function setAutoPage(sender: chrome.runtime.MessageSender, on: boolean) {
  const id = sender.tab?.id;
  if (id === undefined || !sender.url) return;
  const pages = await autoPages();
  if (on && (await getSettings()).engine === 'local') pages[id] = new URL(sender.url).origin;
  else delete pages[id];
  await chrome.storage.session.set({ [AUTO_KEY]: pages });
}
async function dropAutoPage(tabId: number) {
  const pages = await autoPages();
  if (!(tabId in pages)) return;
  delete pages[tabId];
  await chrome.storage.session.set({ [AUTO_KEY]: pages });
}
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== 'complete') return;
  void (async () => {
    const origin = (await autoPages())[tabId];
    if (!origin) return;
    const url = tab.url ? new URL(tab.url).origin : null; // readable only while we still have access to this tab
    if (url !== origin || (await getSettings()).engine !== 'local' || !(await inject(tabId, 0))) return dropAutoPage(tabId);
    await send(tabId, 0, { type: 'translate_page', auto: true }).catch(() => dropAutoPage(tabId));
  })();
});
chrome.tabs.onRemoved.addListener((tabId) => void dropAutoPage(tabId));

chrome.contextMenus.onClicked.addListener((info, tab) => void onMenuClick(info, tab));
chrome.commands.onCommand.addListener((command, tab) => void onCommand(command, tab));

// E2E builds only (dist-e2e): native menus/shortcuts can't be driven by automation, so tests call the same
// handlers. Release builds define __E2E__=false and this block is removed (package audit checks it).
declare const __E2E__: boolean;
if (__E2E__) Object.assign(self, { __transelloTest: { onMenuClick, onCommand } });
