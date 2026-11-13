import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { lintBodyOf, nextRunOf, useAddLint, useNextScheduled, type AddLintInput } from './add-queries';
import { promptsKey, refreshPrompts, type PromptScope } from '../prompt-queries';
import { projectKey } from '@/lib/api/keys';
import { makeQueryClient } from '@/lib/api/query-client';
import type { Schemas } from '@/lib/api/types';
import { MOCK_PROJECTS, MOCK_WORKSPACE } from '@/mocks/fixtures';
import { server } from '@/test/msw';

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix fixture project is missing');
const scope: PromptScope = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: fynix.project_id };
const PROJECT = '*/api/v1/workspaces/:w/projects/:p';
const LINTED = { data: [], quota: { limit: 150, used: 24 } };

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);
beforeEach(() => {
  client = makeQueryClient({ retry: false });
});

const input = (extra: Partial<AddLintInput> = {}): AddLintInput => ({
  texts: ['Which CRM suits a small team?'],
  languageCode: 'en',
  countryIso: 'DE',
  engineCodes: ['chatgpt_web', 'gemini_web'],
  ...extra,
});

describe('the lint body', () => {
  it('is the items shape once a language and a two letter country are chosen', () => {
    expect(lintBodyOf(input({ texts: ['One?', 'Two?'] }))).toEqual({
      items: [
        { text: 'One?', language_code: 'en', country_iso: 'DE' },
        { text: 'Two?', language_code: 'en', country_iso: 'DE' },
      ],
      engine_codes: ['chatgpt_web', 'gemini_web'],
    });
  });

  it('is the texts shape with the language before a country is chosen, so only the warnings come back', () => {
    expect(lintBodyOf(input({ countryIso: '' }))).toEqual({
      texts: ['Which CRM suits a small team?'],
      language_code: 'en',
      engine_codes: ['chatgpt_web', 'gemini_web'],
    });
    expect(lintBodyOf(input({ countryIso: 'de' }))).toHaveProperty('texts');
  });

  it('leaves the language out when it is not a valid code, and engine_codes out when no engine is on', () => {
    expect(lintBodyOf(input({ countryIso: '', languageCode: '', engineCodes: [] }))).toEqual({
      texts: ['Which CRM suits a small team?'],
    });
    expect(lintBodyOf(input({ languageCode: 'EN', countryIso: 'DE' }))).toHaveProperty('texts');
    expect(lintBodyOf(input({ engineCodes: [] }))).not.toHaveProperty('engine_codes');
  });
});

