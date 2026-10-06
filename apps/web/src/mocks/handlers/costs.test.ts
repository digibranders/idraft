import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { pctUsed } from './costs';
import { blockingBudget } from './operations-rules';
import { RUN_PLANNED_MS, RUN_WORKING_MS, runView } from '../factories/operations';
import { MOCK_PROJECTS, MOCK_WORKSPACE } from '../fixtures';
import { KEYWORD_OVERVIEW_ENDPOINT, MOCK_BUDGET_IDS, MOCK_RUNS } from '../operations-fixtures';
import { BUDGET_STATUS, COST_META, COST_ROW, OFFSET_PAGE, PRICE } from '@/test/api-shapes';
import { dataOf, fieldCodes, mockBrowser, pageOf } from '@/test/mock-api';

const W = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}`;
const [fynix] = MOCK_PROJECTS;
if (!fynix) throw new Error('The Fynix project fixture is missing');
const P = `${W}/projects/${fynix.project_id}`;
const ROWS = z.array(COST_ROW);
const BUDGETS = z.array(BUDGET_STATUS);
const PRICES = z.array(PRICE);
const NOON = Date.parse('2026-10-01T12:00:00Z');

let clock = NOON;
beforeEach(() => {
  clock = NOON;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** What September's runs cost at the Labs prices of doc 27: per call and per keyword, failed calls free. */
const september = MOCK_RUNS.filter((run) => run.created_at.startsWith('2026-09') && run.ending === 'completed');
const septemberMicros = september.reduce((sum, run) => sum + run.calls * 12_000 + run.tasks_total * 120, 0);
const usd = (micros: number): string => `0.${String(micros).padStart(6, '0')}`;

describe('costs', () => {
  it('groups the period by the keys asked for, with the total and where the figures come from', async () => {
    const analyst = mockBrowser('analyst');
    const answer = await analyst.call('GET', `${W}/costs?from=2026-09-01&to=2026-09-30&group_by=workload,provider`);
    expect(dataOf(answer, ROWS)).toEqual([
      {
        keys: { workload: 'keyword_metrics', provider: 'dataforseo' },
        cost_usd: usd(septemberMicros),
        request_count: september.reduce((sum, run) => sum + run.calls, 0),
        subjects: september.reduce((sum, run) => sum + run.tasks_total, 0),
      },
    ]);
    expect(COST_META.parse(answer.body.meta)).toEqual({
      total_cost_usd: usd(septemberMicros),
      cost_sources: {
        provider_reported: usd(septemberMicros),
        computed_from_tokens: '0.000000',
        price_book_estimate: '0.000000',
      },
    });
    const byDay = dataOf(
      await analyst.call('GET', `${W}/costs?from=2026-09-01&to=2026-09-30&group_by=day&group_by=endpoint`),
      ROWS,
    );
    expect(byDay.find((row) => row.keys.day === '2026-09-20')?.keys.endpoint).toBe(KEYWORD_OVERVIEW_ENDPOINT);
    expect(byDay.reduce((sum, row) => sum + Number(row.cost_usd.replace('.', '')), 0)).toBe(septemberMicros);
    const nothing = await analyst.call('GET', `${W}/costs?from=2026-09-01&to=2026-09-30&filter[workload_in]=seo_rank`);
    expect(dataOf(nothing, ROWS)).toEqual([]);
  });

  it('checks the period and the keys, and is for members who read costs', async () => {
    const analyst = mockBrowser('analyst');
    expect(fieldCodes(await analyst.call('GET', `${W}/costs?to=2026-09-30&group_by=team`))).toEqual([
      'from:missing',
      'group_by:enum',
    ]);
    expect(await analyst.as('viewer').call('GET', `${W}/costs?from=2026-09-01&to=2026-09-30`)).toMatchObject({
      status: 403,
    });
  });

  it('refuses a period that ends before it starts or runs past 366 days, as the backend does', async () => {
    const analyst = mockBrowser('analyst');
    expect(fieldCodes(await analyst.call('GET', `${W}/costs?from=2026-09-30&to=2026-09-01`))).toEqual([
      'to:range_invalid',
    ]);
    // A period holds both its ends: 366 days is the longest, a leap year's
    expect((await analyst.call('GET', `${W}/costs?from=2024-01-01&to=2024-12-31`)).status).toBe(200);
    expect((await analyst.call('GET', `${W}/costs?from=2025-01-01&to=2026-01-01`)).status).toBe(200);
    expect(fieldCodes(await analyst.call('GET', `${W}/costs?from=2025-01-01&to=2026-01-02`))).toEqual([
      'to:range_too_long',
    ]);
  });

  it('refuses a day outside the years 2000 to 2100, and a month outside them', async () => {
    const analyst = mockBrowser('analyst');
    expect(fieldCodes(await analyst.call('GET', `${W}/costs?from=1999-12-31&to=2000-01-02`))).toEqual([
      'from:value_error',
    ]);
    expect(fieldCodes(await analyst.call('GET', `${W}/costs?from=2100-12-31&to=2101-01-01`))).toEqual([
      'to:value_error',
    ]);
    expect((await analyst.call('GET', `${W}/costs?from=2000-01-01&to=2000-01-31`)).status).toBe(200);
    expect(fieldCodes(await analyst.call('GET', `${W}/budgets/status?month=1999-12`))).toEqual([
      'month:string_pattern_mismatch',
    ]);
    expect(fieldCodes(await analyst.call('GET', `${W}/budgets/status?month=2101-01`))).toEqual([
      'month:string_pattern_mismatch',
    ]);
  });

  it('takes at most 7 group_by keys and 20 workloads', async () => {
    const analyst = mockBrowser('analyst');
    const eight = 'project,workload,provider,endpoint,engine,day,channel,project';
    expect(fieldCodes(await analyst.call('GET', `${W}/costs?from=2026-09-01&to=2026-09-30&group_by=${eight}`))).toEqual(
      ['group_by:too_long'],
    );
    const many = Array.from({ length: 21 }, () => 'seo_rank').join(',');
    expect(
      fieldCodes(await analyst.call('GET', `${W}/costs?from=2026-09-01&to=2026-09-30&filter[workload_in]=${many}`)),
    ).toEqual(['filter[workload_in]:too_long']);
  });

  it('answers 404 for a project filter that is not a project the caller sees', async () => {
    const analyst = mockBrowser('analyst');
    const costs = `${W}/costs?from=2026-09-01&to=2026-09-30`;
    expect((await analyst.call('GET', `${costs}&filter[project_id]=${fynix.project_id}`)).status).toBe(200);
    expect(await analyst.call('GET', `${costs}&filter[project_id]=0192d1a8-ffff-7a10-8e07-000000000001`)).toMatchObject(
      { status: 404, code: 'not_found' },
    );
    // Another workspace's project is as unknown
    const owner = mockBrowser('owner');
    const second = await owner.call('POST', '/api/v1/workspaces', { name: 'Second', slug: 'second-filter' });
    const secondId = dataOf(second, z.object({ workspace_id: z.string() })).workspace_id;
    expect(
      (
        await owner.call(
          'GET',
          `/api/v1/workspaces/${secondId}/costs?from=2026-09-01&to=2026-09-30&filter[project_id]=${fynix.project_id}`,
        )
      ).status,
    ).toBe(404);
  });

  it('counts a manual refresh once it has run', async () => {
    const editor = mockBrowser('editor');
    await editor.call('POST', `${P}/keyword-metrics/refresh`, {});
    const october = `${W}/costs?from=2026-10-01&to=2026-10-31&group_by=project`;
    expect(dataOf(await editor.call('GET', october), ROWS)).toEqual([]);
    clock += RUN_PLANNED_MS + RUN_WORKING_MS;
    expect(dataOf(await editor.call('GET', october), ROWS)).toEqual([
      { keys: { project: fynix.project_id }, cost_usd: '0.012360', request_count: 1, subjects: 3 },
    ]);
  });
});

describe('the share of a limit that is used', () => {
  it('is a percent to one decimal, and 100 for a limit of nothing, which is used up from the start', () => {
    expect(pctUsed(12_500_000, 50)).toBe(25);
    expect(pctUsed(1_234_567, 3)).toBe(41.2);
    expect(pctUsed(0, 0)).toBe(100);
    expect(pctUsed(5_000_000, 0)).toBe(100);
  });
});

describe('budgets', () => {
  it('reads each budget against its month: spent, still committed, and its state', async () => {
    const editor = mockBrowser('editor');
    const research = (budgets: z.infer<typeof BUDGETS>) =>
      budgets.find((status) => status.budget.budget_id === MOCK_BUDGET_IDS.fynixResearch);
    const before = dataOf(await editor.call('GET', `${W}/budgets/status?month=2026-09`), BUDGETS);
    expect(before).toHaveLength(3);
    expect(research(before)).toMatchObject({ spent_usd: usd(septemberMicros), state: 'ok', blocked_runs: 0 });
    // Twelve refreshes of every keyword: about 4 cents each against a $0.50 budget
    const refresh = (): Promise<unknown> => editor.call('POST', `${P}/keyword-metrics/refresh`, { stale_days: 0 });
    await refresh();
    const planned = research(dataOf(await editor.call('GET', `${W}/budgets/status`), BUDGETS));
    expect(planned?.spent_usd).toBe('0.000000');
    expect(Number(planned?.committed_estimate_usd)).toBeGreaterThan(0.04);
    // Ten in all: past 80% of the limit
    for (let index = 1; index < 10; index += 1) await refresh();
    clock += RUN_PLANNED_MS + RUN_WORKING_MS;
    const soft = research(dataOf(await editor.call('GET', `${W}/budgets/status`), BUDGETS));
    expect(soft).toMatchObject({ state: 'soft_exceeded', committed_estimate_usd: '0.000000' });
    // Twelve: past the limit
    for (let index = 0; index < 2; index += 1) await refresh();
    clock += RUN_PLANNED_MS + RUN_WORKING_MS;
    const statuses = dataOf(await editor.call('GET', `${W}/budgets/status`), BUDGETS);
    expect(research(statuses)?.state).toBe('hard_exceeded');
    expect(research(statuses)?.pct_used).toBeGreaterThan(100);
    // The research budget only alerts, so the runs were not blocked; the workspace budget is far off
    expect(statuses.find((status) => status.budget.budget_id === MOCK_BUDGET_IDS.workspace)?.state).toBe('ok');
  });

  it('keeps each workspace to its own budgets and costs', async () => {
    const owner = mockBrowser('owner');
    const second = await owner.call('POST', '/api/v1/workspaces', { name: 'Second', slug: 'second-costs' });
    const secondId = dataOf(second, z.object({ workspace_id: z.string() })).workspace_id;
    const budgets = await owner.call('GET', `/api/v1/workspaces/${secondId}/budgets/status?month=2026-09`);
    expect(dataOf(budgets, BUDGETS)).toEqual([]);
    const costs = await owner.call('GET', `/api/v1/workspaces/${secondId}/costs?from=2026-09-01&to=2026-09-30`);
    expect(dataOf(costs, ROWS)).toEqual([]);
  });

  it('shows a member limited to some projects the budgets of those projects only', async () => {
    const budgets = dataOf(await mockBrowser('analyst').call('GET', `${W}/budgets/status`), BUDGETS);
    expect(budgets.map((status) => status.budget.project_id)).toEqual([fynix.project_id, fynix.project_id]);
    expect(fieldCodes(await mockBrowser('analyst').call('GET', `${W}/budgets/status?month=2026-13`))).toEqual([
      'month:string_pattern_mismatch',
    ]);
  });
});

describe('the pre-flight budget check', () => {
  it('blocks a run that would pass a hard limit that pauses runs, counting what is already committed', () => {
    const [template] = MOCK_RUNS;
    if (template === undefined) throw new Error('No fixture run');
    // A huge run this month: two million keywords, $252 against the workspace's $250
    const huge = {
      ...template,
      run_id: 'huge',
      created_at: '2026-10-01T08:00:00.000Z',
      tasks_total: 2_000_000,
      calls: 1_000,
    };
    const world = { schedules: [], runs: [...MOCK_RUNS, huge] };
    const next = { project_id: fynix.project_id, workload: 'keyword_metrics' as const };
    const scope = {
      workspaceId: MOCK_WORKSPACE.workspace_id,
      projectIds: new Set(MOCK_PROJECTS.map((project) => project.project_id)),
    };
    expect(blockingBudget(world, scope, next, 43_080, NOON)?.budget_id).toBe(MOCK_BUDGET_IDS.workspace);
    expect(blockingBudget({ schedules: [], runs: [...MOCK_RUNS] }, scope, next, 43_080, NOON)).toBeNull();
    // Another workspace's budgets never block, and its runs never count here
    const elsewhere = { workspaceId: 'another', projectIds: new Set(['another-project']) };
    expect(blockingBudget(world, elsewhere, { ...next, project_id: 'another-project' }, 43_080, NOON)).toBeNull();
    const blocked = runView(
      MOCK_WORKSPACE.workspace_id,
      [],
      { ...huge, ending: 'budget_blocked', blocked_by_budget_id: MOCK_BUDGET_IDS.workspace },
      NOON,
    );
    expect(blocked).toMatchObject({
      status: 'budget_blocked',
      actual_cost_usd: null,
      operation: { status: 'blocked' },
    });
  });
});

describe('price book', () => {
  it('lists the verified Labs prices valid on a day, by provider and endpoint', async () => {
    const analyst = mockBrowser('analyst');
    const all = await analyst.call('GET', `${W}/price-book?limit=5`);
    expect(pageOf(all, OFFSET_PAGE)).toEqual({ offset: 0, limit: 5, total: 16 });
    const overview = dataOf(
      await analyst.call('GET', `${W}/price-book?filter[endpoint]=${KEYWORD_OVERVIEW_ENDPOINT}`),
      PRICES,
    );
    expect(overview.map((price) => [price.price_unit, price.unit_price_usd])).toEqual([
      ['task', '0.012000'],
      ['item', '0.000120'],
    ]);
    expect(overview[0]).toMatchObject({ verified_at: '2026-09-29', valid_to: null });
    const before = await analyst.call('GET', `${W}/price-book?valid_at=2026-09-01`);
    expect(pageOf(before, OFFSET_PAGE).total).toBe(0);
  });
});
