import { beforeEach, describe, expect, it } from 'vitest';
import { installChrome } from './setup-chrome';
import { getSettings, sanitize, setSettings } from '../../src/core/settings';

describe('settings', () => {
  beforeEach(() => installChrome({ uiLang: 'de-DE' }));
  it('defaults: target from Chrome UI language, local engine', async () => {
    const s = await getSettings();
    expect(s.target).toBe('de');
    expect(s.engine).toBe('local');
  });
  it('sanitizes garbage', () => {
    const s = sanitize({ engine: 'evil', theme: 3, models: { openai: 'gpt', foo: 'x', anthropic: 5 }, cloudAck: { openai: 'yes' } });
    expect(s.engine).toBe('local');
    expect(s.theme).toBe('auto');
    expect(s.models).toEqual({ openai: 'gpt' });
    expect(s.cloudAck).toEqual({});
  });
  it('persists to sync and never stores secrets there', async () => {
    const { areas } = installChrome();
    await setSettings({ target: 'en', engine: 'openai' });
    expect((await getSettings()).target).toBe('en');
    expect(JSON.stringify(areas.sync)).not.toMatch(/key|token/i);
  });
  it('falls back to local when sync is unavailable', async () => {
    const { areas } = installChrome({ syncFails: true });
    await setSettings({ target: 'fr' });
    expect((areas.local!.settings as { target: string }).target).toBe('fr');
    expect((await getSettings()).target).toBe('fr');
  });
});

import { rememberLang } from '../../src/core/settings';
describe('recent languages', () => {
  beforeEach(() => installChrome());
  it('newest first, deduplicated, max 5, only valid codes', async () => {
    for (const l of ['de', 'fr', 'de', 'es', 'it', 'ja', 'ko', 'xx']) await rememberLang(l);
    expect((await getSettings()).recentLangs).toEqual(['ko', 'ja', 'it', 'es', 'de']);
  });
  it('can update the target in the same write', async () => {
    const s = await rememberLang('fr', { target: 'fr' });
    expect(s.target).toBe('fr');
    expect(s.recentLangs[0]).toBe('fr');
  });
  it('sanitize drops garbage', () => expect(sanitize({ recentLangs: ['en', 3, '<x>', 'EN'] }).recentLangs).toEqual(['en']));
});
