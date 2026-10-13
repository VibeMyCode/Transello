// Credentials: chrome.storage.local only (TRUSTED_CONTEXTS, set by the SW), never sync, never logged (spec §6).
// Not a keychain: keys on the device remain extractable by someone with access to the profile — the UI says so.
import type { CloudId } from './settings';

export interface Credential {
  kind: 'api_key' | 'oauth';
  key: string;
  savedAt: number;
}

const k = (id: CloudId) => `secret.${id}`;

export async function getSecret(id: CloudId): Promise<Credential | null> {
  const v = (await chrome.storage.local.get(k(id)))[k(id)] as Credential | undefined;
  return v && typeof v.key === 'string' && v.key ? v : null;
}

export async function setSecret(id: CloudId, key: string, kind: Credential['kind'] = 'api_key'): Promise<void> {
  await chrome.storage.local.set({ [k(id)]: { kind, key: key.trim(), savedAt: Date.now() } satisfies Credential });
}

export async function clearSecret(id: CloudId): Promise<void> {
  await chrome.storage.local.remove(k(id));
}

/** "sk-proj-…a1b2" — enough to recognise a key, useless to steal it. */
export function maskKey(key: string): string {
  const s = key.trim();
  return s.length <= 8 ? '••••' : `${s.slice(0, Math.min(7, s.length - 4))}…${s.slice(-4)}`;
}
