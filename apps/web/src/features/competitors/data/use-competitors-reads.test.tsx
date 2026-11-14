import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useCompetitorsReads, type CompetitorsReadsInput } from './use-competitors-reads';
import { competitorsBody, HUBSPOT_ID, OWN_ID, ZOHO_ID } from '../model/competitors-fixtures';
import { parseScope } from '../scope/scope-model';
import { makeQueryClient } from '@/lib/api/query-client';
import { mswPath } from '@/mocks/respond';
import { server } from '@/test/msw';

const ALL = ['chatgpt_web', 'gemini_web', 'google_ai_mode'] as const;
const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const COMPETITORS = mswPath(`${P}/ai/competitors`);
const SUMMARY = mswPath(`${P}/ai/prompts-summary`);
const SERIES = mswPath(`${P}/ai/metrics/:metric/series`);
const ENTITIES = mswPath(`${P}/entities`);

const inputOf = (search: Record<string, string>, over: Partial<CompetitorsReadsInput> = {}): CompetitorsReadsInput => ({
  project: { workspaceId: 'w1', projectId: 'p1' },
  scope: parseScope(search, ALL),
  range: { from: '2026-10-17', to: '2026-11-13' },
  enabledEngines: ALL,
  enginesReady: true,
  inspect: null,
  ...over,
});

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

/** What the page asks of the server, by route, with the include it carried. */
function watch(): { urls: URL[]; of: (route: 'competitors' | 'summary' | 'series' | 'entities') => URL[] } {
  const urls: URL[] = [];
  server.events.on('request:start', ({ request }) => urls.push(new URL(request.url)));
  const ends: Record<string, string> = {
    competitors: '/ai/competitors',
    summary: '/ai/prompts-summary',
    series: '/series',
    entities: '/entities',
  };
  return { urls, of: (route) => urls.filter((url) => url.pathname.endsWith(ends[route] ?? '')) };
}

beforeEach(() => {
  client = makeQueryClient({ retry: false });
  server.use(
    http.get(COMPETITORS, () => HttpResponse.json(competitorsBody())),
    http.get(SUMMARY, () =>
      HttpResponse.json({ data: { total: { last_observed_at: '2026-11-12T01:00:00Z' } }, meta: {} }),
    ),
    http.get(SERIES, () => HttpResponse.json({ data: [], meta: competitorsBody().meta })),
    http.get(ENTITIES, () => HttpResponse.json({ data: [] })),
  );
});
afterEach(() => {
  server.events.removeAllListeners();
});

