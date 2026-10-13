import { describe, expect, it } from 'vitest';
import { httpError, redact, toTError } from '../../src/core/errors';

describe('redact', () => {
  it('masks provider keys and bearer tokens', () => {
    const s = redact('key sk-proj-abcdefghijklmnop and Authorization: Bearer eyJhbGciOi.xyz and sk-ant-api03-ZZZZZZZZZ');
    expect(s).not.toMatch(/abcdefghijklmnop|eyJhbGciOi|ZZZZZZZZZ/);
  });
  it('masks long opaque tokens', () => expect(redact('token ' + 'a'.repeat(40))).toBe('token ***'));
});

describe('httpError', () => {
  it.each([
    [401, '', 'auth'], [402, '', 'quota'], [403, '', 'forbidden'], [429, 'Rate limit reached', 'rate_limit'],
    [429, 'You exceeded your current quota', 'quota'], [400, 'maximum context length exceeded', 'context_limit'],
    [503, '', 'server'], [400, 'weird', 'bad_response'],
  ])('%i %s → %s', (st, body, code) => expect(httpError(st, body).code).toBe(code));
});

describe('toTError', () => {
  it('maps DOM errors', () => {
    expect(toTError(new DOMException('x', 'AbortError')).code).toBe('cancelled');
    expect(toTError(new DOMException('x', 'NotSupportedError')).code).toBe('unsupported_pair');
  });
  it('never leaks secrets in detail', () => expect(toTError(new Error('bad key sk-abcdefghijk')).detail).not.toContain('abcdefghijk'));
});
