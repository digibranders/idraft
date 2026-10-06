import { QueryClientProvider, focusManager, notifyManager, type QueryClient } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { refreshKeywords, useKeywordList, type KeywordFilters } from './rankings-queries';
import { makeQueryClient } from '@/lib/api/query-client';
import { server } from '@/test/msw';

/**
 * How the client mode reads the whole list in the background: one page after another, whatever the timing
 * of the notifications, and a write during the load is never lost to it.
 */

const TRACKED = '/api/v1/workspaces/:w/projects/:p/tracked-keywords';
const SCOPE = { workspaceId: 'w', projectId: 'p' } as const;
const FILTERS: KeywordFilters = { 'filter[is_active]': true };
const ROWS_PER_PAGE = 2;

interface Served {
  /** Pages asked, by cursor (`null` for the first). */
  asked: (string | null)[];
  /** The version the rows carry: a test bumps it to simulate a write. */
  version: { current: string };
}

/** A list of `total` keywords in pages of two rows; every row carries the version it was read at. */
function serve(total: number, networkMs: number): Served {
  const served: Served = { asked: [], version: { current: 'v1' } };
  server.use(
    http.get(`*${TRACKED}`, async ({ request }) => {
      const cursor = new URL(request.url).searchParams.get('cursor');
      served.asked.push(cursor);
      const version = served.version.current;
      const index = cursor === null ? 0 : Number(cursor);
      await delay(networkMs);
      const more = (index + 1) * ROWS_PER_PAGE < total;
      return HttpResponse.json({
        data: Array.from({ length: ROWS_PER_PAGE }, (_, offset) => ({
          tracked_keyword_id: `${version}-${String(index * ROWS_PER_PAGE + offset).padStart(3, '0')}`,
        })),
        page: { total, has_more: more, next_cursor: more ? String(index + 1) : null, limit: 200 },
      });
    }),
  );
  return served;
}

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);
const mountList = () =>
  renderHook(() => useKeywordList({ scope: SCOPE, filters: FILTERS, sort: [], search: '' }), { wrapper });
const idsOf = (rows: readonly { tracked_keyword_id: string }[]): string[] => rows.map((row) => row.tracked_keyword_id);

beforeEach(() => {
  client = makeQueryClient({ retry: false, onSignedOut: () => false });
});
afterEach(() => {
  notifyManager.setScheduler((callback) => setTimeout(callback, 0));
  focusManager.setFocused(undefined);
  vi.useRealTimers();
});

describe('the background load of the whole list', () => {
  it('reads every page when notifications arrive later than the network answers', async () => {
    // A hidden tab throttles timers: the page arrives in the same batch as the next fetch's start
    notifyManager.setScheduler((callback) => setTimeout(callback, 100));
    serve(20, 20);
    const { result } = mountList();
    await waitFor(() => expect(result.current.rows).toHaveLength(20), { timeout: 8_000 });
    expect(result.current.loadProgress).toBeNull();
  }, 10_000);

  it('applies a write that lands during the load: no row of the old version is left', async () => {
    const served = serve(40, 40);
    const { result } = mountList();
    await waitFor(() => expect(result.current.rows.length).toBeGreaterThanOrEqual(6));
    served.version.current = 'v2';
    await refreshKeywords(client, SCOPE);
    await waitFor(() => expect(result.current.rows).toHaveLength(40), { timeout: 8_000 });
    await waitFor(() => expect(result.current.fetching).toBe(false));
    expect(idsOf(result.current.rows).filter((id) => id.startsWith('v1'))).toEqual([]);
  }, 12_000);

  it('applies a write that lands during the load when the notifications are late', async () => {
    notifyManager.setScheduler((callback) => setTimeout(callback, 60));
    const served = serve(30, 20);
    const { result } = mountList();
    await waitFor(() => expect(result.current.rows.length).toBeGreaterThanOrEqual(4));
    served.version.current = 'v2';
    await refreshKeywords(client, SCOPE);
    await waitFor(() => expect(result.current.rows).toHaveLength(30), { timeout: 8_000 });
    await waitFor(() => expect(result.current.fetching).toBe(false));
    expect(idsOf(result.current.rows).filter((id) => id.startsWith('v1'))).toEqual([]);
  }, 12_000);
});

describe('what is read again of a loaded list', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
  });

  it('does not read the pages again on a focused window or a remount for ten minutes', async () => {
    const served = serve(10, 5);
    const first = mountList();
    await waitFor(() => expect(first.result.current.rows).toHaveLength(10));
    const reads = served.asked.length;
    expect(reads).toBe(5);

    vi.setSystemTime(Date.now() + 4 * 60_000);
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    first.unmount();
    const again = mountList();
    await waitFor(() => expect(again.result.current.rows).toHaveLength(10));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(served.asked).toHaveLength(reads);
  });

  it('reads the list again on a remount once it is five minutes old, and not on a focus', async () => {
    const served = serve(10, 5);
    const first = mountList();
    await waitFor(() => expect(first.result.current.rows).toHaveLength(10));
    const reads = served.asked.length;

    vi.setSystemTime(Date.now() + 6 * 60_000);
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(served.asked).toHaveLength(reads);

    first.unmount();
    mountList();
    await waitFor(() => expect(served.asked.length).toBeGreaterThan(reads));
  });

  it('drops the cache of a list nobody shows after half a minute', async () => {
    serve(4, 5);
    const first = mountList();
    await waitFor(() => expect(first.result.current.rows).toHaveLength(4));
    expect(client.getQueryCache().getAll().length).toBeGreaterThan(0);
    first.unmount();
    const all = client.getQueryCache().findAll({ queryKey: ['ws'], exact: false });
    const list = all.find((query) => query.queryKey.at(-1) === 'all');
    expect(list?.gcTime).toBe(30_000);
  });
});
