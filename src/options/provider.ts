// UC-05 provider panel: BYOK key, optional OAuth (where officially possible), model choice, test, disconnect.
import { generate, PROVIDERS, systemPrompt, type ModelOption } from '../core/cloud';
import { TError, toTError } from '../core/errors';
import { t, type MsgKey } from '../core/i18n';
import { signInOpenRouter } from '../core/oauth';
import { clearSecret, getSecret, maskKey, setSecret } from '../core/secrets';
import { setSettings, type CloudId, type Settings } from '../core/settings';
import { el } from '../content/dom';

const OAUTH_NOTE: Record<CloudId, MsgKey> = {
  openai: 'pvOauthOpenAI',
  anthropic: 'pvOauthClaude',
  deepseek: 'pvOauthDeepSeek',
  openrouter: 'pvOauthOpenRouterNote',
};

const errText = (e: unknown) => {
  const te = e instanceof TError ? e : toTError(e);
  return t(`err_${te.code}` as MsgKey);
};

/** Cheap/fast models first when nothing is chosen yet; no hardcoded model names (spec §5). */
function suggest(models: ModelOption[]): string | undefined {
  return (models.find((m) => /mini|nano|flash|haiku|lite|small/i.test(m.id) && !/preview|audio|image/i.test(m.id)) ?? models[0])?.id;
}

export async function renderProvider(box: HTMLElement, settings: Settings): Promise<void> {
  box.replaceChildren();
  delete box.dataset.engine;
  box.hidden = settings.engine === 'local';
  if (settings.engine === 'local') return void (box.dataset.engine = 'local');
  const id = settings.engine;
  const p = PROVIDERS[id];
  const cred = await getSecret(id);
  const status = el('div', { class: 'state', role: 'status', 'aria-live': 'polite' });
  const setStatus = (text: string, kind: '' | 'ok' | 'err' = '') => {
    status.className = 'state' + (kind ? ' ' + kind : '');
    status.textContent = text;
  };

  box.append(el('p', { class: 'notice', text: t('pvNotice', p.name) }));

  // Ask for host access in the click handler itself (needs the user gesture); returns false if refused.
  const askHost = () => chrome.permissions.request({ origins: [p.origin] });

  async function connected(key: string, kind: 'api_key' | 'oauth') {
    setStatus(t('pvChecking'));
    const info = await p.validate(key);
    await setSecret(id, key, kind);
    settings = await setSettings({ cloudAck: { ...settings.cloudAck, [id]: true } });
    await renderProvider(box, settings);
    if (info) box.querySelector('[role=status]')!.textContent = t('pvUsage', info.limit === null ? t('pvUnlimited') : `$${info.limit}`, `$${info.usage.toFixed(4)}`);
  }

  if (!cred) {
    const input = el('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', id: 'apiKey', 'aria-label': t('pvApiKey'), placeholder: 'sk-…' });
    const save = el('button', { type: 'button', class: 'btn primary', text: t('pvSave') });
    save.onclick = async () => {
      const key = input.value.trim();
      if (!key) return input.focus();
      if (!(await askHost())) return setStatus(t('pvPermDenied', new URL(p.origin.replace('/*', '')).host), 'err');
      try {
        await connected(key, 'api_key');
        input.value = '';
      } catch (e) {
        setStatus(errText(e), 'err');
      }
    };
    box.append(
      el('label', { class: 'field' }, el('span', { text: t('pvApiKey') }), el('span', { class: 'inline' }, input, save)),
      el('a', { class: 'link', href: p.consoleUrl, target: '_blank', rel: 'noopener', text: t('pvGetKey') + ' ↗' }),
    );
  } else {
    box.append(
      el(
        'div',
        { class: 'inline' },
        el('span', { class: 'state ok', text: t(cred.kind === 'oauth' ? 'pvConnectedOauth' : 'pvConnected', maskKey(cred.key)) }),
        el('button', {
          type: 'button',
          class: 'btn',
          text: t('pvDisconnect'),
          onclick: async () => {
            await clearSecret(id);
            const models = { ...settings.models };
            delete models[id];
            settings = await setSettings({ models, cloudAck: { ...settings.cloudAck, [id]: false } });
            await renderProvider(box, settings);
            setStatusIn(box, t('pvDisconnected'));
          },
        }),
      ),
      el('p', { class: 'muted', text: t('pvAuthorized') }),
    );
  }

  // OAuth: an active button only where an official flow exists and works (OpenRouter PKCE; the others are shown disabled with the reason).
  const oauth = el('div', { class: 'field' }, el('span', { text: t('pvOauthTitle') }));
  if (id === 'openrouter' && !cred) {
    const b = el('button', { type: 'button', class: 'btn', text: t('pvOauthOpenRouter') });
    b.onclick = async () => {
      if (!(await chrome.permissions.request({ permissions: ['identity'], origins: [p.origin] }))) return setStatus(t('pvPermDenied', 'openrouter.ai'), 'err');
      try {
        await connected(await signInOpenRouter(), 'oauth');
      } catch (e) {
        setStatus(errText(e), 'err');
      }
    };
    oauth.append(b, el('small', { class: 'muted', text: t(OAUTH_NOTE[id]) }));
  } else if (id !== 'openrouter') {
    oauth.append(el('div', { class: 'disabled-opt', text: t(OAUTH_NOTE[id]) }));
  }
  if (oauth.childElementCount > 1) box.append(oauth);

  box.append(el('p', { class: 'muted small', text: t('pvKeyStorage') }), status);
  if (cred) await modelSection(box, settings, id, cred.key, setStatus, status);
  box.dataset.engine = id; // rendered (used by E2E to avoid races)
}

