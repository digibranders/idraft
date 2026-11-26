# Page search detail and Monitoring, plan 02: web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `PageSearchPanel` (the content of the page drawer's Search tab, for every page) and the Monitoring tab of Pages (tracked pages table, add pages dialog, the page's search detail in the shared inspector), plus the document updates.

**Architecture:** One feature folder, `apps/web/src/features/page-search/`, owns the reads, the pure models and both screens. Everything visual is an existing component: `DataTable`, `DateRangePicker`, `ChartFrame`, `MetricStrip`, `Inspector`, `Dialog`, `Tabs`, `Select`, `PressedGroup`, `TierBadge`, `Banner`, `EmptyState`. The Pages session's drawer shell and tab strip plug in through props; a route file does the composing.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, TanStack Query, nuqs, next-intl, ECharts through `components/app/chart`, Vitest with Testing Library and MSW.

Date: 2026-11-26. Branch: `claude/gsc-page-detail-monitoring-6f43c3`, worktree `.claude/worktrees/gsc-page-detail-monitoring-6f43c3`. Starts after task 10 of plan 01 is committed on this branch. Spec: `docs/superpowers/specs/2026-11-26-page-search-and-monitoring-design.md` (sections 7, 9, 10, 11, 12).

## Rules for every task

- Builder: one Sonnet session, one task at a time. Haiku may do task 1 (the generated client) and the mechanical parts of task 9. Never Opus or Fable.
- Each task ends with: independent senior review on Sonnet (the diff and the spec section, not your conclusion), fix the findings, targeted checks green, commit. Plain commit messages, no attribution lines.
- Tests first. Targeted and serial, from `apps/web`: `pnpm vitest run --maxWorkers=1 <paths>`, then `pnpm lint` and `pnpm typecheck`. `pnpm format:check` on the files you touched (`pnpm prettier --check <paths>`). `pnpm build` once, in task 9. No `pnpm test` of everything, no full Playwright run, no dev server left running.
- Before any markup: invoke the `design-taste-frontend` skill for its judgment only; this repository's `AI_DEVELOPMENT_UI_RULES.md` and `DESIGN_SYSTEM.md` win over its house style. Read both, and `apps/web/AGENTS.md` (this Next.js has breaking changes: read the guide in `apps/web/node_modules/next/dist/docs/` for anything you use).
- Reuse, never invent: no new primitive, no new drawer, no width of your own, no colour or size literal. If something is missing, stop and report it.
- Never edit: `apps/web/design-preview/**`, `src/components/app/inspector/**`, `src/lib/inspector/**`, `src/lib/navigation/**`, `src/features/internal-links/**`, any file of the Pages or Issues sessions. Do not create any file under `src/app/[workspace]/[project]/seo/pages/` except `monitoring/page.tsx` (and its test).
- Words: `docs/glossary/final-list.md` before any string. Never "Rankings", "GSC", "No data", "N/A", "Monitored", "Watched", "Country" as a label, "Date range". Use "Search Console", "Tracked", "Location", "Period", "Compare with", "Not collected yet", "Not enough data", "Average position". No em-dashes or en-dashes anywhere; ranges say "to". Every visible string is in `apps/web/messages/en.json`.
- Numbers and dates go through `@/lib/format`. Tones come from the delta formatters, never chosen by hand.
- The mock is the reference for behaviour and looks, read only, in the MAIN checkout (its copies are newer than this worktree's): `/Users/a12345/Desktop/AI/idraft/platform/apps/web/design-preview/perf.js`, `perf-detail.js`, `perf-add.js`, `perf-filters.js`, `perf-calc.js`, `il-drawer.js` (`searchTab`). Where the mock and the spec differ, the spec wins (it records the owner's later decisions).

## Decisions taken as given

- **W1** The drawer is the shared `Inspector` inside an `InspectorLayout`, opened through `useInspector` (`?inspect=page:<url id>`), stepped with `useInspectorStepping`. It is always an overlay with one app-wide width (480 to 960 px, 640 by default, a full sheet below 900 px). The panel sets no width and must read well at 480 px. The table does not shrink beside it.
- **W2** Monitoring is table first: exactly two rows above the table (36 px and 32 px), a state banner being the only possible third. First row at about 196 px of a 1280 by 720 window.
- **W3** The list is at most 200 rows: `DataTable` in client mode; sorting, the tier filter, the health filter and the search are done in the browser.
- **W4** Period: `DateRangePicker` with `today` set to the last final day and `maxDays` 92; with no period in the address, the last full calendar month. Compare with: previous period (default), same period last year, no comparison (`cmp` as `lib/compare/compare-model.ts` writes it).
- **W5** Charts: one `ChartFrame` line chart of 140 px per ticked metric; this period and the compared period as two series; position inverted.
- **W6** Health words and sentences are built in the browser from the API's codes and numbers.

## File structure

| File | Responsibility |
|---|---|
| Modify `src/lib/api/schema.ts` | Generated. |
| Create `src/features/page-search/types.ts`, `queries.ts` (+ test) | Types from the client; the reads and writes. |
| Create `src/mocks/page-search-world.ts`, `src/mocks/handlers/page-search.ts` (+ test); modify `src/mocks/handlers/index.ts` | A deterministic mock of the seven routes. |
| Create `src/features/page-search/period.ts`, `health.ts`, `breakdown.ts`, `series.ts` (+ tests) | Pure models. |
| Modify `messages/en.json`, `docs/glossary/terms.md`, `docs/glossary/final-list.md` | Words. |
| Create `src/features/page-search/panel/page-search-panel.tsx`, `period-controls.tsx`, `verdict.tsx`, `metric-tiles.tsx`, `metric-charts.tsx`, `breakdown-tabs.tsx`, `panel-states.tsx` (+ tests) | The Search tab content. |
| Create `src/features/page-search/monitoring/monitoring-screen.tsx`, `monitoring-columns.tsx`, `monitoring-filters.tsx`, `monitoring-rows.ts`, `monitoring-states.tsx`, `add-pages-dialog.tsx`, `use-monitoring-state.ts` (+ tests) | The Monitoring tab. |
| Create `src/features/page-search/index.ts` | What other code imports. |
| Create `src/app/[workspace]/[project]/seo/pages/monitoring/page.tsx` (+ test) | The route. |
| Modify `docs/32-page-performance.md`, `docs/20-frontend-specification.md`, `docs/18-first-party-integrations.md`, `docs/design-system/25-component-inventory.md` | Documents. |

---

### Task 1: The generated client

- [ ] **Step 1:** From `apps/web`: `pnpm gen:api`. Expected: `src/lib/api/schema.ts` gains the seven paths under `/fp/tracked-pages` and `/fp/page-search` and their schemas.
- [ ] **Step 2:** `pnpm typecheck` and `pnpm vitest run --maxWorkers=1 src/lib/api/schema.test.ts`. Expected: PASS.
- [ ] **Step 3:** Commit it alone: `git commit -m "Web: regenerate the API client for tracked pages and page search"`.

After a merge with a branch that changed `schema.ts`: never merge the file by hand; regenerate `backend/openapi/v1.json` (plan 01 task 10 step 1), then run this task again.

---

### Task 2: Types, reads, writes and the mock API

