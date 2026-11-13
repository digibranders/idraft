import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { topicTrendQuery, useTopicTrend } from './topic-trend-query';
import { NO_TOPIC } from '@/features/prompts/prompt-model';
import { engine, topicRow, week } from '@/features/prompts/topics-by-engine/cells-fixtures';
import type { TopicReadScope } from '@/features/prompts/topics-by-engine/topic-entities-query';
import { makeQueryClient } from '@/lib/api/query-client';
import { mockUser } from '@/mocks/fixtures';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { server } from '@/test/msw';
import { DRAWER_RANGE, DRAWER_TOPIC_ID, drawerExtras, summaryOf } from '@/test/topic-drawer-harness';

const SUMMARY_PATH = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/prompts-summary');
const { scope } = drawerExtras();
const READ: TopicReadScope = { scope, range: DRAWER_RANGE, includeBranded: false, country: null };
const CHILD_ID = '33333333-0000-4000-8000-000000000002';

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  client = makeQueryClient({ retry: false });
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('viewer').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
});

const body = (topics: readonly object[], entities: readonly object[] = []): object => ({
  data: {
    window: { ...DRAWER_RANGE, timezone: 'UTC' },
    include_branded: false,
    engine_codes: ['chatgpt_web'],
    entities,
    entity_config_versions: [1],
    prompts: [],
    topics,
  },
});

describe('the weekly read of the topic drawer (C-15)', () => {
  it('asks rows=topics with include=series,entities and filter[term]', () => {
    expect(topicTrendQuery(READ, DRAWER_TOPIC_ID).queryKey.at(-1)).toEqual({
      from: '2026-10-16',
      to: '2026-11-12',
      include_branded: false,
      rows: 'topics',
      include: ['series', 'entities'],
      'filter[term]': DRAWER_TOPIC_ID,
    });
  });

  it('sends the branded choice and the country of the page', () => {
    const query = topicTrendQuery({ ...READ, includeBranded: true, country: 'DE' }, DRAWER_TOPIC_ID).queryKey.at(-1);
    expect(query).toMatchObject({ include_branded: true, 'filter[country_iso]': 'DE' });
  });

  it('takes the row whose term_id is the key, not the topics below it', async () => {
    const own = { entity_id: 'e1', name: 'Fynix', role: 'own' };
    server.use(
      http.get(SUMMARY_PATH, () =>
        HttpResponse.json(
          body(
            [
              { term_id: CHILD_ID, name: 'Local SEO', prompt_count: 1, engines: [] },
              { term_id: DRAWER_TOPIC_ID, name: 'Technical SEO', prompt_count: 3, engines: [] },
            ],
            [own],
          ),
        ),
      ),
    );
    const { result } = renderHook(() => useTopicTrend(READ, DRAWER_TOPIC_ID, true, undefined), { wrapper });
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.row?.name).toBe('Technical SEO');
    expect(result.current.tracked).toEqual([own]);
  });

  it('reads a body without series as no series, never as a failure', async () => {
    server.use(
      http.get(SUMMARY_PATH, () =>
        HttpResponse.json(
          body([
            {
              term_id: DRAWER_TOPIC_ID,
              name: 'Technical SEO',
              prompt_count: 3,
              engines: [{ engine_code: 'chatgpt_web' }],
            },
          ]),
        ),
      ),
    );
    const { result } = renderHook(() => useTopicTrend(READ, DRAWER_TOPIC_ID, true, undefined), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.row?.engines[0]?.series).toBeUndefined();
  });

  it('says ready with no row when the read holds no row of the topic', async () => {
    server.use(http.get(SUMMARY_PATH, () => HttpResponse.json(body([]))));
    const { result } = renderHook(() => useTopicTrend(READ, DRAWER_TOPIC_ID, true, undefined), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.row).toBeUndefined();
  });

  it('takes the row of the prompts without a topic from the page summary and never reads', async () => {
    let calls = 0;
    server.use(
      http.get(SUMMARY_PATH, () => {
        calls += 1;
        return HttpResponse.json(body([]));
      }),
    );
    const row = topicRow(null, null, 2, [engine('chatgpt_web', { series: [week('2026-10-26')] })]);
    const page = summaryOf([row], [{ entity_id: 'e1', name: 'Fynix', role: 'own' }]);
    const { result } = renderHook(() => useTopicTrend(READ, NO_TOPIC, true, page), { wrapper });
    expect(result.current.status).toBe('ready');
    expect(result.current.row).toBe(row);
    expect(result.current.tracked).toEqual(page.entities);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls).toBe(0);
  });

  it('says loading for the prompts without a topic until the page summary is there', () => {
    const { result } = renderHook(() => useTopicTrend(READ, NO_TOPIC, true, undefined), { wrapper });
    expect(result.current.status).toBe('loading');
  });

  it('asks nothing while it is not enabled', async () => {
    let calls = 0;
    server.use(
      http.get(SUMMARY_PATH, () => {
        calls += 1;
        return HttpResponse.json(body([]));
      }),
    );
    const { result } = renderHook(() => useTopicTrend(READ, DRAWER_TOPIC_ID, false, undefined), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls).toBe(0);
    expect(result.current.status).toBe('loading');
  });

  it('says failed when the read fails, and reads again on retry', async () => {
    let fail = true;
    server.use(
      http.get(SUMMARY_PATH, () =>
        fail
          ? HttpResponse.json({ status: 500, code: 'internal_error', title: 'x' }, { status: 500 })
          : HttpResponse.json(
              body([{ term_id: DRAWER_TOPIC_ID, name: 'Technical SEO', prompt_count: 3, engines: [] }]),
            ),
      ),
    );
    const { result } = renderHook(() => useTopicTrend(READ, DRAWER_TOPIC_ID, true, undefined), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('failed'));
    fail = false;
    result.current.retry();
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });
});
