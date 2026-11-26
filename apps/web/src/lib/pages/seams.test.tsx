import { QueryClientProvider } from '@tanstack/react-query';
import { render, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { ISSUE_COLUMNS_AVAILABLE, issueCountsOf, useIssueTotals, usePageIssues } from './issue-source';
import { usePageOutline } from './outline';
import { usePageSearchDaily } from './search-daily';
import { PageSearchDetailSlot } from './search-detail-slot';
import { TRACKING_AVAILABLE, useTrackedPages, useTrackPages } from './tracking';
import { makeQueryClient } from '@/lib/api/query-client';
import type { LinksScope, PageRow } from '@/lib/internal-links/types';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { server } from '@/test/msw';

/** The seams answer `unavailable` until their owner sessions replace them; the two reads of this branch use the mocked API. */

const EVENTUS = MOCK_PROJECTS.find((project) => project.slug === 'eventus-security');
if (EVENTUS === undefined) throw new Error('No fixture project eventus-security');
const SCOPE: LinksScope = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: EVENTUS.project_id };
const PRICING = '108';
const NO_SUCH_PAGE = '999999';

function signIn(): void {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('owner').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
}

function providers(): ({ children }: { children: ReactNode }) => ReactNode {
  const client = makeQueryClient({ retry: false, onSignedOut: () => false });
  return function Providers({ children }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

/** The paths asked of the API while `run` runs. */
async function requestsDuring(run: () => Promise<void>): Promise<string[]> {
  const paths: string[] = [];
  const log = ({ request }: { request: Request }): void => {
    paths.push(new URL(request.url).pathname);
  };
  server.events.on('request:start', log);
  try {
    await run();
  } finally {
    server.events.removeListener('request:start', log);
  }
  return paths;
}

describe('the seams of the other sessions', () => {
  it('answer unavailable, false or null on this branch', () => {
    const wrapper = providers();
    expect(renderHook(() => useIssueTotals(SCOPE, null), { wrapper }).result.current).toEqual({ state: 'unavailable' });
    expect(renderHook(() => usePageIssues(SCOPE, null, PRICING), { wrapper }).result.current).toEqual({
      state: 'unavailable',
    });
    expect(renderHook(() => useTrackedPages(SCOPE), { wrapper }).result.current).toEqual({ state: 'unavailable' });
    expect(ISSUE_COLUMNS_AVAILABLE).toBe(false);
    expect(TRACKING_AVAILABLE).toBe(false);
    expect(issueCountsOf({} as PageRow)).toBeNull();
  });

  it('refuse to track a page, and say it is not pending', async () => {
    const { result } = renderHook(() => useTrackPages(SCOPE), { wrapper: providers() });
    expect(result.current.pending).toBe(false);
    await expect(result.current.track([PRICING])).rejects.toThrow('Tracking is not available');
  });

  it('draw nothing in the search detail slot', () => {
    const { container } = render(
      <PageSearchDetailSlot scope={SCOPE} urlId={PRICING} url="https://eventussecurity.com/pricing" timeZone="UTC" />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('usePageSearchDaily', () => {
  it('loads, then gives the 28 days of the page', async () => {
    signIn();
    const { result } = renderHook(() => usePageSearchDaily(SCOPE, null, PRICING), { wrapper: providers() });
    expect(result.current).toEqual({ state: 'loading' });
    await waitFor(() => {
      expect(result.current.state).toBe('ready');
    });
    if (result.current.state !== 'ready') throw new Error('not ready');
    expect(result.current.data.state).toBe('ok');
    expect(result.current.data.days).toHaveLength(28);
  });

  it('gives an error with a retry that asks again', async () => {
    signIn();
    let failing = true;
    server.use(
      http.get('*/api/v1/workspaces/:w/projects/:p/internal-links/pages/:id/search', () =>
        failing
          ? HttpResponse.json(
              { type: 'about:blank', title: 'Server error', status: 500, code: 'internal_error', request_id: 'r1' },
              { status: 500, headers: { 'content-type': 'application/problem+json' } },
            )
          : undefined,
      ),
    );
    const { result } = renderHook(() => usePageSearchDaily(SCOPE, null, PRICING), { wrapper: providers() });
    await waitFor(() => {
      expect(result.current.state).toBe('error');
    });
    failing = false;
    if (result.current.state !== 'error') throw new Error('no error');
    result.current.retry();
    await waitFor(() => {
      expect(result.current.state).toBe('ready');
    });
  });
});

describe('usePageOutline', () => {
  it('loads, then gives the outline of the page', async () => {
    signIn();
    const { result } = renderHook(() => usePageOutline(SCOPE, PRICING, true), { wrapper: providers() });
    expect(result.current).toEqual({ state: 'loading' });
    await waitFor(() => {
      expect(result.current.state).toBe('ready');
    });
    if (result.current.state !== 'ready') throw new Error('not ready');
    expect(result.current.data.state).toBe('ok');
  });

  it('stays loading and sends no request while it is not enabled', async () => {
    signIn();
    const asked = await requestsDuring(async () => {
      const { result } = renderHook(() => usePageOutline(SCOPE, PRICING, false), { wrapper: providers() });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(result.current).toEqual({ state: 'loading' });
    });
    expect(asked.filter((path) => path.includes('/outline'))).toEqual([]);
  });

  it('gives an error that is not "not found" for a 500, with a retry that asks again', async () => {
    signIn();
    let failing = true;
    server.use(
      http.get('*/api/v1/workspaces/:w/projects/:p/internal-links/pages/:id/outline', () =>
        failing
          ? HttpResponse.json(
              { type: 'about:blank', title: 'Server error', status: 500, code: 'internal_error', request_id: 'r1' },
              { status: 500, headers: { 'content-type': 'application/problem+json' } },
            )
          : undefined,
      ),
    );
    const { result } = renderHook(() => usePageOutline(SCOPE, PRICING, true), { wrapper: providers() });
    await waitFor(() => {
      expect(result.current.state).toBe('error');
    });
    if (result.current.state !== 'error') throw new Error('no error');
    expect(result.current.notFound).toBe(false);
    failing = false;
    result.current.retry();
    await waitFor(() => {
      expect(result.current.state).toBe('ready');
    });
  });

  it('gives an error that is "not found" for a 404', async () => {
    signIn();
    const { result } = renderHook(() => usePageOutline(SCOPE, NO_SUCH_PAGE, true), { wrapper: providers() });
    await waitFor(() => {
      expect(result.current.state).toBe('error');
    });
    expect(result.current).toMatchObject({ state: 'error', notFound: true });
  });
});
