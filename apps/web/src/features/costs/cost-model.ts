import type { CategorySeries, SeriesRole } from '@/lib/charts/category-chart';
import type { BudgetStatus, CostRow } from '@/lib/api/types';

/** The catalog key of a budget state under `costs.states`. */
export const STATE_KEYS = {
  ok: 'ok',
  soft_exceeded: 'softExceeded',
  hard_exceeded: 'hardExceeded',
} as const satisfies Record<BudgetStatus['state'], string>;

/** A money string of the API as a number, or `null` when it is not one. */
export function money(value: string): number | null {
  if (!/^-?\d+(\.\d+)?$/.test(value)) return null;
  return Number(value);
}

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
 * is the most used. `null` when the project has none.
 */
export function projectBudget(list: readonly BudgetStatus[], projectId: string): BudgetStatus | null {
  const own = list.filter((row) => row.budget.project_id === projectId);
  return (
    own.find((row) => row.budget.workload === 'all') ??
    own.reduce<BudgetStatus | null>((most, row) => (most === null || row.pct_used > most.pct_used ? row : most), null)
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
