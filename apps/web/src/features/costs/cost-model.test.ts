import { describe, expect, it } from 'vitest';

import {
  aiEnginePrice,
  budgetRows,
  dayWorkloadSeries,
  money,
  projectBudget,
  shareOf,
  STATE_KEYS,
  unitCostRows,
  workloadRole,
  workspaceBudget,
  type UnitCostRow,
} from './cost-model';
import messages from '../../../messages/en.json';
import { budgetStatusStateValues } from '@/lib/api/schema';
import type { Budget, BudgetStatus, CostRow, Price } from '@/lib/api/types';

const costRow = (keys: Record<string, string>, cost: string): CostRow => ({
  keys,
  cost_usd: cost,
  request_count: 1,
  subjects: 1,
});

const budgetStatus = (projectId: string | null, workload: Budget['workload']): BudgetStatus => ({
  budget: {
    budget_id: `${String(projectId)}-${workload}`,
    project_id: projectId,
    workload,
    period: 'month',
    limit_usd: '100.000000',
    soft_limit_pct: 80,
    action_on_hard: 'pause',
    created_at: '2026-09-01T00:00:00Z',
  },
  spent_usd: '64.000000',
  committed_estimate_usd: '6.000000',
  pct_used: 64,
  state: 'ok',
  blocked_runs: 1,
});

