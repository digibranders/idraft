import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { usePageAi } from './page-ai';
import { makeQueryClient } from '@/lib/api/query-client';
import { pageAiQuery, UrlIdError } from '@/lib/internal-links/queries';
import type { LinksScope } from '@/lib/internal-links/types';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { AI_CITED_PAGE } from '@/mocks/internal-links-page-ai';
import { SESSION_COOKIE } from '@/mocks/session';
import { server } from '@/test/msw';

const EVENTUS = MOCK_PROJECTS.find((project) => project.slug === 'eventus-security');
if (EVENTUS === undefined) throw new Error('No fixture project eventus-security');
const SCOPE: LinksScope = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: EVENTUS.project_id };

function signIn(): void {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('owner').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
}

function providers(): ({ children }: { children: ReactNode }) => ReactNode {
  const client = makeQueryClient({ retry: false, onSignedOut: () => false });
  return function Providers({ children }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('usePageAi', () => {
  it('loads, then gives the page AI data with compare=previous_period', async () => {
    signIn();
    const options = pageAiQuery(SCOPE, AI_CITED_PAGE, null);
    expect(options.queryKey).toContain('ai');

    const { result } = renderHook(() => usePageAi(SCOPE, null, AI_CITED_PAGE), { wrapper: providers() });
    expect(result.current).toEqual({ state: 'loading' });
    await waitFor(() => {
      expect(result.current.state).toBe('ready');
    });
    if (result.current.state !== 'ready') throw new Error('not ready');
    expect(result.current.data.state).toBe('ready');
    expect(result.current.data.compare_window).not.toBeNull();
    expect(result.current.data.trend).toHaveLength(28);
  });

  it('gives an error with a retry that asks again', async () => {
    signIn();
    let failing = true;
    server.use(
      http.get('*/api/v1/workspaces/:w/projects/:p/internal-links/pages/:id/ai', () =>
        failing
          ? HttpResponse.json(
              { type: 'about:blank', title: 'Server error', status: 500, code: 'internal_error', request_id: 'r1' },
              { status: 500, headers: { 'content-type': 'application/problem+json' } },
            )
          : undefined,
      ),
    );
    const { result } = renderHook(() => usePageAi(SCOPE, null, AI_CITED_PAGE), { wrapper: providers() });
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

  it('throws UrlIdError for a non-id url id', () => {
    expect(() => pageAiQuery(SCOPE, 'abc', null)).toThrow(UrlIdError);
  });
});