**Read first:** `src/lib/internal-links/queries.ts` lines 1 to 80 and `mutations.ts` (how `apiQuery` options and mutations are written and how keys start with the project); `src/features/ai-overview/cards/traffic/referrals-read.ts`; `src/mocks/handlers/first-party.ts` and `src/mocks/ai-referrals.ts` (a first-party mock: `projectCaller`, `mock`, `problem`, the integrations cookie that says a property is connected); `src/lib/api/types.ts` (`Schemas`).

**Files:**
- Create: `src/features/page-search/types.ts`, `src/features/page-search/queries.ts`, `src/mocks/page-search-world.ts`, `src/mocks/handlers/page-search.ts`
- Modify: `src/mocks/handlers/index.ts`
- Test: `src/features/page-search/queries.test.ts`, `src/mocks/handlers/page-search.test.ts`

- [ ] **Step 1: Types** (`types.ts`): aliases of the generated schemas, nothing hand-written that the client already has.

```ts
import type { Schemas } from '@/lib/api/types';

export type PageNumbers = Schemas['PageNumbers'];
export type PageHealth = Schemas['PageHealth'];
export type SearchMeta = Schemas['SearchMeta'];
export type SearchState = SearchMeta['state'];
export type TrackedPageRow = Schemas['TrackedPageRow'];
export type TrackOutcome = Schemas['TrackOutcome'];
export type SuggestionRow = Schemas['SuggestionRow'];
export type PageSearchDetail = Schemas['PageSearchDetail'];
export type SeriesPoint = Schemas['SeriesPoint'];
export type BreakdownRow = Schemas['BreakdownRow'];
export type Verdict = PageHealth['verdict'];
export type BreakdownDimension = 'query' | 'country' | 'device';
export type CompareParam = 'previous_period' | 'previous_year' | 'none';
export type MetricKey = 'clicks' | 'impressions' | 'ctr' | 'position';

export interface SearchScope {
  workspaceId: string;
  projectId: string;
}

/** The period and the comparison a read asks for; `from` and `to` left out means the last full month. */
export interface PeriodParams {
  from?: string;
  to?: string;
  compare: CompareParam;
}
```

If a schema name differs in the generated client, use the generated name and keep these aliases.

- [ ] **Step 2: Write the failing test** `queries.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { breakdownQuery, pageSearchQuery, trackedIdsQuery, trackedPagesQuery } from './queries';

const scope = { workspaceId: 'w1', projectId: 'p1' };
const october = { from: '2026-10-01', to: '2026-10-31', compare: 'previous_period' } as const;

describe('page search reads', () => {
  it('keys every read by the project, so one invalidation reaches them all', () => {
    for (const options of [
      trackedPagesQuery(scope, october),
      trackedIdsQuery(scope),
      pageSearchQuery(scope, '812', october),
      breakdownQuery(scope, '812', 'country', october),
    ]) {
      expect(JSON.stringify(options.queryKey)).toContain('p1');
    }
  });

  it('gives each period, page and dimension its own entry', () => {
    const other = { ...october, compare: 'none' } as const;
    expect(trackedPagesQuery(scope, october).queryKey).not.toEqual(trackedPagesQuery(scope, other).queryKey);
    expect(pageSearchQuery(scope, '812', october).queryKey).not.toEqual(pageSearchQuery(scope, '813', october).queryKey);
    expect(breakdownQuery(scope, '812', 'country', october).queryKey).not.toEqual(
      breakdownQuery(scope, '812', 'device', october).queryKey,
    );
  });
});
```

Run: `pnpm vitest run --maxWorkers=1 src/features/page-search/queries.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `queries.ts`.** Path constants as literal strings (`const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}'`, then `` `${P}/fp/tracked-pages` as const `` and so on). Exports:

```ts
export const trackedPagesQuery = (scope: SearchScope, period: PeriodParams) => /* apiQuery(TRACKED, { params: { path, query: period } }) */;
export const trackedIdsQuery = (scope: SearchScope) => /* apiQuery(TRACKED_IDS, ...) */;
export const suggestionsQuery = (scope: SearchScope) => /* apiQuery(SUGGESTIONS, ...) */;
export const pageSearchQuery = (scope: SearchScope, urlId: string, period: PeriodParams) => /* apiQuery(PAGE, ...) */;
export const breakdownQuery = (scope: SearchScope, urlId: string, dimension: BreakdownDimension, period: PeriodParams) => /* apiQuery(BREAKDOWN, ...) */;
export const pageSearchKeys = (scope: SearchScope) => /* the key prefix every read above starts with, as internalLinksKeys does */;

/** Tracked ids as a set, for a Tracked column (All pages uses it). */
export function useTrackedIds(scope: SearchScope): { ids: ReadonlySet<string>; limit: number; ready: boolean };
/** Track pages by address or by url id; `dryRun` checks without writing. Refetches every read of the feature on success. */
export function useTrackPages(scope: SearchScope): UseMutationResult<TrackPagesAnswer, ApiProblem, { urls?: string[]; urlIds?: string[]; dryRun?: boolean }>;
export function useUntrackPages(scope: SearchScope): UseMutationResult<{ removed: number }, ApiProblem, string[]>;
```

Write the mutations the way `src/lib/internal-links/mutations.ts` writes its own (the typed client, `unwrap`, invalidate `pageSearchKeys(scope)` on success; a dry run invalidates nothing). `pageSearchQuery` and `breakdownQuery` get `staleTime: 5 * 60_000` (a final period does not change) and `retry: false` for a `429` (read `src/lib/api/retry.ts` and follow its rule for problems that carry `retry_after`; if it has one, use it).

- [ ] **Step 4: The mock world** (`src/mocks/page-search-world.ts`, pure, deterministic): twelve pages with path, title, tier id (take the tier ids from the list the internal links mock serves for `GET .../page-tiers`: import it, do not copy ids), eight of them tracked at start. `numbersOf(urlId, from, to)` derives daily clicks, impressions and position from a seeded function of the url id and the day number, so the same request always answers the same, a page's totals equal the sum of its series, and at least one page lands on each of: declining, sharp drop, growing, stable, not enough data, lost traffic. `breakdownOf(urlId, dimension, from, to)` splits the page's clicks over fixed queries, locations (`USA`, `IND`, `GBR`, `DEU`) and devices so the rows sum to 88% of the clicks for queries and 100% for the others. Tracked state is kept in module memory with `resetPageSearchWorld()` for tests.

- [ ] **Step 5: Handlers** (`src/mocks/handlers/page-search.ts`), one per route of spec section 7.2, built like `first-party.ts`: `projectCaller` with the route's permission (`data:read`, or `projects:write` for the two POSTs), allowed query names checked, `state` taken from the mock integrations state (`not_connected` when the browser has no linked Search Console property, as `first-party.ts` decides it for GA4; otherwise `ok`), the last final day three days before today in Pacific Time, the default period and the compared period computed with the functions of task 3 (write task 3's `period.ts` first if you take the tasks in this order: it is pure and has no dependency on this task). A query `?mock=busy` on the breakdown route answers `429 gsc_busy` with `retry_after: 20`, so the state can be seen. Add `pageSearchHandlers` to `handlers/index.ts`.