describe('useCompetitorsReads', () => {
  it('R1 is one request for the Comparison tab and the inspector', async () => {
    const seen = watch();
    const { result } = renderHook(
      () => useCompetitorsReads(inputOf({}, { inspect: { id: HUBSPOT_ID, tab: 'overview' } })),
      { wrapper },
    );
    await waitFor(() => expect(result.current.competitors.status).toBe('ready'));
    const asked = seen.of('competitors').filter((url) => !url.searchParams.has('include'));
    expect(asked).toHaveLength(1);
    expect(asked[0]?.searchParams.get('compare')).toBe('previous_period');
  });

  it('on the Comparison tab it asks R1, R2 and R3, not the series, and the sources only for the Sources tab', async () => {
    const seen = watch();
    const { result } = renderHook(() => useCompetitorsReads(inputOf({})), { wrapper });
    await waitFor(() => expect(result.current.topics.status).toBe('ready'));
    await waitFor(() => expect(result.current.lost.status).toBe('ready'));
    expect(seen.of('series')).toHaveLength(0);
    expect(seen.of('entities')).toHaveLength(0);
    const includes = seen.of('competitors').map((url) => url.searchParams.get('include'));
    expect(includes).toHaveLength(2);
    expect(includes).toEqual(expect.arrayContaining([null, 'lost_prompts']));
    const lost = seen.of('competitors').find((url) => url.searchParams.get('include') === 'lost_prompts');
    expect(lost?.searchParams.get('filter[engine_code_in]')).toBe('chatgpt_web');
    expect(lost?.searchParams.has('compare')).toBe(false);
    expect(seen.of('summary')[0]?.searchParams.get('rows')).toBe('topics');
    expect(result.current.series.status).toBe('idle');
    expect(result.current.sources.status).toBe('idle');
  });

  it('R2, R3 and R6 are not asked on the AI tab, R4 and the entities are, after R1', async () => {
    const seen = watch();
    const { result } = renderHook(() => useCompetitorsReads(inputOf({ tab: 'ai' })), { wrapper });
    await waitFor(() => expect(result.current.series.status).toBe('ready'));
    expect(seen.of('summary')).toHaveLength(0);
    expect(seen.of('competitors').every((url) => !url.searchParams.has('include'))).toBe(true);
    expect(seen.of('series')).toHaveLength(1);
    expect(seen.of('series')[0]?.searchParams.get('entity_ids')).toBe([OWN_ID, HUBSPOT_ID, ZOHO_ID].sort().join(','));
    expect(seen.of('entities')).toHaveLength(1);
    expect(result.current.lost.status).toBe('idle');
    expect(result.current.topics.status).toBe('idle');
  });

  it('nothing is asked on SEO or Candidates', async () => {
    for (const tab of ['seo', 'candidates']) {
      const seen = watch();
      const { result, unmount } = renderHook(() => useCompetitorsReads(inputOf({ tab })), { wrapper });
      await act(async () => {
        await Promise.resolve();
      });
      expect(seen.urls).toHaveLength(0);
      expect(result.current.competitors.status).toBe('idle');
      unmount();
      server.events.removeAllListeners();
    }
  });

  it('the Sources tab of the inspector asks for the competitor and the own entities with top sources', async () => {
    const seen = watch();
    const { result } = renderHook(
      () => useCompetitorsReads(inputOf({}, { inspect: { id: HUBSPOT_ID, tab: 'sources' } })),
      { wrapper },
    );
    await waitFor(() => expect(result.current.sources.status).toBe('ready'));
    const sources = seen.of('competitors').find((url) => url.searchParams.get('include') === 'top_sources');
    expect(sources?.searchParams.get('entity_ids')).toBe([HUBSPOT_ID, OWN_ID].sort().join(','));
    expect(sources?.searchParams.get('sources_limit')).toBe('5');
  });

  it('nothing is asked before the engines are known, and every read says it is loading', async () => {
    const seen = watch();
    const { result } = renderHook(() => useCompetitorsReads(inputOf({}, { enginesReady: false, enabledEngines: [] })), {
      wrapper,
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(seen.urls).toHaveLength(0);
    expect(result.current.competitors.status).toBe('loading');
    expect(result.current.topics.status).toBe('loading');
  });

  it('a changed scope keeps the old data and reports refetching', async () => {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    server.use(
      http.get(COMPETITORS, async ({ request }) => {
        if (new URL(request.url).searchParams.has('include')) return HttpResponse.json(competitorsBody());
        calls += 1;
        if (calls > 1) await held;
        return HttpResponse.json(competitorsBody());
      }),
    );
    const { result, rerender } = renderHook(({ search }) => useCompetitorsReads(inputOf(search)), {
      wrapper,
      initialProps: { search: {} as Record<string, string> },
    });
    await waitFor(() => expect(result.current.competitors.status).toBe('ready'));
    rerender({ search: { country: 'DE' } });
    await waitFor(() => expect(result.current.competitors.status).toBe('refetching'));
    expect(result.current.competitors.data?.data).toHaveLength(3);
    expect(result.current.competitors.placeholder).toBe(true);
    release();
    await waitFor(() => expect(result.current.competitors.status).toBe('ready'));
    expect(result.current.competitors.placeholder).toBe(false);
  });
});