describe('useAddLint', () => {
  it('sends the items body, and shows the previous answer while a new one is on its way', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(`${PROJECT}/prompts/lint`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(LINTED);
      }),
    );
    const { result, rerender } = renderHook((props: AddLintInput) => useAddLint(scope, props), {
      wrapper,
      initialProps: input(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(bodies).toEqual([
      {
        items: [{ text: 'Which CRM suits a small team?', language_code: 'en', country_iso: 'DE' }],
        engine_codes: ['chatgpt_web', 'gemini_web'],
      },
    ]);
    rerender(input({ texts: ['Another question here?'] }));
    // Kept, not dropped to nothing: the plan keeps its numbers while the lint runs again
    expect(result.current.data).toEqual(LINTED);
    await waitFor(() => expect(bodies).toHaveLength(2));
  });

  it('does not carry the previous answer over to another country, language or set of engines', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    server.use(
      http.post(`${PROJECT}/prompts/lint`, async () => {
        calls += 1;
        // The second answer waits, so the hook shows what it holds while that one is on its way
        if (calls > 1) await gate;
        return HttpResponse.json(LINTED);
      }),
    );
    const { result, rerender } = renderHook((props: AddLintInput) => useAddLint(scope, props), {
      wrapper,
      initialProps: input(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // A text tracked in Germany is not tracked in France: that answer is not shown for France
    rerender(input({ countryIso: 'FR' }));
    expect(result.current.data).toBeUndefined();
    expect(result.current.isPlaceholderData).toBe(false);
    release();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    rerender(input({ countryIso: 'FR', engineCodes: ['chatgpt_web'] }));
    expect(result.current.data).toBeUndefined();
  });

  it('asks nothing for an empty list, and asks again for the same list when it is read again', async () => {
    let calls = 0;
    server.use(
      http.post(`${PROJECT}/prompts/lint`, () => {
        calls += 1;
        return HttpResponse.json(LINTED);
      }),
    );
    const empty = renderHook(() => useAddLint(scope, input({ texts: [] })), { wrapper });
    expect(empty.result.current.fetchStatus).toBe('idle');
    const some = renderHook(() => useAddLint(scope, input()), { wrapper });
    await waitFor(() => expect(some.result.current.isSuccess).toBe(true));
    expect(calls).toBe(1);
    // The key sits under the prompts of the project, so a change to the prompts reads it again
    const key = client.getQueryCache().findAll()[0]?.queryKey ?? [];
    expect(key.slice(0, promptsKey(scope).length)).toEqual(promptsKey(scope));
    await refreshPrompts(client, scope);
    await waitFor(() => expect(calls).toBe(2));
  });

  it('keeps a lint of the items shape apart from one of the texts shape for the same lines', async () => {
    server.use(http.post(`${PROJECT}/prompts/lint`, () => HttpResponse.json(LINTED)));
    const items = renderHook(() => useAddLint(scope, input()), { wrapper });
    const texts = renderHook(() => useAddLint(scope, input({ countryIso: '' })), { wrapper });
    await waitFor(() => expect(items.result.current.isSuccess && texts.result.current.isSuccess).toBe(true));
    expect(client.getQueryCache().findAll()).toHaveLength(2);
  });
});

describe('the next scheduled answers', () => {
  const schedule = (id: string, nextRunAt: string, extra: Partial<Schemas['Schedule']> = {}): Schemas['Schedule'] => ({
    schedule_id: id,
    project_id: scope.projectId,
    name: id,
    workload: 'ai_prompt',
    cadence: 'weekly',
    cron_expr: null,
    weekday: 1,
    month_day: null,
    window_start_local: '01:00:00',
    window_hours: 8,
    timezone: 'Europe/Berlin',
    priority: 'standard',
    provider_mode: 'standard_queue',
    selector: { all: true },
    is_active: true,
    created_at: '2026-11-01T00:00:00Z',
    last_run_id: null,
    next_run_at: nextRunAt,
    ...extra,
  });

  it('is the earliest next run of the schedules that are active, and none when all are paused', () => {
    const rows = [
      schedule('a', '2026-11-16T00:00:00Z'),
      schedule('b', '2026-11-14T00:00:00Z'),
      schedule('c', '2026-11-13T00:00:00Z', { is_active: false }),
    ];
    expect(nextRunOf(rows)).toBe('2026-11-14T00:00:00Z');
    expect(nextRunOf([schedule('c', '2026-11-13T00:00:00Z', { is_active: false })])).toBeNull();
    expect(nextRunOf([])).toBeNull();
  });

  it("reads the project's active AI schedules, and says when it is still loading or could not be read", async () => {
    const queries: URLSearchParams[] = [];
    server.use(
      http.get(`${PROJECT}/schedules`, ({ request }) => {
        queries.push(new URL(request.url).searchParams);
        return HttpResponse.json({
          data: [schedule('a', '2026-11-16T00:00:00Z'), schedule('b', '2026-11-14T00:00:00Z')],
          page: { offset: 0, limit: 50, total: 2 },
        });
      }),
    );
    const { result } = renderHook(() => useNextScheduled(scope), { wrapper });
    expect(result.current).toEqual({ status: 'loading', nextRunAt: null });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.nextRunAt).toBe('2026-11-14T00:00:00Z');
    expect(queries[0]?.get('filter[workload]')).toBe('ai_prompt');
    expect(queries[0]?.get('filter[is_active]')).toBe('true');
    // The key is the one the Schedules screen and the engines screen refresh
    const key = client.getQueryCache().findAll()[0]?.queryKey ?? [];
    expect(key.slice(0, 5)).toEqual([...projectKey(scope.workspaceId, scope.projectId), 'schedules']);

    server.use(http.get(`${PROJECT}/schedules`, () => HttpResponse.json({ code: 'forbidden' }, { status: 403 })));
    client = makeQueryClient({ retry: false });
    const failed = renderHook(() => useNextScheduled(scope), { wrapper });
    await waitFor(() => expect(failed.result.current.status).toBe('failed'));
    expect(failed.result.current.nextRunAt).toBeNull();
  });
});
