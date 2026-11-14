import { runState, usdOfMicros } from './factories/operations';
import { FIRST_MINTED, mockId } from './mock-ids';
import { AI_ANSWER_MICROS, MOCK_BUDGETS, type BudgetGroup, type StoredBudget } from './operations-fixtures';
import type { StoredRun, StoredSchedule } from './operations-state';
import { ENGINE_CODES, fixturePrompts } from './prompt-fixtures';
import { onMockReset } from './state';
import type { EngineCode, Schemas } from '@/lib/api/types';
import { formatIsoDate } from '@/lib/format';

/**
 * What the AI health mocks answer (WP-30, contracts c3-collection.md and budgets-costs.md): the coverage of an AI
 * run, the daily collection, the budgets a browser edits, the forecast and the unit costs. Pure functions of the
 * runs and schedules of the operation world, plus one list of budgets in memory.
 *
 * shortcut: the answers of an AI run are not kept per task, so a run's coverage is a fixed profile per engine, 150
 * prompts planned on each of the three engines whatever the run's `tasks_total` says. The newest finished run of a
 * project has one degraded engine (Gemini, 132 of 150 valid) so the notice of the AI pages has something to show;
 * every older run is healthy. Move to per-task answers when a flow needs a run whose figures follow its tasks.
 */

/** The base plan's prompt quota: what a full run plans on each engine. */
export const PLANNED_PER_ENGINE = 150;
const DAY_MS = 24 * 60 * 60 * 1000;

interface Profile {
  /** Answers with status `complete` or `partial`. */
  valid: number;
  /** Of the valid answers, the ones flagged `partial`. */
  partial: number;
  empty: number;
  refused: number;
  error: number;
}

const NOTHING: Profile = { valid: 0, partial: 0, empty: 0, refused: 0, error: 0 };
const HEALTHY: Readonly<Record<EngineCode, Profile>> = {
  chatgpt_web: { valid: 141, partial: 3, empty: 2, refused: 1, error: 1 },
  gemini_web: { valid: 140, partial: 3, empty: 3, refused: 1, error: 1 },
  google_ai_mode: { valid: 146, partial: 2, empty: 1, refused: 0, error: 1 },
};
/** Gemini in the newest finished run: 132 of 150 is 88 percent, under the 90 percent line. */
const DEGRADED_GEMINI: Profile = { valid: 132, partial: 4, empty: 6, refused: 3, error: 3 };

/** What one answer costs, in micro-dollars, where the provider reports a cost; Google AI Mode reports none. */
const ENGINE_COST_MICROS: Readonly<Partial<Record<EngineCode, number>>> = { chatgpt_web: 1500, gemini_web: 900 };

interface EngineCounts extends Profile {
  engine_code: EngineCode;
  planned: number;
}

const observedOf = (counts: Profile): number => counts.valid + counts.empty + counts.refused + counts.error;

/**
 * `valid` of `planned`: a cell with numerator and denominator, and no value (never 0) when nothing was planned.
 * `n_observations` is the answers observed, as the contract sets it.
 */
export const validRate = (valid: number, planned: number, observed: number): Schemas['MetricCell'] => ({
  value: planned === 0 ? null : valid / planned,
  numerator: valid,
  denominator: planned,
  n_observations: observed,
  pooled: null,
});

const newestFirst = (a: StoredRun, b: StoredRun): number =>
  b.created_at.localeCompare(a.created_at) || b.run_id.localeCompare(a.run_id);
const oldestFirst = (a: StoredRun, b: StoredRun): number => newestFirst(b, a);

const isAiRunOf = (run: StoredRun, projectId: string): boolean =>
  run.project_id === projectId && run.workload === 'ai_prompt';

const isFinished = (run: StoredRun, now: number): boolean => {
  const { status } = runState(run, now);
  return status === 'completed' || status === 'completed_with_errors';
};

/** The newest AI run of the project that has finished: the one the degraded notice is about. */
export function newestFinishedAiRun(runs: readonly StoredRun[], projectId: string, now: number): StoredRun | undefined {
  return runs
    .filter((run) => isAiRunOf(run, projectId) && isFinished(run, now))
    .sort(newestFirst)
    .at(0);
}

/** The tasks planned and the answers stored per engine: none for a run that was cancelled or blocked. */
function countsOf(run: StoredRun, now: number, degraded: boolean): EngineCounts[] {
  const { status } = runState(run, now);
  if (status === 'cancelled' || status === 'budget_blocked') return [];
  const finished = status === 'completed' || status === 'completed_with_errors';
  return ENGINE_CODES.map((engine) => ({
    engine_code: engine,
    planned: PLANNED_PER_ENGINE,
    ...(!finished ? NOTHING : degraded && engine === 'gemini_web' ? DEGRADED_GEMINI : HEALTHY[engine]),
  }));
}