describe('cost model', () => {
  it('names a message for every budget state, in camelCase as the catalog keys are', () => {
    const { states } = messages.costs;
    expect(Object.keys(STATE_KEYS).sort()).toEqual([...budgetStatusStateValues].sort());
    expect(Object.values(STATE_KEYS).sort()).toEqual(Object.keys(states).sort());
  });

  it('reads money strings', () => {
    expect(money('12.400000')).toBe(12.4);
    expect(money('0.000250')).toBe(0.00025);
    expect(money('not money')).toBeNull();
    expect(money('')).toBeNull();
    expect(money('1e3')).toBeNull();
  });

  it('gives each row its share of the total', () => {
    expect(shareOf('25.000000', '100.000000')).toBe(0.25);
    expect(shareOf('1.000000', '0.000000')).toBeNull();
    expect(shareOf('x', '1.000000')).toBeNull();
  });

  it('colors workloads by a fixed role', () => {
    expect(workloadRole('seo_rank')).toEqual({ kind: 'palette', index: 2 });
    expect(workloadRole('keyword_metrics')).toEqual({ kind: 'palette', index: 3 });
    expect(workloadRole('ai_prompt')).toEqual({ kind: 'palette', index: 4 });
    expect(workloadRole('ai_mode_keyword')).toEqual({ kind: 'palette', index: 5 });
    expect(workloadRole('discovery')).toEqual({ kind: 'palette', index: 6 });
    expect(workloadRole('gsc_sync')).toEqual({ kind: 'other' });
  });

  it('turns day and workload rows into one series per workload over every day', () => {
    const rows = [
      costRow({ day: '2026-10-02', workload: 'seo_rank' }, '2.000000'),
      costRow({ day: '2026-10-01', workload: 'keyword_metrics' }, '1.500000'),
      costRow({ day: '2026-10-01', workload: 'gsc_sync' }, '0.250000'),
      costRow({ day: '2026-10-01', workload: 'bing_sync' }, '0.250000'),
    ];
    const chart = dayWorkloadSeries(rows, { from: '2026-10-01', to: '2026-10-03' }, (workload) => workload, 'Other');
    expect(chart.days).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
    expect(chart.series.map((entry) => [entry.id, entry.values])).toEqual([
      ['seo_rank', [null, 2, null]],
      ['keyword_metrics', [1.5, null, null]],
      ['other', [0.5, null, null]],
    ]);
    expect(chart.series.map((entry) => [entry.name, entry.role])).toEqual([
      ['seo_rank', { kind: 'palette', index: 2 }],
      ['keyword_metrics', { kind: 'palette', index: 3 }],
      ['Other', { kind: 'other' }],
    ]);
  });

  it('keeps the series in the fixed order whatever order the rows come in', () => {
    const rows = [
      costRow({ day: '2026-10-01', workload: 'discovery' }, '1.000000'),
      costRow({ day: '2026-10-01', workload: 'ai_prompt' }, '1.000000'),
      costRow({ day: '2026-10-01', workload: 'seo_rank' }, '1.000000'),
    ];
    const chart = dayWorkloadSeries(rows, { from: '2026-10-01', to: '2026-10-01' }, (workload) => workload, 'Other');
    expect(chart.series.map((entry) => entry.id)).toEqual(['seo_rank', 'ai_prompt', 'discovery']);
  });

  it('skips rows outside the range or with money it cannot read, and covers a range of one day', () => {
    const rows = [
      costRow({ day: '2026-09-30', workload: 'seo_rank' }, '9.000000'),
      costRow({ day: '2026-10-01', workload: 'seo_rank' }, 'oops'),
      costRow({ day: '2026-10-01', workload: 'discovery' }, '3.000000'),
    ];
    const chart = dayWorkloadSeries(rows, { from: '2026-10-01', to: '2026-10-01' }, (workload) => workload, 'Other');
    expect(chart.days).toEqual(['2026-10-01']);
    expect(chart.series.map((entry) => [entry.id, entry.values])).toEqual([['discovery', [3]]]);
  });

  it('has no days when the range ends before it starts', () => {
    const chart = dayWorkloadSeries([], { from: '2026-10-02', to: '2026-10-01' }, (workload) => workload, 'Other');
    expect(chart).toEqual({ days: [], series: [] });
  });

  it('finds the workspace budget and lists the rest', () => {
    const list = [budgetStatus('p1', 'all'), budgetStatus(null, 'seo_rank'), budgetStatus(null, 'all')];
    expect(workspaceBudget(list)?.budget.budget_id).toBe('null-all');
    expect(workspaceBudget([budgetStatus('p1', 'all')])).toBeNull();
    expect(budgetRows(list).map((row) => row.budget.budget_id)).toEqual(['null-all', 'null-seo_rank', 'p1-all']);
  });

  it('picks the budget a project row stands for: the one for all workloads, else the most used', () => {
    const used = (status: BudgetStatus, pct: number): BudgetStatus => ({ ...status, pct_used: pct });
    const list = [
      used(budgetStatus('p1', 'seo_rank'), 10),
      used(budgetStatus('p1', 'ai_prompt'), 70),
      used(budgetStatus('p2', 'all'), 5),
      used(budgetStatus('p2', 'seo_rank'), 90),
      budgetStatus(null, 'all'),
    ];
    expect(projectBudget(list, 'p1')?.budget.budget_id).toBe('p1-ai_prompt');
    expect(projectBudget(list, 'p2')?.budget.budget_id).toBe('p2-all');
    expect(projectBudget(list, 'p3')).toBeNull();
  });

  it('shows only a budget that covers the workloads the row is filtered to', () => {
    const used = (status: BudgetStatus, pct: number): BudgetStatus => ({ ...status, pct_used: pct });
    const list = [
      used(budgetStatus('p1', 'seo_rank'), 10),
      used(budgetStatus('p1', 'ai_prompt'), 70),
      used(budgetStatus('p2', 'all'), 5),
      used(budgetStatus('p2', 'seo_rank'), 90),
    ];
    // A filter of one workload picks the budget of that workload, not the most used of them all
    expect(projectBudget(list, 'p1', ['seo_rank'])?.budget.budget_id).toBe('p1-seo_rank');
    expect(projectBudget(list, 'p1', ['seo_rank', 'ai_prompt'])?.budget.budget_id).toBe('p1-ai_prompt');
    // None of the project's budgets is for a filtered workload: no budget, rather than another workload's
    expect(projectBudget(list, 'p1', ['discovery'])).toBeNull();
    // The budget for all workloads covers any filter
    expect(projectBudget(list, 'p2', ['discovery'])?.budget.budget_id).toBe('p2-all');
    expect(projectBudget(list, 'p2', ['seo_rank'])?.budget.budget_id).toBe('p2-all');
    // No filter is the same as before
    expect(projectBudget(list, 'p1', [])?.budget.budget_id).toBe('p1-ai_prompt');
  });

  it('lists project budgets by project, the all-workloads one first', () => {
    const list = [
      budgetStatus('p2', 'ai_prompt'),
      budgetStatus('p1', 'seo_rank'),
      budgetStatus('p2', 'all'),
      budgetStatus('p1', 'all'),
    ];
    expect(budgetRows(list).map((row) => row.budget.budget_id)).toEqual([
      'p1-all',
      'p1-seo_rank',
      'p2-all',
      'p2-ai_prompt',
    ]);
  });
});

