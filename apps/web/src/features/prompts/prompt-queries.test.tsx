import { QueryClient, QueryClientProvider, useMutation, useQuery } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  aiKey,
  ARCHIVE_PROMPT,
  BULK_CREATE_PROMPTS,
  enginesKey,
  enginesQuery,
  projectEntitiesQuery,
  PUT_ENGINE,
  promptQuery,
  promptsKey,
  refreshPrompts,
  UPDATE_PROMPT,
  usePromptLint,
  usePromptList,
  type PromptScope,
} from './prompt-queries';
import { projectKey } from '@/lib/api/keys';
import { makeQueryClient } from '@/lib/api/query-client';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { FIXTURE_PROMPTS } from '@/mocks/prompt-fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { server } from '@/test/msw';

const [fynix, cleanstart] = MOCK_PROJECTS;
if (fynix === undefined || cleanstart === undefined) throw new Error('The fixture projects are missing');
const scope: PromptScope = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: fynix.project_id };
const other: PromptScope = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: cleanstart.project_id };
const PROJECT = '*/api/v1/workspaces/:w/projects/:p';
const PAGE_ONE = '11111111-1111-4111-8111-111111111111';
const PAGE_TWO = '22222222-2222-4222-8222-222222222222';
const LINTED = { data: [], quota: { limit: 150, used: 24 } };

/** A prompt as the API sends it, for a page a test makes up. */
const promptRow = (): Record<string, unknown> => ({
  prompt_id: PAGE_ONE,
  current_version: { version_no: 1, change_kind: 'initial', text: 'Which agency?', created_at: '2026-11-01T00:00:00Z' },
  country_iso: 'DE',
  language_code: 'en',
  is_branded: false,
  is_active: true,
  intent: 'unknown',
  funnel_stage: 'unknown',
  prompt_type: 'question',
  importance: 3,
  source: 'human',
  creation_method: 'human',
  created_by: null,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  terms: [],
});

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  client = makeQueryClient({ retry: false });
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('admin').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
});

describe('the keys of the AI prompt queries', () => {
  it('put each read under the prefix its refresh invalidates', () => {
    expect(promptQuery(scope, 'x').queryKey.slice(0, 5)).toEqual(promptsKey(scope));
    expect(enginesQuery(scope).queryKey.slice(0, 5)).toEqual(enginesKey(scope));
  });

  it('keep the entities of the project out of the prefixes a prompt change refreshes', () => {
    const key = projectEntitiesQuery(scope).queryKey;
    for (const prefix of [promptsKey(scope), aiKey(scope), enginesKey(scope)]) {
      expect(key.slice(0, prefix.length)).not.toEqual(prefix);
    }
  });

  it('mark the prompts, the answers and the engines of the project stale after a change, and nothing else', async () => {
    const own = projectKey(scope.workspaceId, scope.projectId);
    const foreign = projectKey(other.workspaceId, other.projectId);
    for (const key of [
      [...own, 'prompts', 'all'],
      [...own, 'ai', 'prompts-summary', {}],
      [...own, 'engines', {}],
      [...own, 'runs', 'list'],
      [...foreign, 'prompts', 'all'],
    ]) {
      client.setQueryData(key, 1);
    }
    await refreshPrompts(client, scope);
    const stale = (key: readonly unknown[]): boolean | undefined => client.getQueryState(key)?.isInvalidated;
    expect(stale([...own, 'prompts', 'all'])).toBe(true);
    expect(stale([...own, 'ai', 'prompts-summary', {}])).toBe(true);
    expect(stale([...own, 'engines', {}])).toBe(true);
    // Runs are read again by what started one (Run now), not by every prompt change
    expect(stale([...own, 'runs', 'list'])).toBe(false);
    expect(stale([...foreign, 'prompts', 'all'])).toBe(false);
  });
});