/** The task status of a planned task that has no answer, by how the run stands. */
const taskStatusOf = (run: StoredRun, now: number, place: number): Schemas['AiCoverageMissing']['task_status'] => {
  const { status } = runState(run, now);
  if (status === 'planned' || status === 'running') return 'pending';
  return status === 'failed' || place % 2 === 1 ? 'dead' : 'failed';
};

const promptIdsOf = (projectId: string): string[] => {
  const ids = fixturePrompts(projectId)
    .map((prompt) => prompt.prompt_id)
    .sort();
  return ids.length > 0 ? ids : Array.from({ length: PLANNED_PER_ENGINE }, (_, place) => mockId('prompt', place + 1));
};

/** Coverage of an AI run (C3): per engine what was planned, stored and valid, and every planned task with no answer. */
export function aiCoverage(runs: readonly StoredRun[], run: StoredRun, now: number): Schemas['AiCoverage'] {
  const degraded = newestFinishedAiRun(runs, run.project_id, now)?.run_id === run.run_id;
  const counts = countsOf(run, now, degraded);
  const prompts = promptIdsOf(run.project_id);
  const missing = counts.flatMap((row, engine) =>
    Array.from({ length: row.planned - observedOf(row) }, (_, place): Schemas['AiCoverageMissing'] => {
      // Every slot is its own prompt, or the next replicate of one when a project has fewer prompts than missing tasks
      const slot = place + engine * 7;
      return {
        prompt_id: prompts[slot % prompts.length] ?? '',
        engine_code: row.engine_code,
        location_id: null,
        replicate_index: Math.floor(slot / prompts.length),
        task_status: taskStatusOf(run, now, place),
      };
    }),
  );
  missing.sort(
    (a, b) =>
      a.prompt_id.localeCompare(b.prompt_id) ||
      ENGINE_CODES.indexOf(a.engine_code) - ENGINE_CODES.indexOf(b.engine_code) ||
      a.replicate_index - b.replicate_index,
  );
  return {
    by_engine: counts.map((row) => ({
      engine_code: row.engine_code,
      planned: row.planned,
      observed: observedOf(row),
      valid: row.valid,
      partial: row.partial,
      invalid_by_status: { empty: row.empty, refused: row.refused, error: row.error },
      valid_rate: validRate(row.valid, row.planned, observedOf(row)),
    })),
    missing,
  };
}

// Daily collection (N5)

export interface DailyScope {
  /** The runs of the operation world; the project's AI runs are read from them. */
  runs: readonly StoredRun[];
  projectId: string;
  timezone: string;
  now: number;
  /** First and last project-local day, both included, as `YYYY-MM-DD`. */
  firstDate: string;
  lastDate: string;
}

interface DayEntry {
  run: StoredRun;
  /** The project-local day the run belongs to. */
  day: string;
  blocked: boolean;
  finished: boolean;
  counts: EngineCounts[];
}

const addDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** Every project day from `first` to `last`, oldest first. */
function daysBetween(first: string, last: string): string[] {
  const days: string[] = [];
  for (let day = first; day <= last; day = addDays(day, 1)) days.push(day);
  return days;
}

/** The AI runs of the project that fall in the window, oldest first, on their project day. */
function entriesOf(scope: DailyScope): DayEntry[] {
  const newest = newestFinishedAiRun(scope.runs, scope.projectId, scope.now);
  return scope.runs
    .filter((run) => isAiRunOf(run, scope.projectId))
    .sort(oldestFirst)
    .map((run): DayEntry => {
      const counts = countsOf(run, scope.now, run.run_id === newest?.run_id);
      return {
        run,
        day: formatIsoDate(run.created_at, scope.timezone),
        blocked: runState(run, scope.now).status === 'budget_blocked',
        finished: isFinished(run, scope.now),
        counts,
      };
    })
    .filter((entry) => entry.day >= scope.firstDate && entry.day <= scope.lastDate);
}

/**
 * The engines the daily rows cover: the filter when there is one, else the engines enabled on the project plus any
 * engine that has tasks in the window.
 */