- [ ] **Step 6: Handler test** (`page-search.test.ts`, as `first-party.test.ts` is written): the list answers eight rows with a window of the last full month; a POST with one new path answers `added` and the list then has nine; the 201st page answers `over_limit`; a member without `projects:write` gets `403`; the detail's `current.clicks` equals the sum of its series' clicks; `?mock=busy` answers 429.

- [ ] **Step 7: Run** both test files, `pnpm lint`, `pnpm typecheck`. Expected: PASS.

- [ ] **Step 8: Review, fix, commit.** `git commit -m "Page search: types, reads, writes and a mock of the seven routes"`

---

### Task 3: The pure models

**Read first:** spec sections 7.1, 9 and 10; `src/components/app/date-range/range-model.ts` and `business-date.ts`; `src/lib/compare/compare-model.ts`; the mock's `attentionKey` and `HEALTH` in `perf-calc.js`.

**Files:**
- Create: `src/features/page-search/period.ts`, `health.ts`, `breakdown.ts`, `series.ts`
- Test: the four `.test.ts` files beside them

- [ ] **Step 1: Write the failing tests.**

`period.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { compareWindow, lastFullMonth, periodParams, periodValue } from './period';

describe('period', () => {
  it('finds the last full month on or before the last final day', () => {
    expect(lastFullMonth('2026-11-22')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(lastFullMonth('2026-11-30')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(lastFullMonth('2026-01-03')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });

  it('opens on the last full month when the address says nothing', () => {
    expect(periodValue(null, '2026-11-22')).toEqual({ kind: 'custom', from: '2026-10-01', to: '2026-10-31' });
    expect(periodValue({ kind: 'preset', preset: '7d' }, '2026-11-22')).toEqual({ kind: 'preset', preset: '7d' });
  });

  it('sends no dates for the default, so the server picks the same month', () => {
    expect(periodParams(null, 'previous_period', '2026-11-22')).toEqual({ compare: 'previous_period' });
    expect(periodParams({ kind: 'preset', preset: '7d' }, 'none', '2026-11-22')).toEqual({
      from: '2026-11-16',
      to: '2026-11-22',
      compare: 'none',
    });
  });

  it('compares a calendar month with the month before and another range with as many days', () => {
    expect(compareWindow('2026-10-01', '2026-10-31', 'previous_period')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(compareWindow('2026-10-05', '2026-10-11', 'previous_period')).toEqual({ from: '2026-09-28', to: '2026-10-04' });
    expect(compareWindow('2028-02-01', '2028-02-29', 'previous_year')).toEqual({ from: '2027-02-01', to: '2027-02-28' });
    expect(compareWindow('2026-10-01', '2026-10-31', 'none')).toBeNull();
  });
});
```

`health.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { attentionOrder, HEALTH_ORDER, healthTone, verdictMessage } from './health';
import type { PageHealth } from './types';

const health = (verdict: PageHealth['verdict'], absolute = 0, more: Partial<PageHealth> = {}): PageHealth => ({
  verdict,
  basis: 'clicks',
  change: null,
  absolute,
  small: false,
  flags: [],
  ...more,
});

describe('health', () => {
  it('puts the pages that need attention first, the bigger loss before the smaller', () => {
    const rows = [
      health('stable'),
      health('declining', -30),
      health('lost', -40),
      health('declining', -200),
      health('growing', 80),
      health('sharp_drop', -90),
      health('low_data'),
      health('no_data'),
      health('new', 12),
    ];
    const sorted = [...rows].sort((a, b) => attentionOrder(a) - attentionOrder(b));
    expect(sorted.map((row) => [row.verdict, row.absolute])).toEqual([
      ['lost', -40],
      ['sharp_drop', -90],
      ['declining', -200],
      ['declining', -30],
      ['stable', 0],
      ['growing', 80],
      ['new', 12],
      ['no_data', 0],
      ['low_data', 0],
    ]);
  });

  it('lists the verdicts in the order the filter shows them', () => {
    expect(HEALTH_ORDER).toEqual(['lost', 'sharp_drop', 'declining', 'stable', 'growing', 'new', 'no_data', 'low_data']);
  });

  it('gives each verdict a badge tone', () => {
    expect(healthTone('lost')).toBe('negative');
    expect(healthTone('sharp_drop')).toBe('negative');
    expect(healthTone('declining')).toBe('warning');
    expect(healthTone('growing')).toBe('positive');
    expect(healthTone('new')).toBe('info');
    expect(healthTone('stable')).toBe('neutral');
  });

  it('names the sentence of a verdict', () => {
    expect(verdictMessage(health('declining'), true)).toBe('declining');
    expect(verdictMessage(health('stable'), false)).toBe('stableAlone');
    expect(verdictMessage(health('low_data', 0, { small: true }), true)).toBe('smallNumbers');
    expect(verdictMessage(health('low_data'), true)).toBe('lowData');
    expect(verdictMessage(health('no_data'), true)).toBe('noData');
  });
});
```

Check `healthTone` against the tones the app's `Badge` accepts (`src/components/ui/badge.tsx`); if "insufficient" exists as a tone, `low_data` takes it, else `neutral`. Adjust the test to the real tone names before writing the code, and say so in the report.

`breakdown.test.ts`: `changeOf(row, 'clicks')` is `current - previous` (null when either side is null); for `ctr` it is the difference in points; for `position` it is `previous - current`, so a positive number is an improvement. `sortRows(rows, 'clicks')` orders by the absolute change, biggest first, rows without a change last, ties by current clicks. `nameOf('country', 'IND', names)` uses the locations formatter and falls back to the code; `nameOf('device', 'MOBILE', ...)` is the message key `devices.MOBILE`. Write these as real cases with three or four rows each.

`series.test.ts`: `chartOf(series, previous, 'ctr')` returns `{ categories, current, previous }` where a day's CTR is clicks over impressions and `null` when impressions are 0 (a gap, never 0); `'position'` passes the position through (`null` stays a gap); `'clicks'` and `'impressions'` are plain numbers with 0 kept; the previous series is aligned by index and padded with `null` when shorter; `categories` are the current period's dates.

Run the four files. Expected: FAIL.

- [ ] **Step 2: Implement.**

`period.ts`, complete:

