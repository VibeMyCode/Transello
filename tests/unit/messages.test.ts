import { describe, expect, it } from 'vitest';
import { isTrustedSender, LIMITS, parsePortRequest, parseRuntimeMessage } from '../../src/core/messages';

const ok = { type: 'translate', req: { text: 'hi', source: 'auto', target: 'ru', mode: 'text' } };

describe('parsePortRequest', () => {
  it('accepts a valid translate', () => expect(parsePortRequest(ok)).toEqual(ok));
  it.each([
    null, 'x', {}, { type: 'nope' },
    { type: 'translate', req: { ...ok.req, text: 1 } },
    { type: 'translate', req: { ...ok.req, text: 'x'.repeat(LIMITS.text + 1) } },
    { type: 'translate', req: { ...ok.req, target: 'ru"><script>' } },
    { type: 'translate', req: { ...ok.req, mode: 'evil' } },
    { type: 'batch', segments: [], source: 'auto', target: 'ru' },
    { type: 'batch', segments: Array(LIMITS.segments + 1).fill('a'), source: 'auto', target: 'ru' },
    { type: 'batch', segments: [1], source: 'auto', target: 'ru' },
  ])('rejects %#', (m) => expect(parsePortRequest(m)).toBeNull());
  it('drops unknown fields', () => expect(parsePortRequest({ ...ok, apiKey: 'sk-x', req: { ...ok.req, extra: 1 } })).toEqual(ok));
});

describe('parseRuntimeMessage / sender', () => {
  it('open_window truncates text', () => expect(parseRuntimeMessage({ type: 'open_window', text: 'x'.repeat(LIMITS.text + 5) })).toEqual({ type: 'open_window', text: 'x'.repeat(LIMITS.text) }));
  it('rejects unknown', () => expect(parseRuntimeMessage({ type: 'get_key' })).toBeNull());
  it('trusts only own extension', () => {
    expect(isTrustedSender({ id: 'me' }, 'me')).toBe(true);
    expect(isTrustedSender({ id: 'other' }, 'me')).toBe(false);
    expect(isTrustedSender({}, 'me')).toBe(false);
  });
});

import { isSensitiveHost } from '../../src/core/sensitive';
describe('isSensitiveHost', () => {
  it.each([['mail.google.com', true], ['online.sberbank.ru', true], ['www.paypal.com', true], ['bank.example.com', true], ['developer.chrome.com', false], ['en.wikipedia.org', false], ['', false]])(
    '%s → %s',
    (h, v) => expect(isSensitiveHost(h)).toBe(v),
  );
});
