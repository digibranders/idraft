# Workspace Costs and Runs (Frontend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a workspace what its data collection costs (month to date, budget state, spend by day and workload, by provider, by project, the price book) and let it follow and cancel a project's collection runs.

**Architecture:** This is Task 12 of `docs/superpowers/plans/2026-10-01-keywords-ui.md`, written out step by step. Two workspace pages inside `WorkspaceShell`: Costs (`/[workspace]/costs`) and Runs (`/[workspace]/ops/runs`). Pure modules turn the API's rows (money as decimal strings) into what the screens show, so the components only lay out. Costs reads `GET {W}/costs` with several `group_by` choices for one month, `GET {W}/budgets/status` and `GET {W}/price-book`. Runs reads `GET {P}/runs` for one project chosen on the page, because the workspace-wide list is not in part 1. Both pages are linked from the project switcher and from Settings' workspace group.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict (`exactOptionalPropertyTypes`), TanStack Query 5, nuqs, next-intl, ECharts 6 through `ChartFrame`, MSW, Vitest with Testing Library, Playwright.

---

## Read first

| What | Where |
|---|---|
| The parent plan and its executor notes (gates, house rules, Opus review, no dashes) | `docs/superpowers/plans/2026-10-01-keywords-ui.md`, "Notes for the executor" and Task 12 |
| Costs template | `docs/design-system/24-page-templates.md` section 9.14 (lines 996 to 1035); `docs/design-system/23-application-patterns.md` lines 728 to 790 (strip, `BudgetMeter`, tables, `BudgetStatusBadge`) |
| Charts | `docs/design-system/15-data-visualization.md` sections 3 to 5; `apps/web/src/lib/charts/category-chart.ts`; `apps/web/src/components/app/chart/chart-frame.tsx` |
| Money and numbers | `docs/design-system/22-content-formatting.md` lines 39 to 54; `apps/web/src/lib/format/number.ts` (`formatCurrency`, `formatInteger`, `formatPercent` if present) |
| Runs | `docs/20-frontend-specification.md` section 5.18 (lines 1001 to 1014); `docs/19-api-specification.md` section 3.11.4 (lines 1536 to 1548); run status display `docs/design-system/17-empty-loading-error-states.md` lines 156 to 222 |
| Navigation | `docs/design-system/11-navigation.md` sections 1, 4 and 5 |
| No-permission state | `docs/design-system/17-empty-loading-error-states.md` line 88 |
| Workspace page pattern | `apps/web/src/app/[workspace]/settings/layout.tsx`, `apps/web/src/features/shell/workspace-shell.tsx` |
| Filter bar pattern | `apps/web/src/features/rankings/keyword-filters.ts` and `src/components/app/filters/*` |

All commands run in `apps/web`. Before any markup, invoke `design-taste-frontend` (house rule); the project's design system outranks its generic advice.

## Facts

**Routes as built** (`backend/openapi/v1.json`; the draft at `apps/web/openapi/step-5-draft.json` matches them except the month pattern, which now allows 2000 to 2100):

| Route | Permission | Query | Answer |
|---|---|---|---|
| `GET {W}/costs` | `costs:read` | `from`, `to` (UTC days, both included, at most 366 days, required); `group_by` (comma list of `project`, `workload`, `provider`, `endpoint`, `engine`, `day`, `channel`; none gives one total row); `filter[project_id]`, `filter[workload_in]`, `filter[provider_code]` | `{ data: [{ keys: { [group]: string }, cost_usd, request_count, subjects }], meta: { total_cost_usd, cost_sources: { provider_reported, computed_from_tokens, price_book_estimate } } }`, most expensive first, up to an hour behind |
| `GET {W}/budgets/status` | `costs:read` | `month` (`YYYY-MM`, UTC, default this month) | `{ data: [{ budget: { budget_id, project_id, workload, period, limit_usd, soft_limit_pct, action_on_hard }, spent_usd, committed_estimate_usd, pct_used, state: 'ok' | 'soft_exceeded' | 'hard_exceeded', blocked_runs }] }`; `workload: 'all'` is a budget with no workload; `project_id: null` is the workspace's |
| `GET {W}/price-book` | `costs:read` | `filter[provider_code]`, `filter[endpoint]`, `valid_at`, `offset`, `limit` | offset page of `{ price_id, provider_code, endpoint, price_unit, unit_price_usd, conditions, valid_from, valid_to, verified_at, source_url }` |
| `GET {P}/runs` | `data:read` | `filter[schedule_id]`, `filter[workload_in]`, `filter[status_in]`, `filter[trigger_in]`, `from`, `to` (instants with a zone; `to` exclusive; on `created_at`), `cursor`, `limit` | cursor page of `Run`, newest first, `meta.manual_runs_today { used, limit }` |
| `GET {P}/runs/{run_id}` | `data:read` | | `RunDetail` = `Run` plus `tasks_by_status` and `config_snapshot` |
| `POST {P}/runs/{run_id}/cancel` | see below | body `{ reason? }` or none | the run, `status: 'cancelled'`, `status_reason: 'cancelled_by_user'` |

