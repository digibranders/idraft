import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { aiHealthHandlers } from './ai-health';
import { handlers } from './index';
import { currentBudgets } from '../ai-health-model';
import { EVENTUS_DEFINITION } from '../ai-prompt-definition';
import { setAiSeeded } from '../ai-seed';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '../fixtures';
import { MOCK_BUDGET_IDS, MOCK_BUDGETS, MOCK_RUNS } from '../operations-fixtures';
import type { Schemas } from '@/lib/api/types';
import { BUDGET_STATUS } from '@/test/api-shapes';
import { TEST_API_ORIGIN } from '@/test/api-server';
import { dataOf, fieldCodes, mockBrowser, type Answer } from '@/test/mock-api';

/**
 * Every answer is read through a strict shape declared against the generated type: a change to the schema breaks
 * this file at compile time, and a member the mock leaves out or adds fails the parse (`strictObject`).
 */
const ENGINE = z.enum(['chatgpt_web', 'gemini_web', 'google_ai_mode']);
const WORKLOAD = z.enum([
  'seo_rank',
  'ai_prompt',
  'keyword_research',
  'ai_benchmark',
  'extraction_llm',
  'first_party',
  'all',
]);
const METRIC_CELL: z.ZodType<Schemas['MetricCell']> = z.strictObject({
  denominator: z.number(),
  n_observations: z.number(),
  numerator: z.number(),
  pooled: z.strictObject({ successes: z.number(), trials: z.number() }).nullable().exactOptional(),
  value: z.number().nullable(),
});
const COVERAGE: z.ZodType<Schemas['AiCoverageResponse']> = z.strictObject({
  data: z.strictObject({
    by_engine: z.array(
      z.strictObject({
        engine_code: ENGINE,
        invalid_by_status: z.strictObject({ empty: z.number(), error: z.number(), refused: z.number() }),
        observed: z.number(),
        partial: z.number(),
        planned: z.number(),
        valid: z.number(),
        valid_rate: METRIC_CELL,
      }),
    ),
    missing: z.array(
      z.strictObject({
        engine_code: ENGINE,
        location_id: z.number().nullable(),
        prompt_id: z.string(),
        replicate_index: z.number(),
        task_status: z.enum([
          'pending',
          'submit_unknown',
          'submitted',
          'ready',
          'fetched',
          'ingested',
          'failed',
          'dead',
          'cancelled',
          'skipped_cached',
        ]),
      }),
    ),
  }),
});
const DAILY: z.ZodType<Schemas['CollectionDailyResponse']> = z.strictObject({
  data: z.array(
    z.strictObject({
      answers: z.number(),
      budget_blocked: z.number(),
      by_status: z.strictObject({
        complete: z.number(),
        empty: z.number(),
        error: z.number(),
        partial: z.number(),
        refused: z.number(),
      }),
      date: z.string(),
      engine_code: ENGINE,
      runs: z.array(z.string()),
      scheduled: z.number().nullable(),
      valid: z.number(),
    }),
  ),
  meta: z.strictObject({
    engine_codes: z.array(ENGINE),
    window: z.strictObject({ from: z.string(), timezone: z.string(), to: z.string() }),
  }),
});
const BUDGET: z.ZodType<Schemas['Budget']> = z.strictObject({
  action_on_hard: z.enum(['pause', 'alert_only']),
  budget_id: z.string(),
  created_at: z.string(),
  limit_usd: z.string(),
  period: z.literal('month'),
  project_id: z.string().nullable(),
  soft_limit_pct: z.number(),
  workload: WORKLOAD,
});
const BUDGET_RESPONSE: z.ZodType<Schemas['BudgetResponse']> = z.strictObject({ data: BUDGET });
const BUDGET_PAGE: z.ZodType<Schemas['BudgetPage']> = z.strictObject({
  data: z.array(BUDGET),
  page: z.strictObject({ limit: z.number(), offset: z.number(), total: z.number() }),
});
const FORECAST: z.ZodType<Schemas['ForecastResponse']> = z.strictObject({
  data: z.array(
    z.strictObject({
      estimated_cost_usd: z.string(),
      is_estimate: z.literal(true),
      method: z.literal('price_book_x_schedules'),
      project_id: z.string(),
      workload: z.literal('ai_prompt'),
    }),
  ),
});
const UNIT_COSTS: z.ZodType<Schemas['UnitCostResponse']> = z.strictObject({
  data: z.array(
    z.strictObject({
      ai_answers_by_engine: z.record(z.string(), z.number()),
      extraction_llm_usd: z.string().nullable(),
      per_active_prompt_month: z.string().nullable(),
      per_ai_observation: z.string().nullable(),
      per_engine: z.record(z.string(), z.string().nullable()),
      per_serp_check: z.string().nullable(),
      per_tracked_keyword_month: z.string().nullable(),
      project_id: z.string(),
    }),
  ),
});
const BUDGET_STATUSES = z.array(BUDGET_STATUS);
const RUN_IDS = z.object({ data: z.array(z.object({ run_id: z.string() })) });