function setStatusIn(box: HTMLElement, text: string) {
  const s = box.querySelector('[role=status]');
  if (s) s.textContent = text;
}

async function modelSection(box: HTMLElement, settings: Settings, id: CloudId, key: string, setStatus: (s: string, k?: '' | 'ok' | 'err') => void, before: Element) {
  const p = PROVIDERS[id];
  const select = el('select', { id: 'model', 'aria-label': t('pvModel') });
  const price = el('small', { class: 'muted' });
  const custom = el('input', { type: 'text', id: 'customModel', spellcheck: 'false', placeholder: t('pvCustomModel'), 'aria-label': t('pvCustomModel') });
  let models: ModelOption[] = [];

  const showPrice = () => {
    const m = models.find((x) => x.id === select.value);
    price.textContent = m?.price ? t('pvPrice', m.price.input.toFixed(2), m.price.output.toFixed(2)) : '';
  };
  const choose = async (model: string) => {
    settings = await setSettings({ models: { ...settings.models, [id]: model } });
    showPrice();
  };
  const load = async () => {
    setStatus(t('pvChecking'));
    try {
      models = await p.listModels(key);
      const current = settings.models[id];
      select.replaceChildren(new Option(t('pvChooseModel'), ''), ...models.map((m) => new Option(m.label, m.id)));
      if (current && !models.some((m) => m.id === current)) select.add(new Option(current, current)); // custom ID
      const pick = current ?? suggest(models);
      if (pick) {
        select.value = pick;
        if (!current) await choose(pick);
      }
      showPrice();
      setStatus(t('pvModelsLoaded', models.length), 'ok');
    } catch (e) {
      setStatus(errText(e), 'err');
    }
  };
  select.onchange = () => select.value && void choose(select.value);

  const test = el('button', { type: 'button', class: 'btn', text: t('pvTest') });
  test.onclick = async () => {
    const model = settings.models[id];
    if (!model) return setStatus(t('pvChooseModel'), 'err');
    setStatus(t('pvChecking'));
    try {
      const out = await generate(p, key, model, systemPrompt(settings.target, { source: 'en', kind: 'phrase' }), 'Hello, world!', 1_024);
      setStatus(t('pvTestOk', out.trim().slice(0, 120)), 'ok');
    } catch (e) {
      setStatus(errText(e), 'err');
    }
  };

  before.before(
    el('label', { class: 'field' }, el('span', { text: t('pvModel') }), el('span', { class: 'inline' }, select, el('button', { type: 'button', class: 'btn', text: t('pvRefresh'), onclick: () => void load() })), price),
    el(
      'div',
      { class: 'inline' },
      custom,
      el('button', {
        type: 'button',
        class: 'btn',
        text: t('pvUseCustom'),
        onclick: async () => {
          const v = custom.value.trim();
          if (!/^[\w.:/@-]{1,120}$/.test(v)) return custom.focus();
          if (![...select.options].some((o) => o.value === v)) select.add(new Option(v, v));
          select.value = v;
          await choose(v);
          custom.value = '';
        },
      }),
    ),
    el('div', { class: 'inline' }, test, el('small', { class: 'muted', text: t('pvTestNote') })),
  );
  await load();
}
