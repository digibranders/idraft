import { describe, expect, it } from 'vitest';

import { shouldRetry } from './retry';

const problem = (status: number): Error & { status: number } => Object.assign(new Error('problem'), { status });

describe('shouldRetry', () => {
  it.each([400, 401, 403, 404, 409, 422])('never retries a %i: the API has answered', (status) => {
    expect(shouldRetry(0, problem(status))).toBe(false);
  });

  it('leaves a 429 to the query layer, which waits for Retry-After', () => {
    expect(shouldRetry(0, problem(429))).toBe(false);
  });

  it('never retries a request the caller aborted or that timed out', () => {
    expect(shouldRetry(0, new DOMException('The operation was aborted', 'AbortError'))).toBe(false);
    expect(shouldRetry(0, new DOMException('The operation timed out', 'TimeoutError'))).toBe(false);
  });

  it.each([500, 502, 503, 504])('retries a %i', (status) => {
    expect(shouldRetry(0, problem(status))).toBe(true);
  });

  it('retries a request that got no response', () => {
    expect(shouldRetry(0, new TypeError('Failed to fetch'))).toBe(true);
    expect(shouldRetry(1, new TypeError('Failed to fetch'))).toBe(true);
  });

  it('gives up after two retries', () => {
    expect(shouldRetry(2, problem(503))).toBe(false);
    expect(shouldRetry(2, new TypeError('Failed to fetch'))).toBe(false);
  });

  it('treats a thrown value that is not an error as no response', () => {
    expect(shouldRetry(0, 'boom')).toBe(true);
    expect(shouldRetry(0, null)).toBe(true);
    expect(shouldRetry(0, { status: 'nope' })).toBe(true);
  });
});
