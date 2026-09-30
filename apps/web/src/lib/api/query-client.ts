import { QueryClient } from '@tanstack/react-query';

import { shouldRetry } from './retry';

/** Configuration data goes stale after 30 seconds; analytics queries set their own 5 minutes (20 section 3.5). */
const CONFIGURATION_STALE_MS = 30_000;

/**
 * `retry` is off on the server and in tests. A retry waits before it asks again: on the server that would
 * hold the page for seconds while the API is down, and in a test an error state would arrive after the
 * test stopped waiting. In the browser a failed request gets two more tries (./retry.ts).
 */
export function makeQueryClient({ retry = typeof window !== 'undefined' }: { retry?: boolean } = {}): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: CONFIGURATION_STALE_MS, retry: retry ? shouldRetry : false },
      // A mutation is never sent twice on its own: the second attempt could repeat a change that did happen
      mutations: { retry: false },
    },
  });
}

let browserClient: QueryClient | null = null;

/**
 * One client for the life of the page in the browser. On the server every request gets its own, so one
 * person's cached data can never be rendered for another.
 */
export function getQueryClient(): QueryClient {
  if (typeof window === 'undefined') return makeQueryClient();
  browserClient ??= makeQueryClient();
  return browserClient;
}
