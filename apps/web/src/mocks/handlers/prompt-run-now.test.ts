import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { MOCK_PROJECTS, MOCK_WORKSPACE } from '../fixtures';
import { FIXTURE_PROMPTS } from '../prompt-fixtures';
import { AI_ANSWER_QUOTA, PENDING_MS, promptsOf, setProviderPaused } from '../prompts-state';
import { dataOf, fieldCodes, mockBrowser, type Answer } from '@/test/mock-api';

const W = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}`;
const [fynix, cleanstart] = MOCK_PROJECTS;
if (fynix === undefined || cleanstart === undefined) throw new Error('The fixture projects are missing');
const FYNIX = `${W}/projects/${fynix.project_id}`;
const CLEANSTART = `${W}/projects/${cleanstart.project_id}`;
const PROMPTS = FIXTURE_PROMPTS.get(fynix.project_id) ?? [];
const promptAt = (index: number): string => PROMPTS[index]?.prompt_id ?? '';
const MANUAL_RUNS_PER_DAY = 20;
/** Thursday 12 November 2026, noon UTC. */
const START = Date.parse('2026-11-12T12:00:00Z');
let clock = START;

const RUN = z.object({
  run_id: z.string(),
  project_id: z.string(),
  schedule_id: z.string().nullable(),
  workload: z.string(),
  trigger: z.string(),
  status: z.string(),
  status_reason: z.string().nullable(),
  window_start: z.string(),
  window_end: z.string(),
  tasks_total: z.number(),
  tasks_succeeded: z.number(),
  tasks_failed: z.number(),
  estimated_cost_usd: z.string().nullable(),
  actual_cost_usd: z.string().nullable(),
  blocked_by_budget_id: z.string().nullable(),
  created_by: z.object({ actor_id: z.string(), actor_type: z.string(), label: z.string() }).nullable(),
  created_at: z.string(),
  completed_at: z.string().nullable(),
  operation: z.object({
    kind: z.string(),
    status: z.string(),
    progress: z.object({ done: z.number(), total: z.number().nullable(), unit: z.string() }),
    started_at: z.string().nullable(),
    finished_at: z.string().nullable(),
    error: z.unknown(),
    links: z.object({ self: z.string(), cancel: z.string().nullable().optional() }),
  }),
});
const FIELD_ERRORS = z.object({
  errors: z.array(z.object({ location: z.string(), path: z.string(), message: z.string() })),
});
const errorsOf = (answer: Answer): z.infer<typeof FIELD_ERRORS>['errors'] => FIELD_ERRORS.parse(answer.body).errors;

beforeEach(() => {
  clock = START;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const runNow = (
  who: ReturnType<typeof mockBrowser>,
  promptId: string,
  engines: unknown,
  project = FYNIX,
): Promise<Answer> => who.call('POST', `${project}/prompts/${promptId}/run-now`, { engine_codes: engines });
const item = (text: string, country = 'DE'): Record<string, string> => ({
  text,
  language_code: 'en',
  country_iso: country,
});

describe('run now', () => {
  it('queues a manual run of the prompt on its engines, planned and not yet counted', async () => {
    const answer = await runNow(mockBrowser('analyst'), promptAt(2), ['gemini_web', 'chatgpt_web']);
    expect(answer.status).toBe(202);
    const run = dataOf(answer, RUN);
    expect(run).toMatchObject({
      project_id: fynix.project_id,
      schedule_id: null,
      workload: 'ai_prompt',
      trigger: 'manual',
      status: 'planned',
      status_reason: null,
      tasks_total: 0,
      tasks_succeeded: 0,
      tasks_failed: 0,
      estimated_cost_usd: null,
      actual_cost_usd: null,
      blocked_by_budget_id: null,
      completed_at: null,
      created_at: new Date(START).toISOString(),
      window_start: new Date(START).toISOString(),
      window_end: new Date(START + 3_600_000).toISOString(),
    });
    expect(run.created_by).toMatchObject({ actor_type: 'user', label: expect.any(String) });
    // A planned run has no total yet and has not started (api/operations/run_routes.py `run_view`)
    expect(run.operation).toMatchObject({
      kind: 'collection_run',
      status: 'queued',
      progress: { done: 0, total: null, unit: 'tasks' },
      started_at: null,
      finished_at: null,
      error: null,
    });
    expect(run.operation.links.self).toBe(`${FYNIX}/runs/${run.run_id}`);
    expect(run.operation.links.cancel).toBe(`${FYNIX}/runs/${run.run_id}/cancel`);
  });

  it('refuses a prompt that is asked already on an engine, naming the engines, until the answer has had time to come', async () => {
    const analyst = mockBrowser('analyst');
    expect((await runNow(analyst, promptAt(2), ['chatgpt_web'])).status).toBe(202);
    const again = await runNow(analyst, promptAt(2), ['gemini_web', 'chatgpt_web']);
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: 'check_pending', engine_codes: ['chatgpt_web'] });
    // Another engine of the same prompt, and the same engine of another prompt, are free
    expect((await runNow(analyst, promptAt(2), ['gemini_web'])).status).toBe(202);
    expect((await runNow(analyst, promptAt(3), ['chatgpt_web'])).status).toBe(202);
    // A session lasts ten minutes by the clock, so a browser later in the day signs in again
    clock = START + PENDING_MS;
    expect((await runNow(mockBrowser('analyst'), promptAt(2), ['chatgpt_web'])).status).toBe(202);
  });

  it('refuses each engine that cannot be asked with its own error on engine_codes, in the order of their codes', async () => {
    const editor = mockBrowser('editor');
    const off = await runNow(editor, promptAt(2), ['google_ai_mode', 'gemini_web']);
    expect(off.status).toBe(422);
    expect(fieldCodes(off)).toEqual(['engine_codes:engine_not_enabled']);
    expect(errorsOf(off)).toEqual([
      expect.objectContaining({
        location: 'body',
        path: 'engine_codes',
        message: 'google_ai_mode: The engine is not turned on for the project.',
      }),
    ]);
    // Two engines refused: one error each, by code, however the body lists them
    await editor.call('DELETE', `${FYNIX}/engines/gemini_web`);
    expect(fieldCodes(await runNow(editor, promptAt(2), ['google_ai_mode', 'gemini_web', 'chatgpt_web']))).toEqual([
      'engine_codes:engine_not_enabled',
      'engine_codes:engine_not_enabled',
    ]);
    expect(
      errorsOf(await runNow(editor, promptAt(2), ['google_ai_mode', 'gemini_web'])).map((error) => error.message),
    ).toEqual([
      'gemini_web: The engine is not turned on for the project.',
      'google_ai_mode: The engine is not turned on for the project.',
    ]);
  });

  it('refuses a prompt that is longer than an engine takes, and an engine with no location in the country of the prompt', async () => {
    const editor = mockBrowser('editor');
    await editor.call('PUT', `${FYNIX}/engines/google_ai_mode`, { location_ids: [2276] });
    const long = dataOf(
      await editor.call('POST', `${FYNIX}/prompts`, item(`Which agency ${'audits '.repeat(120)}shop sites?`)),
      z.object({ prompt_id: z.string() }),
    );
    const tooLong = await runNow(editor, long.prompt_id, ['google_ai_mode', 'chatgpt_web']);
    expect(fieldCodes(tooLong)).toEqual(['engine_codes:prompt_too_long']);
    expect(errorsOf(tooLong)[0]?.message).toBe('google_ai_mode: The prompt is longer than this engine takes.');
    // Cleanstart asks in the United States; ChatGPT then moves to Germany only
    await editor.call('PUT', `${CLEANSTART}/engines/chatgpt_web`, { location_ids: [2840] });
    const us = dataOf(
      await editor.call('POST', `${CLEANSTART}/prompts`, item('Which cleaning service is best in Boston?', 'US')),
      z.object({ prompt_id: z.string() }),
    );
    await editor.call('PUT', `${CLEANSTART}/engines/chatgpt_web`, { location_ids: [2276] });
    const elsewhere = await runNow(editor, us.prompt_id, ['chatgpt_web'], CLEANSTART);
    expect(fieldCodes(elsewhere)).toEqual(['engine_codes:location_not_enabled']);
    expect(errorsOf(elsewhere)[0]?.message).toBe("chatgpt_web: The engine has no location in the prompt's country.");
  });

  it('checks the body as the API does', async () => {
    const analyst = mockBrowser('analyst');
    expect(fieldCodes(await runNow(analyst, promptAt(2), []))).toEqual(['engine_codes:too_short']);
    expect(
      fieldCodes(await runNow(analyst, promptAt(2), ['chatgpt_web', 'gemini_web', 'google_ai_mode', 'chatgpt_web'])),
    ).toEqual(['engine_codes:too_long']);
    expect(fieldCodes(await runNow(analyst, promptAt(2), ['chatgpt_web', 'bing']))).toEqual(['engine_codes.1:enum']);
    expect(fieldCodes(await runNow(analyst, promptAt(2), 'chatgpt_web'))).toEqual(['engine_codes:list_type']);
    expect(fieldCodes(await analyst.call('POST', `${FYNIX}/prompts/${promptAt(2)}/run-now`, {}))).toEqual([
      'engine_codes:missing',
    ]);
    expect(
      fieldCodes(
        await analyst.call('POST', `${FYNIX}/prompts/${promptAt(2)}/run-now`, {
          engine_codes: ['gemini_web'],
          live: true,
        }),
      ),
    ).toEqual(['live:extra_forbidden']);
    expect(fieldCodes(await runNow(analyst, 'not-a-uuid', ['gemini_web']))).toEqual(['prompt_id:uuid_parsing']);
  });

  it('is for a member who may trigger runs, on a prompt the project still collects', async () => {
    expect((await runNow(mockBrowser('viewer'), promptAt(2), ['gemini_web'])).code).toBe('forbidden');
    const editor = mockBrowser('editor');
    expect((await runNow(editor, '0192d1a8-9a01-7b44-8c2d-1f0e9d8c7bff', ['gemini_web'])).code).toBe('not_found');
    expect((await editor.call('DELETE', `${FYNIX}/prompts/${promptAt(5)}`)).status).toBe(204);
    expect((await runNow(editor, promptAt(5), ['gemini_web'])).code).toBe('not_found');
    // The permission is checked before the body
    expect((await mockBrowser('viewer').call('POST', `${FYNIX}/prompts/${promptAt(2)}/run-now`, {})).code).toBe(
      'forbidden',
    );
  });

  it('stops at 20 manual runs in a day and says only the limit, then starts again the next day', async () => {
    const analyst = mockBrowser('analyst');
    for (let n = 0; n < MANUAL_RUNS_PER_DAY; n += 1) {
      expect((await runNow(analyst, promptAt(n), ['chatgpt_web'])).status).toBe(202);
    }
    const over = await runNow(analyst, promptAt(MANUAL_RUNS_PER_DAY), ['chatgpt_web']);
    expect(over.status).toBe(429);
    expect(over.code).toBe('manual_run_limit');
    expect(over.body).toMatchObject({ limit: MANUAL_RUNS_PER_DAY });
    expect(over.body).not.toHaveProperty('used');
    expect(over.headers.get('retry-after')).toBeNull();
    clock = START + 86_400_000;
    expect((await runNow(mockBrowser('analyst'), promptAt(MANUAL_RUNS_PER_DAY), ['chatgpt_web'])).status).toBe(202);
  });

  it('shares the 20 manual runs of a day with the other manual runs of the project, in both directions', async () => {
    const analyst = mockBrowser('analyst');
    // Keyword refreshes are manual runs too: 20 of them leave none for Run now
    for (let n = 0; n < MANUAL_RUNS_PER_DAY; n += 1) {
      expect((await analyst.call('POST', `${FYNIX}/keyword-metrics/refresh`, {})).status).toBe(202);
    }
    const over = await runNow(analyst, promptAt(0), ['chatgpt_web']);
    expect(over.status).toBe(429);
    expect(over.body).toMatchObject({ code: 'manual_run_limit', limit: MANUAL_RUNS_PER_DAY });
    // And Run now's runs count against a keyword refresh, and show in the day's count of the runs list
    const other = mockBrowser('analyst');
    const used = async (): Promise<number> => {
      const list = await other.call('GET', `${FYNIX}/runs`);
      return z.object({ manual_runs_today: z.object({ used: z.number() }) }).parse(list.body.meta).manual_runs_today
        .used;
    };
    const before = await used();
    for (let n = 0; n < 3; n += 1) expect((await runNow(other, promptAt(n), ['chatgpt_web'])).status).toBe(202);
    expect(await used()).toBe(before + 3);
    for (let n = 3; n < MANUAL_RUNS_PER_DAY - before; n += 1) {
      expect((await runNow(other, promptAt(n), ['chatgpt_web'])).status).toBe(202);
    }
    const refresh = await other.call('POST', `${FYNIX}/keyword-metrics/refresh`, {});
    expect(refresh.status).toBe(429);
    expect(refresh.code).toBe('manual_run_limit');
  });

  it('checks in the order of the API: the prompt, the engines, what is on its way, the runs of the day, then the answers of the month', async () => {
    const analyst = mockBrowser('analyst');
    const unknown = '0192d1a8-9a01-7b44-8c2d-1f0e9d8c7bff';
    // A prompt the project does not collect is 404 whatever the engines say
    expect((await runNow(analyst, unknown, ['google_ai_mode'])).code).toBe('not_found');
    // A refused engine is 422 before what is on its way, and before the limits
    expect((await runNow(analyst, promptAt(0), ['chatgpt_web'])).status).toBe(202);
    const refusedFirst = await runNow(analyst, promptAt(0), ['chatgpt_web', 'google_ai_mode']);
    expect(refusedFirst.status).toBe(422);
    expect(fieldCodes(refusedFirst)).toEqual(['engine_codes:engine_not_enabled']);
    // What is on its way is 409 before the day's runs
    for (let n = 1; n < MANUAL_RUNS_PER_DAY; n += 1) {
      expect((await runNow(analyst, promptAt(n), ['chatgpt_web'])).status).toBe(202);
    }
    expect((await runNow(analyst, promptAt(0), ['chatgpt_web'])).status).toBe(409);
    expect(fieldCodes(await runNow(analyst, promptAt(MANUAL_RUNS_PER_DAY), ['google_ai_mode']))).toEqual([
      'engine_codes:engine_not_enabled',
    ]);
    // The day's runs are 429 before the month's answers
    promptsOf(fynix.project_id).answersAsked.set('2026-11', AI_ANSWER_QUOTA);
    const limit = await runNow(analyst, promptAt(MANUAL_RUNS_PER_DAY), ['chatgpt_web']);
    expect(limit.status).toBe(429);
    expect(limit.code).toBe('manual_run_limit');
  });

  it('stops when the answers of the month would pass the workspace limit, saying what was asked and what is requested', async () => {
    const analyst = mockBrowser('analyst');
    expect((await runNow(analyst, promptAt(2), ['chatgpt_web', 'gemini_web'])).status).toBe(202);
    promptsOf(fynix.project_id).answersAsked.set('2026-11', AI_ANSWER_QUOTA);
    const over = await runNow(analyst, promptAt(3), ['chatgpt_web', 'gemini_web']);
    expect(over.status).toBe(422);
    expect(over.code).toBe('quota_exceeded');
    expect(over.body).toMatchObject({ limit: AI_ANSWER_QUOTA, requested: 2, quota: 'max_ai_observations_per_month' });
    expect(Number(over.body.used)).toBeGreaterThanOrEqual(AI_ANSWER_QUOTA);
    // Next month starts from nothing
    clock = Date.parse('2026-12-01T12:00:00Z');
    expect((await runNow(mockBrowser('analyst'), promptAt(3), ['chatgpt_web', 'gemini_web'])).status).toBe(202);
  });

  it('says the provider is paused, with when to try again, before it looks at the prompt', async () => {
    setProviderPaused(true);
    const analyst = mockBrowser('analyst');
    for (const id of [promptAt(2), '0192d1a8-9a01-7b44-8c2d-1f0e9d8c7bff']) {
      const paused = await runNow(analyst, id, ['chatgpt_web']);
      expect(paused.status).toBe(503);
      expect(paused.code).toBe('provider_paused');
      expect(paused.headers.get('retry-after')).toBe('300');
    }
    setProviderPaused(false);
    expect((await runNow(analyst, promptAt(2), ['chatgpt_web'])).status).toBe(202);
  });
});
