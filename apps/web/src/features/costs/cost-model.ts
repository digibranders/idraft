import { byEngineOrder } from '@/components/app/engine/order';
import type { CategorySeries, SeriesRole } from '@/lib/charts/category-chart';
import type { BudgetStatus, CostRow, Price, Schemas } from '@/lib/api/types';
import { money } from '@/lib/format/money';

/** What one unit of work cost a project in a month (`GET {W}/costs/unit-costs`). */
export type UnitCostRow = Schemas['UnitCostRow'];

/** The catalog key of a budget state under `costs.states`. */
export const STATE_KEYS = {
  ok: 'ok',
  soft_exceeded: 'softExceeded',
  hard_exceeded: 'hardExceeded',
} as const satisfies Record<BudgetStatus['state'], string>;

export { money };

/** A row's part of a total, or `null` when the total is zero or either is not money. */
export function shareOf(value: string, total: string): number | null {
  const part = money(value);
  const whole = money(total);
  return part === null || whole === null || whole === 0 ? null : part / whole;
}

const ROLES: Readonly<Partial<Record<string, SeriesRole>>> = {
  seo_rank: { kind: 'palette', index: 2 },
  keyword_metrics: { kind: 'palette', index: 3 },
  ai_prompt: { kind: 'palette', index: 4 },
  ai_mode_keyword: { kind: 'palette', index: 5 },
  discovery: { kind: 'palette', index: 6 },
};

/** A workload's color role, fixed so a workload keeps its color from month to month (15 section 5.2). */
export const workloadRole = (workload: string): SeriesRole => ROLES[workload] ?? { kind: 'other' };

const OTHER = 'other';
/** The stack's order, bottom to top: the colored workloads, then every other one as one series. */
const ORDER = ['seo_rank', 'keyword_metrics', 'ai_prompt', 'ai_mode_keyword', 'discovery', OTHER] as const;

const DAY_MS = 86_400_000;

/** Every UTC day from `from` to `to`, both included; none when `to` is before `from`. */
function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let at = Date.parse(`${from}T00:00:00Z`); at <= Date.parse(`${to}T00:00:00Z`); at += DAY_MS) {
    days.push(new Date(at).toISOString().slice(0, 10));
  }
  return days;
}

/**
 * The chart's series from `group_by=day,workload` rows: one per workload with a color role, the rest summed
 * as "Other", in the fixed order, each with a value per day (`null` where nothing was spent).
 */
export function dayWorkloadSeries(
  rows: readonly CostRow[],
  range: { from: string; to: string },
  workloadName: (workload: string) => string,
  otherName: string,
): { days: string[]; series: CategorySeries[] } {
  const days = daysBetween(range.from, range.to);
  const index = new Map(days.map((value, at) => [value, at]));
  const sums = new Map<string, (number | null)[]>();
  for (const row of rows) {
    const at = index.get(row.keys.day ?? '');
    const value = money(row.cost_usd);
    if (at === undefined || value === null) continue;
    const workload = row.keys.workload ?? OTHER;
    const id = ROLES[workload] === undefined ? OTHER : workload;
    const values = sums.get(id) ?? days.map(() => null);
    values[at] = (values[at] ?? 0) + value;
    sums.set(id, values);
  }
  const series = ORDER.flatMap((id): CategorySeries[] => {
    const values = sums.get(id);
    return values === undefined
      ? []
      : [{ id, name: id === OTHER ? otherName : workloadName(id), role: workloadRole(id), values }];
  });
  return { days, series };
}

/** The workspace's own budget for every workload, if it has one. */
export const workspaceBudget = (list: readonly BudgetStatus[]): BudgetStatus | null =>
  list.find((row) => row.budget.project_id === null && row.budget.workload === 'all') ?? null;

/**
 * The budget a project's row shows: its budget for all workloads, else the one of its workload budgets that
 * is the most used. With a Workload filter the row's cost is that of the filtered workloads, so only a budget
 * that covers them counts: the one for all workloads, or one for a workload that is filtered. `null` when the
 * project has none to show.
 */
export function projectBudget(
  list: readonly BudgetStatus[],
  projectId: string,
  workloads: readonly string[] = [],
): BudgetStatus | null {
  const covers = (row: BudgetStatus): boolean =>
    workloads.length === 0 || row.budget.workload === 'all' || workloads.includes(row.budget.workload);
  const own = list.filter((row) => row.budget.project_id === projectId && covers(row));
  return (
    own.find((row) => row.budget.workload === 'all') ??
    own.reduce<BudgetStatus | null>((most, row) => (most === null || row.pct_used > most.pct_used ? row : most), null)
  );
}

/** The cost of one AI answer on one engine of one project. */
export interface UnitCostLine {
  projectId: string;
  /** The API engine code. */
  engine: string;
  /** Mean cost of an answer as the API's money string; `null` when no answer has a cost, which is not zero. */
  perAnswer: string | null;
  /** The answers with a cost that the mean is taken over. */
  answers: number;
}

/**
 * One line per project and engine from the unit costs: the projects as the API sent them, each project's
 * engines in the fixed engine order. An engine is listed when the row has a figure or a count for it.
 */
export function unitCostRows(rows: readonly UnitCostRow[]): UnitCostLine[] {
  return rows.flatMap((row) => {
    const engines = [...new Set([...Object.keys(row.per_engine), ...Object.keys(row.ai_answers_by_engine)])];
    return byEngineOrder(engines, (code) => code).map((engine): UnitCostLine => ({
      projectId: row.project_id,
      engine,
      perAnswer: row.per_engine[engine] ?? null,
      answers: row.ai_answers_by_engine[engine] ?? 0,
    }));
  });
}

/** The price book endpoint each AI engine is asked through (`idraft.domain.ai_engines.ENGINES`). */
const AI_ENDPOINTS: Readonly<Record<string, string>> = {
  chatgpt_web: 'ai_optimization/chat_gpt/llm_scraper',
  gemini_web: 'ai_optimization/gemini/llm_scraper',
  google_ai_mode: 'serp/google/ai_mode',
};

/**
 * The price of one task on an AI engine: the standard queue price of its endpoint, which is the queue the base
 * plan collects on. `null` when the engine has no known endpoint or the book holds no such price, so the table
 * says so rather than guessing.
 */
export function aiEnginePrice(prices: readonly Price[], engine: string): string | null {
  const endpoint = AI_ENDPOINTS[engine];
  if (endpoint === undefined) return null;
  return (
    prices.find((price) => price.endpoint === endpoint && price.conditions.queue === 'standard')?.unit_price_usd ?? null
  );
}

/** Budgets in reading order: the workspace's first, then each project's; within one, all workloads first. */
export function budgetRows(list: readonly BudgetStatus[]): BudgetStatus[] {
  const scope = (row: BudgetStatus): string => row.budget.project_id ?? '';
  const workload = (row: BudgetStatus): string => (row.budget.workload === 'all' ? '' : row.budget.workload);
  const workspaceFirst = (row: BudgetStatus): number => (row.budget.project_id === null ? 0 : 1);
  return [...list].sort(
    (a, b) =>
      workspaceFirst(a) - workspaceFirst(b) ||
      scope(a).localeCompare(scope(b)) ||
      workload(a).localeCompare(workload(b)),
  );
}