describe('the engines of the project', () => {
  it('lists all three and turns one on with its countries', async () => {
    const engines = renderHook(() => useQuery(enginesQuery(other)), { wrapper });
    await waitFor(() => expect(engines.result.current.data).toBeDefined());
    expect(engines.result.current.data?.data.map((row) => [row.engine.engine_code, row.is_enabled])).toEqual([
      ['chatgpt_web', false],
      ['gemini_web', false],
      ['google_ai_mode', false],
    ]);

    const put = renderHook(() => useMutation(PUT_ENGINE), { wrapper });
    const answer = await put.result.current.mutateAsync({
      params: { path: { workspace_id: other.workspaceId, project_id: other.projectId, engine_code: 'chatgpt_web' } },
      body: { is_enabled: true, location_ids: [2840] },
    });
    expect(answer.data).toMatchObject({ is_enabled: true, location_ids: [2840] });
  });
});

describe('usePromptList', () => {
  it('reads every active prompt of the project', async () => {
    const { result } = renderHook(() => usePromptList(scope), { wrapper });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    const active = (FIXTURE_PROMPTS.get(fynix.project_id) ?? []).filter((prompt) => prompt.is_active);
    expect(result.current.rows).toHaveLength(active.length);
  });

  it('asks for the next page until the API says there is none', async () => {
    const cursors: (string | null)[] = [];
    server.use(
      http.get(`${PROJECT}/prompts`, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
        cursors.push(cursor);
        return HttpResponse.json({
          data: [{ ...promptRow(), prompt_id: cursor === null ? PAGE_ONE : PAGE_TWO }],
          page: { limit: 200, next_cursor: cursor === null ? 'next' : null, has_more: cursor === null },
        });
      }),
    );
    const { result } = renderHook(() => usePromptList(scope), { wrapper });
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    expect(result.current.rows.map((row) => row.prompt_id)).toEqual([PAGE_ONE, PAGE_TWO]);
    expect(cursors).toEqual([null, 'next']);
  });
});

describe('usePromptLint', () => {
  it('sends the texts and the enabled engines, so the limits checked are those the project runs', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(`${PROJECT}/prompts/lint`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(LINTED);
      }),
    );
    const { result } = renderHook(() => usePromptLint(scope, ['Which agency?'], ['google_ai_mode', 'chatgpt_web']), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(bodies).toEqual([{ texts: ['Which agency?'], engine_codes: ['google_ai_mode', 'chatgpt_web'] }]);
  });

  it('leaves engine_codes out when no engine is on, and asks nothing for an empty list', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(`${PROJECT}/prompts/lint`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(LINTED);
      }),
    );
    const empty = renderHook(() => usePromptLint(scope, [], []), { wrapper });
    const some = renderHook(() => usePromptLint(scope, ['Which agency?'], []), { wrapper });
    await waitFor(() => expect(some.result.current.isSuccess).toBe(true));
    expect(empty.result.current.fetchStatus).toBe('idle');
    expect(bodies).toEqual([{ texts: ['Which agency?'] }]);
  });
});

describe('the writes', () => {
  it('create prompts in bulk, archive one and bring it back', async () => {
    const bulk = renderHook(() => useMutation(BULK_CREATE_PROMPTS), { wrapper });
    const created = await bulk.result.current.mutateAsync({
      params: { path: { workspace_id: scope.workspaceId, project_id: scope.projectId } },
      body: {
        items: [
          {
            text: 'Which CRM suits a small team?',
            language_code: 'en',
            country_iso: 'DE',
            intent: 'unknown',
            funnel_stage: 'unknown',
            prompt_type: 'question',
            importance: 3,
          },
        ],
        on_duplicate: 'skip',
      },
    });
    expect(created.data.created).toHaveLength(1);
    const [promptId = ''] = created.data.created;
    const path = { workspace_id: scope.workspaceId, project_id: scope.projectId, prompt_id: promptId };

    const archive = renderHook(() => useMutation(ARCHIVE_PROMPT), { wrapper });
    await archive.result.current.mutateAsync({ params: { path } });
    const archived = renderHook(() => useQuery(promptQuery(scope, promptId)), { wrapper });
    await waitFor(() => expect(archived.result.current.data?.data.is_active).toBe(false));

    const update = renderHook(() => useMutation(UPDATE_PROMPT), { wrapper });
    const back = await update.result.current.mutateAsync({ params: { path }, body: { is_active: true } });
    expect(back.data.is_active).toBe(true);
  });
});
