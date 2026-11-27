import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { membersRead, useNoteSources, type NoteSourceView } from './note-sources';
import { membersQuery } from '@/features/workspace-settings/workspace-queries';
import { makeQueryClient } from '@/lib/api/query-client';
import type { LinksScope } from '@/lib/internal-links/types';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { server } from '@/test/msw';

const EVENTUS = MOCK_PROJECTS.find((project) => project.slug === 'eventus-security');
if (EVENTUS === undefined) throw new Error('No fixture project eventus-security');
const SCOPE: LinksScope = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: EVENTUS.project_id };
const VIEW: NoteSourceView = { run: null, linkScope: 'editorial' };
const SOC_PAGE = '103';

function signIn(): void {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('editor').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
}

function providers(): ({ children }: { children: ReactNode }) => ReactNode {
  const client = makeQueryClient({ retry: false, onSignedOut: () => false });
  return function Providers({ children }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

/** The requests the API saw while the test ran. */
function watch(): URL[] {
  const seen: URL[] = [];
  server.use(
    http.all('*/api/v1/*', ({ request }) => {
      seen.push(new URL(request.url));
      return undefined;
    }),
  );
  return seen;
}

const pagesRequests = (seen: readonly URL[]): URL[] =>
  seen.filter((url) => url.pathname.endsWith('/internal-links/pages'));

function render(
  query: string,
  enabled: boolean,
  urlId = SOC_PAGE,
): ReturnType<typeof renderHook<ReturnType<typeof useNoteSources>, { query: string; enabled: boolean }>> {
  return renderHook(({ query: typed, enabled: on }) => useNoteSources(SCOPE, urlId, typed, on, VIEW), {
    wrapper: providers(),
    initialProps: { query, enabled },
  });
}

describe('the members read', () => {
  // `lib` may not import the feature, so the read is written twice; one cache entry only if the keys stay equal
  it('has the key of the Members screen of the workspace settings', () => {
    expect(membersRead(SCOPE.workspaceId).queryKey).toEqual(membersQuery(SCOPE.workspaceId).queryKey);
  });
});

describe('useNoteSources', () => {
  it('gives the teammates, the live pages that match, the tracked keywords of the page and no issue', async () => {
    signIn();
    const { result } = render('soc', true);
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    const { sources } = result.current;
    expect(sources.teammates.map((mate) => mate.name)).toContain('Priya Natarajan');
    expect(sources.teammates[0]).toEqual({ id: expect.any(String), name: expect.any(String) });
    expect(sources.pages.length).toBeGreaterThan(0);
    expect(sources.pages.length).toBeLessThanOrEqual(8);
    expect(sources.pages[0]).toEqual({ id: expect.any(String), path: expect.any(String), title: expect.anything() });
    expect(sources.keywords).toEqual(['soc as a service', 'managed soc', 'soc service provider']);
    // The Issues seam answers unavailable on this branch
    expect(sources.issues).toEqual([]);
  });

  it('asks for live pages with the query and a limit of 8, once after the pause and not on every key', async () => {
    signIn();
    const seen = watch();
    const { rerender } = render('p', true);
    await waitFor(() => {
      expect(pagesRequests(seen)).toHaveLength(1);
    });
    expect(pagesRequests(seen)[0]?.searchParams.get('filter[view]')).toBe('live');
    expect(pagesRequests(seen)[0]?.searchParams.get('limit')).toBe('8');
    rerender({ query: 'pr', enabled: true });
    rerender({ query: 'pri', enabled: true });
    rerender({ query: 'pric', enabled: true });
    await waitFor(() => {
      expect(pagesRequests(seen)).toHaveLength(2);
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(pagesRequests(seen)).toHaveLength(2);
    expect(pagesRequests(seen)[1]?.searchParams.get('q')).toBe('pric');
  });

  it('asks nothing while it is not enabled', async () => {
    signIn();
    const seen = watch();
    const { result } = render('a', false);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(seen.filter((url) => url.pathname.includes('/members') || url.pathname.includes('/pages'))).toEqual([]);
    expect(result.current.sources).toEqual({ teammates: [], pages: [], issues: [], keywords: [] });
  });

  it('leaves the other sources when one fails', async () => {
    signIn();
    server.use(
      http.get('*/api/v1/workspaces/:w/members', () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Server error', status: 500, code: 'internal_error', request_id: 'r1' },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    const { result } = render('soc', true);
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.failed).toBe(true);
    expect(result.current.sources.teammates).toEqual([]);
    expect(result.current.sources.pages.length).toBeGreaterThan(0);
    expect(result.current.sources.keywords).toHaveLength(3);
  });

  it('has no keywords for a page that tracks none', async () => {
    signIn();
    const { result } = render('', true, '101');
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.sources.keywords).toEqual([]);
  });
});
