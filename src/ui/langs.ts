// Language <select> with recently used languages first, then all languages alphabetically (user request).
import { t } from '../core/i18n';
import { LANGS, langName } from '../core/lang';
import type { Settings } from '../core/settings';

export function fillLangSelect(sel: HTMLSelectElement, ui: string, s: Settings, value: string, withAuto = false): void {
  sel.replaceChildren();
  if (withAuto) sel.add(new Option(t('autoDetect'), 'auto'));
  const recent = (s.recentLangs.length ? s.recentLangs : [s.target]).filter((l) => (LANGS as readonly string[]).includes(l));
  const group = (label: string, langs: readonly string[]) => {
    const g = document.createElement('optgroup');
    g.label = label;
    for (const l of langs) g.append(new Option(langName(l, ui), l));
    sel.append(g);
  };
  if (recent.length) group(t('recentLangs'), recent);
  group(t('allLangs'), [...LANGS].sort((a, b) => langName(a, ui).localeCompare(langName(b, ui), ui)));
  sel.value = value;
}
