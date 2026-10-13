// Client side of the `translate` port (popup, options, content scripts). Cancel = disconnect.
import { TError } from './errors';
import { LIMITS, PORT_TRANSLATE, type PortReply, type PortRequest } from './messages';

export interface Pending<T> {
  promise: Promise<T>;
  cancel(): void;
}

type Final = Extract<PortReply, { type: 'result' | 'batch_result' }>;

export function request(msg: PortRequest, onProgress?: (loaded: number) => void): Pending<Final> {
  const port = chrome.runtime.connect({ name: PORT_TRANSLATE });
  let settle: { resolve(v: Final): void; reject(e: TError): void } | null = null;
  const promise = new Promise<Final>((resolve, reject) => (settle = { resolve, reject }));
  const done = (fn: () => void) => {
    if (!settle) return;
    fn();
    settle = null;
    port.disconnect();
  };
  port.onMessage.addListener((m: PortReply) => {
    if (m.type === 'progress') onProgress?.(m.loaded);
    else if (m.type === 'error') done(() => settle!.reject(new TError(m.code, m.detail)));
    else done(() => settle!.resolve(m));
  });
  // SW restarted / extension reloaded mid-request.
  port.onDisconnect.addListener(() => settle && (settle.reject(new TError('internal', 'disconnected')), (settle = null)));
  // Over-long input is cut here (the orchestrator then reports `truncated`) instead of being rejected by the SW.
  if (msg.type === 'translate' && msg.req.text.length > LIMITS.text) msg = { ...msg, req: { ...msg.req, text: msg.req.text.slice(0, LIMITS.text) } };
  port.postMessage(msg);
  return { promise, cancel: () => done(() => settle!.reject(new TError('cancelled'))) };
}
