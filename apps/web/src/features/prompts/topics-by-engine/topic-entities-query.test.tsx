import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { topicEntitiesQuery, useTopicEntities, type TopicReadScope } from './topic-entities-query';
import { NO_TOPIC } from '@/features/prompts/prompt-model';
import { makeQueryClient } from '@/lib/api/query-client';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { server } from '@/test/msw';

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');
const SUMMARY_PATH = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/prompts-summary');
const READ: TopicReadScope = {
  scope: { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: fynix.project_id },
  range: { from: '2026-10-16', to: '2026-11-12' },
  includeBranded: false,
  country: null,
};

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  client = makeQueryClient({ retry: false });
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('viewer').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
});

const body = (names: readonly (string | null)[], entities: readonly object[] = []): object => ({
  data: {
    window: { from: '2026-10-16', to: '2026-11-12', timezone: 'UTC' },
    include_branded: false,
    engine_codes: ['chatgpt_web'],
    entities,
    entity_config_versions: [1],
    prompts: [],
    topics: names.map((name, index) => ({
      term_id: name === null ? null : `33333333-0000-4000-8000-00000000000${String(index)}`,
      name,
      prompt_count: 2,
      engines: [],
    })),
  },
});

describe('the entities read of the Topics tab', () => {
  it('asks for topic rows with entities and nothing else', () => {
    const query = topicEntitiesQuery(READ).queryKey.at(-1);
    expect(query).toEqual({
      from: '2026-10-16',
      to: '2026-11-12',
      include_branded: false,
      rows: 'topics',
      include: ['entities'],
    });
  });

  it('sends the window, the branded choice and the country', () => {
    const query = topicEntitiesQuery({
      ...READ,
      range: { from: '2026-08-15', to: '2026-11-12' },
      includeBranded: true,
      country: 'DE',
    }).queryKey.at(-1);
    expect(query).toEqual({
      from: '2026-08-15',
      to: '2026-11-12',
      include_branded: true,
      'filter[country_iso]': 'DE',
      rows: 'topics',
      include: ['entities'],
    });
  });

  it('reads the rows by topic, the prompts without a topic under their own key, with the tracked entities', async () => {
    const own = { entity_id: 'e1', name: 'Fynix', role: 'own' };
    server.use(http.get(SUMMARY_PATH, () => HttpResponse.json(body(['Technical SEO', null], [own]))));
    const { result } = renderHook(() => useTopicEntities(READ, true), { wrapper });
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect([...result.current.rows.keys()]).toEqual(['33333333-0000-4000-8000-000000000000', NO_TOPIC]);
    expect(result.current.tracked).toEqual([own]);
  });

  it('reads a body with no entity blocks as no entities, never as a failure', async () => {
    // A body that carries neither the `entities` list nor the `engines` of a row, as an older API sends it
    const bare = {
      data: {
        window: { from: '2026-10-16', to: '2026-11-12', timezone: 'UTC' },
        include_branded: false,
        engine_codes: ['chatgpt_web'],
        prompts: [],
        topics: [{ term_id: '33333333-0000-4000-8000-000000000001', name: 'Technical SEO', prompt_count: 2 }],
      },
    };
    server.use(http.get(SUMMARY_PATH, () => HttpResponse.json(bare)));
    const { result } = renderHook(() => useTopicEntities(READ, true), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    // Without the fallback of the hook `tracked` would be undefined here, which no list reads as empty
    expect(result.current.tracked).toEqual([]);
    expect(result.current.rows.size).toBe(1);
  });

  it('asks nothing while it is not enabled', async () => {
    let calls = 0;
    server.use(
      http.get(SUMMARY_PATH, () => {
        calls += 1;
        return HttpResponse.json(body([]));
      }),
    );
    const { result } = renderHook(() => useTopicEntities(READ, false), { wrapper });
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
          : HttpResponse.json(body(['A'])),
      ),
    );
    const { result } = renderHook(() => useTopicEntities(READ, true), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('failed'));
    fail = false;
    result.current.retry();
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  it('keeps the rows when a refetch fails, and says failed only when no rows are held', async () => {
    let fail = false;
    server.use(
      http.get(SUMMARY_PATH, () =>
        fail
          ? HttpResponse.json({ status: 500, code: 'internal_error', title: 'x' }, { status: 500 })
          : HttpResponse.json(body(['First'])),
      ),
    );
    const { result } = renderHook(() => useTopicEntities(READ, true), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    fail = true;
    void client.invalidateQueries();
    await waitFor(() => expect(result.current.error).not.toBeNull());
    // The rows of the last good read stay, so the table does not turn into an error
    expect(result.current.status).toBe('ready');
    expect([...result.current.rows.values()].map((row) => row.name)).toEqual(['First']);
  });

  it('keeps the last rows while the next window is read', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(SUMMARY_PATH, async ({ request }) => {
        const from = new URL(request.url).searchParams.get('from');
        if (from !== READ.range.from) await gate;
        return HttpResponse.json(body(from === READ.range.from ? ['First'] : ['Second']));
      }),
    );
    const { result, rerender } = renderHook(({ read }) => useTopicEntities(read, true), {
      wrapper,
      initialProps: { read: READ },
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect([...result.current.rows.values()].map((row) => row.name)).toEqual(['First']);
    rerender({ read: { ...READ, range: { from: '2026-08-15', to: '2026-11-12' } } });
    await waitFor(() => expect(result.current.fetching).toBe(true));
    // The previous rows stay, and the hook says it is reading
    expect(result.current.status).toBe('ready');
    expect([...result.current.rows.values()].map((row) => row.name)).toEqual(['First']);
    release();
    await waitFor(() => expect([...result.current.rows.values()].map((row) => row.name)).toEqual(['Second']));
    expect(result.current.fetching).toBe(false);
  });
});
