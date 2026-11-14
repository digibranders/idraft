import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSourceReads } from './source-reads';
import messages from '../../../../messages/en.json';
import { makeQueryClient } from '@/lib/api/query-client';
import { citationListQuery, sourcePagesQuery, type SourceFilters } from '@/lib/citations/source-queries';
import type { CitationPage, SourceDomainPage, SourcePagePage, SourceScope } from '@/lib/citations/types';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { server } from '@/test/msw';

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');
const SCOPE: SourceScope = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: fynix.project_id };
const FILTERS: SourceFilters = { from: '2026-10-16', to: '2026-11-12', roles: ['own'] };
/** Thursday 12 November 2026, noon UTC: the Thursday run of 02:00 has answered. */
const NOW = Date.parse('2026-11-12T12:00:00Z');
const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai';
const CITATIONS = mswPath(`${P}/citations`);
const PAGES = mswPath(`${P}/sources/pages`);
const DOMAINS = mswPath(`${P}/sources/domains`);

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
  <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  </NextIntlClientProvider>
);

/** Every request the mock server saw for the routes named, in the order it saw them. */
function watch(...routes: string[]): URL[] {
  const seen: URL[] = [];
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    if (routes.some((route) => url.pathname.endsWith(route))) seen.push(url);
  });
  return seen;
}