```ts
import { addDays, daysInclusive, type BusinessDate } from '@/components/app/date-range/business-date';
import { resolveRange, type DateRangeValue } from '@/components/app/date-range/range-model';

import type { CompareParam, PeriodParams } from './types';

export interface Window {
  from: BusinessDate;
  to: BusinessDate;
}

const pad = (value: number): string => String(value).padStart(2, '0');
const iso = (year: number, month: number, day: number): BusinessDate => `${year}-${pad(month)}-${pad(day)}` as BusinessDate;
const parts = (day: string): [number, number, number] => {
  const [year, month, date] = day.split('-').map(Number);
  return [year ?? 0, month ?? 1, date ?? 1];
};
/** The number of days of a month; `month` is 1 to 12. */
const monthLength = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** The last calendar month that ends on or before the last final day. */
export function lastFullMonth(finalThrough: string): Window {
  const [year, month, day] = parts(finalThrough);
  if (day === monthLength(year, month)) return { from: iso(year, month, 1), to: iso(year, month, day) };
  const before = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  return { from: iso(before.year, before.month, 1), to: iso(before.year, before.month, monthLength(before.year, before.month)) };
}

/** What the picker shows: the address's period, or the last full month when the address has none. */
export function periodValue(fromAddress: DateRangeValue | null, finalThrough: string): DateRangeValue {
  return fromAddress ?? { kind: 'custom', ...lastFullMonth(finalThrough) };
}

/** The query of a read. The default sends no dates, so the server and the browser cannot disagree on the month. */
export function periodParams(fromAddress: DateRangeValue | null, compare: CompareParam, finalThrough: string): PeriodParams {
  if (fromAddress === null) return { compare };
  const range = resolveRange(fromAddress, finalThrough as BusinessDate);
  return { from: range.from, to: range.to, compare };
}

const isCalendarMonth = (from: string, to: string): boolean => {
  const [fromYear, fromMonth, fromDay] = parts(from);
  const [toYear, toMonth, toDay] = parts(to);
  return fromDay === 1 && fromYear === toYear && fromMonth === toMonth && toDay === monthLength(toYear, toMonth);
};

const yearBefore = (day: string): BusinessDate => {
  const [year, month, date] = parts(day);
  return iso(year - 1, month, Math.min(date, monthLength(year - 1, month)));
};

/** The days compared with, as the API computes them (the response's `compare_window` is the truth; this labels the control). */
export function compareWindow(from: string, to: string, compare: CompareParam): Window | null {
  if (compare === 'none') return null;
  if (compare === 'previous_year') return { from: yearBefore(from), to: yearBefore(to) };
  if (isCalendarMonth(from, to)) return lastFullMonth(addDays(from as BusinessDate, -1));
  const days = daysInclusive(from as BusinessDate, to as BusinessDate);
  return { from: addDays(from as BusinessDate, -days), to: addDays(from as BusinessDate, -1) };
}
```

If `business-date.ts` exports different names for `addDays` and `daysInclusive`, or `BusinessDate` is not a branded string, use what it exports and drop the casts; the tests above stay as they are.

`health.ts`: `HEALTH_ORDER` as the test lists it; `attentionOrder(health)` is `HEALTH_ORDER.indexOf(verdict) * 1e9 + health.absolute` for `lost`, `sharp_drop`, `declining` (a bigger loss is a smaller number) and `index * 1e9 - health.absolute` for the others (bigger first); `healthTone`; `verdictMessage(health, compared)` returning the key under `pageSearch.verdict`.

`breakdown.ts` and `series.ts`: as their tests state. No React in any of the four files.

- [ ] **Step 3: Run** the four test files, `pnpm lint`, `pnpm typecheck`. Expected: PASS.

- [ ] **Step 4: Review, fix, commit.** `git commit -m "Page search: period, health order, breakdown and chart series as pure models"`

---

### Task 4: Words

**Read first:** spec section 12; `docs/glossary/final-list.md`; `docs/glossary/terms.md` (its row format); `src/lib/glossary/glossary-words.test.ts` and `src/i18n/messages.test.ts` (what fails a string); the `internalLinks.states` and `integrations` namespaces of `messages/en.json` for the tone of existing sentences.

**Files:**
- Modify: `docs/glossary/terms.md`, `docs/glossary/final-list.md`, `apps/web/messages/en.json`

- [ ] **Step 1: Glossary first.** In `terms.md` add entries (definition, banned alternatives, where used): **Monitoring** (the tab of Pages that lists tracked pages; never a verb, never "Monitored"), **Track in Monitoring** and **Stop tracking** (the two actions), **Health** (the verdict of a tracked page: Lost traffic, Sharp drop, Declining, Stable, Growing, New, Not enough data, Not collected yet), **What changed** (the queries, locations and devices of a page for a period and the period compared with). In `final-list.md` add to "Areas and pages": `Monitoring (a tab of Pages: the pages you track, with their Search Console numbers) | Performance, Watchlist, Monitored pages`; and to "Measures": `Health (of a tracked page): Lost traffic, Sharp drop, Declining, Stable, Growing, New | Status, Score`. If the Issues branch's rows for "Website audit", "Issues" or "All pages" are not on this branch, do not add them: they arrive with that branch.

- [ ] **Step 2: Messages.** Add the namespaces `pageSearch` (with `health`, `verdict`, `states`, `tabs`, `columns`, `metrics`, `compare`, `devices`) and `monitoring` (with `columns`, `bulk`, `empty`, `add`, `add.outcome`) with the keys of spec section 12. Sentences to use (ICU where a number or a date goes in; `{change}` is already formatted by `@/lib/format`):

| Key | Text |
|---|---|
| `pageSearch.verdict.declining` and `sharp_drop` | `{metric} are down {change} ({before} to {now}) against {period}.` |
| `pageSearch.verdict.growing` | `{metric} are up {change} ({before} to {now}) against {period}.` |
| `pageSearch.verdict.stable` | `{metric} are steady ({before} to {now}) against {period}.` |
| `pageSearch.verdict.stableAlone` | `{clicks} clicks and {impressions} impressions in {period}.` |
| `pageSearch.verdict.new` | `New in search: {clicks} clicks, none in {period}.` |
| `pageSearch.verdict.lost` | `Lost all search traffic: no clicks, against {before} in {period}.` |
| `pageSearch.verdict.lowData` | `Too little traffic to judge: {clicks} clicks and {impressions} impressions over both periods.` |
| `pageSearch.verdict.smallNumbers` | `Small numbers: {metric} went from {before} to {now}, too few to count as a real change.` |
| `pageSearch.verdict.noData` | `Google reported no impressions for this page in this period.` |
| `pageSearch.verdict.perDay` | `Counted per day, because the two periods differ in length.` |
| `pageSearch.verdict.position_slipped` | `Average position slipped {places} places.` |
| `pageSearch.verdict.position_improved` | `Average position improved {places} places.` |
| `pageSearch.verdict.ctr_fell_impressions_rose` | `Impressions rose but fewer people clicked. Check the title and the snippet.` |
| `pageSearch.coverage` | `The queries shown cover {percent} of this page's clicks. Google does not report the rest.` |
| `pageSearch.note` | `Search Console, web search. Days are Pacific Time. Final data to {date}.` |
| `pageSearch.notLive` | `Only a page that answers 200 has search data.` |
| `pageSearch.states.notConnected` | `Connect Search Console to see how your pages perform.` |
| `pageSearch.states.askAdmin` | `Ask an owner or admin to connect Search Console.` |
| `pageSearch.states.pending` | `Not collected yet. The first numbers arrive within minutes.` |
| `pageSearch.states.reauth` | `Search Console needs a new sign-in. The numbers stop at {date}.` |
| `pageSearch.states.noAccess` | `This Google account can no longer read the property. The numbers stop at {date}.` |
| `pageSearch.states.busy` | `Google is busy. Trying again in {seconds} s.` |
| `pageSearch.states.unavailable` | `Google did not answer. Try again.` |
| `pageSearch.states.notCollected` | `Not collected yet` |
| `monitoring.context` | `{host}, final data to {date}` |
| `monitoring.contextTip` | `Search Console property {property}. Final data to {date}, Pacific Time.` |
| `monitoring.empty.title` | `Add the pages that matter` |
| `monitoring.empty.reason` | `Paste addresses or pick the pages with the most clicks. You can track up to {limit} pages in a project.` |
| `monitoring.noMatch` | `No tracked pages match these filters.` |
| `monitoring.loadingHistory` | `Loading this page's history` |
| `monitoring.removed` | `{count, plural, one {Stopped tracking # page} other {Stopped tracking # pages}}` |
| `monitoring.removedDetail` | `Their history is kept, so adding them again shows it.` |
| `monitoring.add.count` | `{tracked} of {limit} pages tracked` |
| `monitoring.add.submit` | `{count, plural, =0 {Add pages} one {Add # page} other {Add # pages}}` |
| `monitoring.add.urlsHint` | `One per line, up to 500. Paths or full addresses on {host}.` |
| `monitoring.add.outcome.ok` | `Found, {clicks} clicks in 28 days` |
| `monitoring.add.outcome.okNoClicks` | `Found, no clicks collected yet` |
| `monitoring.add.outcome.already_tracked` | `Already tracked` |
| `monitoring.add.outcome.invalid_url` | `Not a valid address` |
| `monitoring.add.outcome.wrong_host` | `Not on {host}` |
| `monitoring.add.outcome.not_crawled` | `Not in the crawl` |
| `monitoring.add.outcome.over_limit` | `Over the limit of {limit} pages` |
| `monitoring.add.suggestedIntro` | `The pages with the most clicks in the last 28 days that are not tracked yet.` |
| `monitoring.add.allTracked` | `Every page found is already tracked.` |