export function dailyEngines(
  scope: DailyScope,
  enabled: readonly EngineCode[],
  filter: readonly EngineCode[] | null,
): EngineCode[] {
  if (filter !== null) return [...new Set(filter)];
  const planned = new Set(entriesOf(scope).flatMap((entry) => entry.counts.map((row) => row.engine_code)));
  return ENGINE_CODES.filter((code) => enabled.includes(code) || planned.has(code));
}

/** A row for every day and engine, zero filled; `scheduled` is null where no task was planned, never 0. */
export function collectionDays(scope: DailyScope, engines: readonly EngineCode[]): Schemas['CollectionDay'][] {
  const entries = entriesOf(scope);
  return daysBetween(scope.firstDate, scope.lastDate).flatMap((date) =>
    engines.map((engine): Schemas['CollectionDay'] => {
      const today = entries.filter((entry) => entry.day === date);
      const cells = today.flatMap((entry) => {
        const counts = entry.counts.find((row) => row.engine_code === engine);
        return counts === undefined ? [] : [{ entry, counts }];
      });
      const stored = cells.filter(({ entry }) => entry.finished).map(({ counts }) => counts);
      const sum = (pick: (counts: EngineCounts) => number): number =>
        stored.reduce((total, counts) => total + pick(counts), 0);
      const partial = sum((counts) => counts.partial);
      return {
        date,
        engine_code: engine,
        scheduled: cells.length === 0 ? null : cells.reduce((total, { counts }) => total + counts.planned, 0),
        answers: sum(observedOf),
        by_status: {
          complete: sum((counts) => counts.valid) - partial,
          partial,
          empty: sum((counts) => counts.empty),
          refused: sum((counts) => counts.refused),
          error: sum((counts) => counts.error),
        },
        valid: sum((counts) => counts.valid),
        // Runs, not answers: a blocked run asked no engine, so it counts on each of them
        budget_blocked: today.filter((entry) => entry.blocked).length,
        runs: today
          .filter(
            (entry) =>
              entry.blocked ||
              (entry.finished && observedOf(entry.counts.find((row) => row.engine_code === engine) ?? NOTHING) > 0),
          )
          .map((entry) => entry.run.run_id),
      };
    }),
  );
}

// Budgets

let budgets: StoredBudget[] = [...MOCK_BUDGETS];
let minted = FIRST_MINTED - 1;

/**
 * The budgets of every workspace, the fixtures and what this page or test process changed.
 * shortcut: in memory like the prompt mocks, so a page reload starts again from the fixtures; move it to a cookie
 * like ./operations-state.ts when a flow has to survive a reload.
 */
export const currentBudgets = (): readonly StoredBudget[] => budgets;

onMockReset(() => {
  budgets = [...MOCK_BUDGETS];
  minted = FIRST_MINTED - 1;
});

/** Whether the workspace has a budget for this project (null: the whole workspace) and group, for the month. */
export const duplicateBudget = (workspaceId: string, projectId: string | null, workload: BudgetGroup): boolean =>
  budgets.some(
    (budget) => budget.workspace_id === workspaceId && budget.project_id === projectId && budget.workload === workload,
  );

export function addBudget(input: Omit<StoredBudget, 'budget_id' | 'created_at'>, now: number): StoredBudget {
  minted += 1;
  const budget: StoredBudget = {
    ...input,
    budget_id: mockId('budget', minted),
    created_at: new Date(now).toISOString(),
  };
  budgets = [...budgets, budget];
  return budget;
}

export function changeBudget(
  budgetId: string,
  patch: Partial<Pick<StoredBudget, 'limit_usd' | 'soft_limit_pct' | 'action_on_hard'>>,
): StoredBudget | undefined {
  const found = budgets.find((budget) => budget.budget_id === budgetId);
  if (found === undefined) return undefined;
  const changed: StoredBudget = { ...found, ...patch };
  budgets = budgets.map((budget) => (budget.budget_id === budgetId ? changed : budget));
  return changed;
}

export function removeBudget(budgetId: string): boolean {
  const before = budgets.length;
  budgets = budgets.filter((budget) => budget.budget_id !== budgetId);
  return budgets.length < before;
}

/** A budget as the API answers it. */
export const budgetView = (budget: StoredBudget): Schemas['Budget'] => ({
  budget_id: budget.budget_id,
  project_id: budget.project_id,
  workload: budget.workload,
  period: 'month',
  limit_usd: budget.limit_usd,
  soft_limit_pct: budget.soft_limit_pct,
  action_on_hard: budget.action_on_hard,
  created_at: budget.created_at,
});

// Forecast

