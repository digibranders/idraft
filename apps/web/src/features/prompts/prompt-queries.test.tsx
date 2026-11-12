import { QueryClient, QueryClientProvider, useMutation, useQuery } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  aiKey,
  ARCHIVE_PROMPT,
  bulkArchive,
  BULK_CREATE_PROMPTS,
  bulkRun,
  enginesKey,
  enginesQuery,
  MAX_PROMPTS,
  isObservationId,
  observationQuery,
  observationsQuery,
  projectEntitiesQuery,
  PUT_ENGINE,
  promptQuery,
  promptsKey,
  fetchRawAnswer,
  refreshPrompts,
  RUN_NOW,
  summaryQuery,
  UPDATE_PROMPT,
  usePromptLint,
  usePromptList,
  type PromptScope,
} from './prompt-queries';
import { windowRange } from './prompt-model';
import { projectKey } from '@/lib/api/keys';
import { ApiProblem } from '@/lib/api/problem';
import { makeQueryClient } from '@/lib/api/query-client';
import type { EngineCode } from '@/lib/api/types';
import { MOCK_TERM_IDS } from '@/mocks/entity-fixtures';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { FIXTURE_PROMPTS, PROMPT_QUOTA } from '@/mocks/prompt-fixtures';
import { activePromptCount, AI_ANSWER_QUOTA, promptsOf, setProviderPaused } from '@/mocks/prompts-state';
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
const RANGE = { from: '2026-10-16', to: '2026-11-12' };
const DAY_MS = 86_400_000;
/** 2^60 as the API would send it: a number no double holds exactly. */
const TWO_TO_60 = '1152921504606846976';

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
    expect(summaryQuery(scope, RANGE, false).queryKey.slice(0, 5)).toEqual(aiKey(scope));
    expect(observationsQuery(scope, 'x', RANGE).queryKey.slice(0, 5)).toEqual(aiKey(scope));
    expect(observationQuery(scope, '1234567').queryKey.slice(0, 5)).toEqual(aiKey(scope));
  });

  it('tell two windows, the branded prompts and an answer with its hint apart', () => {
    const wider = { from: '2026-08-15', to: '2026-11-12' };
    expect(summaryQuery(scope, RANGE, false).queryKey).not.toEqual(summaryQuery(scope, wider, false).queryKey);
    expect(summaryQuery(scope, RANGE, false).queryKey).not.toEqual(summaryQuery(scope, RANGE, true).queryKey);
    expect(observationQuery(scope, '1234567').queryKey).not.toEqual(
      observationQuery(scope, '1234567', '2026-11-09T02:00:00Z').queryKey,
    );
  });

  it('keep the key of a summary without a scope as it was, and tell each scope apart', () => {
    const plain = summaryQuery(scope, RANGE, false).queryKey;
    expect(plain.at(-1)).toEqual({ from: RANGE.from, to: RANGE.to, include_branded: false });
    expect(summaryQuery(scope, RANGE, false, {}).queryKey).toEqual(plain);
    expect(summaryQuery(scope, RANGE, false, { brandedOnly: false }).queryKey).toEqual(plain);
    const scoped = [{ country: 'DE' }, { country: 'IN' }, { term: 'seo' }, { brandedOnly: true }].map(
      (filters) => summaryQuery(scope, RANGE, false, filters).queryKey,
    );
    expect(new Set([plain, ...scoped].map((key) => JSON.stringify(key))).size).toBe(5);
  });

  it('send include=entities when a summary asks for the entity cells, and keep the key of one that does not', () => {
    const plain = summaryQuery(scope, RANGE, false).queryKey;
    const asked = summaryQuery(scope, RANGE, false, { include: ['entities'] }).queryKey;
    expect(asked.slice(0, 5)).toEqual(aiKey(scope));
    expect(asked.at(-1)).toEqual({ from: RANGE.from, to: RANGE.to, include_branded: false, include: ['entities'] });
    expect(asked).not.toEqual(plain);
    // Nothing asked for is nothing sent, so the key of an existing caller is the same
    expect(summaryQuery(scope, RANGE, false, { include: [] }).queryKey).toEqual(plain);
  });

  it('keep the entities of the project out of the prefixes a prompt change refreshes', () => {
    const key = projectEntitiesQuery(scope).queryKey;
    for (const prefix of [promptsKey(scope), aiKey(scope), enginesKey(scope)]) {
      expect(key.slice(0, prefix.length)).not.toEqual(prefix);
    }
  });

  it('mark every answer of the project stale after a run was asked, the list and each one opened', async () => {
    const list = [...observationsQuery(scope, 'x', RANGE).queryKey];
    const one = [...observationQuery(scope, '1234567', '2026-11-09T02:00:00Z').queryKey];
    const summary = [...summaryQuery(scope, RANGE, false).queryKey];
    for (const key of [list, one, summary]) client.setQueryData(key, 1);
    await refreshPrompts(client, scope);
    for (const key of [list, one, summary]) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
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
  it('stops reading pages at MAX_PROMPTS, whatever the API says', async () => {
    let asked = 0;
    server.use(
      http.get(`${PROJECT}/prompts`, ({ request }) => {
        asked += 1;
        const limit = Number(new URL(request.url).searchParams.get('limit'));
        return HttpResponse.json({
          data: Array.from({ length: limit }, () => promptRow()),
          page: { limit, next_cursor: 'more', has_more: true },
        });
      }),
    );
    const { result } = renderHook(() => usePromptList(scope), { wrapper });
    await waitFor(() => expect(result.current.rows).toHaveLength(MAX_PROMPTS));
    // Give a read that should not happen the time to start
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(result.current.rows).toHaveLength(MAX_PROMPTS);
    expect(asked).toBe(MAX_PROMPTS / 200);
  });

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

  it('says more pages are to come until the last one is in, and after a failed page too', async () => {
    let failing = true;
    server.use(
      http.get(`${PROJECT}/prompts`, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
        if (cursor !== null && failing) return HttpResponse.json({ code: 'boom' }, { status: 500 });
        return HttpResponse.json({
          data: [{ ...promptRow(), prompt_id: cursor === null ? PAGE_ONE : PAGE_TWO }],
          page: { limit: 200, next_cursor: cursor === null ? 'next' : null, has_more: cursor === null },
        });
      }),
    );
    const { result } = renderHook(() => usePromptList(scope), { wrapper });
    // The first page is in and the second failed: the list is not whole
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.hasMore).toBe(true);
    failing = false;
    result.current.refetch();
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    expect(result.current.hasMore).toBe(false);
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

/** What a refused request rejects with: the problem the screens read. */
async function refusal(request: Promise<unknown>): Promise<ApiProblem> {
  try {
    await request;
  } catch (error) {
    if (error instanceof ApiProblem) return error;
    throw error;
  }
  throw new Error('The request was accepted');
}

const fixturePrompts = FIXTURE_PROMPTS.get(fynix.project_id) ?? [];
const asked = fixturePrompts.filter((prompt) => prompt.is_active && prompt.index !== null);
const [firstPrompt] = asked;
if (firstPrompt === undefined) throw new Error('The fixture project has no prompt with answers');
/** The last 28 days in the time zone of the project, as the Topics page asks. */
const lastMonth = (): { from: string; to: string } => windowRange(28, new Date(), fynix.timezone);

describe('the summary', () => {
  it('reads the window it was asked for in the time zone of the project', async () => {
    const range = lastMonth();
    const summary = await client.fetchQuery(summaryQuery(scope, range, false));
    expect(summary.data.window).toEqual({ ...range, timezone: fynix.timezone });
    expect(summary.data.include_branded).toBe(false);
    expect(summary.data.prompts.length).toBeGreaterThan(0);
  });

  it('leaves the branded prompts out unless they are asked for', async () => {
    const range = lastMonth();
    const without = await client.fetchQuery(summaryQuery(scope, range, false));
    const withBranded = await client.fetchQuery(summaryQuery(scope, range, true));
    expect(withBranded.data.include_branded).toBe(true);
    expect(withBranded.data.prompts.length).toBeGreaterThan(without.data.prompts.length);
  });

  it('sends the country, the term and the branded prompts alone, and reads the rows they leave', async () => {
    const range = lastMonth();
    const india = await client.fetchQuery(summaryQuery(scope, range, false, { country: 'IN' }));
    expect(india.data.prompts).toHaveLength(1);
    const technical = await client.fetchQuery(summaryQuery(scope, range, false, { term: MOCK_TERM_IDS.technicalSeo }));
    expect(technical.data.topics.map((topic) => topic.term_id)).toEqual([MOCK_TERM_IDS.technicalSeo]);
    const brandedOnly = await client.fetchQuery(summaryQuery(scope, range, false, { brandedOnly: true }));
    expect(brandedOnly.data).toMatchObject({ include_branded: true, branded_only: true });
    expect(brandedOnly.data.prompts.map((row) => row.is_branded)).toEqual([true]);
  });

  it('reads a cell per tracked entity on every engine when include=entities is asked, and none otherwise', async () => {
    const range = lastMonth();
    const plain = await client.fetchQuery(summaryQuery(scope, range, false));
    const asked = await client.fetchQuery(summaryQuery(scope, range, false, { include: ['entities'] }));
    const engines = (rows: typeof asked.data.prompts): (typeof asked.data.prompts)[number]['engines'] =>
      rows.flatMap((row) => row.engines);
    expect(engines(plain.data.prompts).every((engine) => engine.entities === undefined)).toBe(true);
    expect(asked.data.entities.length).toBeGreaterThan(1);
    for (const engine of [...engines(asked.data.prompts), ...asked.data.topics.flatMap((row) => row.engines)]) {
      expect(engine.entities).toHaveLength(asked.data.entities.length);
    }
  });

  it('gives each prompt and topic the times of its newest answer and its newest valid answer', async () => {
    const summary = await client.fetchQuery(summaryQuery(scope, lastMonth(), false));
    expect(summary.data.branded_only).toBe(false);
    for (const row of [...summary.data.prompts, ...summary.data.topics]) {
      expect(typeof row.last_observed_at).toBe('string');
      expect(typeof row.last_valid_at).toBe('string');
    }
  });

  it('weighs a topic by its prompts and keeps the counts of one prompt', async () => {
    const summary = await client.fetchQuery(summaryQuery(scope, lastMonth(), false));
    const topicCell = summary.data.topics
      .flatMap((topic) => topic.engines)
      .find((engine) => engine.mentioned.value !== null);
    const promptCell = summary.data.prompts
      .flatMap((row) => row.engines)
      .find((engine) => engine.mentioned.value !== null);
    expect(topicCell?.mentioned.pooled).toEqual({ successes: expect.any(Number), trials: expect.any(Number) });
    expect(promptCell?.mentioned.pooled ?? null).toBeNull();
  });

  it('rejects a window of more than 92 days as a problem with its code, not as a field error', async () => {
    const from = new Date(Date.now() - 100 * DAY_MS).toISOString().slice(0, 10);
    const problem = await refusal(client.fetchQuery(summaryQuery(scope, { from, to: lastMonth().to }, false)));
    expect([problem.status, problem.code, problem.errors]).toEqual([422, 'window_too_large', []]);
  });
});

describe('the answers of a prompt', () => {
  it('are those of the prompt, newest first, with their ids as text', async () => {
    const answers = await client.fetchQuery(observationsQuery(scope, firstPrompt.prompt_id, lastMonth()));
    expect(answers.data.length).toBeGreaterThan(0);
    expect(new Set(answers.data.map((row) => row.subject.prompt_id))).toEqual(new Set([firstPrompt.prompt_id]));
    const times = answers.data.map((row) => Date.parse(row.observed_at));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(typeof answers.data[0]?.observation_id).toBe('string');
  });

  it('are read in one page of the most the API gives, 200, since scheduled answers and manual runs both land here', async () => {
    let limit: string | null = null;
    server.use(
      http.get(`${PROJECT}/ai/observations`, ({ request }) => {
        limit = new URL(request.url).searchParams.get('limit');
        return HttpResponse.json({ data: [], page: { limit: 200, next_cursor: null, has_more: false } });
      }),
    );
    await client.fetchQuery(observationsQuery(scope, firstPrompt.prompt_id, lastMonth()));
    expect(limit).toBe('200');
  });

  it('open one by its id, with the hint of the month when the list gave it', async () => {
    const [row] = (await client.fetchQuery(observationsQuery(scope, firstPrompt.prompt_id, lastMonth()))).data;
    if (row === undefined) throw new Error('The prompt has no answer');
    const plain = await client.fetchQuery(observationQuery(scope, row.observation_id));
    const hinted = await client.fetchQuery(observationQuery(scope, row.observation_id, row.observed_at));
    expect(plain.data.observation_id).toBe(row.observation_id);
    expect(hinted.data.observation_id).toBe(row.observation_id);
    expect(hinted.data.offsets_unit).toBe('utf16');
  });

  it('send the hint, so an answer far from it is not found', async () => {
    const [row] = (await client.fetchQuery(observationsQuery(scope, firstPrompt.prompt_id, lastMonth()))).data;
    if (row === undefined) throw new Error('The prompt has no answer');
    const problem = await refusal(
      client.fetchQuery(observationQuery(scope, row.observation_id, '2020-01-01T00:00:00Z')),
    );
    expect(problem.code).toBe('not_found');
  });

  it('know an id a path number holds exactly', () => {
    expect(['20400001', '9007199254740991'].map(isObservationId)).toEqual([true, true]);
    expect(['', 'abc', '0', '-5', '1.5', '007', '9007199254740993', TWO_TO_60].map(isObservationId)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it('are not found, with no request, for an id that is no number or that a path number would change', async () => {
    let asked = 0;
    server.use(
      http.get(`${PROJECT}/ai/observations/:id`, () => {
        asked += 1;
        return HttpResponse.json({});
      }),
    );
    for (const id of ['abc', TWO_TO_60, '9223372036854775807']) {
      const problem = await refusal(client.fetchQuery(observationQuery(scope, id)));
      expect([problem.status, problem.code]).toEqual([404, 'not_found']);
    }
    expect(asked).toBe(0);
  });
});

describe('the raw answer', () => {
  it('asks for the file with the hint of the month, and rejects an id that is no answer without asking', async () => {
    const hint = '2026-11-09T02:00:00+00:00';
    let received: string | null = null;
    server.use(
      http.get(`${PROJECT}/ai/observations/:id/raw`, ({ request }) => {
        received = new URL(request.url).searchParams.get('observed_at');
        return HttpResponse.json({ tasks: [] });
      }),
    );
    expect(await fetchRawAnswer(scope, '20400001', hint).then((file) => file.size)).toBeGreaterThan(0);
    expect(received).toBe(hint);
    await expect(fetchRawAnswer(scope, 'abc')).rejects.toMatchObject({ status: 404, code: 'not_found' });
  });
});

describe('RUN_NOW', () => {
  const asking = (promptId: string, engines: EngineCode[]) => ({
    params: { path: { workspace_id: scope.workspaceId, project_id: scope.projectId, prompt_id: promptId } },
    body: { engine_codes: engines },
  });

  it('answers 202 with the planned run of the prompts workload', async () => {
    const { result } = renderHook(() => useMutation(RUN_NOW), { wrapper });
    const answer = await result.current.mutateAsync(asking(firstPrompt.prompt_id, ['chatgpt_web']));
    expect(answer.data).toMatchObject({ workload: 'ai_prompt', trigger: 'manual', status: 'planned' });
  });

  it('rejects an engine that is off with one field error on engine_codes', async () => {
    const { result } = renderHook(() => useMutation(RUN_NOW), { wrapper });
    const problem = await refusal(result.current.mutateAsync(asking(firstPrompt.prompt_id, ['google_ai_mode'])));
    expect([problem.status, problem.code]).toEqual([422, 'validation_failed']);
    expect(problem.errors.map((item) => [item.path, item.code])).toEqual([['engine_codes', 'engine_not_enabled']]);
  });

  it('rejects a prompt whose answer is on its way with the engines that are pending', async () => {
    const { result } = renderHook(() => useMutation(RUN_NOW), { wrapper });
    await result.current.mutateAsync(asking(firstPrompt.prompt_id, ['chatgpt_web']));
    const problem = await refusal(
      result.current.mutateAsync(asking(firstPrompt.prompt_id, ['chatgpt_web', 'gemini_web'])),
    );
    expect([problem.status, problem.code, problem.body.engine_codes]).toEqual([409, 'check_pending', ['chatgpt_web']]);
  });

  it('rejects the 21st manual run of a day with the limit and nothing else to read', async () => {
    const { result } = renderHook(() => useMutation(RUN_NOW), { wrapper });
    for (const prompt of asked.slice(0, 20)) {
      await result.current.mutateAsync(asking(prompt.prompt_id, ['chatgpt_web']));
    }
    const problem = await refusal(result.current.mutateAsync(asking(asked[20]?.prompt_id ?? '', ['chatgpt_web'])));
    expect([problem.status, problem.code, problem.number('limit'), problem.number('used')]).toEqual([
      429,
      'manual_run_limit',
      20,
      null,
    ]);
  });

  it('rejects a month of answers that no longer fits with the numbers of the quota', async () => {
    const { result } = renderHook(() => useMutation(RUN_NOW), { wrapper });
    promptsOf(scope.projectId).answersAsked.set(new Date().toISOString().slice(0, 7), AI_ANSWER_QUOTA);
    const problem = await refusal(
      result.current.mutateAsync(asking(firstPrompt.prompt_id, ['chatgpt_web', 'gemini_web'])),
    );
    expect([problem.status, problem.code, problem.number('limit'), problem.number('requested')]).toEqual([
      422,
      'quota_exceeded',
      AI_ANSWER_QUOTA,
      2,
    ]);
    expect(problem.string('quota')).toBe('max_ai_observations_per_month');
    expect(problem.number('used')).toBeGreaterThanOrEqual(AI_ANSWER_QUOTA);
  });

  it('rejects a request while the provider is paused, with when to try again', async () => {
    const { result } = renderHook(() => useMutation(RUN_NOW), { wrapper });
    setProviderPaused(true);
    const problem = await refusal(result.current.mutateAsync(asking(firstPrompt.prompt_id, ['chatgpt_web'])));
    setProviderPaused(false);
    expect([problem.status, problem.code, problem.retryAfterSeconds]).toEqual([503, 'provider_paused', 300]);
  });
});

describe('the weekly series of the summary', () => {
  it('send include=series, alone or with the entity cells, and keep the key of every caller that asks for neither', () => {
    const plain = summaryQuery(scope, RANGE, false).queryKey;
    const series = summaryQuery(scope, RANGE, false, { include: ['series'] }).queryKey;
    const both = summaryQuery(scope, RANGE, false, { include: ['series', 'entities'] }).queryKey;
    const entities = summaryQuery(scope, RANGE, false, { include: ['entities'] }).queryKey;
    expect(series.at(-1)).toEqual({ from: RANGE.from, to: RANGE.to, include_branded: false, include: ['series'] });
    expect(both.at(-1)).toEqual({
      from: RANGE.from,
      to: RANGE.to,
      include_branded: false,
      include: ['series', 'entities'],
    });
    expect(new Set([plain, series, both, entities].map((key) => JSON.stringify(key))).size).toBe(4);
    expect(summaryQuery(scope, RANGE, false, { include: [] }).queryKey).toEqual(plain);
  });

  it('read a point for each week on every engine of every prompt and topic, and none unless asked', async () => {
    const range = lastMonth();
    const plain = await client.fetchQuery(summaryQuery(scope, range, false));
    const asked = await client.fetchQuery(summaryQuery(scope, range, false, { include: ['series', 'entities'] }));
    const rows = (summary: typeof asked): (typeof asked.data.prompts)[number]['engines'] => [
      ...summary.data.prompts.flatMap((row) => row.engines),
      ...summary.data.topics.flatMap((row) => row.engines),
    ];
    expect(rows(plain).every((engine) => engine.series === undefined)).toBe(true);
    expect(rows(asked).length).toBeGreaterThan(0);
    for (const engine of rows(asked)) {
      expect(engine.series?.length).toBeGreaterThanOrEqual(4);
      expect(engine.series?.every((point) => /^\d{4}-\d{2}-\d{2}$/.test(point.week_start))).toBe(true);
      expect(engine.entities).toHaveLength(asked.data.entities.length);
    }
  });
});

describe('bulkRun', () => {
  const ids = (from: number, to: number): string[] => asked.slice(from, to).map((prompt) => prompt.prompt_id);

  it('asks many prompts as one manual run and answers the run with what it asks and leaves out', async () => {
    const answer = await bulkRun(scope, ids(0, 3), ['chatgpt_web']);
    expect(answer.data).toMatchObject({ workload: 'ai_prompt', trigger: 'manual', status: 'planned' });
    expect(answer.meta).toMatchObject({ prompts: 3, answers: 3, skipped: [], manual_runs_today: { limit: 20 } });
    expect(answer.meta.manual_runs_today.used).toBeGreaterThanOrEqual(1);
    expect(answer.meta.estimated_cost_usd).toMatch(/^\d+\.\d{6}$/);
  });

  it('sends the engines only when they are given, so the project asks the ones it has on', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(`${PROJECT}/ai/runs`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({});
      }),
    );
    await bulkRun(scope, ['a', 'b']);
    await bulkRun(scope, ['a'], ['gemini_web', 'chatgpt_web']);
    expect(bodies).toEqual([
      { prompt_ids: ['a', 'b'] },
      { prompt_ids: ['a'], engine_codes: ['gemini_web', 'chatgpt_web'] },
    ]);
  });

  it('rejects a prompt that is not asked with one error on prompt_ids', async () => {
    const problem = await refusal(bulkRun(scope, [PAGE_ONE]));
    expect([problem.status, problem.code]).toEqual([422, 'validation_failed']);
    expect(problem.errors.map((item) => [item.path, item.code])).toEqual([['prompt_ids', 'prompt_unknown']]);
  });

  it('rejects when every prompt is on its way, with the prompts and what was left out', async () => {
    await bulkRun(scope, ids(0, 2));
    const problem = await refusal(bulkRun(scope, ids(0, 2)));
    expect([problem.status, problem.code]).toEqual([409, 'check_pending']);
    expect(problem.body.prompt_ids).toEqual(ids(0, 2).sort());
    expect(problem.body.skipped).toHaveLength(4);
  });

  it('rejects an engine that is off with one field error on engine_codes', async () => {
    const problem = await refusal(bulkRun(scope, ids(0, 2), ['google_ai_mode']));
    expect([problem.status, problem.code]).toEqual([422, 'validation_failed']);
    expect(problem.errors.map((item) => [item.path, item.code])).toEqual([['engine_codes', 'engine_not_enabled']]);
  });

  it('rejects a month of answers that no longer fits with the numbers of the quota', async () => {
    promptsOf(scope.projectId).answersAsked.set(new Date().toISOString().slice(0, 7), AI_ANSWER_QUOTA);
    const problem = await refusal(bulkRun(scope, ids(0, 2)));
    // Two prompts on the two engines the project has on
    expect([problem.status, problem.code, problem.number('limit'), problem.number('requested')]).toEqual([
      422,
      'quota_exceeded',
      AI_ANSWER_QUOTA,
      4,
    ]);
  });

  it('rejects a request while the provider is paused, with when to try again', async () => {
    setProviderPaused(true);
    const problem = await refusal(bulkRun(scope, ids(0, 2)));
    setProviderPaused(false);
    expect([problem.status, problem.code, problem.retryAfterSeconds]).toEqual([503, 'provider_paused', 300]);
  });

  it('rejects the 21st manual run of a day with the limit and nothing else to read', async () => {
    for (const prompt of asked.slice(0, 20)) await bulkRun(scope, [prompt.prompt_id], ['chatgpt_web']);
    const problem = await refusal(bulkRun(scope, [asked[20]?.prompt_id ?? ''], ['chatgpt_web']));
    expect([problem.status, problem.code, problem.number('limit'), problem.number('used')]).toEqual([
      429,
      'manual_run_limit',
      20,
      null,
    ]);
  });
});

describe('bulkArchive', () => {
  const two = asked.slice(0, 2).map((prompt) => prompt.prompt_id);

  it('archives and brings back many prompts, saying how many it found and how many it changed', async () => {
    expect(await bulkArchive(scope, [...two, PAGE_ONE], true)).toEqual({ data: { matched: 2, updated: 2 } });
    expect(await bulkArchive(scope, two, true)).toEqual({ data: { matched: 2, updated: 0 } });
    expect(await bulkArchive(scope, two, false)).toEqual({ data: { matched: 2, updated: 2 } });
  });

  it('sends the ids and the direction as the API takes them', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(`${PROJECT}/prompts/bulk-archive`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ data: { matched: 0, updated: 0 } });
      }),
    );
    await bulkArchive(scope, ['a', 'b'], false);
    expect(bodies).toEqual([{ ids: ['a', 'b'], archive: false }]);
  });

  it('rejects bringing prompts back past the workspace limit with the numbers of the quota, and changes nothing', async () => {
    await bulkArchive(scope, two, true);
    // Fill the workspace to one prompt below its limit
    const free = PROMPT_QUOTA - 1 - activePromptCount(MOCK_PROJECTS.map((project) => project.project_id));
    const create = renderHook(() => useMutation(BULK_CREATE_PROMPTS), { wrapper });
    const created = await create.result.current.mutateAsync({
      params: { path: { workspace_id: scope.workspaceId, project_id: scope.projectId } },
      body: {
        items: Array.from({ length: free }, (_, place) => ({
          text: `Which agency fills slot ${String(place)}?`,
          language_code: 'en',
          country_iso: 'DE',
          intent: 'unknown' as const,
          funnel_stage: 'unknown' as const,
          prompt_type: 'question' as const,
          importance: 3,
        })),
        on_duplicate: 'skip',
      },
    });
    expect(created.data.created).toHaveLength(free);
    const problem = await refusal(bulkArchive(scope, two, false));
    expect([problem.status, problem.code, problem.number('limit'), problem.number('requested')]).toEqual([
      422,
      'quota_exceeded',
      PROMPT_QUOTA,
      2,
    ]);
    expect(promptsOf(scope.projectId).prompts.filter((prompt) => two.includes(prompt.prompt_id))).toEqual([
      expect.objectContaining({ is_active: false }),
      expect.objectContaining({ is_active: false }),
    ]);
  });
});