The remaining keys are labels: write them as the spec names them ("Period", "Compare with", "vs previous period", "vs same period last year", "No comparison", "Clicks", "Impressions", "CTR", "Average position", "Over time", "What changed", "Queries", "Locations", "Devices", "Now", "Before", "Change", "Desktop", "Mobile", "Tablet", "Monitoring", "Export CSV", "Add pages", "Tier", "All tiers", "Untiered", "Health", "All", "Search pages", "Page", "Trend", "Stop tracking", "Export selection", "Paste addresses", "Suggested from Search Console", "Check pages", "Retry", "improved {places}", "slipped {places}").

- [ ] **Step 3: Run** `pnpm vitest run --maxWorkers=1 src/i18n/messages.test.ts src/lib/glossary/glossary-words.test.ts`. Expected: PASS. A key no code reads yet is fine in this task; if a test of unused keys exists and fails, move those keys into the task that first reads them and say so.

- [ ] **Step 4: Review, fix, commit.** `git commit -m "Words for the page search detail and Monitoring"`

---

### Task 5: `PageSearchPanel`, part one: period, verdict, tiles and charts

**Read first:** spec sections 9 and 10.3; the mock `perf-detail.js` (the order and density of the parts) and `il-drawer.js` `searchTab`; `src/components/app/metric/metric-strip.tsx` (props `MetricStripItem`, size `sm`) and `delta.tsx`; `src/components/app/chart/chart-frame.tsx` (`CategoryFrameProps`), `src/lib/charts/category-chart.ts` (`CategorySeries`, `SeriesRole`) and `src/lib/charts/rank-chart.ts` (the inverted axis through `extendOption`); `src/components/app/date-range/date-range-picker.tsx` and `use-date-range-params.ts`; `src/components/ui/select.tsx`; `src/components/app/inspector/inspector-section.tsx`; `src/components/app/status/banner.tsx` and `inline-error.tsx`; a card that reads through a feature hook and draws its states, `src/features/ai-overview/cards/traffic/referrals-card.tsx` and its test (how MSW answers are set in a component test and how `ChartFrame` is exercised).

**Files:**
- Create: `src/features/page-search/panel/page-search-panel.tsx`, `period-controls.tsx`, `verdict.tsx`, `metric-tiles.tsx`, `metric-charts.tsx`, `panel-states.tsx`, `use-panel-state.ts`
- Test: `src/features/page-search/panel/page-search-panel.test.tsx`, `verdict.test.tsx`

- [ ] **Step 1: Write the failing tests** (render with the test providers the referrals card test uses; answers from the handlers of task 2, overridden per test with `server.use`):

1. `shows the four numbers of the period with their change` (Clicks 317, Impressions 41.2K as the formatters write them, CTR, Average position 5.9; the position change reads "slipped 2.1").
2. `says the verdict in a sentence and one sentence per flag` (`verdict.test.tsx`: each verdict of the table in task 4 renders its sentence from a `PageHealth`, numbers and a compared window; `perDay` appears only when the two windows differ in length).
3. `draws a chart for clicks and for impressions by default, and one more when CTR is ticked` (find charts by their `ChartFrame` titles; ticking is a toggle button with `aria-pressed`).
4. `keeps at least one metric ticked` (the last ticked toggle is disabled).
5. `asks again when the period or the comparison changes` (choose "No comparison": the request has `compare=none`, and the Before values and the previous line are gone).
6. `states`: `not_connected` shows the connect sentence and, with `integrations:manage`, a link to the project's Integrations page; without it the ask-an-admin sentence. `pending` shows its sentence. `reauth_required` shows the warning banner and still the numbers. A status code of 404 passed as `statusCode` shows only the not live sentence and makes no request.
7. `a page with no impressions says so and shows n/a for CTR and average position with the reason in a tooltip`.
8. `has no accessibility violations` (`vitest-axe`, as the neighbouring tests do).

Run. Expected: FAIL.

- [ ] **Step 2: Implement.**

```ts
export interface PageSearchPanelProps {
  workspaceId: string;
  projectId: string;
  workspaceSlug: string;
  projectSlug: string;
  /** The page, as every url id of the API. */
  urlId: string;
  /** The page's status in the crawl; anything but 200 shows one sentence and reads nothing. `null`: unknown, read. */
  statusCode: number | null;
  /** The project's time zone, for the picker's note. Days are Search Console's (Pacific Time). */
  timeZone: string;
}

export function PageSearchPanel(props: PageSearchPanelProps): ReactElement;
```