/** What a full run of the project asks: its active prompts on its enabled engines. */
export interface RunPrice {
  activePrompts: number;
  engines: number;
}

/**
 * The windows a schedule opens in the month. shortcut: the month and the weekday are UTC, where the planner reads
 * them in the schedule's zone; a window near midnight can fall a day off.
 */
function windowsIn(schedule: StoredSchedule, month: string): number {
  const [year = 0, number = 1] = month.split('-').map(Number);
  const days = new Date(Date.UTC(year, number, 0)).getUTCDate();
  if (schedule.cadence === 'daily') return days;
  if (schedule.cadence === 'monthly') return 1;
  return Array.from({ length: days }, (_, day) => new Date(Date.UTC(year, number - 1, day + 1)).getUTCDay()).filter(
    (weekday) => weekday === schedule.weekday,
  ).length;
}

/**
 * The forecast of a project's AI spend in the month: the windows its live schedules open times the price of a full
 * run. `undefined` (the project is left out) when it has no live AI schedule, or a run asks nothing and has no price.
 */
export function forecastRow(
  schedules: readonly StoredSchedule[],
  projectId: string,
  month: string,
  price: RunPrice,
): Schemas['ForecastRow'] | undefined {
  const run = price.activePrompts * price.engines * AI_ANSWER_MICROS;
  const windows = schedules
    .filter(
      (schedule) =>
        schedule.project_id === projectId &&
        schedule.workload === 'ai_prompt' &&
        schedule.is_active &&
        schedule.deleted_at === null,
    )
    .reduce((sum, schedule) => sum + windowsIn(schedule, month), 0);
  if (run === 0 || windows === 0) return undefined;
  return {
    project_id: projectId,
    workload: 'ai_prompt',
    estimated_cost_usd: usdOfMicros(windows * run),
    method: 'price_book_x_schedules',
    is_estimate: true,
  };
}

// Unit costs

/**
 * `total` micro-dollars over `count`, rounded once to the micro-dollar; null when there is no divisor or nothing was
 * booked. shortcut: the mocks cannot tell a cost of nothing from a cost that was never booked, so both are null.
 */
export const perUnit = (total: number, count: number): string | null =>
  count === 0 || total === 0 ? null : usdOfMicros(Math.round(total / count));

export interface UnitCostInput {
  projectId: string;
  /** `YYYY-MM`, UTC. */
  month: string;
  runs: readonly StoredRun[];
  now: number;
  activePrompts: number;
  trackedKeywords: number;
  /** What the month's `seo_rank` runs spent and how many provider requests they made. */
  seoRank: { micros: number; requests: number };
}

/** The unit costs of a project in a month; every figure is null when its divisor is 0, never 0. */
export function unitCostRow(input: UnitCostInput): Schemas['UnitCostRow'] {
  const newest = newestFinishedAiRun(input.runs, input.projectId, input.now);
  const costed = new Map<EngineCode, number>(ENGINE_CODES.map((code) => [code, 0]));
  for (const run of input.runs) {
    if (!isAiRunOf(run, input.projectId) || !run.created_at.startsWith(input.month) || !isFinished(run, input.now)) {
      continue;
    }
    for (const counts of countsOf(run, input.now, run.run_id === newest?.run_id)) {
      // An engine that reports no cost has no costed answer
      if (ENGINE_COST_MICROS[counts.engine_code] !== undefined) {
        costed.set(counts.engine_code, (costed.get(counts.engine_code) ?? 0) + observedOf(counts));
      }
    }
  }
  const spent = ENGINE_CODES.map((code) => (costed.get(code) ?? 0) * (ENGINE_COST_MICROS[code] ?? 0));
  const total = spent.reduce((sum, micros) => sum + micros, 0);
  const answers = [...costed.values()].reduce((sum, count) => sum + count, 0);
  return {
    project_id: input.projectId,
    per_tracked_keyword_month: perUnit(input.seoRank.micros, input.trackedKeywords),
    per_serp_check: perUnit(input.seoRank.micros, input.seoRank.requests),
    per_active_prompt_month: perUnit(total, input.activePrompts),
    per_ai_observation: perUnit(total, answers),
    // The mocks book no extraction cost
    extraction_llm_usd: null,
    per_engine: Object.fromEntries(
      ENGINE_CODES.map((code, place) => [code, perUnit(spent[place] ?? 0, costed.get(code) ?? 0)]),
    ),
    ai_answers_by_engine: Object.fromEntries(ENGINE_CODES.map((code) => [code, costed.get(code) ?? 0])),
  };
}
