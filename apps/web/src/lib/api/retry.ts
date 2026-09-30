/**
 * Which failed requests are worth sending again at once. A response below 500 is an answer (not found,
 * forbidden, invalid): asking again gives the same answer. A 5xx or a request that never got a response
 * may succeed the next time, so it gets two more tries.
 *
 * A 429 is not retried here either: it says when to come back (Retry-After), and the query layer waits
 * that long before its one retry (20 section 3.7), which a blind retry would ignore.
 *
 * A request the caller aborted is not a failure to repair, so it is never retried.
 */
const MAX_RETRIES = 2;

function statusOf(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('status' in error)) return null;
  return typeof error.status === 'number' ? error.status : null;
}

const isAbort = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');

export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_RETRIES || isAbort(error)) return false;
  const status = statusOf(error);
  return status === null || status >= 500;
}
