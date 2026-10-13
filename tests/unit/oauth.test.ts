import { describe, expect, it } from 'vitest';
import { base64url, parseRedirect, pkce } from '../../src/core/oauth';

describe('PKCE', () => {
  it('verifier is 43 url-safe chars and challenge = base64url(sha256(verifier))', async () => {
    const { verifier, challenge } = await pkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const expected = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    expect(challenge).toBe(expected);
  });
  it('RFC 7636 test vector', async () => {
    const v = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const c = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v))));
    expect(c).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
  it('fresh values each time', async () => expect((await pkce()).verifier).not.toBe((await pkce()).verifier));
});

describe('parseRedirect', () => {
  const cb = 'https://abc.chromiumapp.org/openrouter/STATE123';
  it('accepts our callback with a code', () => expect(parseRedirect(cb + '?code=xyz', cb)).toBe('xyz'));
  it('rejects state mismatch', () => expect(() => parseRedirect('https://abc.chromiumapp.org/openrouter/OTHER?code=x', cb)).toThrow(/state/));
  it('rejects foreign origin', () => expect(() => parseRedirect('https://evil.example/openrouter/STATE123?code=x', cb)).toThrow());
  it('reports provider error', () => expect(() => parseRedirect(cb + '?error=access_denied', cb)).toThrow(/access_denied/));
  it('missing code', () => expect(() => parseRedirect(cb, cb)).toThrow(/no code/));
  it('cancelled flow', () => expect(() => parseRedirect(undefined, cb)).toThrow(/cancelled/));
});
