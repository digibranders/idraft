import { isApiProblem } from './problem';

/**
 * Which failed requests are worth sending again (20-frontend-specification.md section 3.7).
 *
 * - An answer below 500 (not found, forbidden, invalid) is final: asking again gives the same answer.
 * - A 429 says when to come back: it gets one retry, after `Retry-After` (see `retryDelay`).
 * - A 409 `conflict` means another request held the row and nothing was written: one retry is safe.
 * - A 5xx, or a request that never got a response, may succeed next time: two more tries.
 * - A 503 that another try cannot fix is final: `query_timeout` asks for a narrower window, and
 *   `provider_paused` and `maintenance` last longer than a page waits.
 * - A retry never waits more than 10 seconds: a longer `Retry-After` shows the error state, with its own
 *   "Retry", instead of a skeleton that seems stuck. The backoff stays under that too.
 * - A request the caller aborted is not a failure to repair, so it is never retried.
 */
const MAX_RETRIES = 2;
const MAX_WAIT_SECONDS = 10;
const MAX_BACKOFF_MS = 4_000;
const FINAL_SERVER_CODES: ReadonlySet<string> = new Set(['query_timeout', 'provider_paused', 'maintenance']);

const isAbort = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');

/** Whether the problem asks for a wait the page should not sit through. */
const waitsTooLong = (seconds: number | null): boolean => seconds !== null && seconds > MAX_WAIT_SECONDS;

export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_RETRIES || isAbort(error)) return false;
  if (!isApiProblem(error)) return true;
  if (waitsTooLong(error.retryAfterSeconds) || FINAL_SERVER_CODES.has(error.code)) return false;
  if (error.status === 429 || error.code === 'conflict') return failureCount < 1;
  return error.status >= 500;
}

/** A write is never repeated on its own, except a 409 `conflict`, where the API wrote nothing. */
export function shouldRetryMutation(failureCount: number, error: unknown): boolean {
  return failureCount < 1 && isApiProblem(error, 'conflict') && !waitsTooLong(error.retryAfterSeconds);
}

/** The wait before a retry: what the API asked for, or an exponential backoff from 1 second to 4. */
export function retryDelay(failureCount: number, error: unknown): number {
  if (isApiProblem(error) && error.retryAfterSeconds !== null) {
    return Math.min(error.retryAfterSeconds, MAX_WAIT_SECONDS) * 1000;
  }
  return Math.min(1000 * 2 ** failureCount, MAX_BACKOFF_MS);
}