- State (`use-panel-state.ts`): the period and comparison live in the address with the keys Monitoring uses (`win`, `from`, `to`, `cmp`), so a drawer opened from Monitoring shows the same period as the list; the ticked metrics (`pm`, default `clicks,impressions`) and the open breakdown tab (`pt`, default `queries`). Use `nuqs` with the shared parsers of `src/lib/filters/parsers.ts`. Read how `useDateRangeParams` takes `today` and `earliest`: pass the last final day as `today` and `maxDays: 92`. When it cannot express "no period in the address means the last full month" (its default is the 28 day preset), keep its `value` only when the address has `win`, `from` or `to`, and otherwise use `periodValue(null, finalThrough)` from task 3; the read then sends no dates.
- The last final day comes from the response's `meta.final_through`. The first read sends no dates; the picker is drawn once the first answer is in (a skeleton row before).
- `period-controls.tsx`: `DateRangePicker` (size `sm`, `word` "Period") and a `Select` labelled "Compare with" with the three values. Exported, because Monitoring uses the same component.
- `metric-tiles.tsx`: a `MetricStrip` of size `sm` with four items; each item's `delta` from the app's delta formatters (clicks and impressions: percent, per day when the windows differ; CTR: points; position: "improved" or "slipped" with one decimal, positive tone for improved). Under it a row of four toggle buttons (`PressedGroup` is single choice: use four `Button`s with `aria-pressed` in a group labelled by the "Over time" heading, the way the mock's tiles toggle). A value that is `null` shows "n/a" with a tooltip that gives the reason (no impressions in the period).
- `metric-charts.tsx`: per ticked metric one `ChartFrame` with `kind="line"`, `variant="inspector"`, `height={140}`, `categories` and values from `chartOf` (task 3), two series: this period (`role` of the own series) and the compared period (the reference role; read `SeriesRole` for the exact names), `formatValue` from `@/lib/format`, `summary` a sentence with the period's total, `categoryHeader` "Day". Position passes the rank chart's `extendOption` so a better position is higher. Status: `loading`, `ready`, `refetching` (keep the last answer on screen with `placeholderData: keepPreviousData`), `empty` (title "Not collected yet", the no impressions sentence), `error` (retry).
- `verdict.tsx`: the health `Badge` (tone from `healthTone`) and the sentences.
- `panel-states.tsx`: the banners and sentences of spec section 9 for the panel.
- Layout: one column of `InspectorSection`s inside whatever the shell gives as body (`InspectorBody` in Monitoring). No width, no fixed height, nothing that assumes more than 480 px: the four tiles wrap two by two under a container query if the strip does not fit (check `MetricStrip`'s own narrow behaviour first and use it).

- [ ] **Step 3: Run** the two test files, `pnpm lint`, `pnpm typecheck`. Expected: PASS.

- [ ] **Step 4: Review, fix, commit.** `git commit -m "Page search panel: period, verdict, the four numbers and their charts"`

---

### Task 6: `PageSearchPanel`, part two: what changed

**Read first:** spec section 10.3 item 5 and section 9 (busy, unavailable); the mock's breakdown tables in `perf-detail.js`; `src/components/ui/tabs.tsx` (`Tabs`, `TabsPanel`) or `inspector-tabs.tsx` if tabs inside a section are drawn with it elsewhere (find an inspector that has tabs within a section and copy that choice); the compact table used inside inspectors (search `SimpleTable` in `src/components/app`); `src/lib/api/problem.ts` (`isApiProblem`, how `retry_after` is read).

**Files:**
- Create: `src/features/page-search/panel/breakdown-tabs.tsx`
- Modify: `src/features/page-search/panel/page-search-panel.tsx`
- Test: `src/features/page-search/panel/breakdown-tabs.test.tsx`

- [ ] **Step 1: Write the failing tests:**

1. `reads only the open tab` (opening the panel requests `dimension=query` only; choosing Locations requests `dimension=country`).
2. `lists rows with now, before and the change of the first ticked metric, biggest change first`.
3. `names locations and devices` ("India", "Mobile"; an unknown code is shown as the code).
4. `a row outside the other period's stored rows shows Not collected yet in that cell, never 0`.
5. `says how much of the page's clicks the queries cover` (88%), only on the Queries tab and only when `coverage` is not null.
6. `429 shows Google is busy with the seconds and a Retry button, and the rest of the panel stays` (use `?mock=busy` through `server.use`; Retry refetches).
7. `503 shows the inline error with Retry`.
8. `an empty answer says Not collected yet`.

Run. Expected: FAIL.

- [ ] **Step 2: Implement.** `BreakdownTabs({ scope, urlId, period, metric, finalThrough })`: three tabs; the open tab's `breakdownQuery`; a compact table (32 px rows) with columns name, Now, Before, Change; rows from `sortRows` (task 3), at most 25 shown with a "Show all" button when there are more; the busy state counts nothing down by itself: it shows the seconds the answer gave and the Retry button (no timers). The panel passes the first ticked metric as `metric`. Add the note line (`pageSearch.note`) under the tabs in `page-search-panel.tsx`.

- [ ] **Step 3: Run** the test file and the panel's, `pnpm lint`, `pnpm typecheck`. Expected: PASS.

- [ ] **Step 4: Review, fix, commit.** `git commit -m "Page search panel: queries, locations and devices of the period"`

---

### Task 7: The Monitoring table

**Read first:** spec sections 9, 10.1 and 11; the mock `perf.js` (`renderTable`, `renderSummary`, `renderBulk`, `exportRows`, the states in `render`); `src/features/internal-links/internal-links-screen.tsx` (the model for `InspectorLayout`, `useInspector`, `useInspectorStepping`, `PageToolbar`, the no access state; read it, never edit it) and `src/features/internal-links/inspector/page-inspector.tsx` (how an `Inspector` of type `page` is given its header); `src/features/internal-links/pages/pages-tab.tsx` and `page-columns.tsx` (a `DataTable` with `col.*`, selection and a bulk bar); `src/components/app/data-table/columns.tsx` (every `col.*` helper and its options: use only helpers that exist) and `types.ts`; `src/components/app/sparkline/sparkline-cell.tsx`; `src/components/app/tier/tier-badge.tsx`; `src/components/app/filters/pressed-group.tsx`; `src/lib/csv/csv-write.ts` and how a screen downloads a `csvBlob` (search `csvBlob(` in `src/features`); `docs/design-system/24-page-templates.md` (template T2) and `12-tables.md`.

**Files:**
- Create: `src/features/page-search/monitoring/monitoring-screen.tsx`, `monitoring-columns.tsx`, `monitoring-filters.tsx`, `monitoring-rows.ts`, `monitoring-states.tsx`, `use-monitoring-state.ts`, `src/features/page-search/index.ts`
- Test: `src/features/page-search/monitoring/monitoring-rows.test.ts`, `monitoring-screen.test.tsx`

- [ ] **Step 1: Write the failing tests.**

`monitoring-rows.test.ts` (pure): `visibleRows(rows, { tier, health, search })` keeps a row when its tier matches (`'none'` matches `tier_id: null`, `''` matches all), its verdict matches (`''` matches all) and the search text is in its path or title, case ignored. `healthCounts(rows)` counts verdicts over the rows that pass tier and search (not the health filter), in `HEALTH_ORDER`, leaving out verdicts with none. `csvOf(rows, words)` gives the header `Page, Tier, Health, Clicks, Clicks before, Impressions, Impressions before, CTR, CTR before, Average position, Average position before` and one line per row with raw numbers (CTR to four decimals, position to one), an empty cell for `null`.

`monitoring-screen.test.tsx`:

1. `lists the tracked pages, the ones that need attention first`.
2. `has two rows above the table and nothing else`: the toolbar region and the filter region are the only siblings before the table's region inside the page container (assert on roles and labels, not on pixels).
3. `filters by tier, by health and by search text` (the Health group shows counts; the tier and health are in the address as `tier` and `health`; the search text is not).
4. `sorts by a column and writes the sort to the address`.
5. `opens a row in the inspector with the page's search detail, and steps to the next row` (`?inspect=page:<id>`; the inspector's title is the path; `PageSearchPanel` content is there).
6. `calls onOpenPage instead when it is given`.
7. `stops tracking the selected pages` (bulk bar; the remove request; a toast; the rows are gone).
8. `exports the rows shown`.
9. `states`: not connected (empty state, no table); no tracked pages (empty state with Add pages for a writer, none for a reader); pending (banner, rows with skeleton numbers); reauth (warning banner and numbers); a row with `history: loading` shows skeleton cells and the list refetches (assert `refetchInterval` through a second answer arriving).
10. `a member without data:read sees the no access state`; `a member without projects:write sees no Add pages and no selection column`.
11. `has no accessibility violations`.

Run. Expected: FAIL.

- [ ] **Step 2: Implement.**

```ts
export interface MonitoringScreenProps {
  workspaceId: string;
  workspaceSlug: string;
  project: { id: string; slug: string; name: string; timeZone: string; host: string | null };
  /** The tab strip of Pages (Overview, All pages, Monitoring), from the Pages session; nothing until it exists. */
  tabs?: ReactNode;
  /** Open a page somewhere else (the Pages drawer shell on its Search tab). Left out: the shared inspector here. */
  onOpenPage?: ((urlId: string) => void) | undefined;
}

export function MonitoringScreen(props: MonitoringScreenProps): ReactNode;
```

- `use-monitoring-state.ts`: `tier`, `health`, `sort` in the address (nuqs, defaults written as nothing), the period and comparison through the same hook the panel uses (task 5), the search text in React state.
- Page frame: `InspectorLayout` around a fixed-height page (the classes template T2 screens use: read how Keywords or Internal links make the table scroll inside its panel; do not copy the mock's class names).
- Row 1: `PageToolbar` with `title` (visually hidden if that is how tabbed pages do it; follow Internal links), `tabs={props.tabs}`, `status` the context line (`monitoring.context`, tooltip `monitoring.contextTip`), `actions` Export CSV (secondary). The Add pages button (toolbar and empty state) arrives with its dialog in task 8, so no dead button is committed here; test 9's "Add pages for a writer" assertion moves to task 8 with it.
- Row 2 (`monitoring-filters.tsx`): `PeriodControls`, the Tier `Select` (tiers from the read Internal links uses for workspace tiers: find the lib query in `src/lib/internal-links/queries.ts` for `page-tiers` and use it from `lib`, which a feature may import), the Health `PressedGroup` with counts and an "All" item, the search field (the app's search input primitive, 224 px at most, `aria-label` from messages).
- Table (`monitoring-columns.tsx`): `DataTable<TrackedPageRow>` in client mode, `getRowId` the url id, `caption`, `itemNoun`. Columns with `col.*` helpers only: the identity column (path; `detail` the title; the cell tooltip the full address), Tier (`TierBadge`, priority 2), Health (badge; `sortValue` is `attentionOrder`), Clicks, Impressions, CTR, Average position (value and change in one cell; if no helper draws a value with a change, use the helper that takes a custom `cell` and compose the app's `DeltaCell` from `components/app/metric/delta-cell.tsx`), Trend (`SparklineCell`, kind `count`, priority 3, no sort). Default sort: Health ascending (attention first). A row whose `history` is `loading`, or any row while `state` is `pending`, draws skeleton cells for the numbers.
- Selection and the bulk bar only with `projects:write`: Stop tracking (`useUntrackPages`, then a toast with `monitoring.removed` and `removedDetail`, selection cleared, the open inspector closed if its page was removed) and Export selection.
- Opening: row click and Enter call `onOpenPage(urlId)` when given; otherwise `inspector.open({ type: 'page', id })`. The inspector host renders `Inspector` (`type="page"`, header title the path, subtitle the title, the open-page link and copy action the page inspector of Internal links has, `backLabel` "Back to Monitoring", `onStep` from `useInspectorStepping` over the visible rows' ids) with `InspectorBody` holding `PageSearchPanel` (`statusCode={null}`). A target that is not a tracked row any more closes the inspector.
- Reads: `trackedPagesQuery(scope, period)` with `placeholderData: keepPreviousData` and `refetchInterval: 10_000` while any row is `loading` or the state is `pending`, else none.
- States (`monitoring-states.tsx`): as spec section 9. A banner sits between row 1 and row 2 and only in its state.
- `index.ts`:

```ts
// What other code imports of the page search feature
export { PageSearchPanel, type PageSearchPanelProps } from './panel/page-search-panel';
export { MonitoringScreen, type MonitoringScreenProps } from './monitoring/monitoring-screen';
export { useTrackedIds, useTrackPages, useUntrackPages } from './queries';
```

- [ ] **Step 3: Run** the two test files, `pnpm lint`, `pnpm typecheck`. Expected: PASS.

- [ ] **Step 4: Review, fix, commit.** `git commit -m "Monitoring: the tracked pages table with its filters, states and the page's search detail"`

---

### Task 8: Add pages

**Read first:** spec section 10.2; the mock `perf-add.js`; `src/components/ui/dialog.tsx` (`Dialog`, `DialogHeader`, `DialogBody`, `DialogFooter`); a dialog with tabs and a text area in the app, `src/features/internal-links/rules/import-dialog.tsx` (read only); `src/components/app/forms` (`FormField`, the text area primitive); the checkbox primitive in `src/components/ui`.

**Files:**
- Create: `src/features/page-search/monitoring/add-pages-dialog.tsx`
- Modify: `src/features/page-search/monitoring/monitoring-screen.tsx`
- Test: `src/features/page-search/monitoring/add-pages-dialog.test.tsx`

- [ ] **Step 1: Write the failing tests:**

1. `checks pasted addresses and shows one outcome per line` (three lines: found with clicks, already tracked, not on the host; the request has `dry_run: true`; empty lines are dropped; more than 500 lines are cut to 500).
2. `adds only the lines that are ok` (the Add button reads "Add 1 page"; the second request sends those addresses without `dry_run`; the dialog closes; `onAdded` gets the count).
3. `the button is disabled with nothing to add, and says the count of tracked pages against the limit`.
4. `suggested pages can be ticked and added by url id`.
5. `says when every suggested page is tracked already`.
6. `a failed request keeps the dialog open and shows the problem` (the app's form error pattern).
7. `has no accessibility violations`; focus starts in the text area and returns to the Add pages button on close (the `Dialog` does it: assert it).

Run. Expected: FAIL.

- [ ] **Step 2: Implement** `AddPagesDialog({ scope, host, open, onOpenChange, onAdded })`: `Dialog` size `md`, `Tabs` with "Paste addresses" and "Suggested from Search Console". Paste: a labelled text area with the hint, a "Check pages" button (`useTrackPages` with `dryRun: true`), the outcome list (a `Badge` per line with the tone the outcome deserves: positive for ok, neutral for already tracked, negative for the refusals; the sentence from `monitoring.add.outcome.*`). Editing the text after a check clears the outcomes. Suggested: `suggestionsQuery`, a checkbox list (path, title, clicks and impressions in 28 days). Footer: the count sentence at the start, Cancel, the primary button with `monitoring.add.submit`. On success: close, toast (`monitoring.add.added` with the count, `addedDetail` "Loading their history, the last 16 months."), `onAdded(count)`. Wire it into `MonitoringScreen` (the Add pages button of the toolbar and of the empty state).

Add the two toast strings to `en.json` if task 4 did not: `monitoring.add.added` `{count, plural, one {Added # page} other {Added # pages}}`, `monitoring.add.addedDetail` `Loading their history, the last 16 months.`

- [ ] **Step 3: Run** the dialog's test file and the screen's, `pnpm lint`, `pnpm typecheck`. Expected: PASS.

- [ ] **Step 4: Review, fix, commit.** `git commit -m "Monitoring: add pages by pasting addresses or from the pages with the most clicks"`

---

### Task 9: The route, the look at 1280 by 720, the build and the documents

**Read first:** `src/app/[workspace]/[project]/seo/internal-links/page.tsx` and its test (the model for a route: metadata, membership, the project, `notFound`); spec sections 10.1 and 11; `docs/32-page-performance.md`; `docs/20-frontend-specification.md` section 5.5; `docs/18-first-party-integrations.md` section 4.2; `docs/design-system/25-component-inventory.md`; the machine rules in `~/.claude/CLAUDE.md` (dev server policy: check for a running one first, never kill a process, stop what you start).

**Files:**
- Create: `src/app/[workspace]/[project]/seo/pages/monitoring/page.tsx`, `page.test.tsx`
- Modify: `docs/32-page-performance.md`, `docs/20-frontend-specification.md`, `docs/18-first-party-integrations.md`, `docs/design-system/25-component-inventory.md`, `docs/superpowers/specs/2026-11-26-page-search-and-monitoring-design.md` (an "As built" section)

- [ ] **Step 1: Check the path is free.** `git fetch origin` and `git ls-tree -r --name-only claude/pages-overview-all-drawer-f3d1f7 | grep "seo/pages/"`. If that branch has a file at `seo/pages/monitoring/page.tsx`, or a `seo/pages/layout.tsx` or `seo/pages/[...]` route that would catch `monitoring`, stop and report: the main session decides. Otherwise go on.

- [ ] **Step 2: Write the failing route test** as `internal-links/page.test.tsx` is written: the page renders `MonitoringScreen` with the workspace and project of the membership, and an unknown project is `notFound`.

- [ ] **Step 3: The route.** As the Internal links page: `generateMetadata` with the title from `monitoring.title`; `requireMembership`, `projectsOfMembership`, `notFound`; render `<MonitoringScreen workspaceId workspaceSlug project={{ id, slug, name, timeZone, host }} />`. No `tabs` and no `onOpenPage`: the Pages session passes them when its shell is merged (spec section 11). Run the test, `pnpm lint`, `pnpm typecheck`.

- [ ] **Step 4: Look at it.** Follow the dev server policy: `lsof -nP -iTCP -sTCP:LISTEN | grep -E 'node|next'`; reuse this worktree's server if one runs, else start `pnpm dev` on a free port in the background with the mocked API (read `apps/web/README.md` for the mock mode switch). In the browser pane at 1280 by 720, light and dark, open `/<workspace>/<project>/seo/pages/monitoring` and check: the first table row starts at or above 210 px (measure with `getBoundingClientRect` of the first body row); only two rows sit above the table; the table scrolls inside its panel with the header pinned; a row opens the inspector over the table, and the panel reads well at the inspector's minimum width (480 px) and as a full sheet at a 800 px window; the add dialog; each state of spec section 9 that the mock can show. Fix what is off, with tests where a rule can be tested. Stop the server you started.

- [ ] **Step 5: Documents.** No dashes; glossary words.

- `docs/32-page-performance.md`: status line "Superseded in part by `docs/superpowers/specs/2026-11-26-page-search-and-monitoring-design.md` (2026-11-26)". Section 5.1: Pages has the tabs Overview, All pages and Monitoring; the Landing pages tab is removed (owner, 2026-11-26); the detail is the Search tab of the page drawer, open for every page; Monitoring lists only tracked pages; routes as built. Section 5.2 and 5.4: Tier replaces Group; no location, device, search type or query filter in the first build. Section 5.9: two sources (paste, suggested); only crawled pages. Sections 7 and 8: a note at the top of each that the tables and routes built are those of the new spec (sections 6 and 7), with the reasons in its section 3. Section 13: mark D-PP-1 dropped, D-PP-2 changed (one detail, in the page drawer), D-PP-4 widened to locations and devices, D-PP-8 deferred, and add rows for the decisions D1 to D17 by reference. Replace "watch", "watched" and "watchlist" by "track", "tracked" and "tracked pages", "Low data" by "Not enough data", "No data" by "Not collected yet", "Insufficient data" by "Not enough data", "Country" as a label by "Location", in the sections you touch.
- `docs/20-frontend-specification.md` section 5.5: retitle to "Pages"; the tabs are Overview, All pages and Monitoring (Website audit group); the Landing pages list and the Page Intelligence detail page are replaced by All pages, its columns and the page drawer (tabs Overview, Search, Issues, AI, Links); replace the "Performance tab (proposed 2026-10-27...)" paragraph by a short description of Monitoring and the Search tab with a link to the spec. Keep what the Pages session will fill for Overview and All pages as one sentence pointing to its spec, without inventing its content.
- `docs/18-first-party-integrations.md` section 4.2: shape C now stores `position_sum` and the address forms and is kept 16 months; replace the "Watched pages" paragraph by the two filtered reads (page history, page breakdown) with a link to the spec's section 5.
- `docs/design-system/25-component-inventory.md`: entries for `PageSearchPanel` and `MonitoringScreen` under features (what they are, where used, that they add no primitive).
- The spec: an "As built" section listing anything that differs from it, with the reason.

- [ ] **Step 6: The checks of the whole change, once.** From `apps/web`: `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm vitest run --maxWorkers=1 src/features/page-search src/mocks/handlers/page-search.test.ts src/app/\[workspace\]/\[project\]/seo/pages src/i18n src/lib/glossary`, then `pnpm build`. Expected: all green. Delete `.next` afterwards if this worktree will sit idle (it can be rebuilt).

- [ ] **Step 7: Review, fix, commit.** Two commits: `git commit -m "Monitoring: the route, and fixes from the look at 1280 by 720"` and `git commit -m "Docs: page performance, the Pages section and the Search Console shapes follow the page search and Monitoring build"`.

Do not push, do not merge into `develop`, do not touch `main`. Report to the main session: what was built, the checks run and their results, what differs from the spec, and the open questions of spec section 15.

## Self-review

- Spec 10.1: task 7 (and the measurement in task 9). 10.2: task 8. 10.3: tasks 5 and 6. Section 9 states: tasks 5, 6, 7. Section 11 join: props in tasks 5 and 7, exports in task 7, the path check in task 9. Section 12 words: task 4. Doc updates (doc 32, doc 20 section 5.5, doc 18): task 9.
- Names used across tasks: `PeriodParams`, `SearchScope`, `periodValue`, `periodParams`, `compareWindow`, `lastFullMonth`, `attentionOrder`, `HEALTH_ORDER`, `healthTone`, `verdictMessage`, `changeOf`, `sortRows`, `nameOf`, `chartOf`, `trackedPagesQuery`, `trackedIdsQuery`, `suggestionsQuery`, `pageSearchQuery`, `breakdownQuery`, `pageSearchKeys`, `useTrackedIds`, `useTrackPages`, `useUntrackPages`, `PeriodControls`, `BreakdownTabs`, `PageSearchPanel`, `MonitoringScreen`, `AddPagesDialog`.
