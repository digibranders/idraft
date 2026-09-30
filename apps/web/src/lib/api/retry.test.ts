import { describe, expect, it } from 'vitest';

import { problemFrom } from './problem';
import { retryDelay, shouldRetry, shouldRetryMutation } from './retry';

const problem = (status: number, code = 'some_code', headers: Record<string, string> = {}): Error =>
  problemFrom(new Response(null, { status, headers }), { code });

describe('shouldRetry', () => {
  it.each([400, 401, 403, 404, 409, 410, 422])('never retries a %i: the API has answered', (status) => {
    expect(shouldRetry(0, problem(status))).toBe(false);
  });

  it('retries a 429 once', () => {
    expect(shouldRetry(0, problem(429, 'rate_limited', { 'retry-after': '3' }))).toBe(true);
    expect(shouldRetry(1, problem(429, 'rate_limited', { 'retry-after': '3' }))).toBe(false);
    expect(shouldRetry(0, problem(429, 'rate_limited'))).toBe(true);
  });

  it('retries a 409 conflict once: nothing was written', () => {
    expect(shouldRetry(0, problem(409, 'conflict'))).toBe(true);
    expect(shouldRetry(1, problem(409, 'conflict'))).toBe(false);
  });

  it('does not sit through a wait longer than 10 seconds', () => {
    expect(shouldRetry(0, problem(429, 'rate_limited', { 'retry-after': '11' }))).toBe(false);
    expect(shouldRetry(0, problem(503, 'service_unavailable', { 'retry-after': '600' }))).toBe(false);
    expect(shouldRetry(0, problem(503, 'service_unavailable', { 'retry-after': '10' }))).toBe(true);
  });

  it.each(['query_timeout', 'provider_paused', 'maintenance'])('never retries a 503 %s', (code) => {
    expect(shouldRetry(0, problem(503, code))).toBe(false);
  });

  it('never retries a request the caller aborted or that timed out', () => {
    expect(shouldRetry(0, new DOMException('The operation was aborted', 'AbortError'))).toBe(false);
    expect(shouldRetry(0, new DOMException('The operation timed out', 'TimeoutError'))).toBe(false);
  });

  it.each([500, 502, 503, 504])('retries a %i twice', (status) => {
    expect(shouldRetry(0, problem(status))).toBe(true);
    expect(shouldRetry(1, problem(status))).toBe(true);
    expect(shouldRetry(2, problem(status))).toBe(false);
  });

  it('retries a request that got no response twice', () => {
    expect(shouldRetry(0, new TypeError('Failed to fetch'))).toBe(true);
    expect(shouldRetry(1, new TypeError('Failed to fetch'))).toBe(true);
    expect(shouldRetry(2, new TypeError('Failed to fetch'))).toBe(false);
  });

  it('treats a thrown value that is not an ApiProblem as no response', () => {
    expect(shouldRetry(0, 'boom')).toBe(true);
    expect(shouldRetry(0, null)).toBe(true);
    expect(shouldRetry(0, Object.assign(new Error('looks like a 404'), { status: 404 }))).toBe(true);
  });
});

describe('shouldRetryMutation', () => {
  it('repeats a write only after a 409 conflict, and only once', () => {
    expect(shouldRetryMutation(0, problem(409, 'conflict'))).toBe(true);
    expect(shouldRetryMutation(1, problem(409, 'conflict'))).toBe(false);
    expect(shouldRetryMutation(0, problem(409, 'duplicate'))).toBe(false);
    expect(shouldRetryMutation(0, problem(503))).toBe(false);
    expect(shouldRetryMutation(0, new TypeError('Failed to fetch'))).toBe(false);
  });

  it('does not repeat a write after a conflict that asks for a long wait', () => {
    expect(shouldRetryMutation(0, problem(409, 'conflict', { 'retry-after': '3600' }))).toBe(false);
  });
});

describe('retryDelay', () => {
  it('waits as long as the API asked, up to 10 seconds', () => {
    expect(retryDelay(0, problem(429, 'rate_limited', { 'retry-after': '7' }))).toBe(7000);
    expect(retryDelay(0, problem(429, 'rate_limited', { 'retry-after': '0' }))).toBe(0);
    expect(retryDelay(0, problem(429, 'rate_limited', { 'retry-after': '99999999999' }))).toBe(10_000);
  });

  it('backs off exponentially from one second, up to 4 seconds, when the API gave no wait', () => {
    expect(retryDelay(0, problem(503))).toBe(1000);
    expect(retryDelay(1, new TypeError('Failed to fetch'))).toBe(2000);
    expect(retryDelay(10, problem(502))).toBe(4000);
  });
});
