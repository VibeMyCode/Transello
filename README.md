# Transello

**Translate with your favorite AI.** Fast translation of text, selections and whole pages in Chrome. Translation runs locally through Chrome's built-in Translator, or through a cloud AI provider you connect yourself.

- No account, no Transello server, no analytics.
- Local mode never sends your text anywhere. Chrome downloads its own language packs once.
- Cloud mode (OpenAI, Claude, DeepSeek, OpenRouter) is opt-in and uses **your** API key, so the provider bills you directly.

## Use

| What | How |
|---|---|
| Translate pasted text | Click the toolbar icon and paste. The translation appears automatically. |
| Translate a selection in a modal | Select text, right-click, then choose **Translate in Transello**. |
| Translate a selection in a mini popup | Select text and press **Alt+Shift+Y** (macOS: **Ctrl+Shift+Y**). You can change the shortcut at `chrome://extensions/shortcuts`. |
| Translate the whole page | Right-click the page, then choose **Translate page with Transello**. **Show original** restores the page. |

Requirements: desktop Chrome **138+**. Chromium browsers such as **Brave** are supported and tested: Brave lacks Chrome's language-detection model, so Transello uses Chrome's bundled detector there instead. Local translation depends on Chrome having the language pair available; the extension checks this at runtime. Chrome on Android is not supported.

Interface languages (12): English, Русский, 中文 (简体), हिन्दी, Español, Français, العربية (RTL), বাংলা, Português (Brasil), 日本語, Deutsch, Bahasa Indonesia. By default the browser's language is used, and **Settings → Interface language** overrides it without a reload. More languages can be added on request (`public/_locales/<lang>/messages.json`; `npm test` checks keys and placeholders).

## Develop

```bash
npm ci
npm run build          # → dist/ (load unpacked in chrome://extensions)
npm run watch          # rebuild on change
npm run check          # typecheck + lint + unit tests + package audit
npm run test:chrome    # real Chrome E2E (needs branded Chrome; Chrome for Testing has no language packs)
npm run package        # → release/transello-v<version>.zip (+ audit, sha256)
```

npm 10.9 crashes on vitest's peer-dependency set, so `.npmrc` sets `legacy-peer-deps=true`.

## Privacy & support

- Privacy policy: https://vibemycode.github.io/transello-site/privacy.html
- Feedback, bugs and ideas: [GitHub issues](https://github.com/VibeMyCode/transello/issues/new/choose)
- ☕ Support Transello (voluntary): https://vibemycode.github.io/transello-site/support.html

## License

Source-available, all rights reserved: you may read and audit the code, and use the official extension. Copying, modifying or redistributing it needs written permission. See [LICENSE](LICENSE).
