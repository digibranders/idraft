import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http } from 'msw';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useChangeCounts,
  useDiversity,
  useLatestCitation,
  usePreviousMeta,
  useScopeMeta,
  type CitationRead,
} from './citation-reads';
import messages from '../../../messages/en.json';
import { makeQueryClient } from '@/lib/api/query-client';
import type { SourceFilters } from '@/lib/citations/source-queries';
import type { SourceDomainPage, SourceScope } from '@/lib/citations/types';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { mswPath, problem } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { server } from '@/test/msw';

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');
const scope: SourceScope = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: fynix.project_id };
const FILTERS: SourceFilters = { from: '2026-10-16', to: '2026-11-12', roles: ['own'] };
/** Thursday 12 November 2026, noon UTC: the Thursday run of 02:00 has answered. */
const NOW = Date.parse('2026-11-12T12:00:00Z');
const DOMAINS = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/sources/domains');

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
  <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  </NextIntlClientProvider>
);

/** The query values of every request the mock server saw, for one route. */
function watch(route: string): URL[] {
  const seen: URL[] = [];
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith(route)) seen.push(url);
  });
  return seen;
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => NOW);
  client = makeQueryClient({ retry: false });
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('admin').user_id}.${String(NOW + 600_000)}; Path=/; Secure`;
});
afterEach(() => {
  server.events.removeAllListeners();
  vi.restoreAllMocks();
});

describe('useScopeMeta', () => {
  it('reads one row of the domains with the blocks the strip needs, whatever the role filter', async () => {
    const seen = watch('/sources/domains');
    const { result } = renderHook(() => useScopeMeta(scope, FILTERS), { wrapper });
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.data?.meta.citation_units).toBeGreaterThan(0);
    expect(result.current.data?.meta.by_role_by_engine).toBeDefined();
    expect(result.current.data?.meta.series).toBeDefined();
    expect(result.current.errorId).toBeNull();
    const query = seen[0]?.searchParams;
    expect(query?.get('limit')).toBe('1');
    expect(query?.get('min_support')).toBe('1');
    expect(query?.get('compare')).toBe('previous_period');
    expect(query?.get('include')).toBe('by_role_by_engine,series');
    expect(query?.has('filter[domain_role_in]')).toBe(false);
  });

  it('says error with an id and reads again on retry', async () => {
    server.use(http.get(DOMAINS, ({ request }) => problem(request, 'not_found')));
    const { result } = renderHook(() => useScopeMeta(scope, FILTERS), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.data).toBeUndefined();
    expect(result.current.errorId?.id).toBeTruthy();
    server.resetHandlers();
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.errorId).toBeNull();
  });

  it('keeps the rows it has while a new window is read', async () => {
    const { result, rerender } = renderHook(({ filters }: { filters: SourceFilters }) => useScopeMeta(scope, filters), {
      wrapper,
      initialProps: { filters: FILTERS },
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const first = result.current.data;
    rerender({ filters: { ...FILTERS, from: '2026-10-17' } });
    expect(result.current.status).toBe('ready');
    expect(result.current.data).toBe(first);
    expect(result.current.retrying).toBe(true);
    await waitFor(() => expect(result.current.retrying).toBe(false));
  });

  it('reads nothing while it is turned off', () => {
    const seen = watch('/sources/domains');
    renderHook(() => useScopeMeta(scope, FILTERS, false), { wrapper });
    expect(seen).toHaveLength(0);
  });
});

/** The scope read and the previous read together, as the page uses them. */
function useBoth(
  filters: SourceFilters,
  compare: boolean,
): { scope: CitationRead<SourceDomainPage>; previous: CitationRead<SourceDomainPage> } {
  const scopeRead = useScopeMeta(scope, filters);
  return { scope: scopeRead, previous: usePreviousMeta(scope, filters, scopeRead.data?.meta, compare) };
}

describe('usePreviousMeta', () => {
  it('reads the same route over the compare window, with no comparison of its own', async () => {
    const seen = watch('/sources/domains');
    const { result } = renderHook(() => useBoth(FILTERS, true), { wrapper });
    await waitFor(() => expect(result.current.previous.data).toBeDefined());
    const window = result.current.scope.data?.meta.compare_window;
    expect(window).toBeDefined();
    const previousQuery = seen.find((url) => url.searchParams.get('from') === window?.from)?.searchParams;
    expect(previousQuery?.get('to')).toBe(window?.to);
    expect(previousQuery?.has('compare')).toBe(false);
    expect(previousQuery?.get('limit')).toBe('1');
    expect(previousQuery?.has('filter[domain_role_in]')).toBe(false);
    expect(result.current.previous.data?.meta.window.from).toBe(window?.from);
  });

  it('drops the data of the previous period when the comparison goes off', async () => {
    const { result, rerender } = renderHook(({ compare }: { compare: boolean }) => useBoth(FILTERS, compare), {
      wrapper,
      initialProps: { compare: true },
    });
    await waitFor(() => expect(result.current.previous.data).toBeDefined());
    rerender({ compare: false });
    expect(result.current.previous.data).toBeUndefined();
    expect(result.current.previous.status).toBe('ready');
    expect(result.current.previous.retrying).toBe(false);
  });

  it('reads nothing for the previous period when the comparison is off', async () => {
    const seen = watch('/sources/domains');
    const { result } = renderHook(() => useBoth(FILTERS, false), { wrapper });
    await waitFor(() => expect(result.current.scope.status).toBe('ready'));
    expect(result.current.previous.data).toBeUndefined();
    expect(result.current.previous.status).toBe('ready');
    expect(seen).toHaveLength(1);
  });

  it('reads nothing when the previous period has no answers', async () => {
    const seen = watch('/sources/domains');
    const quiet = { ...FILTERS, from: '2026-01-01', to: '2026-01-28' };
    const { result } = renderHook(() => useBoth(quiet, true), { wrapper });
    await waitFor(() => expect(result.current.scope.status).toBe('ready'));
    expect(result.current.scope.data?.meta.previous_answers ?? 0).toBe(0);
    expect(result.current.previous.data).toBeUndefined();
    expect(seen).toHaveLength(1);
  });
});

describe('the other reads of the strip', () => {
  it('useDiversity reads the engines and ignores the role filter', async () => {
    const seen = watch('/sources/diversity');
    const { result } = renderHook(() => useDiversity(scope, FILTERS), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.data?.meta.distinct_domains).toBeGreaterThan(0);
    expect(seen[0]?.searchParams.has('filter[domain_role_in]')).toBe(false);
  });

  it('useChangeCounts reads one row of a kind with the minimum, whatever the role filter', async () => {
    const seen = watch('/sources/changes');
    const { result } = renderHook(() => useChangeCounts(scope, FILTERS, { kind: 'lost', minSupport: 3 }), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.data?.meta.kind).toBe('lost');
    expect(typeof result.current.data?.page.total).toBe('number');
    const query = seen[0]?.searchParams;
    expect(query?.get('kind')).toBe('lost');
    expect(query?.get('min_support')).toBe('3');
    expect(query?.get('limit')).toBe('1');
    expect(query?.has('filter[domain_role_in]')).toBe(false);
  });

  it('useLatestCitation reads the newest citation', async () => {
    const seen = watch('/ai/citations');
    const { result } = renderHook(() => useLatestCitation(scope, FILTERS), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.data?.data).toHaveLength(1);
    expect(seen[0]?.searchParams.get('limit')).toBe('1');
    expect(seen[0]?.searchParams.has('filter[domain_role_in]')).toBe(false);
  });
});
