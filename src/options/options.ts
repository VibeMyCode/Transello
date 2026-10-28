// UC-05 Settings: general, engine/provider, privacy, about.
import { LINKS } from '../core/config';
import { applyI18n, t, UI_LANGS, uiLocale } from '../core/i18n';
import { fillLangSelect } from '../ui/langs';
import { setPair } from '../ui/fx';
import { applyTheme, ENGINE_NAMES, getSettings, onSettingsChanged, initUi, rememberLang, setSettings, type EngineId, type Settings } from '../core/settings';
import { renderProvider } from './provider';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let settings: Settings;

const ENGINES: EngineId[] = ['local', 'openrouter', 'openai', 'anthropic', 'deepseek'];

function renderEngines() {
  const box = $('engines');
  box.replaceChildren();
  for (const id of ENGINES) {
    const label = document.createElement('label');
    label.className = 'engine';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'engine';
    radio.value = id;
    radio.checked = settings.engine === id;
    radio.onchange = () => void select(id);
    const b = document.createElement('b');
    b.textContent = id === 'local' ? t('engineLocal') : ENGINE_NAMES[id];
    const small = document.createElement('small');
    small.textContent = id === 'local' ? 'Chrome' : 'API';
    label.append(radio, b, small);
    box.append(label);
  }
  void renderProvider($('provider'), settings);
}

async function select(id: EngineId) {
  settings = await setSettings({ engine: id });
  renderEngines();
}

async function renderAll() {
  await initUi(settings);
  applyTheme(settings);
  applyI18n();
  const ui = uiLocale();
  const uiSel = $<HTMLSelectElement>('uiLang');
  uiSel.replaceChildren(
    new Option(t('optUiLangAuto'), 'auto'),
    ...UI_LANGS.map((l) => {
      const code = l.replace('_', '-');
      return new Option(new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? l, l); // native name
    }),
  );
  const target = $<HTMLSelectElement>('target');
  fillLangSelect(target, ui, settings, settings.target);
  setPair(document.documentElement, settings.uiLang === 'auto' ? uiLocale() : settings.uiLang, settings.target); // interface language → target
  $<HTMLSelectElement>('uiLang').value = settings.uiLang;
  $<HTMLSelectElement>('theme').value = settings.theme;
  $<HTMLInputElement>('keepDraft').checked = settings.keepDraft;
  $('version').textContent = t('optVersion', chrome.runtime.getManifest().version);
  for (const [id, url] of [['codeLink', LINKS.repo], ['sourceLink', LINKS.feedback], ['privacyLink', uiLocale().startsWith('ru') ? LINKS.privacyRu : LINKS.privacy], ['supportLink', LINKS.support]] as const) {
    const a = $<HTMLAnchorElement>(id);
    a.hidden = !url;
    if (url) a.href = url;
  }
  renderEngines();
}

async function init() {
  settings = await getSettings();
  await renderAll();
  const cmds = await chrome.commands.getAll();
  const keyOf = (name: string) => cmds.find((c) => c.name === name)?.shortcut || t('shortcutNotSet');
  $('shortcut').textContent = keyOf('translate-selection');
  $('shortcutPage').textContent = keyOf('translate-page');
  $<HTMLAnchorElement>('codeTrust').href = LINKS.cloudCode;
  // chrome:// URLs cannot be links; tabs.create is the supported way to open the shortcuts page.
  $('shortcutLink').onclick = () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  $<HTMLSelectElement>('uiLang').onchange = async (e) => {
    settings = await setSettings({ uiLang: (e.target as HTMLSelectElement).value as Settings['uiLang'] });
    await renderAll();
  };
  $<HTMLSelectElement>('theme').onchange = async (e) => {
    settings = await setSettings({ theme: (e.target as HTMLSelectElement).value as Settings['theme'] });
    applyTheme(settings);
  };
  $<HTMLSelectElement>('target').onchange = async (e) => {
    settings = await rememberLang((e.target as HTMLSelectElement).value, { target: (e.target as HTMLSelectElement).value });
    await renderAll();
  };
  $<HTMLInputElement>('keepDraft').onchange = async (e) => {
    settings = await setSettings({ keepDraft: (e.target as HTMLInputElement).checked });
    if (!settings.keepDraft) await chrome.storage.session.remove('draft');
  };
  $('clearData').onclick = async () => {
    await chrome.storage.session.clear();
    const b = $('clearData');
    b.textContent = t('optCleared');
    setTimeout(() => (b.textContent = t('optClear')), 1500);
  };
  onSettingsChanged((s) => {
    settings = s;
  });
}

void init();
