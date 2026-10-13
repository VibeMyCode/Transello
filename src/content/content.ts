// Content script entry. Injected on demand (activeTab) by the SW; idempotent across repeated injections.
import type { TabCommand } from '../core/messages';
import { bestSelectionText, showModal, toggleMini } from './overlay';
import { togglePage } from './page';

declare global {
  var __transello: boolean | undefined;
}

if (!globalThis.__transello) {
  globalThis.__transello = true;
  chrome.runtime.onMessage.addListener((m: TabCommand, sender, send) => {
    if (sender.id !== chrome.runtime.id || !m || typeof m !== 'object') return;
    if (m.type === 'show_modal' && typeof m.text === 'string') void showModal(bestSelectionText(m.text));
    else if (m.type === 'show_mini') void toggleMini();
    else if (m.type === 'translate_page') void togglePage();
    else if (m.type === 'ping') send(true);
  });
}
