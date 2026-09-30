import { describe, expect, it, vi } from 'vitest';

import { getQueryClient, makeQueryClient } from './query-client';
import { shouldRetry } from './retry';

describe('makeQueryClient', () => {
  it('does not retry on the server, where a retry would hold the page', async () => {
    const client = makeQueryClient();
    expect(client.getDefaultOptions().queries?.retry).toBe(false);
    const queryFn = vi.fn().mockRejectedValue(Object.assign(new Error('Bad gateway'), { status: 502 }));
    await client.prefetchQuery({ queryKey: ['down'], queryFn });
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it('uses the retry policy when retries are on, as in the browser', () => {
    expect(makeQueryClient({ retry: true }).getDefaultOptions().queries?.retry).toBe(shouldRetry);
  });

  it('never sends a mutation twice on its own', () => {
    expect(makeQueryClient({ retry: true }).getDefaultOptions().mutations?.retry).toBe(false);
  });

  it('keeps configuration data fresh for 30 seconds', () => {
    expect(makeQueryClient().getDefaultOptions().queries?.staleTime).toBe(30_000);
  });
});

describe('getQueryClient', () => {
  it('gives every request its own client on the server, so one person never sees another person’s cache', () => {
    expect(getQueryClient()).not.toBe(getQueryClient());
  });
});
