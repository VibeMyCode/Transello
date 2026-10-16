// Error codes shared by all engines and UIs. Each code has a localized message `err_<code>`.
export const ERROR_CODES = [
  'cancelled',
  'api_missing', // Chrome built-in Translator not exposed in this browser
  'local_unavailable_here', // exposed elsewhere, but not in this context (see ADR-001 fallback)
  'unsupported_pair',
  'unknown_language', // detector could not tell; user must pick the source
  'needs_download', // detected direction has no model on the device; ask before downloading (detail "src>tgt")
  'download_failed',
  'download_stalled',
  'too_long',
  'restricted_page',
  'no_selection',
  'offline',
  'auth', // 401 / revoked / expired
  'forbidden', // 403
  'rate_limit', // 429
  'quota', // 402 / insufficient credits
  'context_limit',
  'server', // 5xx
  'network',
  'bad_response',
  'empty_output', // model returned no text (e.g. reasoning model hit max tokens)
  'no_key',
  'no_permission', // optional host permission not granted
  'consent_required',
  'internal',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export class TError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly detail?: string,
  ) {
    super(code + (detail ? `: ${detail}` : ''));
    this.name = 'TError';
  }
}

const RETRYABLE = new Set<ErrorCode>(['empty_output', 'download_failed', 'download_stalled', 'offline', 'rate_limit', 'server', 'network', 'bad_response', 'internal']);
export const isRetryable = (c: ErrorCode) => RETRYABLE.has(c);

export function isErrorCode(x: unknown): x is ErrorCode {
  return typeof x === 'string' && (ERROR_CODES as readonly string[]).includes(x);
}

/** Convert anything thrown into a TError without leaking secrets into the detail. */
export function toTError(e: unknown): TError {
  if (e instanceof TError) return e;
  const name = (e as { name?: string })?.name;
  if (name === 'AbortError') return new TError('cancelled');
  if (name === 'NotSupportedError') return new TError('unsupported_pair');
  if (name === 'QuotaExceededError') return new TError('too_long');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return new TError('offline');
  if (e instanceof TypeError) return new TError('network');
  return new TError('internal', redact(String((e as Error)?.message ?? e)).slice(0, 200));
}

/** Mask anything that looks like an API key / bearer token (spec §6: no secrets in logs or errors). */
export function redact(s: string): string {
  return s
    .replace(/\b(sk|rk|pk)-[A-Za-z0-9_-]{6,}/g, '$1-***')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer ***')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '***');
}

/** HTTP status → error code for cloud providers (spec §5 "Ошибки"). */
export function httpError(status: number, body = ''): TError {
  const b = body.toLowerCase();
  if (status === 401) return new TError('auth');
  if (status === 402) return new TError('quota');
  if (status === 403) return new TError('forbidden');
  if (status === 413 || /context|too long|maximum.*tokens/.test(b)) return new TError('context_limit');
  if (status === 429) return /quota|insufficient|credit|balance/.test(b) ? new TError('quota') : new TError('rate_limit');
  if (status >= 500) return new TError('server', String(status));
  return new TError('bad_response', String(status));
}
