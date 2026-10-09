/** Cancellation, spelled one way for every long export. */

/** The error a cancelled export rejects with: an `AbortError`, as `fetch` uses. */
export function abortError(): Error {
  const error = new Error('The export was cancelled.');
  error.name = 'AbortError';
  return error;
}

/** Whether a failure was a cancellation, which is not something to report as an error. */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/** Throw if the export has been cancelled; call between steps, never inside a synchronous capture. */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}