/** Thursday 12 November 2026, noon UTC: the run of Thursday 02:00 UTC has finished. */
const NOW = Date.parse('2026-11-12T12:00:00Z');
const W = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}`;
const fynix = MOCK_PROJECTS.find((project) => project.slug === 'fynix');
const eventus = MOCK_PROJECTS.find((project) => project.slug === 'eventus-security');
if (fynix === undefined || eventus === undefined) throw new Error('The fixture projects are missing');
const EVENTUS = `${W}/projects/${eventus.project_id}`;
const FYNIX = `${W}/projects/${fynix.project_id}`;
const DAILY_WEEK = 'from=2026-11-06&to=2026-11-12';
const [keywordRun] = MOCK_RUNS;
if (keywordRun === undefined) throw new Error('No fixture run');

const NEW_BUDGET = { project_id: eventus.project_id, workload: 'ai_prompt', limit_usd: '250.00', soft_limit_pct: 90 };

beforeEach(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => NOW);
  setAiSeeded(true);
});
afterEach(() => {
  vi.restoreAllMocks();
  setAiSeeded(false);
});

/** The AI runs of Eventus Security, newest first. */
async function aiRunIds(): Promise<string[]> {
  const answer = await mockBrowser('owner').call('GET', `${EVENTUS}/runs?filter[workload_in]=ai_prompt&limit=200`);
  expect(answer.status, JSON.stringify(answer.body)).toBe(200);
  return RUN_IDS.parse(answer.body).data.map((run) => run.run_id);
}

async function coverageOf(runId: string): Promise<Schemas['AiCoverageResponse']> {
  const answer = await mockBrowser('owner').call('GET', `${EVENTUS}/runs/${runId}/ai-coverage`);
  expect(answer.status, JSON.stringify(answer.body)).toBe(200);
  return COVERAGE.parse(answer.body);
}

describe('AI coverage of a run', () => {
  it('coverage answers the generated AiCoverageResponse shape', async () => {
    const [newest] = await aiRunIds();
    if (newest === undefined) throw new Error('Eventus has no AI run');
    const { data } = await coverageOf(newest);
    expect(data.by_engine.map((row) => row.engine_code)).toEqual(['chatgpt_web', 'gemini_web', 'google_ai_mode']);
    const gemini = data.by_engine.find((row) => row.engine_code === 'gemini_web');
    // The newest finished run has one degraded engine: 132 of 150 answers valid, under the 90 percent line
    expect(gemini).toMatchObject({ planned: 150, valid: 132 });
    expect(gemini?.valid_rate).toMatchObject({ numerator: 132, denominator: 150, value: 0.88 });
    for (const row of data.by_engine.filter((candidate) => candidate.engine_code !== 'gemini_web')) {
      expect(row.valid_rate.value ?? 0).toBeGreaterThanOrEqual(0.9);
    }
  });

  it('coverage numbers add up: observed is valid plus the invalid statuses', async () => {
    const ids = await aiRunIds();
    expect(ids.length).toBeGreaterThan(2);
    for (const id of ids.slice(0, 3)) {
      const { data } = await coverageOf(id);
      for (const row of data.by_engine) {
        const { empty, refused, error } = row.invalid_by_status;
        expect(row.observed).toBe(row.valid + empty + refused + error);
        expect(row.partial).toBeLessThanOrEqual(row.valid);
        expect(data.missing.filter((task) => task.engine_code === row.engine_code)).toHaveLength(
          row.planned - row.observed,
        );
      }
    }
    // An older run is healthy
    const older = await coverageOf(ids[1] ?? '');
    expect(older.data.by_engine.find((row) => row.engine_code === 'gemini_web')?.valid_rate.value ?? 0).toBeGreaterThan(
      0.9,
    );
  });

  it('a keyword run is 422 not_an_ai_run', async () => {
    const answer = await mockBrowser('owner').call('GET', `${FYNIX}/runs/${keywordRun.run_id}/ai-coverage`);
    expect(answer).toMatchObject({ status: 422, code: 'not_an_ai_run' });
  });

  it('answers 401, 404, 403 and 422 in that order', async () => {
    const [newest] = await aiRunIds();
    const path = `${EVENTUS}/runs/${newest ?? ''}/ai-coverage`;
    expect((await fetch(`${TEST_API_ORIGIN}${path}`)).status).toBe(401);
    // A run of another project is not found, and so is one that does not exist
    expect((await mockBrowser('owner').call('GET', `${FYNIX}/runs/${newest ?? ''}/ai-coverage`)).status).toBe(404);
    expect(
      (await mockBrowser('owner').call('GET', `${EVENTUS}/runs/0192d1a8-ffff-7a10-8e07-000000000001/ai-coverage`))
        .status,
    ).toBe(404);
    // Billing does not hold data:read
    expect((await mockBrowser('billing').call('GET', path)).status).toBe(403);
    const bad = await mockBrowser('owner').call('GET', `${EVENTUS}/runs/not-a-uuid/ai-coverage`);
    expect(bad.status).toBe(422);
    expect(fieldCodes(bad)).toEqual(['run_id:uuid_parsing']);
    expect(fieldCodes(await mockBrowser('owner').call('GET', `${path}?limit=1`))).toEqual(['limit:extra_forbidden']);
  });
});

describe('daily collection', () => {
  const dailyOf = async (query: string): Promise<Schemas['CollectionDailyResponse']> => {
    const answer = await mockBrowser('owner').call('GET', `${EVENTUS}/ai/collection/daily?${query}`);
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    return DAILY.parse(answer.body);
  };

  it('daily answers CollectionDailyResponse with a row for every day and engine', async () => {
    const { data, meta } = await dailyOf(DAILY_WEEK);
    expect(meta).toEqual({
      engine_codes: ['chatgpt_web', 'gemini_web', 'google_ai_mode'],
      window: { from: '2026-11-06', to: '2026-11-12', timezone: 'Asia/Kolkata' },
    });
    expect(data).toHaveLength(7 * 3);
    expect(new Set(data.map((row) => `${row.date} ${row.engine_code}`)).size).toBe(21);
    for (const row of data) {
      const { complete, partial, empty, refused, error } = row.by_status;
      expect(row.answers).toBe(complete + partial + empty + refused + error);
      expect(row.valid).toBe(complete + partial);
    }
    // Wednesday 11 November: nothing was asked, so nothing is known (null, not 0)
    expect(data.find((row) => row.date === '2026-11-11' && row.engine_code === 'chatgpt_web')).toMatchObject({
      scheduled: null,
      answers: 0,
      runs: [],
    });
    // Thursday: the degraded Gemini
    const [newest] = await aiRunIds();
    expect(data.find((row) => row.date === '2026-11-12' && row.engine_code === 'gemini_web')).toMatchObject({
      scheduled: 150,
      valid: 132,
      runs: [newest],
    });
    expect((await dailyOf(`${DAILY_WEEK}&filter[engine_code_in]=gemini_web`)).data).toHaveLength(7);
  });

  it('defaults to the 28 days ending today in the project zone', async () => {
    const { data, meta } = await dailyOf('');
    expect(meta.window).toEqual({ from: '2026-10-16', to: '2026-11-12', timezone: 'Asia/Kolkata' });
    expect(data).toHaveLength(28 * 3);
  });

  it('daily refuses 93 days with window_too_large and 4 engines with 422', async () => {
    const owner = mockBrowser('owner');
    const wide = await owner.call('GET', `${EVENTUS}/ai/collection/daily?from=2026-08-10&to=2026-11-10`);
    expect(wide).toMatchObject({ status: 422, code: 'window_too_large', body: { limit_days: 92 } });
    // 92 days, both ends included, is the longest
    expect((await owner.call('GET', `${EVENTUS}/ai/collection/daily?from=2026-08-11&to=2026-11-10`)).status).toBe(200);
    const four = await owner.call(
      'GET',
      `${EVENTUS}/ai/collection/daily?${DAILY_WEEK}&filter[engine_code_in]=chatgpt_web,gemini_web,google_ai_mode,chatgpt_web`,
    );
    expect(four.status).toBe(422);
    expect(fieldCodes(four)).toEqual(['filter[engine_code_in]:too_long']);
    expect(
      fieldCodes(await owner.call('GET', `${EVENTUS}/ai/collection/daily?filter[engine_code_in]=perplexity_web`)),
    ).toEqual(['filter[engine_code_in].0:enum']);
    expect(fieldCodes(await owner.call('GET', `${EVENTUS}/ai/collection/daily?from=2026-11-12&to=2026-11-06`))).toEqual(
      ['from:range_invalid'],
    );
  });

  it('is zero filled for a project with no AI runs, and null where nothing is known', async () => {
    const answer = await mockBrowser('owner').call('GET', `${FYNIX}/ai/collection/daily?${DAILY_WEEK}`);
    const { data, meta } = DAILY.parse(answer.body);
    expect(meta.engine_codes).toEqual(['chatgpt_web', 'gemini_web']);
    expect(data).toHaveLength(14);
    expect(data.every((row) => row.scheduled === null && row.answers === 0 && row.runs.length === 0)).toBe(true);
  });

  it('answers 401, 404 and 403 as the other project reads do', async () => {
    const path = `${EVENTUS}/ai/collection/daily?${DAILY_WEEK}`;
    expect((await fetch(`${TEST_API_ORIGIN}${path}`)).status).toBe(401);
    expect(
      (await mockBrowser('owner').call('GET', `${W}/projects/0192d1a8-ffff-7a10-8e07-000000000001/ai/collection/daily`))
        .status,
    ).toBe(404);
    expect((await mockBrowser('billing').call('GET', path)).status).toBe(403);
  });
});

describe('budgets', () => {
  const create = (body: unknown, role: 'owner' | 'billing' | 'editor' = 'owner'): Promise<Answer> =>
    mockBrowser(role).call('POST', `${W}/budgets`, body);
  const listed = async (): Promise<Schemas['Budget'][]> => {
    const answer = await mockBrowser('owner').call('GET', `${W}/budgets`);
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    return BUDGET_PAGE.parse(answer.body).data;
  };

  it('created budget is 201 and appears in budgets and in budgets/status', async () => {
    const owner = mockBrowser('owner');
    const made = await owner.call('POST', `${W}/budgets`, NEW_BUDGET);
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const budget = BUDGET_RESPONSE.parse(made.body).data;
    expect(budget).toMatchObject({
      project_id: eventus.project_id,
      workload: 'ai_prompt',
      period: 'month',
      limit_usd: '250.00',
      soft_limit_pct: 90,
      action_on_hard: 'pause',
      created_at: '2026-11-12T12:00:00.000Z',
    });
    const page = BUDGET_PAGE.parse((await owner.call('GET', `${W}/budgets`)).body);
    expect(page.page).toEqual({ offset: 0, limit: 50, total: MOCK_BUDGETS.length + 1 });
    // Oldest first: the new one is last
    expect(page.data.at(-1)?.budget_id).toBe(budget.budget_id);
    const status = dataOf(await owner.call('GET', `${W}/budgets/status?month=2026-11`), BUDGET_STATUSES);
    expect(status.find((reading) => reading.budget.budget_id === budget.budget_id)).toMatchObject({
      state: 'ok',
      spent_usd: '0.000000',
      pct_used: 0,
      blocked_runs: 0,
    });
  });

  it('the mock list of budgets resets between tests', () => {
    // The test before made a budget: the reset after it put the fixtures back
    expect(currentBudgets()).toEqual(MOCK_BUDGETS);
  });

  it('takes the defaults of the columns, a group of all as the workspace, and two places for the limit', async () => {
    const budget = BUDGET_RESPONSE.parse((await create({ workload: 'seo_rank', limit_usd: '10' })).body).data;
    expect(budget).toMatchObject({ project_id: null, soft_limit_pct: 80, action_on_hard: 'pause', limit_usd: '10.00' });
    const unique = await create({
      project_id: null,
      workload: 'ai_benchmark',
      limit_usd: '0',
      action_on_hard: 'alert_only',
    });
    expect(unique.status).toBe(201);
    expect(BUDGET_RESPONSE.parse(unique.body).data).toMatchObject({ limit_usd: '0.00', action_on_hard: 'alert_only' });
  });

  it('a second budget for the same scope is 409 duplicate', async () => {
    expect((await create(NEW_BUDGET)).status).toBe(201);
    expect(await create(NEW_BUDGET)).toMatchObject({ status: 409, code: 'duplicate' });
    // The workspace budget of the fixtures: no project, group all
    expect(await create({ workload: 'all', limit_usd: '5.00' })).toMatchObject({ status: 409, code: 'duplicate' });
    // The same group in another project is a budget of its own
    expect((await create({ ...NEW_BUDGET, project_id: fynix.project_id })).status).toBe(201);
    expect(await listed()).toHaveLength(MOCK_BUDGETS.length + 2);
  });

  it('refuses a project of nothing as project_unknown, and a body outside the bounds', async () => {
    const unknown = await create({ ...NEW_BUDGET, project_id: '0192d1a8-ffff-7a10-8e07-000000000001' });
    expect(unknown.status).toBe(422);
    expect(fieldCodes(unknown)).toEqual(['project_id:project_unknown']);
    const errors = await create({ workload: 'storage', limit_usd: '-1', soft_limit_pct: 101, extra: true });
    expect(errors.status).toBe(422);
    expect(fieldCodes(errors).sort()).toEqual([
      'extra:extra_forbidden',
      'limit_usd:string_pattern_mismatch',
      'soft_limit_pct:less_than_equal',
      'workload:enum',
    ]);
    expect(fieldCodes(await create({ workload: 'all' }))).toEqual(['limit_usd:missing']);
    expect(fieldCodes(await create({ workload: 'seo_rank', limit_usd: '100000000000.00' }))).toEqual([
      'limit_usd:less_than_equal',
    ]);
    expect(fieldCodes(await create({ workload: 'seo_rank', limit_usd: '1.005' }))).toEqual([
      'limit_usd:string_pattern_mismatch',
    ]);
    expect(fieldCodes(await create({ workload: 'seo_rank', limit_usd: '1.00', soft_limit_pct: 0 }))).toEqual([
      'soft_limit_pct:greater_than_equal',
    ]);
    expect((await create('{')).status).toBe(422);
  });

  it('patch and delete change status too', async () => {
    const owner = mockBrowser('owner');
    const id = MOCK_BUDGET_IDS.fynixRanks;
    const patched = await owner.call('PATCH', `${W}/budgets/${id}`, {
      limit_usd: '55.50',
      soft_limit_pct: 70,
      action_on_hard: 'alert_only',
    });
    expect(BUDGET_RESPONSE.parse(patched.body).data).toMatchObject({
      budget_id: id,
      limit_usd: '55.50',
      soft_limit_pct: 70,
      action_on_hard: 'alert_only',
      workload: 'seo_rank',
      project_id: fynix.project_id,
    });
    const reading = async (): Promise<z.infer<typeof BUDGET_STATUS> | undefined> =>
      dataOf(await owner.call('GET', `${W}/budgets/status?month=2026-11`), BUDGET_STATUSES).find(
        (status) => status.budget.budget_id === id,
      );
    expect((await reading())?.budget).toMatchObject({
      limit_usd: '55.50',
      soft_limit_pct: 70,
      action_on_hard: 'alert_only',
    });
    const removed = await owner.call('DELETE', `${W}/budgets/${id}`);
    expect(removed.status).toBe(204);
    expect(await reading()).toBeUndefined();
    expect((await listed()).some((budget) => budget.budget_id === id)).toBe(false);
    expect((await owner.call('DELETE', `${W}/budgets/${id}`)).status).toBe(404);
    expect((await owner.call('PATCH', `${W}/budgets/${id}`, { limit_usd: '1.00' })).status).toBe(404);
  });

  it('refuses an empty patch, a scope that changes, a null and a bad id', async () => {
    const owner = mockBrowser('owner');
    const path = `${W}/budgets/${MOCK_BUDGET_IDS.fynixRanks}`;
    expect(fieldCodes(await owner.call('PATCH', path, {}))).toEqual([':value_error']);
    expect(fieldCodes(await owner.call('PATCH', path, { project_id: null, workload: 'all' }))).toEqual([
      'project_id:extra_forbidden',
      'workload:extra_forbidden',
    ]);
    expect(fieldCodes(await owner.call('PATCH', path, { limit_usd: null }))).toEqual(['limit_usd:null_not_allowed']);
    expect(fieldCodes(await owner.call('PATCH', `${W}/budgets/not-a-uuid`, { limit_usd: '1.00' }))).toEqual([
      'budget_id:uuid_parsing',
    ]);
    expect(fieldCodes(await owner.call('DELETE', `${W}/budgets/not-a-uuid`))).toEqual(['budget_id:uuid_parsing']);
  });

  it('a role without budgets:manage is 403 on the writes', async () => {
    const id = MOCK_BUDGET_IDS.fynixRanks;
    for (const role of ['editor', 'analyst', 'viewer'] as const) {
      const browser = mockBrowser(role);
      expect((await browser.call('POST', `${W}/budgets`, NEW_BUDGET)).status, role).toBe(403);
      expect((await browser.call('PATCH', `${W}/budgets/${id}`, { limit_usd: '1.00' })).status, role).toBe(403);
      expect((await browser.call('DELETE', `${W}/budgets/${id}`)).status, role).toBe(403);
    }
    // Reading costs is its own permission: a viewer cannot, billing and the analyst can
    expect((await mockBrowser('viewer').call('GET', `${W}/budgets`)).status).toBe(403);
    expect((await mockBrowser('analyst').call('GET', `${W}/budgets`)).status).toBe(200);
    expect((await create(NEW_BUDGET, 'billing')).status).toBe(201);
    expect(currentBudgets()).toHaveLength(MOCK_BUDGETS.length + 1);
  });

  it('answers 401 and keeps the page and filter rules of a list', async () => {
    expect((await fetch(`${TEST_API_ORIGIN}${W}/budgets`)).status).toBe(401);
    const owner = mockBrowser('owner');
    const page = BUDGET_PAGE.parse((await owner.call('GET', `${W}/budgets?limit=1&offset=1`)).body);
    // Oldest first: the workspace budget, the research budget Fynix got with its first keyword, then its rank budget
    expect(page.data.map((budget) => budget.budget_id)).toEqual([MOCK_BUDGET_IDS.fynixResearch]);
    expect(page.page).toEqual({ offset: 1, limit: 1, total: 3 });
    const filtered = BUDGET_PAGE.parse(
      (await owner.call('GET', `${W}/budgets?filter[project_id]=${fynix.project_id}`)).body,
    );
    expect(filtered.data.map((budget) => budget.project_id)).toEqual([fynix.project_id, fynix.project_id]);
    expect(
      (await owner.call('GET', `${W}/budgets?filter[project_id]=0192d1a8-ffff-7a10-8e07-000000000001`)).status,
    ).toBe(404);
    expect(fieldCodes(await owner.call('GET', `${W}/budgets?filter[project_id]=nope&limit=0`)).sort()).toEqual([
      'filter[project_id]:uuid_parsing',
      'limit:value_error',
    ]);
  });

  it('a member limited to a project sees its budgets only', async () => {
    // Jonas (analyst) is limited to Fynix and Cleanstart
    const analyst = mockBrowser('analyst');
    const page = BUDGET_PAGE.parse((await analyst.call('GET', `${W}/budgets`)).body);
    expect(page.data.map((budget) => budget.project_id)).toEqual([fynix.project_id, fynix.project_id]);
    expect(page.page.total).toBe(2);
    expect((await analyst.call('GET', `${W}/budgets?filter[project_id]=${eventus.project_id}`)).status).toBe(404);
    // Kwame (billing) manages budgets; limited to Fynix by the owner he manages Fynix's and nothing else
    const owner = mockBrowser('owner');
    const limited = await owner.call('PATCH', `${W}/members/${mockUser('billing').user_id}`, {
      project_ids: [fynix.project_id],
    });
    expect(limited.status).toBe(200);
    const billing = owner.as('billing');
    expect((await billing.call('POST', `${W}/budgets`, { ...NEW_BUDGET, project_id: fynix.project_id })).status).toBe(
      201,
    );
    expect((await billing.call('POST', `${W}/budgets`, NEW_BUDGET)).status).toBe(404);
    expect((await billing.call('POST', `${W}/budgets`, { workload: 'ai_prompt', limit_usd: '5.00' })).status).toBe(404);
    expect(
      (await billing.call('PATCH', `${W}/budgets/${MOCK_BUDGET_IDS.workspace}`, { limit_usd: '1.00' })).status,
    ).toBe(404);
    expect((await billing.call('DELETE', `${W}/budgets/${MOCK_BUDGET_IDS.workspace}`)).status).toBe(404);
    expect((await billing.call('DELETE', `${W}/budgets/${MOCK_BUDGET_IDS.fynixRanks}`)).status).toBe(204);
    const seen = BUDGET_PAGE.parse((await billing.call('GET', `${W}/budgets`)).body);
    expect(new Set(seen.data.map((budget) => budget.project_id))).toEqual(new Set([fynix.project_id]));
  });
});

describe('forecast and unit costs', () => {
  const MONTH = 'month=2026-11';

  it('forecast and unit costs answer their shapes and never return 0 for an unknown figure', async () => {
    const owner = mockBrowser('owner');
    const forecast = FORECAST.parse((await owner.call('GET', `${W}/costs/forecast?${MONTH}`)).body).data;
    // Only Eventus has live AI schedules: five Mondays and four Thursdays of November, 72 prompts on two engines
    const run = EVENTUS_DEFINITION.prompts.length * EVENTUS_DEFINITION.engines.length * 1200;
    expect(forecast).toEqual([
      {
        project_id: eventus.project_id,
        workload: 'ai_prompt',
        estimated_cost_usd: `${String(Math.floor((9 * run) / 1_000_000))}.${String((9 * run) % 1_000_000).padStart(6, '0')}`,
        method: 'price_book_x_schedules',
        is_estimate: true,
      },
    ]);
    const unit = UNIT_COSTS.parse((await owner.call('GET', `${W}/costs/unit-costs?${MONTH}`)).body).data;
    expect(unit.map((row) => row.project_id).sort()).toEqual(MOCK_PROJECTS.map((project) => project.project_id).sort());
    const money = (row: (typeof unit)[number]): (string | null)[] => [
      row.extraction_llm_usd,
      row.per_active_prompt_month,
      row.per_ai_observation,
      row.per_serp_check,
      row.per_tracked_keyword_month,
      ...Object.values(row.per_engine),
    ];
    for (const row of unit) {
      for (const figure of money(row))
        expect(figure === null || Number(figure) > 0, `${row.project_id} ${String(figure)}`).toBe(true);
    }
    const eventusRow = unit.find((row) => row.project_id === eventus.project_id);
    expect(eventusRow?.per_engine).toEqual({ chatgpt_web: '0.001500', gemini_web: '0.000900', google_ai_mode: null });
    expect(eventusRow?.ai_answers_by_engine.google_ai_mode).toBe(0);
    // The answers behind the figures are the observed answers of the month's finished runs
    const month = await owner.call(
      'GET',
      `${EVENTUS}/runs?filter[workload_in]=ai_prompt&from=2026-11-01T00:00:00Z&to=2026-12-01T00:00:00Z&limit=200`,
    );
    let chatgpt = 0;
    for (const id of RUN_IDS.parse(month.body).data.map((candidate) => candidate.run_id)) {
      chatgpt += (await coverageOf(id)).data.by_engine.find((row) => row.engine_code === 'chatgpt_web')?.observed ?? 0;
    }
    expect(eventusRow?.ai_answers_by_engine.chatgpt_web).toBe(chatgpt);
    // Fynix has no AI run: every figure is unknown, and so is its forecast (it is left out above)
    const fynixRow = unit.find((row) => row.project_id === fynix.project_id);
    expect(fynixRow?.per_ai_observation).toBeNull();
    expect(Object.values(fynixRow?.per_engine ?? {}).every((figure) => figure === null)).toBe(true);
  });

  it('reads the month, a project filter and the member scope as the other cost reads do', async () => {
    const owner = mockBrowser('owner');
    expect(
      FORECAST.parse(
        (await owner.call('GET', `${W}/costs/forecast?month=2026-11&filter[project_id]=${fynix.project_id}`)).body,
      ).data,
    ).toEqual([]);
    expect(fieldCodes(await owner.call('GET', `${W}/costs/forecast?month=2026-13`))).toEqual([
      'month:string_pattern_mismatch',
    ]);
    expect(fieldCodes(await owner.call('GET', `${W}/costs/unit-costs?month=1999-12`))).toEqual([
      'month:string_pattern_mismatch',
    ]);
    // This month when none is given
    expect((await owner.call('GET', `${W}/costs/unit-costs`)).status).toBe(200);
    // Jonas (analyst) is limited to Fynix and Cleanstart
    const analyst = mockBrowser('analyst');
    const rows = UNIT_COSTS.parse((await analyst.call('GET', `${W}/costs/unit-costs`)).body).data;
    expect(rows.map((row) => row.project_id).sort()).toEqual(
      MOCK_PROJECTS.filter((project) => ['fynix', 'cleanstart'].includes(project.slug))
        .map((project) => project.project_id)
        .sort(),
    );
    expect((await analyst.call('GET', `${W}/costs/forecast?filter[project_id]=${eventus.project_id}`)).status).toBe(
      404,
    );
    expect((await mockBrowser('viewer').call('GET', `${W}/costs/forecast`)).status).toBe(403);
    expect((await fetch(`${TEST_API_ORIGIN}${W}/costs/unit-costs`)).status).toBe(401);
  });
});

describe('AI limits', () => {
  const QUOTA = z.strictObject({ limit: z.number(), used: z.number() });
  const LIMITS: z.ZodType<Schemas['AiLimitsResponse']> = z.strictObject({
    data: z.strictObject({ ai_observations_month: QUOTA, manual_runs_today: QUOTA, prompts: QUOTA }),
  });

  it('answers the generated AiLimitsResponse shape with used and limit for each quota', async () => {
    const answer = await mockBrowser('owner').call('GET', `${EVENTUS}/ai/limits`);
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    const { data } = LIMITS.parse(answer.body);
    expect(data.prompts.limit).toBe(150);
    expect(data.prompts.used).toBeGreaterThan(0);
    expect(data.ai_observations_month.limit).toBe(2000);
    expect(data.ai_observations_month.used).toBeGreaterThanOrEqual(0);
  });

  it('answers 401, 404 and 403 as the other project reads do', async () => {
    expect((await fetch(`${TEST_API_ORIGIN}${EVENTUS}/ai/limits`)).status).toBe(401);
    expect(
      (await mockBrowser('owner').call('GET', `${W}/projects/0192d1a8-ffff-7a10-8e07-000000000001/ai/limits`)).status,
    ).toBe(404);
    // Billing reads costs but not prompts and answers
    expect((await mockBrowser('billing').call('GET', `${EVENTUS}/ai/limits`)).status).toBe(403);
  });
});

describe('where the AI health handlers sit', () => {
  it('registers the nine routes once, in the handler list', () => {
    expect(aiHealthHandlers).toHaveLength(9);
    for (const handler of aiHealthHandlers)
      expect(handlers.filter((candidate) => candidate === handler)).toHaveLength(1);
  });
});
