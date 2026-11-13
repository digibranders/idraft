import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  addBudget,
  aiCoverage,
  changeBudget,
  collectionDays,
  currentBudgets,
  dailyEngines,
  duplicateBudget,
  type DailyScope,
  forecastRow,
  newestFinishedAiRun,
  perUnit,
  PLANNED_PER_ENGINE,
  removeBudget,
  unitCostRow,
  validRate,
} from './ai-health-model';
import { EVENTUS_WORLD } from './ai-prompt-world';
import { aiScheduleRuns } from './ai-runs';
import { setAiSeeded } from './ai-seed';
import { MOCK_PROJECTS, MOCK_WORKSPACE } from './fixtures';
import { MOCK_BUDGET_IDS, MOCK_BUDGETS, MOCK_RUNS, type StoredBudget } from './operations-fixtures';
import type { StoredRun, StoredSchedule } from './operations-state';
import { resetMockState } from './state';

/** Thursday 12 November 2026, noon UTC: the run of Thursday 02:00 UTC has finished. */
const NOW = Date.parse('2026-11-12T12:00:00Z');
const eventus = MOCK_PROJECTS.find((project) => project.slug === 'eventus-security');
if (eventus === undefined) throw new Error('The Eventus Security fixture is missing');
const ZONE = 'Asia/Kolkata';

const runs = (): StoredRun[] => aiScheduleRuns(EVENTUS_WORLD, NOW);
const newest = (): StoredRun => {
  const found = newestFinishedAiRun(runs(), eventus.project_id, NOW);
  if (found === undefined) throw new Error('No finished AI run');
  return found;
};

beforeEach(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => NOW);
  setAiSeeded(true);
});
afterEach(() => {
  vi.restoreAllMocks();
  setAiSeeded(false);
});