- **Money** is a decimal string with six places (`"12.400000"`), never a float on the wire. `formatCurrency(Number(value))` shows it (2 decimals, 4 below one cent). Sums of a page's rows in `Number` are fine at these sizes; the totals shown come from `meta.total_cost_usd` when there is one.
- **`Run`**: `run_id`, `project_id`, `schedule_id`, `workload`, `trigger` (`schedule`, `manual`, `backfill`, `retry`), `status` (`planned`, `running`, `completed`, `completed_with_errors`, `failed`, `cancelled`, `budget_blocked`), `status_reason`, `window_start`, `window_end`, `tasks_total`, `tasks_succeeded`, `tasks_failed`, `estimated_cost_usd`, `actual_cost_usd`, `blocked_by_budget_id`, `created_by { actor_type, actor_id, label } | null`, `created_at`, `completed_at`, `operation`.
- **Cancel**: only `planned` and `running`. Who: `schedules:write` cancels any run; `runs:trigger` cancels the manual runs its holder asked for (`created_by.actor_type === 'user'` and `actor_id` is the member's user id); anyone else is `403 forbidden`. An ended run is `409 invalid_state_transition`. Tasks already sent to the provider still finish (they are paid).
- **`GET {W}/runs` is not in part 1** (the backend, 2026-10-05). The draft and the mocks have it; this plan does not use it, and Task 1 removes its mock so the contract switch in parent Task 13 finds nothing left over.
- Not built, so not shown: projected month end (no forecast route), unit costs per SERP check or prompt (no unit-costs route), reconciliation (deferred), budget editing (with the budgets API). Settings > Budgets and usage does not exist yet; the Budgets tab is read-only with no edit link.
- Reserved project slugs include `costs` and `ops`, so `/[workspace]/costs` and `/[workspace]/ops/runs` never meet a project.
- Inspector types already include `run` (`src/lib/inspector/placement.ts`).

## Decisions

1. **Month scope from a `Select`.** The current month and the 11 before it, labelled "October 2026"; URL key `month` (`YYYY-MM`, absent means the current month). Costs asks `from` the first day to the earlier of the month's last day and today (UTC). Runs asks `from` the month's first instant to the next month's first instant (UTC, `to` exclusive).
2. **Filters on Costs**: Project (one), Workload (several), Provider (one), with URL keys `project`, `workload`, `provider` (13-filters-search.md line 126). They apply to every cost query; budgets and the price book ignore them.
3. **Workload colors are fixed**, never by position: `seo_rank` palette 2, `keyword_metrics` palette 3, `ai_prompt` palette 4, `ai_mode_keyword` palette 5, `discovery` palette 6, every other workload the `other` role, grouped as one "Other" series. `chart-1` stays for the own brand (15 section 5.2).
4. **Tables are plain.** The cost tables are short and fixed (a dozen rows at most), so they are semantic `<table>` elements in one small `CostTable` component styled like the members table, not `DataTable`. Runs is a record list, so it is a `DataTable` in client mode.
5. **Runs per project.** A project `Select` (the member's projects, URL key `project` holding the slug, default the first) above the table. Filters Workload, Status and Trigger (URL keys `workload`, `status`, `trigger`). Rows of the month load page by page up to 2,000; past that, a notice says the newest 2,000 are shown.
6. **No-permission states**: without `costs:read` the Costs page shows the no-access state (17 line 88) with "Back to Overview". Runs needs `data:read`, which every role but billing has (a billing member gets the no-access state).
7. **Navigation**: the project switcher's popup gains a "Workspace" group with Costs (only with `costs:read`) and Runs; Settings' workspace group gains Costs and Operations items linking to the two pages (11-navigation section 5 order: after Members and roles).

## File structure

| File | Responsibility |
|---|---|
| Modify `src/mocks/handlers/runs.ts`, `runs.test.ts` | Remove the `{W}/runs` mock |
| Modify `src/lib/charts/category-chart.ts` (+ test) | `stacked` bars |
| Modify `src/components/app/chart/chart-frame.tsx` | Pass `stacked` through |
| Create `src/lib/format/month.ts` (+ test) | Month keys: list, label, UTC day range, UTC instant range |
| Create `src/features/costs/cost-model.ts` (+ test) | Money parsing, shares, day by workload series, workload roles, budget rows |
| Create `src/features/costs/costs-queries.ts` | The cost, budget and price queries |
| Create `src/features/costs/cost-table.tsx` | Plain table for cost rows |
| Create `src/features/costs/budget-meter.tsx` | 6 px meter with the soft limit tick |
| Create `src/features/costs/budget-status-badge.tsx` | Within budget, Soft limit reached, Budget blocked |
| Create `src/features/costs/costs-screen.tsx` | The page body |
| Create `src/features/costs/costs.test.tsx` | Component tests |
| Create `src/features/costs/index.ts` | Exports |
| Create `src/app/[workspace]/costs/page.tsx` | The route |
| Create `src/features/operations/run-model.ts` (+ test) | Cancel rule, task summary, status display |
| Create `src/features/operations/runs-queries.ts` | Run list (all pages of the month), detail, cancel |
| Create `src/features/operations/run-inspector.tsx` | Summary of one run |
| Create `src/features/operations/runs-screen.tsx` | The page body |
| Create `src/features/operations/runs.test.tsx` | Component tests |
| Create `src/features/operations/index.ts` | Exports |
| Create `src/app/[workspace]/ops/runs/page.tsx` | The route |
| Modify `src/lib/routes/paths.ts` | `costsPath`, `runsPath` |
| Modify `src/components/app/shell/project-switcher.tsx`, `src/features/shell/project-shell.tsx` | Workspace links in the switcher |
| Modify `src/features/settings/settings-frame.tsx` (and its nav types) | Costs and Operations items |
| Modify `messages/en.json` | `costs.*`, `runs.*`, navigation and settings items |
| Modify `e2e/flows/*.spec.ts` | Costs and Runs load; cancel a run |
| Modify `docs/superpowers/plans/2026-10-01-keywords-ui.md` | Task 12 as-built note |

---

### Task 1: Remove the workspace runs mock

**Files:**
- Modify: `apps/web/src/mocks/handlers/runs.ts`
- Modify: `apps/web/src/mocks/handlers/runs.test.ts`

- [ ] **Step 1:** Delete the `mock('get', `${W}/runs`, ...)` handler and the helpers only it uses (`operationsWorkspaceCaller` if nothing else calls it; check with grep). Delete the tests that call `${W}/runs`.

- [ ] **Step 2:** Run `pnpm vitest run src/mocks src/lib/api`.
Expected: PASS. If a test asserts that every route of the schema has a mock handler (look in `src/mocks/handlers/handlers.test.ts` and `src/lib/api/pending.test.ts`), add `GET {W}/runs` to its list of routes the mocks leave out, with the reason "Phase 4: the backend does not build it in step 5 part 1".

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/mocks apps/web/src/lib/api
git commit -m "Mocks: no workspace runs list in part 1"
```

### Task 2: Stacked bars

**Files:**
- Modify: `apps/web/src/lib/charts/category-chart.ts`
- Test: `apps/web/src/lib/charts/category-chart.test.ts`
- Modify: `apps/web/src/components/app/chart/chart-frame.tsx`

- [ ] **Step 1: Write the failing test** (add to `category-chart.test.ts`, reusing its token fixture):

```ts
it('stacks bars into one column per category, rounding only the top of each', () => {
  const option = categoryChartOption({
    kind: 'bar',
    stacked: true,
    categories: ['Oct 1', 'Oct 2'],
    series: [
      { id: 'a', name: 'A', role: { kind: 'palette', index: 2 }, values: [1, 2] },
      { id: 'b', name: 'B', role: { kind: 'palette', index: 3 }, values: [3, 4] },
    ],
    hidden: new Set(),
    patterns: false,
    tokens,
    formatValue: String,
  });
  const series = option.series as { stack?: string; itemStyle: { borderRadius: number[] } }[];
  expect(series.map((entry) => entry.stack)).toEqual(['total', 'total']);
  expect(series.map((entry) => entry.itemStyle.borderRadius)).toEqual([[0, 0, 0, 0], [2, 2, 0, 0]]);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run src/lib/charts/category-chart.test.ts`
Expected: FAIL (`stacked` is not an input; no `stack`).

- [ ] **Step 3: Implement.** Add `stacked?: boolean | undefined` to `CategoryChartInput` with the doc comment "Bars of a category stack into one column (a total that means something, 15 section 4); lines ignore it." In the bar branch:

```ts
if (kind === 'bar') {
  const top = stacked === true && entry === shown[shown.length - 1];
  return {
    ...base,
    type: 'bar',
    barMaxWidth: 24,
    barGap: '8%',
    ...(stacked === true ? { stack: 'total' } : {}),
    itemStyle: { borderRadius: stacked === true && !top ? [0, 0, 0, 0] : [2, 2, 0, 0] },
  };
}
```

Destructure `stacked` from `input`. In `chart-frame.tsx`, add `stacked?: boolean | undefined` to `ChartFrameProps` and pass it into `categoryChartOption` (add it to the `useCallback` dependencies). The frame's Table view lists every series as columns already; with `stacked`, add a Total column only if the table component makes that a one-line change, otherwise leave it.

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run src/lib/charts src/components/app/chart`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/charts apps/web/src/components/app/chart
git commit -m "Charts: stacked bars"
```

### Task 3: Months

**Files:**
- Create: `apps/web/src/lib/format/month.ts`
- Test: `apps/web/src/lib/format/month.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import { monthDays, monthInstants, monthLabel, parseMonth, recentMonths } from './month';

const now = new Date('2026-10-05T12:00:00Z');

describe('months', () => {
  it('lists this month and the 11 before it, newest first', () => {
    const months = recentMonths(now);
    expect(months).toHaveLength(12);
    expect(months[0]).toBe('2026-10');
    expect(months[11]).toBe('2025-11');
  });
  it('reads a month key, or null', () => {
    expect(parseMonth('2026-09')).toBe('2026-09');
    expect(parseMonth('2026-13')).toBeNull();
    expect(parseMonth('1999-01')).toBeNull();
    expect(parseMonth(null)).toBeNull();
  });
  it('labels a month', () => {
    expect(monthLabel('2026-09', 'en')).toBe('September 2026');
  });
  it('gives the UTC days a cost query takes, stopping at today', () => {
    expect(monthDays('2026-09', now)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(monthDays('2026-10', now)).toEqual({ from: '2026-10-01', to: '2026-10-05' });
  });
  it('gives the instants a run query takes, the end exclusive', () => {
    expect(monthInstants('2026-12')).toEqual({ from: '2026-12-01T00:00:00Z', to: '2027-01-01T00:00:00Z' });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run src/lib/format/month.test.ts`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Write the module**

```ts
/**
 * Months as the cost and run pages scope them: `YYYY-MM` keys in UTC, as the API counts cost days and
 * budget months (19 section 3.11.2), between 2000 and 2100.
 */

export type MonthKey = `${number}-${number}`;

const MONTH = /^(20\d{2}|2100)-(0[1-9]|1[0-2])$/;

const keyOf = (year: number, monthIndex: number): MonthKey =>
  `${String(year)}-${String(monthIndex + 1).padStart(2, '0')}` as MonthKey;

const partsOf = (key: MonthKey): { year: number; monthIndex: number } => {
  const [year = '2000', month = '01'] = key.split('-');
  return { year: Number(year), monthIndex: Number(month) - 1 };
};

/** A month key from the URL, or `null` when it is not one. */
export const parseMonth = (value: string | null): MonthKey | null =>
  value !== null && MONTH.test(value) ? (value as MonthKey) : null;

/** This month (UTC) and the 11 before it, newest first. */
export function recentMonths(now: Date, count = 12): MonthKey[] {
  return Array.from({ length: count }, (_, back) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    return keyOf(date.getUTCFullYear(), date.getUTCMonth());
  });
}

/** "September 2026". */
export function monthLabel(key: MonthKey, locale: string): string {
  const { year, monthIndex } = partsOf(key);
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, monthIndex, 1)),
  );
}

const day = (date: Date): string => date.toISOString().slice(0, 10);

/** The month's first and last UTC day, the last no later than today. */
export function monthDays(key: MonthKey, now: Date): { from: string; to: string } {
  const { year, monthIndex } = partsOf(key);
  const last = new Date(Date.UTC(year, monthIndex + 1, 0));
  return { from: day(new Date(Date.UTC(year, monthIndex, 1))), to: day(last < now ? last : now) };
}

/** The month's first instant and the next month's, for a `created_at` range with `to` exclusive. */
export function monthInstants(key: MonthKey): { from: string; to: string } {
  const { year, monthIndex } = partsOf(key);
  const iso = (date: Date): string => `${date.toISOString().slice(0, 19)}Z`;
  return { from: iso(new Date(Date.UTC(year, monthIndex, 1))), to: iso(new Date(Date.UTC(year, monthIndex + 1, 1))) };
}
```

The `as MonthKey` casts sit where a checked string becomes the template type; if the lint config refuses them, make `MonthKey` a branded `string` (`string & { readonly month: unique symbol }`) built only by `keyOf` and `parseMonth`, and keep one cast inside each.

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run src/lib/format/month.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/format/month.ts apps/web/src/lib/format/month.test.ts
git commit -m "Months for cost and run scopes"
```

### Task 4: The cost model (pure)

**Files:**
- Create: `apps/web/src/features/costs/cost-model.ts`
- Test: `apps/web/src/features/costs/cost-model.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import { budgetRows, dayWorkloadSeries, money, shareOf, workloadRole, workspaceBudget } from './cost-model';

describe('cost model', () => {
  it('reads money strings', () => {
    expect(money('12.400000')).toBe(12.4);
    expect(money('not money')).toBeNull();
  });

  it('gives each row its share of the total', () => {
    expect(shareOf('25.000000', '100.000000')).toBe(0.25);
    expect(shareOf('1.000000', '0.000000')).toBeNull();
  });

  it('colors workloads by a fixed role', () => {
    expect(workloadRole('seo_rank')).toEqual({ kind: 'palette', index: 2 });
    expect(workloadRole('keyword_metrics')).toEqual({ kind: 'palette', index: 3 });
    expect(workloadRole('gsc_sync')).toEqual({ kind: 'other' });
  });

  it('turns day and workload rows into one series per workload over every day', () => {
    const rows = [
      { keys: { day: '2026-10-02', workload: 'seo_rank' }, cost_usd: '2.000000', request_count: 1, subjects: 1 },
      { keys: { day: '2026-10-01', workload: 'keyword_metrics' }, cost_usd: '1.500000', request_count: 1, subjects: 1 },
      { keys: { day: '2026-10-01', workload: 'gsc_sync' }, cost_usd: '0.250000', request_count: 1, subjects: 1 },
      { keys: { day: '2026-10-01', workload: 'bing_sync' }, cost_usd: '0.250000', request_count: 1, subjects: 1 },
    ];
    const chart = dayWorkloadSeries(rows, { from: '2026-10-01', to: '2026-10-03' }, (workload) => workload, 'Other');
    expect(chart.days).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
    expect(chart.series.map((entry) => [entry.id, entry.values])).toEqual([
      ['seo_rank', [null, 2, null]],
      ['keyword_metrics', [1.5, null, null]],
      ['other', [0.5, null, null]],
    ]);
  });

  it('finds the workspace budget and lists the rest', () => {
    const status = (projectId: string | null, workload: string) => ({
      budget: { budget_id: `${String(projectId)}-${workload}`, project_id: projectId, workload, period: 'month', limit_usd: '100.000000', soft_limit_pct: 80, action_on_hard: 'pause', created_at: '' },
      spent_usd: '64.000000',
      committed_estimate_usd: '6.000000',
      pct_used: 64,
      state: 'ok',
      blocked_runs: 1,
    });
    const list = [status('p1', 'all'), status(null, 'seo_rank'), status(null, 'all')];
    expect(workspaceBudget(list)?.budget.budget_id).toBe('null-all');
    expect(budgetRows(list).map((row) => row.budget.budget_id)).toEqual(['null-all', 'null-seo_rank', 'p1-all']);
  });
});
```

The budget fixture's `workload` and `state` need the generated union types; type the helper's return as `BudgetStatus` and its parameter as that type's `budget.workload`, so the literal strings check.

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run src/features/costs/cost-model.test.ts`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Write the module**

```ts
import type { CategorySeries, SeriesRole } from '@/lib/charts/category-chart';
import type { components } from '@/lib/api/schema';

export type CostRow = components['schemas']['CostRow'];
export type BudgetStatus = components['schemas']['BudgetStatus'];
export type CostWorkload = components['schemas']['CostWorkload'];

/** A money string of the API as a number, or `null` when it is not one. */
export function money(value: string): number | null {
  if (!/^-?\d+(\.\d+)?$/.test(value)) return null;
  return Number(value);
}

/** A row's part of a total, or `null` when the total is zero. */
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

/** A workload's color role, fixed so a workload keeps its color from month to month. */
export const workloadRole = (workload: string): SeriesRole => ROLES[workload] ?? { kind: 'other' };

const OTHER = 'other';
const ORDER = [...Object.keys(ROLES), OTHER];

/** Every UTC day from `from` to `to`, both included. */
function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let at = Date.parse(`${from}T00:00:00Z`); at <= Date.parse(`${to}T00:00:00Z`); at += 86_400_000) {
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
  const series = ORDER.flatMap((id) => {
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

/** Budgets in reading order: the workspace's first (all workloads, then by workload), then each project's. */
export function budgetRows(list: readonly BudgetStatus[]): BudgetStatus[] {
  const rank = (row: BudgetStatus): string =>
    `${row.budget.project_id === null ? '0' : `1${row.budget.project_id}`}:${row.budget.workload === 'all' ? '' : row.budget.workload}`;
  return [...list].sort((a, b) => rank(a).localeCompare(rank(b)));
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run src/features/costs/cost-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/costs
git commit -m "Costs: the cost model"
```

### Task 5: Costs queries, meter, badge, table

**Files:**
- Create: `apps/web/src/features/costs/costs-queries.ts`
- Create: `apps/web/src/features/costs/budget-meter.tsx`
- Create: `apps/web/src/features/costs/budget-status-badge.tsx`
- Create: `apps/web/src/features/costs/cost-table.tsx`

- [ ] **Step 1: Invoke `design-taste-frontend`** before writing markup.

- [ ] **Step 2: `costs-queries.ts`.** One hook per request, all through `apiQuery`:

```ts
export interface CostScope {
  workspaceId: string;
  month: MonthKey;
  /** Filters from the URL; `undefined` leaves a filter out. */
  projectId?: string | undefined;
  workloads?: readonly CostWorkload[] | undefined;
  provider?: string | undefined;
}

/** `GET {W}/costs` for the month with `groupBy` (none is the total). */
export function useCosts(scope: CostScope, groupBy: readonly CostGroup[], now: Date): UseQueryResult<CostList>;
/** `GET {W}/budgets/status` for the month. */
export function useBudgetStatus(workspaceId: string, month: MonthKey): UseQueryResult<BudgetStatusList>;
/** `GET {W}/price-book` valid on the month's last day, every page (`apiAllPagesQuery`). */
export function usePriceBook(workspaceId: string, month: MonthKey, now: Date): ...;
```

`CostGroup` is the generated `group_by` item type. `from` and `to` come from `monthDays(month, now)`. Pass `now` from the screen (`useState(() => new Date())`), so a test can fix it and the query key stays stable across renders. Leave a filter out of the query when it is `undefined` (the API refuses parameters set to empty).

- [ ] **Step 3: `BudgetMeter`** props `{ pct: number; softLimitPct: number; state: BudgetStatus['state']; size: 'summary' | 'cell'; label: string }`: a 6 px track (`h-1.5`), 160 px wide in the summary and 64 px in a cell, 1 px `border-border-strong` outline, a fill of `min(pct, 100)%` in the neutral fill token for `ok`, warning for `soft_exceeded`, negative for `hard_exceeded` (use the tokens 23-application-patterns lines 737 to 750 name), a 1 px tick at `softLimitPct`. `role="meter"`, `aria-valuenow={pct}`, `aria-valuemin={0}`, `aria-valuemax={100}`, `aria-label={label}`.

- [ ] **Step 4: `BudgetStatusBadge`** props `{ state }`: `Badge` with Within budget (neutral), Soft limit reached (warning), Budget blocked (negative), per 23 lines 782 to 790. Reuse `Badge`'s variants; read its props first.

- [ ] **Step 5: `CostTable`**

```ts
export interface CostColumn<TRow> {
  id: string;
  header: string;
  align: 'left' | 'right';
  cell: (row: TRow) => ReactNode;
}

export interface CostTableProps<TRow> {
  caption: string;
  columns: readonly CostColumn<TRow>[];
  rows: readonly TRow[];
  rowKey: (row: TRow) => string;
  /** A last row in bold, such as the total. */
  footer?: readonly ReactNode[] | undefined;
  status: 'loading' | 'ready' | 'error';
  errorState: ReactNode;
  emptyText: string;
}
```

Markup like the members table (`src/features/workspace-settings/members-screen.tsx`): `<table>` with a visually hidden `<caption>`, `type-label` headers, `tabular-nums` right-aligned money and counts, `border-b border-border-subtle` rows. Loading shows 4 skeleton rows; error shows `errorState`; no rows shows `emptyText` in one full-width cell.

- [ ] **Step 6: Lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/costs
git commit -m "Costs: queries, meter, badge and table"
```

### Task 6: The Costs page

**Files:**
- Create: `apps/web/src/features/costs/costs-screen.tsx`, `apps/web/src/features/costs/index.ts`
- Create: `apps/web/src/app/[workspace]/costs/page.tsx`
- Modify: `apps/web/src/lib/routes/paths.ts`, `apps/web/messages/en.json`
- Test: `apps/web/src/features/costs/costs.test.tsx`

- [ ] **Step 1: Strings** under `costs` (plain text, no en or em dashes):

```json
"costs": {
  "pageTitle": "Costs",
  "title": "Costs",
  "meta": "{month}. Provider days in UTC. Up to an hour behind.",
  "month": "Month",
  "filters": { "project": "Project", "workload": "Workload", "provider": "Provider" },
  "strip": "Month summary",
  "monthToDate": "Month to date",
  "monthToDateContext": "{from} to {to}",
  "budget": "Budget",
  "budgetValue": "{pct}% of {limit}",
  "noBudget": "No budget",
  "blockedRuns": "Blocked runs",
  "chartTitle": "Spend by day, by workload",
  "chartSummary": "Spend per day this month, stacked by workload. {total} in all.",
  "day": "Day",
  "other": "Other",
  "byWorkload": "By workload",
  "workload": "Workload",
  "cost": "Cost (USD)",
  "share": "Share",
  "requests": "Requests",
  "subjects": "Subjects",
  "total": "Total",
  "sources": "Cost sources: provider reported {provider}, from tokens {tokens}, price book estimate {estimate}",
  "tabs": { "label": "Breakdown", "provider": "By provider", "project": "By project", "units": "Unit costs", "budgets": "Budgets" },
  "provider": "Provider",
  "project": "Project",
  "deletedProject": "Deleted project",
  "noProject": "No project",
  "endpoint": "Endpoint",
  "unit": "Unit",
  "unitPrice": "Unit price (USD)",
  "estimate": "Estimate",
  "unitCostsNote": "Prices from the price book. They estimate costs; actual costs come from what providers report.",
  "validFrom": "Valid from",
  "verified": "Checked",
  "scope": "Scope",
  "workspaceScope": "Workspace",
  "limit": "Limit",
  "spent": "Spent",
  "committed": "Planned (estimate)",
  "used": "Used",
  "status": "Status",
  "states": { "ok": "Within budget", "soft_exceeded": "Soft limit reached", "hard_exceeded": "Budget blocked" },
  "allWorkloads": "All workloads",
  "workloads": {
    "seo_rank": "SEO rank", "keyword_metrics": "Keyword metrics", "ai_prompt": "AI prompts", "ai_mode_keyword": "AI mode",
    "discovery": "Discovery", "ai_benchmark": "AI benchmark", "gsc_sync": "Search Console sync", "bing_sync": "Bing sync",
    "ga4_sync": "Analytics sync", "cloudflare_sync": "Cloudflare sync", "ai_overview": "AI Overview",
    "extraction_llm": "Extraction LLM", "keyword_research": "Keyword research", "first_party": "First-party data"
  },
  "empty": "No costs recorded in {month}.",
  "emptyFiltered": "No costs match these filters in {month}.",
  "loadFailed": "The costs could not be loaded.",
  "noAccessTitle": "You do not have access to Costs",
  "noAccessReason": "Viewing costs needs the costs:read permission. Ask an admin of this workspace.",
  "backToOverview": "Back to Overview"
}
```

Check docs/design-system/17 line 88 for the exact no-access wording and use it. Budget workload names: `Budget.workload` has `keyword_research`, `ai_benchmark`, `extraction_llm`, `first_party` and `all`; every one has a label above (`all` is `allWorkloads`).

- [ ] **Step 2: Paths.** In `paths.ts`:

```ts
/** Workspace Costs (11-navigation.md section 1). */
export const costsPath = (workspace: string): Route => `/${encodeURIComponent(workspace)}/costs` as Route;

/** Workspace Operations > Runs. */
export const runsPath = (workspace: string): Route => `/${encodeURIComponent(workspace)}/ops/runs` as Route;
```

- [ ] **Step 3: The route.** `src/app/[workspace]/costs/page.tsx`, like the workspace settings layout: `generateMetadata` with `costs.pageTitle`; the page reads `requireMembership(workspace)`, renders `<WorkspaceShell workspace={...} page={t('title')}>` around `<CostsScreen workspaceId=... projects={...} />`, where `projects` are the member's projects (`projectsOfMembership(membership)`, mapped to `{ id, slug, name }`) for names and the Project filter.

- [ ] **Step 4: Write the failing tests** in `costs.test.tsx`. Render `CostsScreen` inside `PermissionProvider` with `membershipFactory(role)` and the mock session cookie, as `rankingsAs` does (write a `costsAs(role)` helper in the test file). Fix `now` with `vi.setSystemTime(new Date('2026-09-29T12:00:00Z'))` (the mocks' cost events sit in September 2026; check `src/mocks/handlers/costs.ts` and its fixtures for the month that has data and use it).
  1. An admin sees the strip: Month to date equals the mock's `meta.total_cost_usd` formatted, Budget shows "N% of $X" with a meter when the mock has a workspace budget, Blocked runs only when above 0.
  2. The chart's Table view lists the days of the month and a column per workload in the fixed order (`ChartFrame` is mocked as the inspector tests mock `@/components/app/chart/echart`; the frame's Table toggle renders the data).
  3. By workload lists workloads with Cost and Share; shares add up to 100% within rounding.
  4. Tabs: By provider lists providers with requests and cost; By project names projects from `projects` and shows "Deleted project" for an unknown id; Unit costs lists price book rows with "Estimate"; Budgets lists budgets with the meter and badge.
  5. Choosing the Workload filter `seo_rank` sends `filter[workload_in]=seo_rank` on every cost request and writes `workload=seo_rank` to the URL (`onUrlUpdate`).
  6. Changing the month to the one before sends `from` and `to` of that month and `month` on budgets status.
  7. A month without costs shows the empty sentence in the chart area and the tables.
  8. A viewer without `costs:read` (check which roles hold it in `src/lib/permissions/permissions.ts` or the mock access table) sees the no-access state and no request to `/costs` is sent.

- [ ] **Step 5: Run them to see them fail**

Run: `pnpm vitest run src/features/costs`
Expected: FAIL.

- [ ] **Step 6: Write `CostsScreen`.** Props `{ workspaceId, workspaceSlug, projects: readonly { id: string; slug: string; name: string }[] }`. Layout top to bottom, in the page padding the settings frame uses:
  - `PageHeader` with the title and `meta` (the month label). No actions (Export waits for step 7).
  - A toolbar row: the month `Select` (`recentMonths(now)`, labels from `monthLabel`) and a `FilterBar` with the three filters (copy the field definition style of `keyword-filters.ts`; options: projects from props, workloads from `costWorkloadValues` in `schema.ts` labelled by `costs.workloads.*`, providers from the month's `group_by=provider` rows). URL state with `useQueryStates` and `history: 'replace'`.
  - `MetricStrip` `size="md"`: Month to date (`meta.total_cost_usd` of the total query, context `monthToDateContext` with the days), Budget (from `workspaceBudget`; value `budgetValue`, a `BudgetMeter` `size="summary"` in the item's addon slot; `noBudget` when there is none), Blocked runs (sum of `blocked_runs` over the budgets; leave the item out at 0).
  - A two-column region from `lg` (stacked below): `ChartFrame` `kind="bar"` `stacked` `height={240}` with `dayWorkloadSeries` of the `day,workload` query, `formatValue` with `formatCurrency(value, { context: 'axis' })`, and the By workload `CostTable` (360 px wide column) from the `workload` query: Workload, Cost (USD), Share, with a Total footer.
  - The cost sources line (`type-meta`) under the chart from the total query's `meta.cost_sources`.
  - `Tabs` `variant="segmented"` with the four tabs; each panel a `CostTable`:
    - By provider (`provider` query): Provider, Requests, Subjects, Cost (USD), Share.
    - By project (`project` query): Project (name from props, `deletedProject` for an unknown id, `noProject` for an empty key), Cost (USD), Share, and when a project budget exists, the meter cell (`size="cell"`) and the status badge.
    - Unit costs (`usePriceBook`): Provider, Endpoint, Unit, Unit price (USD) with an "Estimate" badge in the header tooltip, Valid from, Checked; the `unitCostsNote` above the table.
    - Budgets (`budgetRows`): Scope (`workspaceScope` or the project name), Workload, Limit, Spent, Planned (estimate), Used (meter cell and percent), Status (badge).
  - Errors: each region shows `InlineError` with Retry for its own query; the strip shows its items as unknown while loading.
  - Without `useCan('costs:read')`: only the header and the no-access `EmptyState` with a link back to the workspace root (`workspacePath(workspaceSlug)`); no query is enabled (pass `enabled: false` through the hooks).

- [ ] **Step 7: Run the tests**

Run: `pnpm vitest run src/features/costs`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/costs apps/web/src/app apps/web/src/lib/routes apps/web/messages/en.json
git commit -m "Workspace costs"
```

### Task 7: The run model (pure)

**Files:**
- Create: `apps/web/src/features/operations/run-model.ts`
- Test: `apps/web/src/features/operations/run-model.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import { canCancel, isOpen, taskSummary } from './run-model';

const run = (over: Record<string, unknown> = {}) => ({
  status: 'running',
  trigger: 'manual',
  created_by: { actor_type: 'user', actor_id: 'u1', label: 'Ana' },
  tasks_total: 10,
  tasks_succeeded: 6,
  tasks_failed: 1,
  ...over,
});

describe('run model', () => {
  it('knows which runs are still open', () => {
    expect(isOpen(run())).toBe(true);
    expect(isOpen(run({ status: 'planned' }))).toBe(true);
    expect(isOpen(run({ status: 'completed' }))).toBe(false);
  });

  it('lets schedules:write cancel any open run, runs:trigger only the manual runs its holder asked for', () => {
    expect(canCancel(run({ trigger: 'schedule' }), { userId: 'u2', permissions: ['schedules:write'] })).toBe(true);
    expect(canCancel(run(), { userId: 'u1', permissions: ['runs:trigger'] })).toBe(true);
    expect(canCancel(run(), { userId: 'u2', permissions: ['runs:trigger'] })).toBe(false);
    expect(canCancel(run({ trigger: 'schedule' }), { userId: 'u1', permissions: ['runs:trigger'] })).toBe(false);
    expect(canCancel(run({ status: 'failed' }), { userId: 'u1', permissions: ['schedules:write'] })).toBe(false);
  });

  it('sums the tasks', () => {
    expect(taskSummary(run())).toEqual({ done: 7, succeeded: 6, failed: 1, pending: 3, total: 10 });
  });
});
```

Type the fixture as `Pick<Run, ...>` with the generated `Run` type, so the literals check.

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run src/features/operations/run-model.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the module**

```ts
import type { components } from '@/lib/api/schema';
import { can } from '@/lib/permissions';

export type Run = components['schemas']['Run'];
export type RunStatus = Run['status'];

/** Planned and running runs may still be cancelled (19 section 3.11.4). */
export const isOpen = (run: Pick<Run, 'status'>): boolean => run.status === 'planned' || run.status === 'running';

/**
 * Whether the member may cancel the run: `schedules:write` cancels any open run, `runs:trigger` the manual
 * runs the member asked for.
 */
export function canCancel(
  run: Pick<Run, 'status' | 'trigger' | 'created_by'>,
  member: { userId: string; permissions: readonly string[] },
): boolean {
  if (!isOpen(run)) return false;
  if (can(member.permissions, 'schedules:write')) return true;
  return (
    can(member.permissions, 'runs:trigger') &&
    run.trigger === 'manual' &&
    run.created_by?.actor_type === 'user' &&
    run.created_by.actor_id === member.userId
  );
}

export function taskSummary(
  run: Pick<Run, 'tasks_total' | 'tasks_succeeded' | 'tasks_failed'>,
): { done: number; succeeded: number; failed: number; pending: number; total: number } {
  const done = run.tasks_succeeded + run.tasks_failed;
  return {
    done,
    succeeded: run.tasks_succeeded,
    failed: run.tasks_failed,
    pending: Math.max(0, run.tasks_total - done),
    total: run.tasks_total,
  };
}
```

Check `can` is exported from `@/lib/permissions` (it is in `permissions.ts`; the index exports it in its first block). Read how screens get the member's user id and permissions (`useMembership()`).

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run src/features/operations/run-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/operations
git commit -m "Runs: the run model"
```

### Task 8: The Runs page

**Files:**
- Create: `apps/web/src/features/operations/runs-queries.ts`, `run-inspector.tsx`, `runs-screen.tsx`, `index.ts`
- Create: `apps/web/src/app/[workspace]/ops/runs/page.tsx`
- Modify: `apps/web/messages/en.json`
- Test: `apps/web/src/features/operations/runs.test.tsx`

- [ ] **Step 1: Invoke `design-taste-frontend`** before writing markup.

- [ ] **Step 2: Strings** under `runs`:

```json
"runs": {
  "pageTitle": "Runs",
  "title": "Runs",
  "meta": "{project}, {month}",
  "project": "Project",
  "month": "Month",
  "filters": { "workload": "Workload", "status": "Status", "trigger": "Trigger" },
  "caption": "Runs",
  "noun": { "one": "run", "other": "runs" },
  "search": "Search runs",
  "columns": {
    "workload": "Workload", "trigger": "Trigger", "status": "Status", "window": "Window", "tasks": "Tasks",
    "estimate": "Estimate (USD)", "actual": "Actual (USD)", "created": "Started", "completed": "Finished"
  },
  "triggers": { "schedule": "Schedule", "manual": "Manual", "backfill": "Backfill", "retry": "Retry" },
  "statuses": {
    "planned": "Planned", "running": "Running", "completed": "Completed", "completed_with_errors": "Completed with errors",
    "failed": "Failed", "cancelled": "Cancelled", "budget_blocked": "Budget blocked"
  },
  "tasks": "{done} of {total} done, {failed} failed",
  "window": "{start} to {end}",
  "cappedNotice": "Showing the newest {count} runs of the month. Narrow the filters to see older ones.",
  "manualToday": "{used} of {limit} manual runs used today",
  "cancel": "Cancel run",
  "cancelTitle": "Cancel this run?",
  "cancelDescription": "Tasks not yet sent are cancelled. Tasks already sent to the provider still finish and are paid.",
  "cancelConfirm": "Cancel run",
  "keepRunning": "Keep run",
  "cancelled": "Run cancelled",
  "cancelFailed": "The run could not be cancelled. Try again.",
  "cancelEnded": "This run has already ended.",
  "cancelForbidden": "You can cancel the runs you started, or any run with permission to edit schedules.",
  "empty": "No runs in {month}.",
  "emptyFiltered": "No runs match these filters in {month}.",
  "loadFailed": "The runs could not be loaded.",
  "noProjects": "You have no projects in this workspace yet.",
  "inspector": {
    "title": "Run",
    "summary": "Summary",
    "byStatus": "Tasks by status",
    "reason": "Reason",
    "createdBy": "Started by",
    "system": "Sightline",
    "blockedBy": "Blocked by a budget"
  }
}
```

Reuse `costs.workloads.*` for workload names (move that map to a shared `workloads` namespace if both features need it; features may not import each other, but they share messages).

- [ ] **Step 3: `runs-queries.ts`.**
  - `useMonthRuns(scope: { workspaceId; projectId }, month, filters)`: `useInfiniteQuery` on `GET {P}/runs` with `from`/`to` from `monthInstants(month)`, the filters, `limit: 200`, following `page.next_cursor`; an effect reads the next page while `has_more` and fewer than 2,000 rows are loaded (as `useKeywordList` does in client mode). Answers `{ rows, loading, error, capped, manualRunsToday }`.
  - `useRunDetail(scope, runId)`: `apiQuery` on `GET {P}/runs/{run_id}`.
  - `CANCEL_RUN = apiMutation('post', '{P}/runs/{run_id}/cancel')`.

- [ ] **Step 4: Write the failing tests** in `runs.test.tsx` (helper `runsAs(role, projectSlug?)` like `costsAs`; fix the time to a month that has mock runs, read `src/mocks/operations-fixtures.ts`):
  1. The project `Select` lists the member's projects and starts on the first; the table lists that project's runs newest first with Workload, Trigger, Status, Window, Tasks, Estimate, Actual.
  2. Choosing another project asks `GET .../projects/{other}/runs` and writes `project=<slug>` to the URL.
  3. The Status filter `failed` sends `filter[status_in]=failed`.
  4. Opening a row shows the run inspector with tasks by status from the detail.
  5. An admin (`schedules:write`) sees "Cancel run" on a running scheduled run; confirming sends the cancel, the toast says "Run cancelled", and the row shows Cancelled.
  6. A member with `runs:trigger` but not `schedules:write` sees "Cancel run" only on their own manual run.
  7. A `409 invalid_state_transition` answer to the cancel shows "This run has already ended." and refreshes the list.
  8. With more than 2,000 rows (override the list with a handler that always has more), the capped notice shows.

- [ ] **Step 5: Run them to see them fail**

Run: `pnpm vitest run src/features/operations`
Expected: FAIL.

- [ ] **Step 6: Write `RunsScreen` and `RunInspector`.** Props `{ workspaceId, workspaceSlug, projects: readonly { id; slug; name; timeZone }[] }`.
  - Header with the title and `meta`; under it the project `Select`, the month `Select`, and a `FilterBar` with Workload (several), Status (several), Trigger (several). URL keys `project`, `month`, `workload`, `status`, `trigger` with `history: 'replace'`. With no projects, an `EmptyState` with `noProjects`.
  - `DataTable` in client mode (no `server` prop): columns through `col.*` as `keyword-columns.ts` builds them: Workload (identity), Trigger, Status (status icon and text per 17 lines 160 to 171; read the existing status cell components in `src/components/app/status`), Window (`window` in the project's time zone with the date formatter of `src/lib/format`), Tasks (`tasks` text; a small stacked bar is optional and only if a cell component for it exists), Estimate and Actual (`formatCurrency(money(...))`, empty for `null`), Started, Finished. Default sort Started, newest first. Search over workload and status labels. `rowActions`: "Cancel run" (group `destructive`) when `canCancel(row, member)`, with `disabledReason` never (the action is left out instead). `onRowOpen` opens the inspector with `{ type: 'run', id }`.
  - `manualRunsToday` shows as `manualToday` in the header meta when present.
  - Cancel: `ConfirmDialog` (`cancelTitle`, `cancelDescription`, `cancelConfirm`, `keepRunning`). On success: toast `cancelled`, invalidate the run list and the detail. `409` gives `cancelEnded` as the dialog error and refreshes; `403` gives `cancelForbidden`; else `cancelFailed`.
  - `RunInspector` (with `InspectorLayout`, as Rankings does): title workload and status; a key-value list (Trigger, Window, Started, Finished, Started by: `created_by.label` or `system` for a system actor, Reason: `status_reason` in words when known, else as sent; Blocked by a budget when `blocked_by_budget_id` is set), and tasks by status from `tasks_by_status` as label and count pairs. No task table (Operations, with the tasks API).
  - The route `src/app/[workspace]/ops/runs/page.tsx` mirrors the Costs route, passing projects with their time zones.

- [ ] **Step 7: Run the tests**

Run: `pnpm vitest run src/features/operations`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/operations apps/web/src/app apps/web/messages/en.json
git commit -m "Workspace runs"
```

### Task 9: Links from the switcher and Settings

**Files:**
- Modify: `apps/web/src/components/app/shell/project-switcher.tsx`, `apps/web/src/features/shell/project-shell.tsx`
- Modify: `apps/web/src/features/settings/settings-frame.tsx` and the settings nav types it uses
- Modify: `apps/web/messages/en.json`
- Test: the switcher's and the settings frame's existing test files

- [ ] **Step 1: Write failing tests:**
  1. In the project switcher test: with `workspaceLinks` given, the open popup shows a "Workspace" group with "Costs" and "Runs" links to the given hrefs; without it, no such group.
  2. In the settings frame test (or `workspace-shell.test.tsx` if the frame has none): the workspace group lists Costs and Operations after Members and roles, linking to `/{workspace}/costs` and `/{workspace}/ops/runs`; a member without `costs:read` sees Operations but not Costs.

- [ ] **Step 2: Run them to see them fail.**

- [ ] **Step 3: Implement.**
  - `ProjectSwitcherProps` gains `workspaceLinks?: readonly { href: Route; label: string }[] | undefined` and `workspaceLabel?: string | undefined`; the popup renders them as a labelled group of links after the projects list, before the existing `allProjects` and `createProject` footer links (match their markup).
  - `project-shell.tsx` passes `[{ href: costsPath(workspace), label: t('workspaceLinks.costs') }]` when `useCan('costs:read')`, plus Runs always.
  - Settings: add link items to the workspace group after Members and roles: Costs (only with `costs:read`) and Operations (to `runsPath`). If `SettingsNavGroup` items are typed as sections only, add an optional `href` override for these two ids rather than making them settings sections; `current` never matches them, since they are not under `/settings/`.
  - Strings: `navigation.workspaceLinks.label` "Workspace", `.costs` "Costs", `.runs` "Runs"; `settings.items.costs` "Costs", `settings.items.operations` "Operations".

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run src/components/app/shell src/features/shell src/features/settings`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src apps/web/messages/en.json
git commit -m "Links to Costs and Runs"
```

### Task 10: End to end, as-built note, gates, review

**Files:**
- Create or modify: `apps/web/e2e/flows/costs-runs.spec.ts` (or the closest existing spec)
- Modify: `docs/superpowers/plans/2026-10-01-keywords-ui.md`

- [ ] **Step 1: E2E flows.** An admin opens the project switcher, follows Costs, sees the strip and the By provider tab; switches the month; follows Runs from Settings, filters Status Running, opens a run, cancels it and sees "Run cancelled". An analyst opens `/{workspace}/costs` and sees the no-access state if analysts lack `costs:read` (check the permission table first; skip the case if they hold it).

- [ ] **Step 2: As-built note** under Task 12 in the parent plan:

```markdown
- **As built.** Step by step in `2026-10-05-costs-runs-ui.md`.
  - Costs: month scope (UTC, this month and the 11 before), filters Project, Workload and Provider, a strip (month to date, the workspace budget with its meter, blocked runs), spend by day stacked by workload with fixed workload colors, by workload, and tabs By provider, By project, Unit costs (the price book, labelled estimates) and Budgets (read-only). No projection, unit costs per check or reconciliation: their routes are not built.
  - Runs: per project on `{P}/runs` with a project picker (the backend builds no `{W}/runs` in part 1; its mock is gone), month scope, filters Workload, Status and Trigger, the newest 2,000 of a month, a run inspector with tasks by status, and Cancel for `schedules:write`, or `runs:trigger` on one's own manual runs.
  - Linked from the project switcher's Workspace group and Settings' workspace group.
```

- [ ] **Step 3: Run every gate**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
NEXT_PUBLIC_API_MOCKING=off pnpm build
pnpm run preview
pnpm e2e
```

Expected: all pass. Fix and re-run until they do.

- [ ] **Step 4: Opus review.** Dispatch an independent reviewer on the Opus model (superpowers:code-reviewer) with this plan, the parent plan's Task 12, and the range from the commit before Task 1 to HEAD. Fix every Critical and Important finding, re-run the gates.

- [ ] **Step 5: Commit**

```bash
git add apps/web docs/superpowers/plans/2026-10-01-keywords-ui.md
git commit -m "Workspace costs and runs"
```

Never add `.claude/launch.json` or `research/`. No attribution lines. Push only on the user's word.