function gate(): { opened: Promise<void>; open: () => void } {
  let open = (): void => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

/** Two cited pages of the mock world, so a test names ids that exist. */
async function twoPages(): Promise<[number, number]> {
  const page = await client.fetchQuery(sourcePagesQuery(SCOPE, { from: FILTERS.from, to: FILTERS.to }, { limit: 5 }));
  const [first, second] = page.data;
  if (first === undefined || second === undefined) throw new Error('The mock world has fewer than two cited pages');
  return [first.url_id, second.url_id];
}

const emptyCitations: CitationPage = { data: [], page: { has_more: false, limit: 100, next_cursor: null } };
const emptyPages = (): SourcePagePage => ({
  data: [],
  page: { limit: 200, offset: 0, total: 0 },
  meta: {
    window: { from: FILTERS.from, to: FILTERS.to, timezone: 'UTC' },
    include_branded: false,
    engine_codes: ['chatgpt_web'],
    answers: 0,
    answers_citing: 0,
    citation_units: 0,
    by_role: [],
  },
});
const emptyDomains = (): SourceDomainPage => ({ ...emptyPages(), data: [] });

beforeEach(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => NOW);
  client = makeQueryClient({ retry: false });
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('admin').user_id}.${String(NOW + 600_000)}; Path=/; Secure`;
});
afterEach(() => {
  server.events.removeAllListeners();
  vi.restoreAllMocks();
});

describe('useSourceReads', () => {
  it('reads citations by url_id first and the pages of its domain second', async () => {
    const [urlId] = await twoPages();
    const seen = watch('/ai/citations', '/sources/pages');
    const { result } = renderHook(() => useSourceReads(SCOPE, FILTERS, urlId), { wrapper });
    await waitFor(() => expect(result.current.page.status).toBe('ready'));
    expect(seen.map((url) => url.pathname.split('/ai/')[1])).toEqual(['citations', 'sources/pages']);
    const [citations, pages] = seen;
    expect(citations?.searchParams.get('filter[url_id]')).toBe(String(urlId));
    expect(citations?.searchParams.get('limit')).toBe('100');
    const row = result.current.citations.data?.data[0];
    expect(row?.url_id).toBe(urlId);
    expect(pages?.searchParams.get('filter[registrable_domain]')).toBe(row?.registrable_domain);
    expect(pages?.searchParams.get('include')).toBe('series');
    expect(pages?.searchParams.get('limit')).toBe('200');
    expect(result.current.page.data?.data.some((page) => page.url_id === urlId)).toBe(true);
  });

  it('keeps the second read waiting for the first', async () => {
    const [urlId] = await twoPages();
    const held = gate();
    server.use(
      http.get(CITATIONS, async () => {
        await held.opened;
        return HttpResponse.json(emptyCitations);
      }),
    );
    const seen = watch('/sources/pages');
    const { result } = renderHook(() => useSourceReads(SCOPE, FILTERS, urlId), { wrapper });
    await waitFor(() => expect(result.current.citations.status).toBe('loading'));
    expect(seen).toHaveLength(0);
    held.open();
    await waitFor(() => expect(result.current.citations.status).toBe('ready'));
    // Cited by nothing in scope: there is no domain to read the pages of
    expect(seen).toHaveLength(0);
  });

  it('puts the flags and the country on the pages and the totals, and on the citation list only the country', async () => {
    const [urlId] = await twoPages();
    const citation = await client.fetchQuery(
      citationListQuery(SCOPE, { from: FILTERS.from, to: FILTERS.to }, { limit: 1, urlId }),
    );
    server.use(
      http.get(CITATIONS, () => HttpResponse.json(citation)),
      http.get(PAGES, () => HttpResponse.json(emptyPages())),
      http.get(DOMAINS, () => HttpResponse.json(emptyDomains())),
    );
    const seen = watch('/ai/citations', '/sources/pages', '/sources/domains');
    const filters: SourceFilters = {
      ...FILTERS,
      country: 'DE',
      includeUnresolvedRedirects: true,
      includeEngineInternal: true,
    };
    const { result } = renderHook(() => useSourceReads(SCOPE, filters, urlId), { wrapper });
    await waitFor(() => expect(result.current.totals.status).toBe('ready'));
    await waitFor(() => expect(result.current.page.status).toBe('ready'));
    const byRoute = (route: string): URLSearchParams | undefined =>
      seen.find((url) => url.pathname.endsWith(route))?.searchParams;
    for (const route of ['/sources/pages', '/sources/domains']) {
      const query = byRoute(route);
      expect(query?.get('filter[country_iso]')).toBe('DE');
      expect(query?.get('include_unresolved_redirects')).toBe('true');
      expect(query?.get('include_engine_internal')).toBe('true');
    }
    // The citation list refuses both flags (422), so they never go to it
    const list = byRoute('/ai/citations');
    expect(list?.get('filter[country_iso]')).toBe('DE');
    expect(list?.has('include_unresolved_redirects')).toBe(false);
    expect(list?.has('include_engine_internal')).toBe(false);
  });

  it('never sends the role filter: the inspector is of the whole page', async () => {
    const [urlId] = await twoPages();
    const seen = watch('/ai/citations', '/sources/pages', '/sources/domains');
    const { result } = renderHook(() => useSourceReads(SCOPE, FILTERS, urlId), { wrapper });
    await waitFor(() => expect(result.current.totals.status).toBe('ready'));
    await waitFor(() => expect(result.current.page.status).toBe('ready'));
    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(seen.every((url) => !url.searchParams.has('filter[domain_role_in]'))).toBe(true);
  });

  it('reads a page nothing cites as a 200 with no rows, and asks for no pages', async () => {
    const seen = watch('/sources/pages');
    const { result } = renderHook(() => useSourceReads(SCOPE, FILTERS, 987_654_321), { wrapper });
    await waitFor(() => expect(result.current.citations.status).toBe('ready'));
    expect(result.current.citations.data?.data).toEqual([]);
    expect(result.current.citations.notFound).toBe(false);
    expect(seen).toHaveLength(0);
  });

  it('asks for nothing for an id that is no url_id, and says the source is not there', async () => {
    const seen = watch('/ai/citations', '/sources/pages');
    const { result } = renderHook(() => useSourceReads(SCOPE, FILTERS, null), { wrapper });
    expect(result.current.citations.notFound).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(seen).toHaveLength(0);
  });

  it('never shows the last source while the next one is read', async () => {
    const [first, second] = await twoPages();
    const { result, rerender } = renderHook(({ urlId }) => useSourceReads(SCOPE, FILTERS, urlId), {
      wrapper,
      initialProps: { urlId: first },
    });
    await waitFor(() => expect(result.current.page.status).toBe('ready'));
    expect(result.current.citations.data?.data[0]?.url_id).toBe(first);
    // A key the cache has not seen, held: what is on screen is the loading state, not the first page's rows
    const held = gate();
    server.use(
      http.get(CITATIONS, async () => {
        await held.opened;
        return HttpResponse.json(emptyCitations);
      }),
    );
    rerender({ urlId: second });
    expect(result.current.citations.data).toBeUndefined();
    expect(result.current.citations.status).toBe('loading');
    held.open();
    await waitFor(() => expect(result.current.citations.status).toBe('ready'));
  });

  it('keeps the rows of the same source while another window is read', async () => {
    const [urlId] = await twoPages();
    const { result, rerender } = renderHook(({ filters }) => useSourceReads(SCOPE, filters, urlId), {
      wrapper,
      initialProps: { filters: FILTERS },
    });
    await waitFor(() => expect(result.current.page.status).toBe('ready'));
    const held = gate();
    server.use(
      http.get(CITATIONS, async () => {
        await held.opened;
        return HttpResponse.json(emptyCitations);
      }),
    );
    rerender({ filters: { ...FILTERS, from: '2026-10-20' } });
    expect(result.current.citations.data?.data[0]?.url_id).toBe(urlId);
    expect(result.current.citations.retrying).toBe(true);
    held.open();
    await waitFor(() => expect(result.current.citations.retrying).toBe(false));
  });
});
