import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { domainRowId } from './domain-rows';
import { useExpandedPages, type ExpandedPagesOptions } from './use-expanded-pages';
import { makeQueryClient } from '@/lib/api/query-client';
import type { MetricCell, SourceDomainRow, SourcePagePage, SourcePageRow } from '@/lib/citations/types';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { mswPath, problem } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { server } from '@/test/msw';

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');
const NOW = Date.parse('2026-11-12T12:00:00Z');
const PAGES = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/sources/pages');

const share = (units: number): MetricCell => ({
  value: units / 18420,
  numerator: units,
  denominator: 18420,
  n_observations: 4812,
});

const domainOf = (overrides: Partial<SourceDomainRow> = {}): SourceDomainRow => ({
  registrable_domain: 'g2.com',
  domain_role: 'third_party',
  role_entity_id: null,
  citation_units: 1912,
  observations: 640,
  prompts: 48,
  engines: [],
  source_share: share(1912),
  first_seen_at: '2026-10-20T08:00:00Z',
  last_seen_at: '2026-11-10T08:00:00Z',
  ...overrides,
});

const pageOf = (id: number, overrides: Partial<SourcePageRow> = {}): SourcePageRow => ({
  url_id: id,
  url: `https://g2.com/products/p${String(id)}`,
  title: `Page ${String(id)}`,
  host: 'g2.com',
  registrable_domain: 'g2.com',
  domain_role: 'third_party',
  role_entity_id: null,
  citation_units: 100,
  observations: 50,
  prompts: 5,
  engines: [],
  source_share: share(100),
  first_seen_at: '2026-10-20T08:00:00Z',
  last_seen_at: '2026-11-10T08:00:00Z',
  ...overrides,
});

const pageBody = (rows: readonly SourcePageRow[], total = rows.length): SourcePagePage => ({
  data: [...rows],
  page: { limit: 10, offset: 0, total },
  meta: {
    window: { from: '2026-10-16', to: '2026-11-12', timezone: 'UTC' },
    include_branded: false,
    engine_codes: [],
    answers: 10,
    answers_citing: 10,
    citation_units: 18420,
    by_role: [],
  },
});

const G2 = domainOf();
const HUBSPOT = domainOf({
  registrable_domain: 'hubspot.com',
  domain_role: 'competitor',
  role_entity_id: 'ent-hubspot',
});
const G2_AS_COMPETITOR = domainOf({ domain_role: 'competitor', role_entity_id: 'ent-g2' });

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

const OPTIONS: ExpandedPagesOptions = {
  source: { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: fynix.project_id },
  filters: {
    from: '2026-10-16',
    to: '2026-11-12',
    roles: ['own', 'competitor', 'third_party'],
    engines: ['chatgpt_web'],
  },
  minSupport: 3,
  compare: true,
  open: [],
};

