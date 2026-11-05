import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useCheckPrice, useTrackedKeywordQuota } from './add-queries';
import { refreshKeywords } from '../rankings-queries';
import { makeQueryClient } from '@/lib/api/query-client';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { MAX_TRACKED_KEYWORDS } from '@/mocks/handlers/keyword-rules';
import { SESSION_COOKIE } from '@/mocks/session';
import { server } from '@/test/msw';
import { fynix } from '@/test/rankings-harness';

const SCOPE = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: fynix.project_id } as const;
const QUOTA = '*/api/v1/workspaces/:w/tracked-keyword-quota';
const PRICE_BOOK = '*/api/v1/workspaces/:w/price-book';
const EMPTY_PRICE_BOOK = { data: [], page: { total: 0, offset: 0, limit: 200 } };
/** Ten pages at 600 micro-dollars and the AI Overview task, from the mock price book. */
const CHECK_PRICE = 0.0066;

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

/** Resolves once a query exists and none is still waiting for its first answer. */
const settled = (): boolean => {
  const queries = client.getQueryCache().findAll();
  return queries.length > 0 && queries.every((query) => query.state.status !== 'pending');
};

beforeEach(() => {
  client = makeQueryClient({ retry: false });
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('admin').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
});

describe('useTrackedKeywordQuota', () => {
  it('reads the limit and the use of the workspace', async () => {
    const { result } = renderHook(() => useTrackedKeywordQuota(SCOPE, true), { wrapper });
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.limit).toBe(MAX_TRACKED_KEYWORDS);
    expect(result.current?.used).toBeGreaterThan(0);
  });

  it('reads nothing until it is enabled', async () => {
    let asked = 0;
    server.use(
      http.get(QUOTA, () => {
        asked += 1;
        return HttpResponse.json({ data: { limit: 5000, used: 7 } });
      }),
    );
    const { result, rerender } = renderHook(({ enabled }) => useTrackedKeywordQuota(SCOPE, enabled), {
      wrapper,
      initialProps: { enabled: false },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(asked).toBe(0);
    expect(result.current).toBeNull();
    rerender({ enabled: true });
    await waitFor(() => expect(result.current).toEqual({ limit: 5000, used: 7 }));
    expect(asked).toBe(1);
  });

  it('is null when the quota cannot be read', async () => {
    server.use(http.get(QUOTA, () => HttpResponse.json({ title: 'Broken' }, { status: 500 })));
    const { result } = renderHook(() => useTrackedKeywordQuota(SCOPE, true), { wrapper });
    await waitFor(settled);
    expect(result.current).toBeNull();
  });

  it('reads the use again after an add, an archive or a delete', async () => {
    let used = 3;
    server.use(http.get(QUOTA, () => HttpResponse.json({ data: { limit: 5000, used } })));
    const { result } = renderHook(() => useTrackedKeywordQuota(SCOPE, true), { wrapper });
    await waitFor(() => expect(result.current?.used).toBe(3));
    used = 9;
    await refreshKeywords(client, SCOPE);
    await waitFor(() => expect(result.current?.used).toBe(9));
  });
});

describe('useCheckPrice', () => {
  it('is null while the price book loads, then the cost of a depth 100 check', async () => {
    const { result } = renderHook(() => useCheckPrice(SCOPE, true), { wrapper });
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current).toBeCloseTo(CHECK_PRICE, 6);
  });

  it('reads nothing until it is enabled', async () => {
    let asked = 0;
    server.use(
      http.get(PRICE_BOOK, () => {
        asked += 1;
        return HttpResponse.json(EMPTY_PRICE_BOOK);
      }),
    );
    const { result } = renderHook(() => useCheckPrice(SCOPE, false), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(asked).toBe(0);
    expect(result.current).toBeNull();
  });

  it('is null for a member who may not read the price book', async () => {
    server.use(http.get(PRICE_BOOK, () => HttpResponse.json({ title: 'Forbidden' }, { status: 403 })));
    const { result } = renderHook(() => useCheckPrice(SCOPE, true), { wrapper });
    await waitFor(settled);
    expect(client.getQueryCache().findAll()[0]?.state.status).toBe('error');
    expect(result.current).toBeNull();
  });

  it('is null when the price book holds no price for a check', async () => {
    server.use(http.get(PRICE_BOOK, () => HttpResponse.json(EMPTY_PRICE_BOOK)));
    const { result } = renderHook(() => useCheckPrice(SCOPE, true), { wrapper });
    await waitFor(settled);
    expect(client.getQueryCache().findAll()[0]?.state.status).toBe('success');
    expect(result.current).toBeNull();
  });
});
