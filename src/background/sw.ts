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
      const ctx = { settings, signal: ctl.signal, onProgress: (loaded: number) => post({ type: 'progress', loaded }), cloud: cloudTranslate };
      // Text was already in the target language: the language we switched to becomes the new default.
      const adopt = async (l?: string) => void (l && l !== settings.target && (await rememberLang(l, { target: l })));
      if (m.type === 'translate') {
        const result = await translate(m.req, ctx);
        await adopt(result.retarget);
        post({ type: 'result', result });
      } else {
        const r = await translateBatch(m.segments, m.source, m.target, { ...ctx, consent: m.consent, cloudBatch });
        await adopt(r.retarget);
        post({ type: 'batch_result', ...r });
      }
    } catch (e) {
      const te = toTError(e);
      if (te.code !== 'cancelled') console.warn('[transello]', te.code, te.detail ?? ''); // codes only, never text/keys
      post({ type: 'error', code: isErrorCode(te.code) ? te.code : 'internal', detail: te.detail });
    }
  });
});

// ---------- one-shot messages (extension pages and our content scripts) ----------
chrome.runtime.onMessage.addListener((raw, sender, send) => {
  const m = parseRuntimeMessage(raw);
  if (!m || !isTrustedSender(sender)) return;
  if (m.type === 'open_window') void openWindow(m.text).then(() => send(true));
  else if (m.type === 'ui_strings') void loadMessages(m.lang).then(send); // for content scripts (no package fetch)
  else void chrome.runtime.openOptionsPage().then(() => send(true));
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
  if (command !== 'translate-selection') return;
  const t = tab ?? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (!t?.id) return;
  if (await inject(t.id, 0)) await send(t.id, 0, { type: 'show_mini' });
  else await openWindow('', 'restricted_page');
}

chrome.contextMenus.onClicked.addListener((info, tab) => void onMenuClick(info, tab));
chrome.commands.onCommand.addListener((command, tab) => void onCommand(command, tab));

// E2E builds only (dist-e2e): native menus/shortcuts can't be driven by automation, so tests call the same
// handlers. Release builds define __E2E__=false and this block is removed (package audit checks it).
declare const __E2E__: boolean;
if (__E2E__) Object.assign(self, { __transelloTest: { onMenuClick, onCommand } });