/** Every request to the pages route, as its URL. */
function watch(): URL[] {
  const seen: URL[] = [];
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/sources/pages')) seen.push(url);
  });
  return seen;
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => NOW);
  client = makeQueryClient({ retry: false });
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('admin').user_id}.${String(NOW + 600_000)}; Path=/; Secure`;
  server.use(http.get(PAGES, () => HttpResponse.json(pageBody([pageOf(1), pageOf(2)], 48))));
});
afterEach(() => {
  server.events.removeAllListeners();
  vi.restoreAllMocks();
});

/** Lets a request that was going to start start: a read that never happens is told from one that has not yet. */
const settle = (): Promise<void> => act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));

const hookWith = (
  initial: ExpandedPagesOptions,
): ReturnType<typeof renderHook<ReturnType<typeof useExpandedPages>, ExpandedPagesOptions>> =>
  renderHook((options: ExpandedPagesOptions) => useExpandedPages(options), { wrapper, initialProps: initial });

describe('useExpandedPages', () => {
  it('reads nothing while no domain is open', async () => {
    const seen = watch();
    const { result } = hookWith(OPTIONS);
    await settle();
    expect(result.current.reads.size).toBe(0);
    expect(seen).toHaveLength(0);
  });

  it('reads the top 10 pages of an open domain, of its registrable domain and its role, in the same scope', async () => {
    const seen = watch();
    const { result } = hookWith({ ...OPTIONS, open: [G2] });
    expect(result.current.reads.get(domainRowId(G2))?.status).toBe('loading');
    await waitFor(() => expect(result.current.reads.get(domainRowId(G2))?.status).toBe('ready'));
    expect(result.current.reads.get(domainRowId(G2))?.data?.page.total).toBe(48);
    expect(seen).toHaveLength(1);
    const query = seen[0]?.searchParams;
    expect(query?.get('filter[registrable_domain]')).toBe('g2.com');
    expect(query?.get('filter[domain_role_in]')).toBe('third_party');
    expect(query?.get('filter[engine_code_in]')).toBe('chatgpt_web');
    expect(query?.get('limit')).toBe('10');
    expect(query?.get('min_support')).toBe('3');
    expect(query?.get('compare')).toBe('previous_period');
    expect(query?.get('include')).toBe('series');
    expect(query?.get('from')).toBe('2026-10-16');
  });

  it('keeps the rows of one domain with several roles apart: each is read for its own role', async () => {
    const seen = watch();
    const { result } = hookWith({ ...OPTIONS, open: [G2, G2_AS_COMPETITOR] });
    await waitFor(() => expect(result.current.reads.size).toBe(2));
    await waitFor(() => expect(seen).toHaveLength(2));
    expect(seen.map((url) => url.searchParams.get('filter[domain_role_in]')).sort()).toEqual([
      'competitor',
      'third_party',
    ]);
    expect(domainRowId(G2)).not.toBe(domainRowId(G2_AS_COMPETITOR));
  });

  it('reads only the domain that opens and stops with the one that closes', async () => {
    const seen = watch();
    const { result, rerender } = hookWith({ ...OPTIONS, open: [G2] });
    await waitFor(() => expect(result.current.reads.get(domainRowId(G2))?.status).toBe('ready'));
    rerender({ ...OPTIONS, open: [G2, HUBSPOT] });
    await waitFor(() => expect(result.current.reads.get(domainRowId(HUBSPOT))?.status).toBe('ready'));
    // g2.com is not read again for hubspot.com opening
    expect(seen.map((url) => url.searchParams.get('filter[registrable_domain]'))).toEqual(['g2.com', 'hubspot.com']);
    rerender({ ...OPTIONS, open: [HUBSPOT] });
    expect(result.current.reads.has(domainRowId(G2))).toBe(false);
    rerender({ ...OPTIONS, open: [] });
    expect(result.current.reads.size).toBe(0);
    expect(seen).toHaveLength(2);
  });

  it('says error for a domain whose read failed and reads it again on retry, the others unchanged', async () => {
    let failing = true;
    server.use(
      http.get(PAGES, ({ request }) => {
        const domain = new URL(request.url).searchParams.get('filter[registrable_domain]');
        if (failing && domain === 'g2.com') return problem(request, 'not_found');
        return HttpResponse.json(pageBody([pageOf(1)]));
      }),
    );
    const { result } = hookWith({ ...OPTIONS, open: [G2, HUBSPOT] });
    await waitFor(() => expect(result.current.reads.get(domainRowId(G2))?.status).toBe('error'));
    await waitFor(() => expect(result.current.reads.get(domainRowId(HUBSPOT))?.status).toBe('ready'));
    expect(result.current.reads.get(domainRowId(G2))?.data).toBeUndefined();
    failing = false;
    act(() => result.current.retry(domainRowId(G2)));
    await waitFor(() => expect(result.current.reads.get(domainRowId(G2))?.status).toBe('ready'));
  });

  it('keeps the pages it has while the same read is fetched again', async () => {
    const { result } = hookWith({ ...OPTIONS, open: [G2] });
    await waitFor(() => expect(result.current.reads.get(domainRowId(G2))?.status).toBe('ready'));
    const first = result.current.reads.get(domainRowId(G2))?.data;
    act(() => result.current.retry(domainRowId(G2)));
    expect(result.current.reads.get(domainRowId(G2))?.data).toBe(first);
    expect(result.current.reads.get(domainRowId(G2))?.status).toBe('ready');
  });

  it('reads nothing while it is turned off', async () => {
    const seen = watch();
    const { result } = hookWith({ ...OPTIONS, open: [G2], enabled: false });
    await settle();
    expect(seen).toHaveLength(0);
    expect(result.current.reads.get(domainRowId(G2))?.data).toBeUndefined();
  });
});
