export class BodyLimitError extends Error {}

export function deadline(milliseconds, parent) {
  const controller = new AbortController();
  const abort = () => controller.abort(parent.reason);
  if (parent?.aborted) abort();
  else parent?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException('Deadline exceeded', 'TimeoutError')), milliseconds);
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      parent?.removeEventListener('abort', abort);
    },
    cancel() { controller.abort(); }
  };
}

export async function readJsonBounded(message, signal, maximum = 16 * 1024) {
  signal.throwIfAborted();
  const reader = message.body?.getReader();
  if (!reader) throw new SyntaxError('Missing body');
  let cancelRequested = false;
  const cancel = () => {
    if (!cancelRequested) {
      cancelRequested = true;
      void reader.cancel().catch(() => {});
    }
  };
  signal.addEventListener('abort', cancel, { once: true });
  const bytes = new Uint8Array(maximum);
  let length = 0;
  try {
    if (Number(message.headers.get('content-length')) > maximum) throw new BodyLimitError();
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      if (length + value.byteLength > maximum) throw new BodyLimitError();
      bytes.set(value, length);
      length += value.byteLength;
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)));
  } catch (error) {
    cancel();
    throw error;
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}