describe('coverage of an AI run', () => {
  it('degrades Gemini alone in the newest finished run: 132 valid of 150 planned, under 90 percent', () => {
    const run = newest();
    const gemini = aiCoverage(runs(), run, NOW).by_engine.find((row) => row.engine_code === 'gemini_web');
    expect(gemini).toMatchObject({ planned: 150, valid: 132 });
    expect(gemini?.valid_rate.value).toBe(0.88);
    expect(gemini?.valid_rate.value ?? 1).toBeLessThan(0.9);
    const others = aiCoverage(runs(), run, NOW).by_engine.filter((row) => row.engine_code !== 'gemini_web');
    expect(others.map((row) => row.engine_code)).toEqual(['chatgpt_web', 'google_ai_mode']);
    for (const row of others) expect(row.valid_rate.value ?? 0).toBeGreaterThanOrEqual(0.9);
  });

  it('keeps every older run healthy: only the newest finished run is degraded', () => {
    const all = runs();
    const older = all.filter((run) => run.run_id !== newest().run_id);
    expect(older.length).toBeGreaterThan(5);
    for (const run of older) {
      for (const row of aiCoverage(all, run, NOW).by_engine) {
        expect(row.valid_rate.value ?? 0, `${run.run_id} ${row.engine_code}`).toBeGreaterThanOrEqual(0.9);
      }
    }
  });

  it('adds up on every engine: observed is valid plus empty, refused and error, partial is inside valid', () => {
    for (const row of aiCoverage(runs(), newest(), NOW).by_engine) {
      const { empty, refused, error } = row.invalid_by_status;
      expect(row.observed).toBe(row.valid + empty + refused + error);
      expect(row.partial).toBeLessThanOrEqual(row.valid);
      expect(row.valid_rate.numerator).toBe(row.valid);
      expect(row.valid_rate.denominator).toBe(row.planned);
      // The cell counts the answers observed, as the contract does, not the tasks planned
      expect(row.valid_rate.n_observations).toBe(row.valid + empty + refused + error);
    }
  });

  it('lists a missing task for every planned task with no answer, in prompt, engine, location, replicate order', () => {
    const coverage = aiCoverage(runs(), newest(), NOW);
    for (const row of coverage.by_engine) {
      expect(coverage.missing.filter((task) => task.engine_code === row.engine_code)).toHaveLength(
        row.planned - row.observed,
      );
    }
    const keys = coverage.missing.map((task) =>
      [task.prompt_id, task.engine_code, String(task.location_id ?? 'null'), String(task.replicate_index)].join('|'),
    );
    expect(new Set(keys).size).toBe(keys.length);
    expect(coverage.missing.map((task) => task.prompt_id)).toEqual(
      coverage.missing.map((task) => task.prompt_id).sort(),
    );
  });

  it('says what a run that is not finished has: all pending when it is open, nothing planned when cancelled', () => {
    const [template] = runs();
    if (template === undefined) throw new Error('No AI run');
    const open: StoredRun = { ...template, run_id: 'open', created_at: new Date(NOW - 5_000).toISOString() };
    const opened = aiCoverage([open], open, NOW);
    expect(opened.by_engine.map((row) => [row.observed, row.valid])).toEqual([
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
    expect(opened.missing).toHaveLength(3 * PLANNED_PER_ENGINE);
    expect(new Set(opened.missing.map((task) => task.task_status))).toEqual(new Set(['pending']));
    const cancelled: StoredRun = { ...open, run_id: 'cancelled', cancelled_at: new Date(NOW - 4_000).toISOString() };
    expect(aiCoverage([cancelled], cancelled, NOW)).toEqual({ by_engine: [], missing: [] });
  });

  it('gives a valid rate of null, never 0, when nothing was planned', () => {
    expect(validRate(0, 0, 0)).toEqual({ value: null, numerator: 0, denominator: 0, n_observations: 0, pooled: null });
    expect(validRate(141, 150, 147)).toMatchObject({
      value: 0.94,
      numerator: 141,
      denominator: 150,
      n_observations: 147,
    });
  });
});

describe('daily collection', () => {
  const scope = (over: Partial<DailyScope> = {}): DailyScope => ({
    runs: runs(),
    projectId: eventus.project_id,
    timezone: ZONE,
    now: NOW,
    firstDate: '2026-11-06',
    lastDate: '2026-11-12',
    ...over,
  });
  const lateRun = (over: Partial<StoredRun>): StoredRun => {
    const [template] = runs();
    if (template === undefined) throw new Error('No AI run');
    return { ...template, run_id: 'late', created_at: '2026-11-11T19:30:00.000Z', ...over };
  };

  it('has a row for every day and engine, zero filled, with scheduled null where nothing is known', () => {
    const engines = dailyEngines(scope(), ['chatgpt_web', 'gemini_web'], null);
    // Google AI Mode is not enabled on the project, but its answers are in the window
    expect(engines).toEqual(['chatgpt_web', 'gemini_web', 'google_ai_mode']);
    const rows = collectionDays(scope(), engines);
    expect(rows).toHaveLength(7 * 3);
    const friday = rows.find((row) => row.date === '2026-11-06' && row.engine_code === 'gemini_web');
    expect(friday).toEqual({
      date: '2026-11-06',
      engine_code: 'gemini_web',
      scheduled: null,
      answers: 0,
      by_status: { complete: 0, partial: 0, empty: 0, refused: 0, error: 0 },
      valid: 0,
      budget_blocked: 0,
      runs: [],
    });
  });

  it('puts a run on the project day: 19:30 UTC is the next morning in Kolkata and the same afternoon in New York', () => {
    const dayOf = (timezone: string): string | undefined =>
      collectionDays(scope({ runs: [lateRun({})], timezone, firstDate: '2026-11-10' }), ['chatgpt_web']).find(
        (row) => row.answers > 0,
      )?.date;
    expect(dayOf('Asia/Kolkata')).toBe('2026-11-12');
    expect(dayOf('America/New_York')).toBe('2026-11-11');
  });

  it('counts answers by status, valid as complete plus partial, and the newest finished run is the degraded one', () => {
    const rows = collectionDays(scope(), ['chatgpt_web', 'gemini_web']);
    const thursday = rows.filter((row) => row.date === '2026-11-12');
    for (const row of thursday) {
      const { complete, partial, empty, refused, error } = row.by_status;
      expect(row.answers).toBe(complete + partial + empty + refused + error);
      expect(row.valid).toBe(complete + partial);
      expect(row.runs).toEqual([newest().run_id]);
    }
    expect(thursday.find((row) => row.engine_code === 'gemini_web')).toMatchObject({ valid: 132, scheduled: 150 });
  });

  it('counts a blocked run on the day it was made, as a run, with no scheduled tasks of its own', () => {
    const blocked = lateRun({
      run_id: 'blocked',
      ending: 'budget_blocked',
      blocked_by_budget_id: MOCK_BUDGET_IDS.workspace,
    });
    const [row] = collectionDays(scope({ runs: [blocked], firstDate: '2026-11-12' }), ['chatgpt_web']);
    expect(row).toMatchObject({ scheduled: null, answers: 0, budget_blocked: 1, runs: ['blocked'] });
  });

  it('reads the engines the project has enabled when nothing is filtered, and the filter when there is one', () => {
    expect(dailyEngines(scope({ runs: [] }), ['chatgpt_web', 'gemini_web'], null)).toEqual([
      'chatgpt_web',
      'gemini_web',
    ]);
    expect(dailyEngines(scope(), ['chatgpt_web', 'gemini_web'], ['google_ai_mode', 'gemini_web'])).toEqual([
      'google_ai_mode',
      'gemini_web',
    ]);
  });
});

describe('budgets in memory', () => {
  const draft = {
    workspace_id: MOCK_WORKSPACE.workspace_id,
    project_id: eventus.project_id,
    workload: 'ai_prompt',
    limit_usd: '250.00',
    soft_limit_pct: 90,
    action_on_hard: 'pause',
  } as const satisfies Omit<StoredBudget, 'budget_id' | 'created_at'>;

  it('starts from the fixtures and adds a budget with a new id and the time of the request', () => {
    expect(currentBudgets()).toEqual(MOCK_BUDGETS);
    const made = addBudget(draft, NOW);
    expect(made).toMatchObject({ ...draft, created_at: '2026-11-12T12:00:00.000Z' });
    expect(MOCK_BUDGETS.some((budget) => budget.budget_id === made.budget_id)).toBe(false);
    expect(currentBudgets()).toHaveLength(MOCK_BUDGETS.length + 1);
    expect(addBudget({ ...draft, workload: 'seo_rank' }, NOW).budget_id).not.toBe(made.budget_id);
  });

  it('finds a duplicate by workspace, project and group, a workspace budget (no project) included', () => {
    expect(duplicateBudget(MOCK_WORKSPACE.workspace_id, null, 'all')).toBe(true);
    expect(duplicateBudget(MOCK_WORKSPACE.workspace_id, eventus.project_id, 'ai_prompt')).toBe(false);
    addBudget(draft, NOW);
    expect(duplicateBudget(MOCK_WORKSPACE.workspace_id, eventus.project_id, 'ai_prompt')).toBe(true);
    expect(duplicateBudget('another-workspace', eventus.project_id, 'ai_prompt')).toBe(false);
  });

  it('changes only the limit, the soft limit and the action, and removes by id', () => {
    const changed = changeBudget(MOCK_BUDGET_IDS.fynixRanks, { limit_usd: '55.50', soft_limit_pct: 70 });
    expect(changed).toMatchObject({
      limit_usd: '55.50',
      soft_limit_pct: 70,
      action_on_hard: 'pause',
      workload: 'seo_rank',
    });
    expect(changeBudget('missing', { limit_usd: '1.00' })).toBeUndefined();
    expect(removeBudget(MOCK_BUDGET_IDS.fynixRanks)).toBe(true);
    expect(removeBudget(MOCK_BUDGET_IDS.fynixRanks)).toBe(false);
    expect(currentBudgets().some((budget) => budget.budget_id === MOCK_BUDGET_IDS.fynixRanks)).toBe(false);
  });

  it('forgets every change when the mocks are reset', () => {
    addBudget(draft, NOW);
    removeBudget(MOCK_BUDGET_IDS.workspace);
    resetMockState();
    expect(currentBudgets()).toEqual(MOCK_BUDGETS);
  });
});

describe('forecast', () => {
  const schedule = (over: Partial<StoredSchedule>): StoredSchedule => {
    const [template] = MOCK_RUNS;
    if (template === undefined) throw new Error('No fixture run');
    return {
      schedule_id: 'schedule',
      project_id: eventus.project_id,
      name: 'AI answers',
      workload: 'ai_prompt',
      cadence: 'weekly',
      weekday: 1,
      month_day: null,
      window_start_local: '01:00:00',
      window_hours: 8,
      timezone: ZONE,
      priority: 'standard',
      provider_mode: 'standard_queue',
      selector: { all: true },
      is_active: true,
      created_at: '2026-06-01T09:00:00.000Z',
      deleted_at: null,
      next_run_at: null,
      last_window_at: null,
      ...over,
    };
  };
  const price = { activePrompts: 72, engines: 2 };
  const forecast = (schedules: StoredSchedule[], over: Partial<typeof price> = {}): string | undefined =>
    forecastRow(schedules, eventus.project_id, '2026-11', { ...price, ...over })?.estimated_cost_usd;

  it('is the windows the live schedules open in the month times the price of one full run', () => {
    // November 2026 has five Mondays and four Thursdays; a run is 72 prompts on 2 engines at $0.0012
    expect(forecast([schedule({ weekday: 1 }), schedule({ weekday: 4, schedule_id: 'thursday' })])).toBe('1.555200');
    expect(forecast([schedule({ cadence: 'daily', weekday: null })])).toBe('5.184000');
    expect(forecast([schedule({ cadence: 'monthly', weekday: null, month_day: 20 })])).toBe('0.172800');
  });

  it('adds nothing for a paused or deleted schedule, and leaves the project out when nothing is live', () => {
    expect(forecast([schedule({ is_active: false })])).toBeUndefined();
    expect(forecast([schedule({ deleted_at: '2026-11-01T00:00:00.000Z' })])).toBeUndefined();
    expect(forecast([schedule({ workload: 'seo_rank' })])).toBeUndefined();
    expect(forecast([schedule({ project_id: 'another-project' })])).toBeUndefined();
  });

  it('leaves the project out, not 0, when a run has no price because it asks nothing', () => {
    expect(forecast([schedule({})], { activePrompts: 0 })).toBeUndefined();
    expect(forecast([schedule({})], { engines: 0 })).toBeUndefined();
  });

  it('is flagged an estimate by the price book method', () => {
    expect(forecastRow([schedule({})], eventus.project_id, '2026-11', price)).toMatchObject({
      project_id: eventus.project_id,
      workload: 'ai_prompt',
      method: 'price_book_x_schedules',
      is_estimate: true,
    });
  });
});

describe('unit costs', () => {
  const none = { micros: 0, requests: 0 };
  const row = (over: Partial<Parameters<typeof unitCostRow>[0]> = {}): ReturnType<typeof unitCostRow> =>
    unitCostRow({
      projectId: eventus.project_id,
      month: '2026-11',
      runs: runs(),
      now: NOW,
      activePrompts: 72,
      trackedKeywords: 0,
      seoRank: none,
      ...over,
    });

  it('divides in whole micro-dollars and rounds once, and is null when the divisor is 0 or nothing was spent', () => {
    expect(perUnit(3700, 3)).toBe('0.001233');
    expect(perUnit(3800, 3)).toBe('0.001267');
    expect(perUnit(1200, 1)).toBe('0.001200');
    expect(perUnit(3700, 0)).toBeNull();
    expect(perUnit(0, 5)).toBeNull();
  });

  it('prices the answers of the month per engine, and an engine whose answers carry no cost is null with 0 answers', () => {
    const unit = row();
    expect(unit.per_engine).toEqual({ chatgpt_web: '0.001500', gemini_web: '0.000900', google_ai_mode: null });
    expect(unit.ai_answers_by_engine.google_ai_mode).toBe(0);
    expect(unit.ai_answers_by_engine.chatgpt_web).toBeGreaterThan(0);
    const chatgpt = unit.ai_answers_by_engine.chatgpt_web ?? 0;
    const gemini = unit.ai_answers_by_engine.gemini_web ?? 0;
    expect(unit.per_ai_observation).toBe(perUnit(chatgpt * 1500 + gemini * 900, chatgpt + gemini));
    expect(unit.per_active_prompt_month).toBe(perUnit(chatgpt * 1500 + gemini * 900, 72));
  });

  it('counts only the runs of the month and the project', () => {
    const december = row({ month: '2026-12' });
    expect(december.per_ai_observation).toBeNull();
    expect(Object.values(december.per_engine)).toEqual([null, null, null]);
    expect(Object.values(december.ai_answers_by_engine)).toEqual([0, 0, 0]);
    expect(row({ projectId: 'another-project' }).per_ai_observation).toBeNull();
  });

  it('is null for every figure that has no divisor, never 0', () => {
    const unit = row({ activePrompts: 0 });
    expect(unit.per_active_prompt_month).toBeNull();
    expect(unit.per_tracked_keyword_month).toBeNull();
    expect(unit.per_serp_check).toBeNull();
    expect(unit.extraction_llm_usd).toBeNull();
    const spent = row({ trackedKeywords: 4, seoRank: { micros: 4_000, requests: 8 } });
    expect(spent.per_tracked_keyword_month).toBe('0.001000');
    expect(spent.per_serp_check).toBe('0.000500');
  });
});
