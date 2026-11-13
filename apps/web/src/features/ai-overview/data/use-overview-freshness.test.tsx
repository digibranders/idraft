import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useOverviewFreshness, type FreshnessInput } from './use-overview-reads';
import { makeQueryClient } from '@/lib/api/query-client';
import type { EngineCode } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { setAiSeeded } from '@/mocks/ai-seed';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { server } from '@/test/msw';

/** Thursday 12 November 2026, noon UTC. */
const NOW = Date.parse('2026-11-12T12:00:00Z');
const ALL: readonly EngineCode[] = ['chatgpt_web', 'gemini_web', 'google_ai_mode'];
const eventus = MOCK_PROJECTS.find((project) => project.slug === 'eventus-security');
if (eventus === undefined) throw new Error('The fixture project is missing');

const inputOf = (patch: Partial<FreshnessInput> = {}): FreshnessInput => ({
  project: { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: eventus.project_id },
  today: '2026-11-12',
  enabledEngines: ALL,
  ...patch,
});

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
  <QueryClientProvider client={client}>
    <PermissionProvider membership={membershipFactory('admin')}>{children}</PermissionProvider>
  </QueryClientProvider>
);

const listeners: ((info: { request: Request }) => void)[] = [];
function summaryRequests(): URL[] {
  const seen: URL[] = [];
  const listener = ({ request }: { request: Request }): void => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/ai/prompts-summary')) seen.push(url);
  };
  listeners.push(listener);
  server.events.on('request:start', listener);
  return seen;
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => NOW);
  client = makeQueryClient({ retry: false });
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('admin').user_id}.${String(NOW + 600_000)}; Path=/; Secure`;
  setAiSeeded(true);
});
afterEach(() => {
  for (const listener of listeners) server.events.removeListener('request:start', listener);
  listeners.length = 0;
  vi.restoreAllMocks();
  setAiSeeded(false);
});

describe('useOverviewFreshness', () => {
  it('asks the project as a whole: 92 days ending today, every engine and prompt, with no filter of the scope', async () => {
    const seen = summaryRequests();
    const { result } = renderHook(() => useOverviewFreshness(inputOf()), { wrapper });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    const [request] = seen;
    expect(seen).toHaveLength(1);
    expect(request?.searchParams.get('from')).toBe('2026-08-13');
    expect(request?.searchParams.get('to')).toBe('2026-11-12');
    expect(request?.searchParams.get('include_branded')).toBe('true');
    expect(request?.searchParams.get('include')).toBe('total');
    expect(request?.searchParams.get('rows')).toBe('none');
    for (const name of ['filter[engine_code_in]', 'filter[country_iso]', 'filter[term]', 'branded_only']) {
      expect(request?.searchParams.has(name)).toBe(false);
    }
  });

  it('gives the newest answer and the newest valid answer of the project', async () => {
    const { result } = renderHook(() => useOverviewFreshness(inputOf()), { wrapper });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    expect(result.current.data?.lastObservedAt).toMatch(/^2026-11-/);
    expect(result.current.data?.lastValidAt).toMatch(/^2026-11-/);
  });

  it('does not depend on the window of the page: only the day it is asked on', async () => {
    const seen = summaryRequests();
    const { result, rerender } = renderHook((input: FreshnessInput) => useOverviewFreshness(input), {
      wrapper,
      initialProps: inputOf(),
    });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    // A new object of the same project and day is the same read
    rerender(inputOf());
    expect(seen).toHaveLength(1);
  });

  it('is not asked while no engine is on', () => {
    const seen = summaryRequests();
    const { result } = renderHook(() => useOverviewFreshness(inputOf({ enabledEngines: [] })), { wrapper });
    expect(result.current.status).toBe('idle');
    expect(seen).toHaveLength(0);
  });

  it('reports a failed read with its error id and no data, never an empty answer', async () => {
    server.use(
      http.get('*/api/v1/workspaces/:w/projects/:p/ai/prompts-summary', () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Internal error', status: 500, code: 'internal_error', request_id: 'req-9' },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    const { result } = renderHook(() => useOverviewFreshness(inputOf()), { wrapper });
    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });
    expect(result.current.data).toBeUndefined();
    expect(result.current.errorId).toBe('req-9');
  });
});
