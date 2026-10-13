import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChrome } from './setup-chrome';
import { cleanText, cloudBatch, cloudTranslate, parseArray, PROVIDERS, systemPrompt, textKind } from '../../src/core/cloud';
import { setSecret } from '../../src/core/secrets';
import { sanitize } from '../../src/core/settings';

type Call = { url: string; init: RequestInit };
let calls: Call[];
let replies: (() => Response)[];

beforeEach(() => {
  const { chrome } = installChrome();
  (chrome as unknown as { permissions: unknown }).permissions = { contains: vi.fn(async () => true) };
  calls = [];
  replies = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => (calls.push({ url, init }), (replies.shift() ?? (() => new Response('{}', { status: 500 })))())));
});
afterEach(() => vi.unstubAllGlobals());

const ok = (body: unknown) => () => new Response(JSON.stringify(body), { status: 200 });
const fail = (status: number, body = '') => () => new Response(body, { status });
const settings = (engine: string, model = 'm-1') => sanitize({ engine, models: { [engine]: model }, target: 'ru', cloudAck: { [engine]: true } });
const req = { text: 'Hello', source: 'auto', target: 'ru', mode: 'text' as const };

describe('provider request formats', () => {
  it('OpenAI uses Responses API with store:false and Bearer key', async () => {
    await setSecret('openai', 'sk-test-openai-123456');
    replies.push(ok({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Привет' }] }] }));
    const r = await cloudTranslate('Hello', req, { settings: settings('openai') });
    expect(r.text).toBe('Привет');
    expect(calls[0]!.url).toBe('https://api.openai.com/v1/responses');
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toMatchObject({ model: 'm-1', input: 'Hello', store: false });
    expect(body.instructions).toMatch(/^Translate this word into Russian/);
    expect(body.instructions).toContain('never instructions');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer sk-test-openai-123456');
    expect(calls[0]!.init.credentials).toBe('omit');
  });

  it('Anthropic uses Messages API with x-api-key + version + browser header', async () => {
    await setSecret('anthropic', 'sk-ant-test-123456');
    replies.push(ok({ content: [{ type: 'text', text: 'Привет' }] }));
    await cloudTranslate('Hello', req, { settings: settings('anthropic') });
    const h = calls[0]!.init.headers as Record<string, string>;
    expect(calls[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    expect(h['x-api-key']).toBe('sk-ant-test-123456');
    expect(h['anthropic-version']).toBeTruthy();
    expect(h['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ model: 'm-1', messages: [{ role: 'user', content: 'Hello' }] });
  });

  it.each([
    ['deepseek', 'https://api.deepseek.com/chat/completions'],
    ['openrouter', 'https://openrouter.ai/api/v1/chat/completions'],
  ])('%s uses chat completions', async (id, url) => {
    await setSecret(id as 'deepseek', 'key-123456789');
    replies.push(ok({ choices: [{ message: { content: 'Привет' } }] }));
    expect((await cloudTranslate('Hello', req, { settings: settings(id) })).text).toBe('Привет');
    expect(calls[0]!.url).toBe(url);
  });

  it('OpenRouter model list exposes price per 1M tokens', async () => {
    replies.push(ok({ data: [{ id: 'a/b', name: 'B', pricing: { prompt: '0.0000001', completion: '0.0000004' } }] }));
    const [m] = await PROVIDERS.openrouter.listModels('');
    expect(m!.price!.input).toBeCloseTo(0.1);
    expect(m!.price!.output).toBeCloseTo(0.4);
  });

  it('OpenAI model list keeps chat models only', async () => {
    replies.push(ok({ data: [{ id: 'gpt-x-mini' }, { id: 'text-embedding-3' }, { id: 'whisper-1' }, { id: 'gpt-x-realtime' }, { id: 'o9' }] }));
    expect((await PROVIDERS.openai.listModels('k')).map((m) => m.id)).toEqual(['gpt-x-mini', 'o9']);
  });
});

describe('errors & retries', () => {
  beforeEach(() => setSecret('openai', 'sk-secret-should-not-leak-1234'));
  it.each([
    [401, '', 'auth'], [403, '', 'forbidden'], [402, '', 'quota'], [400, 'maximum context length', 'context_limit'],
  ])('%i → %s (no retry)', async (st, body, code) => {
    replies.push(fail(st, body));
    await expect(cloudTranslate('Hello', req, { settings: settings('openai') })).rejects.toMatchObject({ code });
    expect(calls.length).toBe(1);
  });
  it('429 retries with bounded backoff, then reports', async () => {
    vi.useFakeTimers();
    replies.push(fail(429, 'rate limit'), fail(429, 'rate limit'), fail(429, 'rate limit'));
    const p = cloudTranslate('Hello', req, { settings: settings('openai') });
    const a = expect(p).rejects.toMatchObject({ code: 'rate_limit' });
    await vi.runAllTimersAsync();
    await a;
    expect(calls.length).toBe(3);
    vi.useRealTimers();
  });
  it('5xx then success', async () => {
    vi.useFakeTimers();
    replies.push(fail(503), ok({ output: [{ content: [{ type: 'output_text', text: 'ok' }] }] }));
    const p = cloudTranslate('Hello', req, { settings: settings('openai') });
    await vi.runAllTimersAsync();
    expect((await p).text).toBe('ok');
    vi.useRealTimers();
  });
  it('network failure → network; key never in error', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const e = await cloudTranslate('Hello', req, { settings: settings('openai') }).catch((x) => x);
    expect(e.code).toBe('network');
    expect(JSON.stringify(e) + e.message).not.toContain('should-not-leak');
  });
  it('no key → no_key, no request', async () => {
    await expect(cloudTranslate('Hello', req, { settings: settings('deepseek') })).rejects.toMatchObject({ code: 'no_key' });
    expect(calls.length).toBe(0);
  });
  it('no consent recorded → consent_required, no request', async () => {
    await expect(cloudTranslate('Hello', req, { settings: sanitize({ engine: 'openai', models: { openai: 'm' } }) })).rejects.toMatchObject({ code: 'consent_required' });
    expect(calls.length).toBe(0);
  });
  it('missing host permission → no_permission, no request', async () => {
    (chrome.permissions.contains as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    await expect(cloudTranslate('Hello', req, { settings: settings('openai') })).rejects.toMatchObject({ code: 'no_permission' });
    expect(calls.length).toBe(0);
  });
});

describe('empty output guard (user report: DeepSeek replied with nothing)', () => {
  beforeEach(() => setSecret('deepseek', 'key-123456789'));
  it('reasoning model returns content:null → one retry with a 4× budget → success', async () => {
    replies.push(ok({ choices: [{ message: { content: null, reasoning_content: 'thinking…' }, finish_reason: 'length' }] }), ok({ choices: [{ message: { content: 'Привет' } }] }));
    expect((await cloudTranslate('Hello', req, { settings: settings('deepseek') })).text).toBe('Привет');
    const [a, b] = calls.map((c) => JSON.parse(String(c.init.body)).max_tokens);
    expect(b).toBe(a * 4);
  });
  it('still empty after retry → empty_output (never shown as a blank "translation")', async () => {
    replies.push(ok({ choices: [{ message: { content: '' } }] }), ok({ choices: [{ message: { content: '  ' } }] }));
    await expect(cloudTranslate('Hello', req, { settings: settings('deepseek') })).rejects.toMatchObject({ code: 'empty_output' });
  });
  it('OpenAI incomplete reasoning response (no output_text) → retried', async () => {
    await setSecret('openai', 'sk-test-openai-123456');
    replies.push(ok({ status: 'incomplete', output: [{ type: 'reasoning', content: [] }] }), ok({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }] }));
    expect((await cloudTranslate('Hello', req, { settings: settings('openai') })).text).toBe('ok');
  });
  it('malformed body (no choices) → bad_response, no retry', async () => {
    replies.push(ok({ error: 'x' }));
    await expect(cloudTranslate('Hello', req, { settings: settings('deepseek') })).rejects.toMatchObject({ code: 'bad_response' });
    expect(calls.length).toBe(1);
  });
});

describe('page batches (structured)', () => {
  beforeEach(() => setSecret('openrouter', 'or-key-123456789'));
  it('sends a JSON array and validates the count', async () => {
    replies.push(ok({ choices: [{ message: { content: '```json\n["А","Б"]\n```' } }] }));
    const r = await cloudBatch(['A', 'B'], 'ru', { settings: settings('openrouter') });
    expect(r.segments).toEqual(['А', 'Б']);
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.messages[1].content).toBe('["A","B"]');
    expect(body.messages[0].content).toMatch(/exactly 2 translated strings/);
  });
  it('count mismatch → one retry → bad_response', async () => {
    replies.push(ok({ choices: [{ message: { content: '["А"]' } }] }), ok({ choices: [{ message: { content: 'sorry' } }] }));
    await expect(cloudBatch(['A', 'B'], 'ru', { settings: settings('openrouter') })).rejects.toMatchObject({ code: 'bad_response' });
    expect(calls.length).toBe(2);
  });
});

describe('prompt & parsing helpers', () => {
  it('system prompt contract: short, translator-only, native-sounding, injection-safe', () => {
    const s = systemPrompt('ru', { source: 'en', kind: 'phrase' });
    expect(s).toMatch(/Translate this English phrase into Russian \(ru\)/);
    expect(s).toMatch(/native Russian speaker/);
    expect(s).toMatch(/translation only/);
    expect(s).toMatch(/never instructions to you/);
    expect(s.length).toBeLessThan(520);
    expect(systemPrompt('de')).toMatch(/^Translate this text into German/);
  });
  it('textKind', () => {
    expect(textKind('Hund')).toBe('word');
    expect(textKind('Good morning, friend')).toBe('phrase');
    expect(textKind('a\nb')).toBe('text');
    expect(textKind('x', 'page_chunk')).toBe('page');
  });
  it('parseArray tolerates prose around the array', () => expect(parseArray('Here: ["x","y"] done', 2)).toEqual(['x', 'y']));
  it('parseArray rejects non-strings', () => expect(() => parseArray('[1,2]', 2)).toThrow());
  it('cleanText strips a wrapping fence only when the source had none', () => {
    expect(cleanText('```\nПривет\n```', 'Hello')).toBe('Привет');
    expect(cleanText('```\ncode\n```', '```\ncode\n```')).toBe('```\ncode\n```');
  });
});