const unitRow = (projectId: string, over: Partial<UnitCostRow> = {}): UnitCostRow => ({
  project_id: projectId,
  per_tracked_keyword_month: null,
  per_serp_check: null,
  per_active_prompt_month: null,
  per_ai_observation: null,
  extraction_llm_usd: null,
  per_engine: {},
  ai_answers_by_engine: {},
  ...over,
});

describe('unitCostRows', () => {
  it('makes one line per project and engine, engines in the fixed order, projects as the API sent them', () => {
    const rows = unitCostRows([
      unitRow('p2', {
        per_engine: { google_ai_mode: null, gemini_web: '0.000900', chatgpt_web: '0.001500' },
        ai_answers_by_engine: { google_ai_mode: 0, gemini_web: 40, chatgpt_web: 148 },
      }),
      unitRow('p1', { per_engine: { chatgpt_web: '0.001234' }, ai_answers_by_engine: { chatgpt_web: 3 } }),
    ]);
    expect(rows.map((row) => `${row.projectId}/${row.engine}`)).toEqual([
      'p2/chatgpt_web',
      'p2/gemini_web',
      'p2/google_ai_mode',
      'p1/chatgpt_web',
    ]);
    expect(rows.map((row) => row.answers)).toEqual([148, 40, 0, 3]);
  });

  it('keeps a missing figure null and never turns it into zero', () => {
    const [line] = unitCostRows([unitRow('p1', { per_engine: { google_ai_mode: null } })]);
    expect(line).toEqual({ projectId: 'p1', engine: 'google_ai_mode', perAnswer: null, answers: 0 });
  });

  it('lists an engine that has a count but no figure, and one that has a figure but no count', () => {
    const rows = unitCostRows([
      unitRow('p1', { per_engine: { gemini_web: '0.000900' }, ai_answers_by_engine: { chatgpt_web: 2 } }),
    ]);
    expect(rows).toEqual([
      { projectId: 'p1', engine: 'chatgpt_web', perAnswer: null, answers: 2 },
      { projectId: 'p1', engine: 'gemini_web', perAnswer: '0.000900', answers: 0 },
    ]);
  });

  it('puts an engine the fixed order does not know after the known ones', () => {
    const rows = unitCostRows([unitRow('p1', { per_engine: { zeta: '0.001000', chatgpt_web: '0.002000' } })]);
    expect(rows.map((row) => row.engine)).toEqual(['chatgpt_web', 'zeta']);
  });

  it('has no line for a project with no engine at all', () => {
    expect(unitCostRows([unitRow('p1')])).toEqual([]);
  });
});

describe('aiEnginePrice', () => {
  const price = (endpoint: string, queue: string, usd: string): Price => ({
    price_id: `${endpoint}-${queue}`,
    provider_code: 'dataforseo',
    endpoint,
    price_unit: 'task',
    unit_price_usd: usd,
    conditions: { queue },
    valid_from: '2026-07-01',
    valid_to: null,
    verified_at: '2026-07-01',
    source_url: 'https://dataforseo.com/pricing',
  });
  const book = [
    price('ai_optimization/chat_gpt/llm_scraper', 'priority', '0.002400'),
    price('ai_optimization/chat_gpt/llm_scraper', 'standard', '0.001200'),
    price('serp/google/ai_mode', 'standard', '0.001200'),
    price('serp/google/organic', 'standard', '0.000600'),
  ];

  it('takes the standard queue price of the engine endpoint', () => {
    expect(aiEnginePrice(book, 'chatgpt_web')).toBe('0.001200');
    expect(aiEnginePrice(book, 'google_ai_mode')).toBe('0.001200');
  });

  it('is null for an engine whose endpoint has no standard price, and for an engine with no endpoint', () => {
    expect(aiEnginePrice(book, 'gemini_web')).toBeNull();
    expect(aiEnginePrice(book, 'google_ai_overview')).toBeNull();
    expect(aiEnginePrice([], 'chatgpt_web')).toBeNull();
  });
});
