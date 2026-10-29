# Changelog

## 1.1.1
- Store name now says what it is: "Transello - Private AI Translator" (localized in all 12 languages), so it can be found by searching for a translator.
- Settings → About: "★ Rate Transello" opens the Chrome Web Store reviews page.
- OpenRouter requests include the site address next to the app name, so Transello can appear in OpenRouter's public app rankings.

## 1.1.0 - unreleased
- Settings: privacy facts gathered in Privacy, one key line in the provider panel, "Model (N available)", both shortcuts listed, clearer wording. The popup header keeps its size with long cloud model names (shortened with an ellipsis).
- Cloud provider settings state plainly where your key and text go (stored only on this device, sent only to that provider, no Transello server), with a link to the exact source file that makes the requests. Settings → About links to the source code.
- Page language is detected once per page from its longest texts, and the page's own lang attribute decides when the detector is unsure (user report: an English site's menu words "looked Swedish" and Transello offered a Swedish model).
- Follow-up translation also works on single-page sites that change the address without reloading (Next.js and similar).
- Follow-up pages: after a page is translated with the built-in translator, the next pages you open on the same site in that tab are translated automatically. A page already in your language is left alone. "Show original", another site or closing the tab stops it. No new permissions.
- New shortcut to translate the whole page: Ctrl+. (Mac: Control+.). Press it again to show the original. Works with cloud providers too (they are never automatic, since each page costs money).
- The selection shortcut is now Ctrl+Q (Mac: Control+Q). Both shortcuts can be changed at chrome://extensions/shortcuts.

## 1.0.0 - unreleased
- After Chrome's translator fails to start once, Transello remembers it for this Chrome version (one day) and shows the explanation at once instead of offering ~80 MB downloads that cannot work (Windows on ARM: the TranslateKit engine component stays 0.0.0.0).
- When Chrome's translator will not start although the model is installed (seen on Chrome, Windows 11 ARM: NotSupportedError after download), the message says exactly that, shows Chrome's reason, and points to chrome://components, disk space or a cloud provider. Settings → About runs a one-word self-test of the installed en→ru pair.
- Page translation also translates static text inside forms (headings, labels, button text); field values and editable areas are never touched (user report: brave.com card waitlist stayed English because its hero is a form).
- Page translations are kept in memory until the page is closed: "Translate again" re-applies them instantly, with no second cloud call. Cloud pages send up to 3 batches at once. If nothing could be applied, the toolbar says so instead of offering "Show original".
- A pair the browser does not offer (seen: English → Russian on Chrome, Windows 11 ARM) now fails clearly with the pair named, instead of offering a download that cannot work.
- Design "Aura": every language has its own colour; the popup glows in the colours of the current pair and they glide when it changes. Glass cards, a border beam while translating, translations "decode" from the source script into the target one, spring entrances for the modal and mini popup (Motion, MIT, bundled). Everything is off with reduced motion; the real text is in the DOM from the first frame.
- UC-01: toolbar popup with auto-detect, local Chrome translation, download progress, copy, draft, standalone window.
- Local engine runs in the extension service worker (ADR-001) with stall guard, bounded cache and recovery from invalidated models.
- UC-02: context menu "Translate in Transello" → Shadow-DOM modal (focus trap, Esc, backdrop, CSP-safe styles, iframes, fallback window on restricted pages, honest length limit).
- UC-03: shortcut (Alt+Shift+Y / ⌃⇧Y) → mini popover under the selection; toggle, update, scroll-follow, viewport clamp, no-selection hint, never reads password fields.
- UC-04: "Translate page with Transello" - TreeWalker text nodes (skips code/pre/forms/editable/hidden/translate=no), viewport-first batches, progress + cancel, exact restore, SPA-safe, 2000-node cap reported honestly.
- Cloud BYOK: OpenAI (Responses API), Claude (Messages API), DeepSeek, OpenRouter; model lists, custom model ID, free key validation, test request, masked keys, disconnect, bounded retries, consent before full-page cloud sends (40k chars cap, sensitive sites always ask).
- OAuth: OpenRouter PKCE sign-in; ChatGPT/Claude sign-in shown as unavailable with the reason.
- UAT fixes: language detection works in Brave (no LanguageDetector model there): CLD fallback with a writing-system check, then a script heuristic; fixed-size popup; diagnostics in Settings → About.
- Cloud: empty model answers (reasoning models) are retried with a larger token budget, then reported clearly instead of showing a blank translation.
- Recently used languages are listed first in every language menu.
- Cloud prompt: short translator-only instruction with source language and text kind (word/phrase/text/page), aiming for natural native-speaker phrasing (user suggestion).
- Text already in the target language (auto-detect) is translated into the most recent other language, else the browser language, and that becomes the new target, so en→ru then ru→en then en→ru just works (user request). A target the user has just picked is never switched: they get the honest "already in …" message instead.
- Fix (user report: Windows 11 + Brave): local translation no longer requires `LanguageDetector`, which Brave on Windows lacks; detection falls back to Chrome's CLD. If the browser has no Translator at all, the message says so plainly and points to cloud providers.
- When text is already in the target language and there is no other recent or browser language to switch to, Transello asks ("Choose language") instead of guessing.
- Licenses: a proper UTF-8 page with the full MIT text (the old `.txt` rendered as mojibake on Windows). User-facing texts use "-" instead of the long dash.
- Brave with built-in AI turned off (Windows 11): one clear message ("Built-in translation is turned off in this browser…") with a Settings action, instead of the modal → window → error loop.
- Store description: "Speak fluent internet…" (12 locales).
- Interface in 12 languages (en, ru, zh_CN, hi, es, fr, ar, bn, pt_BR, ja, de, id): browser language by default, switchable in Settings without reload; Arabic is laid out right-to-left; user text uses `dir=auto`. The non-en/ru strings are machine-assisted and should get a native-speaker review (especially privacy and payment wording).
