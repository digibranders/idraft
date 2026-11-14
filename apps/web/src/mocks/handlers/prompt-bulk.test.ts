import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { AI_ANSWER_MICROS } from '../operations-fixtures';
import { MOCK_PROJECTS, MOCK_WORKSPACE } from '../fixtures';
import { FIXTURE_PROMPTS, PROMPT_QUOTA } from '../prompt-fixtures';
import { AI_ANSWER_QUOTA, PENDING_MS, promptsOf, setProviderPaused } from '../prompts-state';
import { dataOf, fieldCodes, mockBrowser, pageOf, type Answer, type MockBrowser } from '@/test/mock-api';

const W = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}`;
const [fynix, cleanstart] = MOCK_PROJECTS;
if (fynix === undefined || cleanstart === undefined) throw new Error('The fixture projects are missing');
const FYNIX = `${W}/projects/${fynix.project_id}`;
const CLEANSTART = `${W}/projects/${cleanstart.project_id}`;
const PROMPTS = FIXTURE_PROMPTS.get(fynix.project_id) ?? [];
const promptAt = (index: number): string => PROMPTS[index]?.prompt_id ?? '';
/** The Hindi prompt of the fixtures, asked in India: the one prompt Germany-only engines cannot ask. */
const HINDI = promptAt(5);
const MANUAL_RUNS_PER_DAY = 20;
const BULK_RUN_MAX = 150;
const BULK_ARCHIVE_MAX = 1000;
const UNKNOWN = '0192d1a8-9a01-7b44-8c2d-1f0e9d8c7bff';
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
  tasks_total: z.number(),
  tasks_succeeded: z.number(),
  estimated_cost_usd: z.string().nullable(),
  created_at: z.string(),
  window_start: z.string(),
  window_end: z.string(),
  created_by: z.object({ actor_type: z.string() }).nullable(),
  operation: z.object({
    kind: z.string(),
    status: z.string(),
    progress: z.object({ done: z.number(), total: z.number().nullable(), unit: z.string() }),
    links: z.object({ self: z.string(), cancel: z.string().nullable().optional() }),
  }),
});
const SKIP = z.object({ prompt_id: z.string(), engine_code: z.string(), reason: z.string() });
const META = z.object({
  prompts: z.number(),
  answers: z.number(),
  estimated_cost_usd: z.string(),
  skipped: z.array(SKIP),
  manual_runs_today: z.object({ used: z.number(), limit: z.number() }),
});
const OBSERVATION = z.object({
  observation_id: z.string(),
  observed_at: z.string(),
  engine_code: z.string(),
  run_id: z.string().nullable(),
  subject: z.object({ prompt_id: z.string() }),
  facts: z.object({ is_valid: z.boolean() }).nullable(),
});
const COUNT = z.object({ matched: z.number(), updated: z.number() });
const PAGE = z.object({ limit: z.number(), next_cursor: z.string().nullable(), has_more: z.boolean() });
const PROMPT_ROW = z.object({ prompt_id: z.string(), is_active: z.boolean() });
const PROBLEM_SKIPS = z.object({ skipped: z.array(SKIP), prompt_ids: z.array(z.string()).optional() });

beforeEach(() => {
  clock = START;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
});
afterEach(() => {
  vi.restoreAllMocks();
  setProviderPaused(false);
});

const bulkRun = (who: MockBrowser, promptIds: unknown, engineCodes?: unknown, project = FYNIX): Promise<Answer> =>
  who.call('POST', `${project}/ai/runs`, {
    prompt_ids: promptIds,
    ...(engineCodes === undefined ? {} : { engine_codes: engineCodes }),
  });
const runNow = (who: MockBrowser, promptId: string, engines: string[]): Promise<Answer> =>
  who.call('POST', `${FYNIX}/prompts/${promptId}/run-now`, { engine_codes: engines });
const metaOf = (answer: Answer): z.infer<typeof META> => META.parse(answer.body.meta);
const skipsOf = (answer: Answer): z.infer<typeof PROBLEM_SKIPS>['skipped'] => PROBLEM_SKIPS.parse(answer.body).skipped;
const bodyErrors = (answer: Answer): { path: string; code: string; message: string }[] =>
  z
    .object({ errors: z.array(z.object({ path: z.string(), code: z.string(), message: z.string() })) })
    .parse(answer.body).errors;
const ids = (from: number, to: number): string[] => PROMPTS.slice(from, to).map((prompt) => prompt.prompt_id);

describe('bulk run', () => {
  it('queues one manual run for many prompts on every engine the project has on, planned, with what it asks', async () => {
    const answer = await bulkRun(mockBrowser('analyst'), ids(2, 5));
    expect(answer.status).toBe(202);
    const run = dataOf(answer, RUN);
    expect(run).toMatchObject({
      project_id: fynix.project_id,
      schedule_id: null,
      workload: 'ai_prompt',
      trigger: 'manual',
      status: 'planned',
      tasks_total: 0,
      tasks_succeeded: 0,
      created_at: new Date(START).toISOString(),
      window_start: new Date(START).toISOString(),
      window_end: new Date(START + 3_600_000).toISOString(),
      created_by: { actor_type: 'user' },
      operation: { kind: 'collection_run', status: 'queued', progress: { done: 0, total: null, unit: 'tasks' } },
    });
    expect(run.operation.links.self).toBe(`${FYNIX}/runs/${run.run_id}`);
    // Three prompts on ChatGPT and Gemini, one answer each, at the standard queue's price
    expect(metaOf(answer)).toEqual({
      prompts: 3,
      answers: 6,
      estimated_cost_usd: `0.00${String(6 * AI_ANSWER_MICROS).padStart(4, '0')}`,
      skipped: [],
      manual_runs_today: { used: 1, limit: MANUAL_RUNS_PER_DAY },
    });
  });

  it('asks only the engines it is given, each once, and a prompt once however often it is named', async () => {
    const answer = await bulkRun(
      mockBrowser('analyst'),
      [promptAt(2), promptAt(3), promptAt(2)],
      ['gemini_web', 'gemini_web'],
    );
    expect(answer.status).toBe(202);
    expect(metaOf(answer)).toMatchObject({ prompts: 2, answers: 2, skipped: [] });
    clock = START + 120_000;
    const rows = dataOf(
      await mockBrowser('analyst').call('GET', `${FYNIX}/ai/observations?limit=200&from=2026-11-12&to=2026-11-12`),
      z.array(OBSERVATION),
    ).filter((row) => row.run_id !== null);
    expect(rows.map((row) => row.engine_code)).toEqual(['gemini_web', 'gemini_web']);
  });

  it('delivers a valid answer for each prompt and engine, which the observations, the summary and the runs then show', async () => {
    const analyst = mockBrowser('analyst');
    const asked = ids(2, 6);
    const run = dataOf(await bulkRun(analyst, asked), RUN);
    clock = START + 120_000;
    const fresh = dataOf(
      await mockBrowser('analyst').call('GET', `${FYNIX}/ai/observations?limit=200&from=2026-11-12&to=2026-11-12`),
      z.array(OBSERVATION),
    ).filter((row) => row.run_id === run.run_id);
    expect(fresh).toHaveLength(8);
    expect(new Set(fresh.map((row) => row.observation_id)).size).toBe(8);
    expect(fresh.every((row) => row.facts?.is_valid === true)).toBe(true);
    expect(fresh.every((row) => row.observed_at === new Date(START).toISOString())).toBe(true);
    for (const promptId of asked) {
      expect(
        fresh
          .filter((row) => row.subject.prompt_id === promptId)
          .map((row) => row.engine_code)
          .sort(),
      ).toEqual(['chatgpt_web', 'gemini_web']);
    }
    // The run is kept in the browser that asked it
    const listed = dataOf(await analyst.call('GET', `${FYNIX}/runs`), z.array(RUN));
    expect(listed.find((candidate) => candidate.run_id === run.run_id)).toMatchObject({
      workload: 'ai_prompt',
      trigger: 'manual',
      tasks_total: 8,
      created_by: { actor_type: 'user' },
    });
    expect((await analyst.call('GET', `${FYNIX}/runs/${run.run_id}`)).status).toBe(200);
  });

  it('is one manual run against the 20 of the day, whatever it asks, shared with every other manual run', async () => {
    const editor = mockBrowser('editor');
    expect(metaOf(await bulkRun(editor, ids(0, 24))).manual_runs_today.used).toBe(1);
    // 19 single runs on an engine the bulk run did not ask fill the day
    await editor.call('PUT', `${FYNIX}/engines/google_ai_mode`, { location_ids: [2276, 2356] });
    for (let n = 0; n < MANUAL_RUNS_PER_DAY - 1; n += 1) {
      expect((await runNow(editor, promptAt(n), ['google_ai_mode'])).status).toBe(202);
    }
    const over = await bulkRun(editor, [promptAt(20)], ['google_ai_mode']);
    expect(over.status).toBe(429);
    expect(over.code).toBe('manual_run_limit');
    expect(over.body).toMatchObject({ limit: MANUAL_RUNS_PER_DAY });
    expect(over.body).not.toHaveProperty('used');
    expect(over.headers.get('retry-after')).toBeNull();
    clock = START + 86_400_000;
    expect((await bulkRun(mockBrowser('editor'), [promptAt(20)], ['google_ai_mode'])).status).toBe(202);
  });

  it('leaves a prompt out on an engine that has no location in its country, listing it, and runs the rest', async () => {
    const editor = mockBrowser('editor');
    // Gemini asks in Germany only now: the Hindi prompt of India has no location there
    expect((await editor.call('PUT', `${FYNIX}/engines/gemini_web`, { location_ids: [2276] })).status).toBe(200);
    const answer = await bulkRun(editor, [HINDI, promptAt(2)]);
    expect(answer.status).toBe(202);
    expect(metaOf(answer)).toMatchObject({
      prompts: 2,
      answers: 3,
      skipped: [{ prompt_id: HINDI, engine_code: 'gemini_web', reason: 'location_not_enabled' }],
    });
  });

  it('leaves a prompt out on an engine that takes shorter prompts than it is, listing it, and runs the rest', async () => {
    const editor = mockBrowser('editor');
    await editor.call('PUT', `${FYNIX}/engines/google_ai_mode`, { location_ids: [2276] });
    const long = dataOf(
      await editor.call('POST', `${FYNIX}/prompts`, {
        text: `Which agency ${'audits '.repeat(120)}shop sites?`,
        language_code: 'en',
        country_iso: 'DE',
      }),
      z.object({ prompt_id: z.string() }),
    );
    const answer = await bulkRun(editor, [long.prompt_id, promptAt(2)], ['google_ai_mode']);
    expect(answer.status).toBe(202);
    expect(metaOf(answer)).toMatchObject({
      prompts: 1,
      answers: 1,
      skipped: [{ prompt_id: long.prompt_id, engine_code: 'google_ai_mode', reason: 'prompt_too_long' }],
    });
  });

  it('leaves out every engine of a prompt that is asked already, check_pending where it is and prompt_pending on the rest', async () => {
    const analyst = mockBrowser('analyst');
    expect((await runNow(analyst, promptAt(2), ['chatgpt_web'])).status).toBe(202);
    const answer = await bulkRun(analyst, [promptAt(2), promptAt(3)]);
    expect(answer.status).toBe(202);
    expect(metaOf(answer)).toMatchObject({
      prompts: 1,
      answers: 2,
      skipped: [
        { prompt_id: promptAt(2), engine_code: 'chatgpt_web', reason: 'check_pending' },
        { prompt_id: promptAt(2), engine_code: 'gemini_web', reason: 'prompt_pending' },
      ],
    });
    // Run now left the prompt's answer on its way, so the prompt was not asked on Gemini either
    const count = (code: string): number =>
      promptsOf(fynix.project_id).observations.filter(
        (row) => row.subject.prompt_id === promptAt(2) && row.engine_code === code,
      ).length;
    expect(count('chatgpt_web')).toBe(1);
    expect(count('gemini_web')).toBe(0);
  });

  it('lists its skips by prompt id, then engine', async () => {
    const analyst = mockBrowser('analyst');
    expect((await bulkRun(analyst, [promptAt(5), promptAt(2)])).status).toBe(202);
    const answer = await bulkRun(analyst, [promptAt(5), promptAt(2), promptAt(8)]);
    expect(answer.status).toBe(202);
    expect(metaOf(answer).skipped.map((skip) => `${skip.prompt_id} ${skip.engine_code}`)).toEqual(
      [promptAt(5), promptAt(2)].sort().flatMap((promptId) => [`${promptId} chatgpt_web`, `${promptId} gemini_web`]),
    );
  });

  it('is a 409 check_pending naming the prompts when every prompt is on its way, and counts no run', async () => {
    const analyst = mockBrowser('analyst');
    expect((await bulkRun(analyst, [promptAt(2), promptAt(3)])).status).toBe(202);
    const again = await bulkRun(analyst, [promptAt(3), promptAt(2)]);
    expect(again.status).toBe(409);
    expect(again.code).toBe('check_pending');
    expect(again.body.prompt_ids).toEqual([promptAt(2), promptAt(3)].sort());
    expect(skipsOf(again)).toHaveLength(4);
    expect(skipsOf(again).every((skip) => skip.reason === 'check_pending')).toBe(true);
    const list = await analyst.call('GET', `${FYNIX}/runs`);
    expect(
      z.object({ manual_runs_today: z.object({ used: z.number() }) }).parse(list.body.meta).manual_runs_today.used,
    ).toBe(1);
    // The answers have had time to come
    clock = START + PENDING_MS;
    expect((await bulkRun(mockBrowser('analyst'), [promptAt(2), promptAt(3)])).status).toBe(202);
  });

  it('is a 422 nothing_to_run with its skips when the planner leaves out every prompt, and counts no run', async () => {
    const editor = mockBrowser('editor');
    await editor.call('PUT', `${FYNIX}/engines/gemini_web`, { location_ids: [2276] });
    const answer = await bulkRun(editor, [HINDI], ['gemini_web']);
    expect(answer.status).toBe(422);
    expect(answer.code).toBe('nothing_to_run');
    expect(skipsOf(answer)).toEqual([{ prompt_id: HINDI, engine_code: 'gemini_web', reason: 'location_not_enabled' }]);
    expect(answer.body).not.toHaveProperty('prompt_ids');
    const list = await editor.call('GET', `${FYNIX}/runs`);
    expect(
      z.object({ manual_runs_today: z.object({ used: z.number() }) }).parse(list.body.meta).manual_runs_today.used,
    ).toBe(0);
  });

  it('takes up to 150 prompts, 151 are too many, and a prompt that is not asked is one error on prompt_ids', async () => {
    const analyst = mockBrowser('analyst');
    const many = Array.from(
      { length: BULK_RUN_MAX },
      (_, place) => `0192d1a8-9a01-7b44-8c2d-${String(place).padStart(12, '0')}`,
    );
    const unknown = await bulkRun(analyst, many);
    expect(unknown.status).toBe(422);
    expect(fieldCodes(unknown)).toEqual(['prompt_ids:prompt_unknown']);
    expect(bodyErrors(unknown)[0]?.message).toBe(
      'A prompt the project does not ask: archived, deleted or of another project.',
    );
    expect(fieldCodes(await bulkRun(analyst, [...many, UNKNOWN]))).toEqual(['prompt_ids:too_long']);
    // The whole of the project's active prompts at once is one run
    const all = await bulkRun(analyst, ids(0, 24));
    expect(all.status).toBe(202);
    expect(metaOf(all)).toMatchObject({ prompts: 24, answers: 48 });
  });

  it('refuses an archived prompt and a prompt of another project as unknown', async () => {
    const editor = mockBrowser('editor');
    expect((await editor.call('DELETE', `${FYNIX}/prompts/${promptAt(4)}`)).status).toBe(204);
    expect(fieldCodes(await bulkRun(editor, [promptAt(2), promptAt(4)]))).toEqual(['prompt_ids:prompt_unknown']);
    expect(fieldCodes(await bulkRun(editor, [promptAt(2)], undefined, CLEANSTART))).toEqual([
      'prompt_ids:prompt_unknown',
    ]);
  });

  it('refuses an engine the project has not turned on, and a project with no engine', async () => {
    const editor = mockBrowser('editor');
    const off = await bulkRun(editor, [promptAt(2)], ['google_ai_mode', 'gemini_web', 'chatgpt_web']);
    expect(off.status).toBe(422);
    expect(fieldCodes(off)).toEqual(['engine_codes:engine_not_enabled']);
    expect(bodyErrors(off)[0]?.message).toBe('google_ai_mode: The engine is not turned on for the project.');
    // Without engine_codes the engines on are asked; with none on, there is nothing to ask them on
    await editor.call('DELETE', `${FYNIX}/engines/chatgpt_web`);
    await editor.call('DELETE', `${FYNIX}/engines/gemini_web`);
    const none = await bulkRun(editor, [promptAt(2)]);
    expect(fieldCodes(none)).toEqual(['engine_codes:engine_not_enabled']);
    expect(bodyErrors(none)[0]?.message).toBe('The project has no engine turned on.');
  });

  it('checks the body as the API does', async () => {
    const analyst = mockBrowser('analyst');
    const codes = async (body: unknown): Promise<string[]> =>
      fieldCodes(await analyst.call('POST', `${FYNIX}/ai/runs`, body));
    expect(await codes([])).toEqual([':model_attributes_type']);
    expect(await codes({})).toEqual(['prompt_ids:missing']);
    expect(await codes({ prompt_ids: 'x' })).toEqual(['prompt_ids:list_type']);
    expect(await codes({ prompt_ids: [] })).toEqual(['prompt_ids:too_short']);
    expect(await codes({ prompt_ids: [promptAt(2), 'abc', 'def'] })).toEqual([
      'prompt_ids.1:uuid_parsing',
      'prompt_ids.2:uuid_parsing',
    ]);
    expect(await codes({ prompt_ids: [promptAt(2)], engine_codes: [] })).toEqual(['engine_codes:too_short']);
    expect(await codes({ prompt_ids: [promptAt(2)], engine_codes: 'chatgpt_web' })).toEqual(['engine_codes:list_type']);
    expect(
      await codes({
        prompt_ids: [promptAt(2)],
        engine_codes: ['chatgpt_web', 'gemini_web', 'google_ai_mode', 'chatgpt_web'],
      }),
    ).toEqual(['engine_codes:too_long']);
    expect(await codes({ prompt_ids: [promptAt(2)], engine_codes: ['chatgpt_web', 'bing'] })).toEqual([
      'engine_codes.1:enum',
    ]);
    expect(await codes({ prompt_ids: [promptAt(2)], note: 'x' })).toEqual(['note:extra_forbidden']);
    // A null list of engines is the default
    expect(
      (await analyst.call('POST', `${FYNIX}/ai/runs`, { prompt_ids: [promptAt(2)], engine_codes: null })).status,
    ).toBe(202);
    const broken = await analyst.call('POST', `${FYNIX}/ai/runs`, '{"prompt_ids": [');
    expect(fieldCodes(broken)).toEqual([':json_invalid']);
  });

  it('is for a member who may trigger runs, within the projects they may open', async () => {
    expect((await bulkRun(mockBrowser('viewer'), [promptAt(2)])).code).toBe('forbidden');
    expect((await bulkRun(mockBrowser('billing'), [promptAt(2)])).code).toBe('forbidden');
    expect((await bulkRun(mockBrowser('analyst'), [promptAt(2)])).status).toBe(202);
    const other = `${W}/projects/${MOCK_PROJECTS[2]?.project_id ?? ''}`;
    expect((await bulkRun(mockBrowser('analyst'), [promptAt(2)], undefined, other)).code).toBe('not_found');
  });

  it('stops when the answers of the month would pass the workspace limit, saying what was asked and what is requested', async () => {
    const analyst = mockBrowser('analyst');
    promptsOf(fynix.project_id).answersAsked.set('2026-11', AI_ANSWER_QUOTA);
    const over = await bulkRun(analyst, ids(2, 5));
    expect(over.status).toBe(422);
    expect(over.code).toBe('quota_exceeded');
    expect(over.body).toMatchObject({ limit: AI_ANSWER_QUOTA, requested: 6, quota: 'max_ai_observations_per_month' });
    expect(Number(over.body.used)).toBeGreaterThanOrEqual(AI_ANSWER_QUOTA);
    clock = Date.parse('2026-12-01T12:00:00Z');
    expect((await bulkRun(mockBrowser('analyst'), ids(2, 5))).status).toBe(202);
  });

  it('counts the answers it asks against the month, so the next bulk run sees them', async () => {
    const analyst = mockBrowser('analyst');
    expect((await bulkRun(analyst, ids(2, 5))).status).toBe(202);
    expect(promptsOf(fynix.project_id).answersAsked.get('2026-11')).toBe(6);
  });

  it('checks in the order of the API: the body, the provider, the prompts, the engines, what is on its way, the runs of the day, then the answers of the month', async () => {
    const analyst = mockBrowser('analyst');
    setProviderPaused(true);
    // The body before the provider; the provider before the prompts
    expect(fieldCodes(await bulkRun(analyst, []))).toEqual(['prompt_ids:too_short']);
    const paused = await bulkRun(analyst, [UNKNOWN]);
    expect(paused.status).toBe(503);
    expect(paused.code).toBe('provider_paused');
    expect(paused.headers.get('retry-after')).toBe('300');
    setProviderPaused(false);
    // The prompts before the engines
    expect(fieldCodes(await bulkRun(analyst, [UNKNOWN], ['google_ai_mode']))).toEqual(['prompt_ids:prompt_unknown']);
    // The engines before what is on its way
    expect((await bulkRun(analyst, [promptAt(0)])).status).toBe(202);
    expect(fieldCodes(await bulkRun(analyst, [promptAt(0)], ['google_ai_mode']))).toEqual([
      'engine_codes:engine_not_enabled',
    ]);
    expect((await bulkRun(analyst, [promptAt(0)])).status).toBe(409);
    // What is on its way before the day's runs, the day's runs before the month's answers
    for (let n = 1; n < MANUAL_RUNS_PER_DAY; n += 1) expect((await bulkRun(analyst, [promptAt(n)])).status).toBe(202);
    expect((await bulkRun(analyst, [promptAt(0)])).status).toBe(409);
    promptsOf(fynix.project_id).answersAsked.set('2026-11', AI_ANSWER_QUOTA);
    expect((await bulkRun(analyst, [promptAt(MANUAL_RUNS_PER_DAY)])).code).toBe('manual_run_limit');
  });
});

describe('bulk archive', () => {
  const archive = (who: MockBrowser, body: unknown, project = FYNIX): Promise<Answer> =>
    who.call('POST', `${project}/prompts/bulk-archive`, body);
  const activeIds = async (who: MockBrowser, active: boolean): Promise<string[]> => {
    const found: string[] = [];
    let cursor = '';
    for (;;) {
      const answer = await who.call('GET', `${FYNIX}/prompts?limit=200&filter[is_active]=${String(active)}${cursor}`);
      found.push(...dataOf(answer, z.array(PROMPT_ROW)).map((row) => row.prompt_id));
      const page = pageOf(answer, PAGE);
      if (page.next_cursor === null) return found;
      cursor = `&cursor=${page.next_cursor}`;
    }
  };

  it('archives the prompts it is given, which then leave the active list and keep their answers', async () => {
    const editor = mockBrowser('editor');
    const answer = await archive(editor, { ids: ids(2, 5), archive: true });
    expect(answer.status).toBe(200);
    expect(dataOf(answer, COUNT)).toEqual({ matched: 3, updated: 3 });
    const active = await activeIds(editor, true);
    expect(active).toHaveLength(21);
    expect(ids(2, 5).every((id) => !active.includes(id))).toBe(true);
    expect((await activeIds(editor, false)).sort()).toEqual(ids(2, 5).sort());
    // The answers stay: an archived prompt is still read
    const observations = dataOf(
      await editor.call('GET', `${FYNIX}/ai/observations?limit=200&filter[prompt_id]=${promptAt(2)}`),
      z.array(OBSERVATION),
    );
    expect(observations.length).toBeGreaterThan(0);
  });

  it('does not match an id the project does not have, counts a repeat once, and updates only what changes', async () => {
    const editor = mockBrowser('editor');
    const first = await archive(editor, { ids: [promptAt(2), promptAt(2), promptAt(3), UNKNOWN], archive: true });
    expect(dataOf(first, COUNT)).toEqual({ matched: 2, updated: 2 });
    const again = await archive(editor, { ids: [promptAt(2), promptAt(3), promptAt(4)], archive: true });
    expect(dataOf(again, COUNT)).toEqual({ matched: 3, updated: 1 });
    expect(dataOf(await archive(editor, { ids: [UNKNOWN], archive: true }), COUNT)).toEqual({ matched: 0, updated: 0 });
    // Another project's prompt is not this project's
    expect(dataOf(await archive(editor, { ids: [promptAt(5)], archive: true }, CLEANSTART), COUNT)).toEqual({
      matched: 0,
      updated: 0,
    });
    expect(await activeIds(editor, true)).toContain(promptAt(5));
  });

  it('brings prompts back with archive false, as PATCH is_active true does one', async () => {
    const editor = mockBrowser('editor');
    await archive(editor, { ids: ids(2, 5), archive: true });
    const back = await archive(editor, { ids: [...ids(2, 4), promptAt(6)], archive: false });
    expect(dataOf(back, COUNT)).toEqual({ matched: 3, updated: 2 });
    const active = await activeIds(editor, true);
    expect(active).toHaveLength(23);
    expect(active).toEqual(expect.arrayContaining(ids(2, 4)));
    expect(await activeIds(editor, false)).toEqual([promptAt(4)]);
  });

  it('stops bringing prompts back at the workspace quota, all or none, saying what is used and requested', async () => {
    const editor = mockBrowser('editor');
    await archive(editor, { ids: [promptAt(2), promptAt(3), promptAt(4)], archive: true });
    // Fill the quota to 149 active prompts
    const items = Array.from({ length: PROMPT_QUOTA - 1 - 21 }, (_, place) => ({
      text: `Which agency handles bulk archive case ${String(place)}?`,
      language_code: 'en',
      country_iso: 'DE',
    }));
    expect((await editor.call('POST', `${FYNIX}/prompts/bulk-create`, { items })).status).toBe(200);
    const over = await archive(editor, { ids: [promptAt(2), promptAt(3)], archive: false });
    expect(over.status).toBe(422);
    expect(over.code).toBe('quota_exceeded');
    expect(over.body).toMatchObject({ limit: PROMPT_QUOTA, used: PROMPT_QUOTA - 1, requested: 2 });
    // Nothing came back
    expect((await activeIds(editor, false)).sort()).toEqual([promptAt(2), promptAt(3), promptAt(4)].sort());
    // One fits; a prompt that is active already is not asked for, and archiving needs no room
    expect(dataOf(await archive(editor, { ids: [promptAt(2), promptAt(5)], archive: false }), COUNT)).toEqual({
      matched: 2,
      updated: 1,
    });
    expect(dataOf(await archive(editor, { ids: [promptAt(5)], archive: true }), COUNT)).toEqual({
      matched: 1,
      updated: 1,
    });
  });

  it('archives up to 1,000 ids and checks the body as the API does', async () => {
    const editor = mockBrowser('editor');
    const codes = async (body: unknown): Promise<string[]> => fieldCodes(await archive(editor, body));
    expect(await codes([])).toEqual([':model_attributes_type']);
    expect(await codes({})).toEqual(['ids:missing', 'archive:missing']);
    expect(await codes({ ids: [promptAt(2)] })).toEqual(['archive:missing']);
    expect(await codes({ archive: true })).toEqual(['ids:missing']);
    expect(await codes({ ids: 'x', archive: true })).toEqual(['ids:list_type']);
    expect(await codes({ ids: [], archive: true })).toEqual(['ids:too_short']);
    expect(await codes({ ids: [promptAt(2), 'abc'], archive: true })).toEqual(['ids.1:uuid_parsing']);
    expect(await codes({ ids: [promptAt(2)], archive: 'maybe' })).toEqual(['archive:bool_type']);
    expect(await codes({ ids: [promptAt(2)], archive: null })).toEqual(['archive:bool_type']);
    expect(await codes({ ids: [promptAt(2)], archive: true, filter: {} })).toEqual(['filter:extra_forbidden']);
    expect(await codes({ ids: Array.from({ length: BULK_ARCHIVE_MAX + 1 }, () => UNKNOWN), archive: true })).toEqual([
      'ids:too_long',
    ]);
    expect(
      dataOf(
        await archive(editor, { ids: Array.from({ length: BULK_ARCHIVE_MAX }, () => UNKNOWN), archive: true }),
        COUNT,
      ),
    ).toEqual({ matched: 0, updated: 0 });
    expect(fieldCodes(await editor.call('POST', `${FYNIX}/prompts/bulk-archive`, '{"ids": ['))).toEqual([
      ':json_invalid',
    ]);
  });

  it('is for a member who may write prompts, within the projects they may open', async () => {
    const body = { ids: [promptAt(2)], archive: true };
    expect((await archive(mockBrowser('viewer'), body)).code).toBe('forbidden');
    expect((await archive(mockBrowser('analyst'), body)).code).toBe('forbidden');
    expect((await archive(mockBrowser('editor'), body)).status).toBe(200);
    const other = `${W}/projects/${MOCK_PROJECTS[2]?.project_id ?? ''}`;
    expect((await archive(mockBrowser('editor'), body, other)).status).toBe(200);
    expect((await archive(mockBrowser('analyst'), body, other)).code).toBe('not_found');
  });

  it('keeps an archived prompt out of a bulk run, and a prompt brought back is asked again', async () => {
    const editor = mockBrowser('editor');
    await archive(editor, { ids: [promptAt(2)], archive: true });
    expect(fieldCodes(await bulkRun(editor, [promptAt(2), promptAt(3)]))).toEqual(['prompt_ids:prompt_unknown']);
    await archive(editor, { ids: [promptAt(2)], archive: false });
    expect((await bulkRun(editor, [promptAt(2), promptAt(3)])).status).toBe(202);
  });
});
