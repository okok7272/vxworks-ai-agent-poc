export class LoopCancelled extends Error {}
export function checkAbort(signal: AbortSignal): void {
  if (signal.aborted) { throw new LoopCancelled(String(signal.reason ?? 'Cancelled')); }
}
export async function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  checkAbort(signal);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new LoopCancelled(String(signal.reason ?? 'Cancelled')));
    signal.addEventListener('abort', abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
