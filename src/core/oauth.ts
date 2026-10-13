// OAuth (Authorization Code + PKCE S256) — only for providers whose official flow accepts the extension
// redirect (OpenAI allows only a 127.0.0.1 callback; Anthropic only API keys). V1 candidate: OpenRouter, which returns a user-controlled API key.
import { TError } from './errors';

export function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  return { verifier, challenge };
}

/** Validate the redirect: exactly our callback URL (which embeds `state` in its path), a code, no error. */
export function parseRedirect(responseUrl: string | undefined, callback: string): string {
  if (!responseUrl) throw new TError('cancelled');
  const u = new URL(responseUrl);
  if (`${u.origin}${u.pathname}` !== callback) throw new TError('auth', 'state mismatch');
  if (u.searchParams.get('error')) throw new TError('auth', u.searchParams.get('error')!.slice(0, 80));
  const code = u.searchParams.get('code');
  if (!code) throw new TError('auth', 'no code');
  return code;
}

export const OAUTH_PROVIDERS = {
  openrouter: {
    authUrl: 'https://openrouter.ai/auth',
    tokenUrl: 'https://openrouter.ai/api/v1/auth/keys',
  },
} as const;

/** Runs in an extension page (user click). Requires the optional `identity` permission, requested by the caller. */
export async function signInOpenRouter(): Promise<string> {
  const { verifier, challenge } = await pkce();
  const state = base64url(crypto.getRandomValues(new Uint8Array(16)));
  // OpenRouter has no `state` parameter, so state is carried in the callback path and checked on return.
  const callback = chrome.identity.getRedirectURL(`openrouter/${state}`);
  const url = `${OAUTH_PROVIDERS.openrouter.authUrl}?callback_url=${encodeURIComponent(callback)}&code_challenge=${challenge}&code_challenge_method=S256`;
  let responseUrl: string | undefined;
  try {
    responseUrl = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
  } catch (e) {
    throw new TError(/cancel|closed|did not approve/i.test(String((e as Error).message)) ? 'cancelled' : 'auth', String((e as Error).message).slice(0, 120));
  }
  const code = parseRedirect(responseUrl, callback);
  const res = await fetch(OAUTH_PROVIDERS.openrouter.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
    credentials: 'omit',
  });
  if (!res.ok) throw new TError('auth', `exchange ${res.status}`);
  const { key } = (await res.json()) as { key?: string };
  if (!key) throw new TError('bad_response', 'no key');
  return key;
}
