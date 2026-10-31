# Rank Features in Rankings (Frontend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rankings shows the rest of what the API knows about a keyword's rank: SERP features, AI Overview status, whether the target URL is the one that ranks, a 30-check trend, competitors' positions, a summary strip over the table, the rank history chart in the keyword inspector, and a "Check now" action for one keyword or a selection.

**Architecture:** The follow-up of `2026-10-06-rank-columns-ui.md` (its Decisions item 1 lists these items as separate plans). Almost everything is already served by the backend on main (`backend/openapi/v1.json`): the row's `state` carries features, AI Overview and target match; `include=sparkline` and `include=competitor_ranks` fill two more row blocks; `GET .../tracked-keywords/{id}/rank-history` gives the chart; `POST {P}/seo/check-now` starts a manual live check. The only gap is aggregates for the metric strip (average rank, visibility, comparison deltas), so the strip ships its four count items now from `page.total` reads and the rest is one blocked task with an exact backend request. As in the sibling plan, a pure model decides what a cell or chart shows and the components only lay out; the mocks learn each new block and route before the UI uses it.

**Tech Stack:** Next.js 16, React 19, TypeScript strict (`exactOptionalPropertyTypes`), TanStack Query 5, nuqs, next-intl, ECharts 6 (through `ChartFrame`), MSW, Vitest with Testing Library, Playwright.

---

## Read first

| What | Where |
|---|---|
| Executor rules (gates, review on Opus, no dashes, edit tools only, `design-taste-frontend` before markup) | `docs/superpowers/plans/2026-10-01-keywords-ui.md`, "Notes for the executor" |
| What the rank columns plan built and how | `docs/superpowers/plans/2026-10-06-rank-columns-ui.md` (Facts, Decisions, Review fixes) |
| Rankings code | `apps/web/src/features/rankings/{keyword-columns.ts,rank-columns.tsx,rank-cells.tsx,rank-filters.ts,keyword-filters.ts,rankings-queries.ts,keyword-cache.ts,rankings-screen.tsx}`, `bulk/bulk-target.ts`, `bulk/bulk-actions.tsx`, `refresh/*`, `keyword-inspector/*` |
| Table plumbing | `apps/web/src/lib/tables/column-types.ts`, `apps/web/src/components/app/data-table/columns.tsx` (`col.*`, `rich`), `data-table/types.ts` (`CellTip`, `RecordAction`) |
| Column and cell specs | `docs/design-system/24-page-templates.md` section 9.3 (columns 1 and 7 to 10, strip, bulk actions), `12-tables.md` sections 5 and 6 (`sparkline`, `features`, `aiOverview`, `competitor` types; `SparklineCell`, `SERPFeatureList`, `AIOverviewStatus`, `CompetitorCell`) |
| Filters | `docs/design-system/13-filters-search.md` sections 3 to 5 (`feat`, `aio` keys; enum multi for status) |
| Badges and feature labels | `docs/design-system/14-badges-status.md` section 6 (SERP feature short labels) |
| Charts | `docs/design-system/15-data-visualization.md` sections 7 (rank charts) and 9 (sparklines) |
| Accessibility | `docs/design-system/20-accessibility.md` section 1 (1.1.1 sparklines `role="img"`), the table of spoken values (lines 450 to 456: AI Overview cell, SERP features, sparkline), section 12 (chart summary, table view, markers) |
| API | `backend/openapi/v1.json`: list `GET {P}/tracked-keywords` (`include`, `filter[feature_present]`, `filter[feature_owned]`, `filter[aio_state]`, `filter[target_url_match]`), schemas `TrackedKeywordState`, `Sparkline`, `SparklinePoint`, `CompetitorRank`, `AioStateInfo`, `RankHistory`, `HistorySeries`, `HistoryPoint`, `HistoryBand`, `HistorySummary`, `CheckNow`, `Run`; routes `GET .../tracked-keywords/{id}/rank-history`, `POST {P}/seo/check-now` |
| Backend behaviour | `backend/src/idraft/api/operations/runs.py` (`check_now`: order of refusals), `backend/src/idraft/api/ranks/routes.py` and `history.py` (rank history), `backend/src/idraft/db/migrations/versions/0013_rank_collection.py` lines 71 to 89 (the 16 SERP feature codes), `backend/src/idraft/ranks/resolve.py` `target_url_match` |
| Mock UI (visual reference only) | `apps/web/design-preview/index.html` and the files named per task in the task list below |

All commands run in `apps/web`. Before any markup, invoke `design-taste-frontend` (house rule); the project's design system outranks its generic advice.

**Precedence.** Project docs (`docs/design-system/*`, doc 20) and the API win over the mock UI in `design-preview/`. Where they disagree the task says so and names the winner.

## Facts this plan relies on

- **Always on the row** (`row.state`, no `include` needed): `feature_types_present` (codes on the first results page), `owned_feature_types`, `aio` (`AioStateInfo`: `state` is `absent`, `present_not_cited`, `present_cited`, `not_loaded` or `unknown`; `citation_position`; `observation_id`), `target_url_match` (`true`, `false`, or `null` without a target or without a ranking URL: `ranks/resolve.py`).
- **`include=sparkline`** fills `row.sparkline`: `{ depth_mode: 'daily_depth', points: SparklinePoint[] }`, the last 30 checks oldest first, each `{ t, rank, depth, state: 'ranked' | 'beyond_depth' }` (failed checks are not points).
- **`include=competitor_ranks`** fills `row.competitor_ranks`: `CompetitorRank[]` = `{ entity: EntityRef, current: RankCell, change: RankChange }` for the keyword's effective competitors. `EntityRef.color_index` is `--chart-1` to `--chart-6` or null.
- **List filters** (single value each, AND with the rest): `filter[feature_present]` (1 to 100 characters, one code), `filter[feature_owned]` (one code), `filter[aio_state]` (a list of the five states), `filter[target_url_match]` (boolean). The bulk routes' body filter (`TrackedKeywordFilter`) has the same members without the `filter[...]` wrapper. `keyword-cache.ts` already lists all four in `LOOKS_AT`.
- **No sort** exists for features, AI Overview, competitors or the trend: the list's `sort` takes only `keyword`, `search_volume`, `keyword_difficulty`, `cpc_usd`, `priority`, `created_at`, `current_rank`, `rank_change`, `best_rank`, `last_observed_at`. These columns are `sortable: false`, so client and server mode behave the same.
- **SERP feature codes** (migration 0013, `seo.serp_feature_types`): `ai_overview`, `featured_snippet`, `people_also_ask`, `local_pack`, `knowledge_graph`, `top_stories`, `video`, `images`, `discussions_and_forums`, `perspectives`, `shopping`, `related_searches` (not ownable), `social_posts`, `answer_box`, `ads`, `sitelinks`. No route lists them, so the UI mirrors the list; an unknown code from the API is still shown (by its code) and never dropped.
- **Rank history** `GET {P}/tracked-keywords/{id}/rank-history`: `window` `last_7d` to `last_365d` (default `last_90d`) or `from`/`to` (at most 400 days); `entity_ids` (`own` or uuids, default own plus effective competitors, at most 11); `include` `absolute`, `url`, `events`; `format` `points` (default) or `columns`. Answer `data`: `series` (`HistorySeries[]`: `entity`, `points` of `{ date, observed_at, state: 'ranked' | 'beyond_depth' | 'failed', rank, depth_requested, url_id, serp_snapshot_id, absolute_rank }`), `bands` (`{ entity_id, from, to, kind: 'beyond_depth', depth_requested, label }`), `summary` (`checks`, `ranked_checks`, `beyond_depth_checks`, `failed_checks`, `average_rank` as a `MetricValue` or null), `window` (`from`, `to`, `timezone`), `config_history`, `version_boundaries`, `deep_check_weekday`, `urls`. Permission `data:read`.
- **Check now** `POST {P}/seo/check-now`, body `CheckNow` = `{ tracked_keyword_ids: uuid[1..100], depth?: 10 | 20 | 50 | 100 | null }`, answer `202` with `RunResponse` (`workload: 'seo_rank'`, `trigger: 'manual'`). Permission `runs:trigger`. Refusals in the backend's order (`runs.py`): `503 provider_paused` (with `Retry-After`), `422 validation_failed` with `keyword_unknown` at `tracked_keyword_ids` (archived or not tracked), `429 manual_run_limit` with `limit` (20 manual runs per project per UTC day, shared with Refresh metrics: `meta.manual_runs_today` on `GET {P}/runs` counts both), `422 quota_exceeded` with `limit`, `used`, `requested`, `quota: 'max_serp_checks_per_month'` (the workspace's live checks this month). A budget used up gives a run that ends `budget_blocked`. "A result is normally there within seconds" after the worker plans it within a minute.
- **Counts by `page.total`:** `GET {P}/tracked-keywords?limit=1` answers `page.total` for any filter combination (`useTrackedCount` already uses this). The API has no summary or aggregate route for rankings: no average rank, no visibility, no previous-period comparison.

## Decisions

Tables are 12 px with capital header labels, compact (32 px rows) by default and left aligned in every column except the row actions (owner decisions of 2026-10-29); this is global, see 12-tables.md.

1. **Order.** Unblocked tasks first, cheapest first: three columns read from `row.state` only (features, AI Overview, target match), then the two `include` columns (trend, competitors), then the strip, the inspector chart and Check now. The one blocked task (strip aggregates) comes after them; the closing task does the end to end flows and documents.
2. **Not sortable:** SERP features, AI Overview, competitor and trend columns, since the API cannot sort by them (Facts). Their header tooltips do not promise a sort.
3. **Column set and tiers** (template 9.3; tiers follow the viewport): SERP features tier 3 (120 px), AI Overview tier 2 (104 px), Competitor tier 4 (120 px, one column per SEO competitor, the first visible by default, the others in the chooser), Trend tier 2 (96 px). Order after the rank columns: Keyword, Rank, Change, Ranking URL, Volume, KD, CPC, Intent, SERP features, AI Overview, Competitor(s), Trend, Priority, Group, Tags, Best rank, Updated, Added. KD and CPC stay where the rank columns plan put them (the template does not list them in the default set; they are chooser candidates later, not moved here).
4. **Sparkline renderer:** a canvas, as 15-data-visualization.md section 9 prescribes ("shared canvas renderer, not ECharts", `components/app/sparkline`), drawn from a pure geometry function that is unit tested. The 64 x 20 size is used in both densities in this plan (the cells do not receive the density); 64 x 16 for Compact is recorded as a limit.
5. **Metric strip now, aggregates later:** Tracked, Top 3, Top 10, Top 20 from `limit=1` reads with the list's filters (the search box is not part of the strip's scope, so it reads the same in both list modes). No delta is shown (MetricStrip: "left out when there is no comparison, never a zero in its place"). Average rank and Visibility wait for the backend (Task 9).
6. **Check now runs at each keyword's daily depth** (no depth control): the body sends no `depth`. Entry points: the inspector's frequent action (`frequentAction`, the header slot meant for "Check now") and the bulk bar, ahead of Refresh metrics. A selection by filter ("all matching") or of more than 100 keywords is refused in the UI with the reason, since the route takes ids only and at most 100.
7. **Run following is shared:** the refresh's open-runs read, run cache and header progress (`refresh/refresh-queries.ts`, `refresh-progress.tsx`) take a workload (`keyword_metrics` or `seo_rank`) instead of a second copy. The day's count stays one number for both, as the API counts both.
8. **Mock rank world stays derived:** new blocks (sparkline, competitor ranks, rank history) are computed from the same `checksOf` walk as `rankStateOf`; nothing new is stored. A mock check now records a run but does not change any rank (storing up to 100 ids per run does not fit the operations cookie); the as-built note says so.
9. **New URL keys** (13-filters-search.md section 5 gains rows): `featown` (SERP feature owned) and `tmatch` (target URL match). `feat` and `aio` already exist in the key table.

## Task list

| # | Task | Status | Mock reference (`apps/web/design-preview/`) |
|---|---|---|---|
| 1 | SERP features column and filters | Unblocked | `index.html` "SERP features" card (lines 497 to 511): feature names and the owned count read as "You appear"; no table column exists in the mock |
| 2 | AI Overview column and filter | Unblocked | `prompts-parts.js` `keywordRow` (cited badge in `positive-subtle`) |
| 3 | Target URL match marker and filter | Unblocked | `kw-inspector.js` Tracking card ("Target URL", "No target set"); no mismatch marker in the mock |
| 4 | Trend (sparkline) column | Unblocked | `charts.js` `renderSparklines` (lines 333 to 390), `prompts-cells.js` `sparkCell`, `perf-chart.js` `sparkline` |
| 5 | Competitor position columns | Unblocked | none for keywords; `prompts-cells.js` `topEngineCell` for a compact value cell |
| 6 | Metric strip (counts) | Unblocked | `customize.js` `NUMBER_DATA` `seo.*` (lines 133 to 143), `index.html` summary strip `data-zone="numbers"` |
| 7 | Rank history chart in the inspector | Unblocked | `index.html` prompt inspector History panel (lines 783 to 797, `#chart-prompt-history`, 180 px), `charts.js` `hatch()` (line 145) |
| 8 | Check now (one keyword and bulk) | Unblocked | `index.html` inspector header "Check now" button (line 755, `data-toast-check`), `interactions.js` toast `check` (line 332), `kw.js` bulk bar order (lines 207 to 221) |
| 9 | Metric strip: average rank, visibility, deltas | **Blocked** (backend) | `customize.js` `seo.average_rank`, `seo.visibility_volume` |
| 10 | End to end, documents, whole-branch review | Unblocked after 1 to 8 | `kw-table.js` for the column order sanity check |

### Mock versus docs and API (which wins)

| Topic | Mock says | Docs or API say | Winner |
|---|---|---|---|
| Feature labels | "Image pack" (`index.html` line 506) | Code `images`, short label "Images" (14-badges-status.md section 6, migration 0013) | Docs and API |
| AI Overview not cited, absent | Neutral badge with the word (`prompts-parts.js`) | Not cited: 16 px `Check` icon in `primary-text`, name "AI Overview present, not cited"; absent: "No AIO" text in tertiary, no badge (12-tables.md section 6, doc 20 line 453) | Docs |
| Empty sparkline | "n/a" text (`prompts-cells.js` `sparkCell`) | 1 px dashed `border` line across the width (15 section 9) | Docs |
| Sparkline scale | Fixed 1 to 20 (`charts.js`) | Same: fixed per table, 1 to 20 by default | Agree |
| Sparkline as SVG | `perf-chart.js` draws SVG | Shared canvas renderer (15 section 9) | Docs |
| Strip deltas | "+6", "+14", "+1.2 pts" (`customize.js`) | The API has no comparison; MetricStrip leaves the delta out | API (Task 9 adds them when the API does) |
| Strip Visibility, Average rank | Shown (`customize.js`) | No API source | API (Task 9) |
| Check now toast | "Check queued. Results arrive in about 2 minutes." (`interactions.js`) | Planned within a minute, a result within seconds after that; the run is followed in the header like a refresh | API; copy in Task 8 |
| Rank history look | Prompt history: a line chart card, 180 px, an Observations table and Events below | 15 section 7: inverted axis, guides at 3, 10, 20 with labels in a 52 px right margin, hatched depth band, competitor series in entity colors | Docs (take the card layout and height from the mock) |

## File structure

| File | Responsibility |
|---|---|
| Create `src/lib/keywords/serp-features.ts` (+ test) | The 16 feature codes, which are ownable, and the slots a cell shows (pure) |
| Create `src/features/rankings/feature-cells.tsx` (+ test) | `SerpFeatureListView`, `AioStatusView`, `TargetMismatchMarker`, `CompetitorRankView` |
| Create `src/lib/format/aio-display.ts` (+ test) | What an AI Overview cell shows (pure) |
| Create `src/lib/charts/sparkline.ts` (+ test) | Sparkline geometry and summary (pure) |
| Create `src/components/app/sparkline/sparkline-cell.tsx` (+ test) | The canvas `SparklineCell` |
| Create `src/features/rankings/strip/strip-queries.ts` (+ test), `strip/rank-strip.tsx` (+ test) | The strip's count reads and its `MetricStrip` |
| Create `src/features/rankings/keyword-inspector/rank-history-model.ts` (+ test), `rank-history-section.tsx` | The chart's series, bands and depth (pure) and the card |
| Create `src/lib/charts/rank-chart.ts` (+ test) | The rank axis, guides and depth band over a category chart option |
| Create `src/features/rankings/check-now/check-now-model.ts` (+ test), `use-check-now.tsx`, `check-now.test.tsx` | Targets and refusals (pure), the hook with bar action, inspector button and progress |
| Create `src/mocks/handlers/rank-history.ts` (+ test) | Mock rank history route |
| Modify `src/lib/tables/column-types.ts`, `src/components/app/data-table/columns.tsx` (+ test) | Types `features`, `aiOverview`, `competitor`, `sparkline`; `col.features`, `col.aiOverview`, `col.competitor`, `col.sparkline`; `marker` on `col.keyword` |
| Modify `src/features/rankings/rank-columns.tsx`, `keyword-columns.ts` | The new columns |
| Modify `src/features/rankings/rank-filters.ts` (+ test), `keyword-filters.ts`, `bulk/bulk-target.ts` (+ test) | Chips `feat`, `featown`, `aio`, `tmatch` and their parameters |
| Modify `src/features/rankings/rankings-queries.ts` | `include` gains `sparkline` and `competitor_ranks` |
| Modify `src/features/rankings/refresh/refresh-queries.ts`, `refresh-progress.tsx`, `use-metrics-refresh.tsx` | Run following by workload |
| Modify `src/features/rankings/rankings-screen.tsx`, `keyword-inspector/keyword-inspector.tsx`, `components/app/chart/chart-frame.tsx` | Wiring: strip, Check now, the history card, `extendOption` |
| Modify `src/mocks/rank-state.ts`, `factories/keyword.ts`, `handlers/runs.ts`, `handlers/index.ts` (+ tests) | Feature codes, sparkline and competitor blocks, check now |
| Modify `src/lib/api/types.ts` | Export `AioStateInfo`, `Sparkline`, `SparklinePoint`, `CompetitorRank`, `RankHistory` |
| Modify `messages/en.json` | `rankings.features`, `rankings.aio`, `rankings.target`, `rankings.trend`, `rankings.competitor`, `rankings.strip`, `rankings.inspector.rankHistory`, `rankings.checkNow` |
| Modify `e2e/flows/rankings.spec.ts`, `e2e/visual/pages.spec.ts`, docs | Flows, visual, as-built notes |

---

### Task 1: SERP features column and filters

**Files:**
- Create: `apps/web/src/lib/keywords/serp-features.ts`, `apps/web/src/lib/keywords/serp-features.test.ts`, `apps/web/src/features/rankings/feature-cells.tsx`, `apps/web/src/features/rankings/feature-cells.test.tsx`
- Modify: `apps/web/src/mocks/rank-state.ts`, `apps/web/src/mocks/rank-state.test.ts`, `apps/web/src/lib/tables/column-types.ts`, `apps/web/src/components/app/data-table/columns.tsx`, `apps/web/src/features/rankings/rank-columns.tsx`, `apps/web/src/features/rankings/keyword-columns.ts`, `apps/web/src/features/rankings/rank-filters.ts`, `apps/web/src/features/rankings/rank-filters.test.ts`, `apps/web/src/features/rankings/keyword-filters.ts`, `apps/web/src/features/rankings/bulk/bulk-target.ts`, `apps/web/src/features/rankings/bulk/bulk-target.test.ts`, `apps/web/messages/en.json`, `apps/web/src/features/rankings/rankings.test.tsx`

**Mock reference:** `design-preview/index.html` "SERP features" card: the feature names and the idea of "You appear" for owned. Its "Image pack" label loses to the API's `images` and 14-badges' "Images". The mock has no table column: the cell follows 12-tables.md `SERPFeatureList`.

- [ ] **Step 1: Fix the mock's feature codes (test first).** In `apps/web/src/mocks/rank-state.test.ts` add:

```ts
import { FEATURE_TYPES } from '@/lib/keywords/serp-features';

it('uses only the feature codes the backend knows, and lists ai_overview when an AI Overview showed', () => {
  const now = Date.parse('2026-10-29T12:00:00Z');
  for (const row of MOCK_TRACKED_KEYWORDS.slice(0, 40)) {
    const state = rankStateOf(row.tracked_keyword_id, row.created_at, now, 'fynix.digital');
    for (const code of state.feature_types_present) expect(FEATURE_TYPES).toContain(code);
    for (const code of state.owned_feature_types) expect(state.feature_types_present).toContain(code);
    const showed = state.aio.state === 'present_cited' || state.aio.state === 'present_not_cited';
    if (state.current.state !== 'not_checked') expect(state.feature_types_present.includes('ai_overview')).toBe(showed);
  }
});
```

Run: `pnpm vitest run src/mocks/rank-state.test.ts`. Expected: FAIL (module `serp-features` missing, and `image_pack` is not a backend code).

- [ ] **Step 2: Write the feature model test** `apps/web/src/lib/keywords/serp-features.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { FEATURE_SLOTS, FEATURE_TYPES, OWNABLE_FEATURE_TYPES, featureListDisplay } from './serp-features';

describe('SERP features', () => {
  it('mirrors the 16 codes of the backend in its order', () => {
    expect(FEATURE_TYPES).toHaveLength(16);
    expect(FEATURE_TYPES[0]).toBe('ai_overview');
    expect(FEATURE_TYPES.at(-1)).toBe('sitelinks');
  });

  it('cannot own related searches', () => {
    expect(OWNABLE_FEATURE_TYPES).not.toContain('related_searches');
    expect(OWNABLE_FEATURE_TYPES).toHaveLength(15);
  });

  it('orders the slots by the fixed feature order and marks the owned ones', () => {
    expect(featureListDisplay(['video', 'ai_overview', 'featured_snippet'], ['featured_snippet'])).toEqual({
      shown: [
        { type: 'ai_overview', owned: false },
        { type: 'featured_snippet', owned: true },
        { type: 'video', owned: false },
      ],
      overflow: 0,
      all: [
        { type: 'ai_overview', owned: false },
        { type: 'featured_snippet', owned: true },
        { type: 'video', owned: false },
      ],
    });
  });

  it('shows five slots and counts the rest', () => {
    const present = ['ads', 'sitelinks', 'video', 'images', 'local_pack', 'shopping', 'top_stories'];
    const shown = featureListDisplay(present, []);
    expect(shown.shown).toHaveLength(FEATURE_SLOTS);
    expect(shown.overflow).toBe(2);
    expect(shown.all).toHaveLength(7);
  });

  it('keeps a code the UI does not know, after the known ones, and drops repeats', () => {
    expect(featureListDisplay(['new_thing', 'video', 'video'], []).shown).toEqual([
      { type: 'video', owned: false },
      { type: 'new_thing', owned: false },
    ]);
  });

  it('shows nothing for no features', () => {
    expect(featureListDisplay([], [])).toEqual({ shown: [], overflow: 0, all: [] });
  });
});
```

- [ ] **Step 3: Run it** (`pnpm vitest run src/lib/keywords/serp-features.test.ts`). Expected: FAIL, module missing.

- [ ] **Step 4: Write `apps/web/src/lib/keywords/serp-features.ts`:**

```ts
/**
 * The SERP features the backend records (`seo.serp_feature_types`, migration 0013, docs/06 section 5.4), in
 * its order, which is also the order of a cell's fixed slots (12-tables.md section 6, `SERPFeatureList`). No
 * route lists them, so the list is mirrored here; a code the API adds later is still shown, after these.
 */

export const FEATURE_TYPES = [
  'ai_overview',
  'featured_snippet',
  'people_also_ask',
  'local_pack',
  'knowledge_graph',
  'top_stories',
  'video',
  'images',
  'discussions_and_forums',
  'perspectives',
  'shopping',
  'related_searches',
  'social_posts',
  'answer_box',
  'ads',
  'sitelinks',
] as const;

export type FeatureType = (typeof FEATURE_TYPES)[number];

/** A domain cannot own these: they have no source URLs (`ownable` false in the migration). */
const NOT_OWNABLE: ReadonlySet<string> = new Set<FeatureType>(['related_searches']);

export const OWNABLE_FEATURE_TYPES: readonly FeatureType[] = FEATURE_TYPES.filter((type) => !NOT_OWNABLE.has(type));

/** A cell shows this many feature icons, then a `+N` count (12-tables.md section 6). */
export const FEATURE_SLOTS = 5;

export const isFeatureType = (value: string): value is FeatureType =>
  (FEATURE_TYPES as readonly string[]).includes(value);

export interface FeatureSlot {
  type: string;
  owned: boolean;
}

export interface FeatureListDisplay {
  /** The first `FEATURE_SLOTS`, in the fixed order. */
  shown: FeatureSlot[];
  /** How many more there are. */
  overflow: number;
  /** Every feature, for the tooltip and the accessible name. */
  all: FeatureSlot[];
}

const orderOf = (type: string): number => {
  const index = (FEATURE_TYPES as readonly string[]).indexOf(type);
  return index === -1 ? FEATURE_TYPES.length : index;
};

/** What a SERP features cell shows for the codes present and the codes the project owns. */
export function featureListDisplay(
  present: readonly string[],
  owned: readonly string[],
  slots: number = FEATURE_SLOTS,
): FeatureListDisplay {
  const ownedSet = new Set(owned);
  const all = [...new Set(present)]
    .sort((a, b) => orderOf(a) - orderOf(b) || a.localeCompare(b))
    .map((type) => ({ type, owned: ownedSet.has(type) }));
  return { shown: all.slice(0, slots), overflow: Math.max(0, all.length - slots), all };
}
```

- [ ] **Step 5: Fix the mock.** In `apps/web/src/mocks/rank-state.ts` replace the local `FEATURES` constant by an import of `FEATURE_TYPES` and pick from the six common ones the backend really parses: `const FEATURES = ['featured_snippet', 'people_also_ask', 'video', 'images', 'local_pack', 'top_stories'] as const satisfies readonly FeatureType[];`. In `rankStateOf`, compute `aio` first, then `const features = [...(showed ? ['ai_overview'] : []), ...featuresOf(trackedId)]` where `showed` is `aio.state === 'present_cited' || aio.state === 'present_not_cited'`, so the AI Overview feature and the AIO state never disagree. `ai_overview` is owned exactly when `aio.state === 'present_cited'` and the keyword ranks. Run `pnpm vitest run src/mocks`. Expected: PASS (update only assertions that named `image_pack`).

- [ ] **Step 6: Column type and builder (test first).** In `apps/web/src/components/app/data-table/data-table.test.tsx` (or the columns test the rank columns plan added) add a case: `col.features('serp_features', () => null, { header: 'SERP features', priority: 3, width: 120, sortable: false, cell: () => 'x' })` has `type: 'features'`, `width: 120` (clamped between 112 and 220), and `sortValue` undefined. Run it: FAIL. Then in `column-types.ts` add `'features'` to `ColumnType` and `features: { width: 140, min: 112, max: 220, align: 'left', defaultDesc: true, flex: false }` (12-tables.md section 5; the type sorts by count, but no API sort exists, so screens pass `sortable: false`). In `columns.tsx` widen `rich`'s type parameter to `Extract<ColumnType, 'rank' | 'rankDelta' | 'url' | 'features'>` and add:

```ts
  /** SERP features: icon slots, left aligned (12-tables.md section 6, `SERPFeatureList`). */
  features<TRow>(id: string, sortValue: (row: TRow) => number | null, options: RichOptions<TRow>): DataTableColumn<TRow> {
    return rich(id, 'features', sortValue, options);
  },
```

Run `pnpm vitest run src/components/app/data-table src/lib/tables && pnpm typecheck`. Expected: PASS.

- [ ] **Step 7: Strings** in `messages/en.json` under `rankings.features` (plain text, no dashes):

```json
"features": {
  "column": "SERP features",
  "columnTooltip": "Result features on the first page at the latest check. Highlighted ones show your site.",
  "none": "None",
  "noneTooltip": "No result features on the first page at the latest check.",
  "pending": "Pending",
  "pendingTooltip": "The first check has not run yet.",
  "more": "+{count}",
  "owned": "{feature}, yours",
  "listName": "SERP features: {features}",
  "types": {
    "ai_overview": "AI Overview",
    "featured_snippet": "Snippet",
    "people_also_ask": "PAA",
    "local_pack": "Local pack",
    "knowledge_graph": "Knowledge panel",
    "top_stories": "Top stories",
    "video": "Video",
    "images": "Images",
    "discussions_and_forums": "Discussions",
    "perspectives": "Perspectives",
    "shopping": "Shopping",
    "related_searches": "Related searches",
    "social_posts": "Social posts",
    "answer_box": "Answer box",
    "ads": "Ads",
    "sitelinks": "Sitelinks"
  },
  "names": {
    "ai_overview": "AI Overview",
    "featured_snippet": "Featured snippet",
    "people_also_ask": "People also ask",
    "local_pack": "Local pack",
    "knowledge_graph": "Knowledge panel",
    "top_stories": "Top stories",
    "video": "Video",
    "images": "Images",
    "discussions_and_forums": "Discussions and forums",
    "perspectives": "Perspectives",
    "shopping": "Shopping",
    "related_searches": "Related searches",
    "social_posts": "Social posts",
    "answer_box": "Answer box",
    "ads": "Ads",
    "sitelinks": "Sitelinks"
  }
}
```

  `types` are the 14-badges short labels (tooltips, chips); `names` are the full names for screen readers (doc 20 line 455: "Featured snippet, owned. People also ask. Video"). A code without a key is shown by its code: the component checks `t.has(...)` before reading a key.

- [ ] **Step 8: Write the failing cell test** `apps/web/src/features/rankings/feature-cells.test.tsx` (render with `NextIntlClientProvider` as `rank-cells.test.tsx` does):
  1. `SerpFeatureListView` with `featureListDisplay(['featured_snippet', 'video'], ['featured_snippet'])` renders two icons, the snippet icon has `text-primary-text`, the video icon `text-foreground-muted`; the cell's accessible text (an `sr-only` span) is "SERP features: Featured snippet, yours. Video".
  2. Seven features render five icons and a visible `+2`.
  3. No features after a check render "None" in tertiary; a keyword `not_checked` renders "Pending".
  4. An unknown code `new_thing` renders the fallback icon and is named `new_thing`.
- [ ] **Step 9: Run it** (`pnpm vitest run src/features/rankings/feature-cells.test.tsx`). Expected: FAIL.
- [ ] **Step 10: Implement `SerpFeatureListView`** in `feature-cells.tsx`: props `{ display: FeatureListDisplay; checked: boolean }`. Icons are 16 px Lucide components (`size-icon`, stroke 1.75, `aria-hidden`), one per code, in a fixed map in the same file: `ai_overview: Sparkles`, `featured_snippet: TextQuote`, `people_also_ask: MessageCircleQuestion`, `local_pack: MapPin`, `knowledge_graph: BookOpen`, `top_stories: Newspaper`, `video: Video`, `images: Image`, `discussions_and_forums: MessagesSquare`, `perspectives: UserRound`, `shopping: ShoppingBag`, `related_searches: Search`, `social_posts: Share2`, `answer_box: MessageSquareText`, `ads: Megaphone`, `sitelinks: Link`, fallback `CircleDot` (if an icon name does not exist in the installed `lucide-react`, typecheck fails: pick the nearest existing one and note it in the as-built note). Owned icons `text-primary-text`, others `text-foreground-muted` (12-tables.md section 6). The visible `+N` is `type-meta num`. The spoken list is one `sr-only` span built from `names` (owned ones with `owned`), and the icons are `aria-hidden`, so the list is read once.
- [ ] **Step 11: The column.** In `rank-columns.tsx` add `features` to `RankColumns` and `RANK_COLUMN_IDS` (`features: 'serp_features'`):

```tsx
features: col.features<TrackedKeywordRow>(RANK_COLUMN_IDS.features, () => null, {
  header: features('column'),
  headerTooltip: features('columnTooltip'),
  priority: 3,
  width: 120,
  sortable: false,
  cell: (row) => (
    <SerpFeatureListView
      display={featureListDisplay(row.state.feature_types_present, row.state.owned_feature_types)}
      checked={row.state.current.state !== 'not_checked'}
    />
  ),
  cellTip: (row) => featureTip(row),
}),
```

  `features` is `useTranslations('rankings.features')`; `featureTip` gives `{ content: <the short labels joined by ", ">, detail: <owned ones, "Yours: Snippet"> }` when there are features, the `noneTooltip` or `pendingTooltip` otherwise. In `keyword-columns.ts` put `ranks.features` after Intent. Update the file's doc comment (SERP features built; trend, AI Overview and competitor still to come until their tasks land).
- [ ] **Step 12: Filters (test first).** Add to `rank-filters.test.ts`:

```ts
  it('maps a SERP feature to feature_present and an owned feature to feature_owned', () => {
    expect(rankFilterParams(one('feat', 'featured_snippet'))).toEqual({ 'filter[feature_present]': 'featured_snippet' });
    expect(rankFilterParams(one('featown', 'video'))).toEqual({ 'filter[feature_owned]': 'video' });
  });

  it('drops a feature code the API does not know and an owned feature that cannot be owned', () => {
    expect(rankFilterParams(one('feat', 'image_pack'))).toEqual({});
    expect(rankFilterParams(one('featown', 'related_searches'))).toEqual({});
  });
```

  Run: FAIL. In `rank-filters.ts` extend `RankFilterParams` with `'filter[feature_present]' | 'filter[feature_owned]'` and add to `rankFilterParams`:

```ts
  const feature = choiceOf(values, 'feat', FEATURE_TYPES);
  const ownedFeature = choiceOf(values, 'featown', OWNABLE_FEATURE_TYPES);
  if (feature !== undefined) params['filter[feature_present]'] = feature;
  if (ownedFeature !== undefined) params['filter[feature_owned]'] = ownedFeature;
```

  In `keyword-filters.ts` add two single-choice enum fields after `chg`: `{ id: 'feat', kind: 'enum', label: t('feature'), multi: false, options: options(FEATURE_TYPES, (value) => featureLabel(value)) }` and `{ id: 'featown', kind: 'enum', label: t('featureOwned'), multi: false, options: options(OWNABLE_FEATURE_TYPES, featureLabel) }`, where `featureLabel` reads `rankings.features.names`. The API takes one feature per parameter, so both chips are single choice (same reason as the rank chips). Strings under `rankings.filters`: `"feature": "SERP feature"`, `"featureOwned": "SERP feature you own"`.
- [ ] **Step 13: Bulk body filter (test first).** In `bulk-target.test.ts` add a case: "Select all matching" under `feat=video` and `featown=featured_snippet` sends `feature_present: 'video'` and `feature_owned: 'featured_snippet'` in the body filter. Run: FAIL. In `bulk-target.ts` add `...given('feature_present', filters['filter[feature_present]'])` and `...given('feature_owned', filters['filter[feature_owned]'])` beside the rank members. Run: PASS.
- [ ] **Step 14: Screen tests** in `rankings.test.tsx`: a fixture keyword with features shows its icons and the spoken list; choosing "SERP feature: Video" sends `filter[feature_present]=video` and writes `feat=video` to the URL; a link with `feat=image_pack` drops the chip with the usual notice. Update only assertions that enumerate columns.
- [ ] **Step 15: Gates** (in `apps/web`, all must pass): `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm format:check`, `NEXT_PUBLIC_API_MOCKING=off pnpm build`, `pnpm run preview`, `pnpm e2e`.
- [ ] **Step 16: Independent review on Opus.** The lead dispatches a reviewer on the Opus model with this task's text and the diff since the task started; fix every Critical and Important finding (each with its test first), then run the gates again.
- [ ] **Step 17: Commit**

```bash
git add apps/web/src apps/web/messages/en.json
git commit -m "Rankings: SERP features column and filters"
```

**As-built notes:**
- `ai_overview` in `absolute_rank`: `ai_overview` is included in `feature_types_present` and counts toward `features.length` in `absolute_rank: latest.rank + Math.min(features.length, 2)`, as an AI Overview occupies physical SERP space above organic search results.

### Task 2: AI Overview column and filter

**Files:**
- Create: `apps/web/src/lib/format/aio-display.ts`, `apps/web/src/lib/format/aio-display.test.ts`
- Modify: `apps/web/src/lib/format/index.ts`, `apps/web/src/lib/api/types.ts`, `apps/web/src/lib/tables/column-types.ts`, `apps/web/src/components/app/data-table/columns.tsx`, `apps/web/src/features/rankings/feature-cells.tsx` (+ test), `rank-columns.tsx`, `keyword-columns.ts`, `rank-filters.ts` (+ test), `keyword-filters.ts`, `bulk/bulk-target.ts` (+ test), `apps/web/messages/en.json`, `rankings.test.tsx`

**Mock reference:** `design-preview/prompts-parts.js` `keywordRow`: "Cited #2" as a `positive-subtle` badge with `positive-text`. Copy only that badge. For "not cited" and "no AI Overview" the mock's neutral badge loses to 12-tables.md section 6 and doc 20 line 453 (a `Check` icon; "No AIO" plain tertiary text).

- [ ] **Step 1: Write the failing test** `apps/web/src/lib/format/aio-display.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { aioDisplay } from './aio-display';
import type { AioStateInfo } from '@/lib/api/types';

const aio = (state: AioStateInfo['state'], position: number | null = null): AioStateInfo => ({
  state,
  citation_position: position,
  observation_id: state === 'absent' || state === 'unknown' ? null : '17',
});

describe('aioDisplay', () => {
  it('shows a citation with its position', () => {
    expect(aioDisplay(aio('present_cited', 2), 'ranked')).toEqual({ kind: 'cited', position: 2 });
    expect(aioDisplay(aio('present_cited', null), 'beyond_depth')).toEqual({ kind: 'cited', position: null });
  });

  it('tells an AI Overview that does not cite the site from none at all', () => {
    expect(aioDisplay(aio('present_not_cited'), 'ranked')).toEqual({ kind: 'notCited' });
    expect(aioDisplay(aio('absent'), 'ranked')).toEqual({ kind: 'absent' });
  });

  it('says not loaded and unknown as such', () => {
    expect(aioDisplay(aio('not_loaded'), 'ranked')).toEqual({ kind: 'notLoaded' });
    expect(aioDisplay(aio('unknown'), 'failed')).toEqual({ kind: 'unknown' });
  });

  it('is pending before the first check, whatever the state says', () => {
    expect(aioDisplay(aio('unknown'), 'not_checked')).toEqual({ kind: 'pending' });
  });
});
```

- [ ] **Step 2: Run it** (`pnpm vitest run src/lib/format/aio-display.test.ts`). Expected: FAIL.
- [ ] **Step 3: Implement** (add `export type AioStateInfo = Schemas['AioStateInfo'];` to `src/lib/api/types.ts` beside `RankCell`, and `export * from './aio-display';` to `src/lib/format/index.ts`):

```ts
import type { AioStateInfo, RankCell } from '@/lib/api/types';

/** What an AI Overview cell shows (12-tables.md section 6, `AIOverviewStatus`). Codes only: no English here. */
export type AioDisplay =
  | { kind: 'cited'; position: number | null }
  | { kind: 'notCited' }
  | { kind: 'absent' }
  | { kind: 'notLoaded' }
  | { kind: 'pending' }
  | { kind: 'unknown' };

export function aioDisplay(aio: AioStateInfo, current: RankCell['state']): AioDisplay {
  if (current === 'not_checked') return { kind: 'pending' };
  switch (aio.state) {
    case 'present_cited':
      return { kind: 'cited', position: aio.citation_position };
    case 'present_not_cited':
      return { kind: 'notCited' };
    case 'absent':
      return { kind: 'absent' };
    case 'not_loaded':
      return { kind: 'notLoaded' };
    case 'unknown':
      return { kind: 'unknown' };
  }
}
```

- [ ] **Step 4: Run** the test and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Column type** `aiOverview: { width: 112, min: 96, max: 140, align: 'left', defaultDesc: false, flex: false }` in `column-types.ts`; widen `rich` to include `'aiOverview'`; add `col.aiOverview` the same way as `col.features` (test first in the columns test: type, clamped width 104, no sort value with `sortable: false`).
- [ ] **Step 6: Strings** under `rankings.aio`:

```json
"aio": {
  "column": "AI Overview",
  "columnTooltip": "Whether Google showed an AI Overview at the latest check, and whether it cites your site.",
  "cited": "Cited #{position}",
  "citedNoPosition": "Cited",
  "absent": "No AIO",
  "notLoaded": "Not loaded",
  "notLoadedTooltip": "The AI Overview did not load at the latest check.",
  "unknown": "n/a",
  "unknownTooltip": "The latest check did not record the AI Overview.",
  "pending": "Pending",
  "pendingTooltip": "The first check has not run yet.",
  "speech": {
    "cited": "AI Overview present, cited at position {position}",
    "citedNoPosition": "AI Overview present, cited",
    "notCited": "AI Overview present, not cited",
    "absent": "Not applicable, no AI Overview"
  },
  "states": {
    "present_cited": "Cited",
    "present_not_cited": "Present, not cited",
    "absent": "No AI Overview",
    "not_loaded": "Not loaded",
    "unknown": "Unknown"
  }
}
```

- [ ] **Step 7: Cell test first** in `feature-cells.test.tsx`: `AioStatusView` for `cited` 2 shows "Cited #2" in a positive badge; `notCited` shows a `Check` icon in `text-primary-text` with the accessible name "AI Overview present, not cited" and no visible word; `absent` shows "No AIO" in tertiary and speaks "Not applicable, no AI Overview"; `notLoaded`, `unknown`, `pending` show their words in tertiary. Run: FAIL.
- [ ] **Step 8: Implement `AioStatusView`** (`{ display: AioDisplay }`): `cited` is `<Badge tone="positive">` (check the badge's tone names in `src/components/ui/badge.tsx`) with the optional 12 px `Check` icon; `notCited` is a 16 px `Check` in `text-primary-text` with `role="img"` and `aria-label`; the rest are tertiary text, `absent` with an `sr-only` sentence and the visible word `aria-hidden`.
- [ ] **Step 9: The column** in `rank-columns.tsx` (`RANK_COLUMN_IDS.aio = 'aio'`), tier 2, width 104, `sortable: false`, cell `<AioStatusView display={aioDisplay(row.state.aio, row.state.current.state)} />`, cell tip: the matching tooltip for `notLoaded`, `unknown`, `pending`, and for `cited` "Cited at position {n}". Place it after SERP features in `keyword-columns.ts`.
- [ ] **Step 10: Filter (test first).** In `rank-filters.test.ts`:

```ts
  it('maps the AI Overview chip to a list of states, keeping only known ones', () => {
    expect(rankFilterParams({ aio: { kind: 'enum', values: ['present_cited', 'absent'] } })).toEqual({
      'filter[aio_state]': ['present_cited', 'absent'],
    });
    expect(rankFilterParams({ aio: { kind: 'enum', values: ['sometimes'] } })).toEqual({});
  });
```

  Implement: `export const AIO_CHOICES = ['present_cited', 'present_not_cited', 'absent', 'not_loaded', 'unknown'] as const;`, a helper

```ts
/** The values of a multi choice chip that are among `allowed`, in the chip's order. */
function choicesOf<T extends string>(values: FilterValues, id: string, allowed: readonly T[]): T[] {
  const value = values[id];
  if (value?.kind !== 'enum') return [];
  return value.values.flatMap((item) => allowed.filter((candidate) => candidate === item));
}
```

  and `const aio = choicesOf(values, 'aio', AIO_CHOICES); if (aio.length > 0) params['filter[aio_state]'] = aio;` (extend `RankFilterParams` with `'filter[aio_state]'`). In `keyword-filters.ts` the field `{ id: 'aio', kind: 'enum', label: t('aio'), multi: true, options: options(AIO_CHOICES, (value) => aioStates(value)) }` after `featown` (13-filters-search.md line 43: a status is an enum multi; the chip reads "AI Overview: Cited, No AI Overview"). `rankings.filters.aio`: "AI Overview". In `bulk-target.ts` add `...given('aio_state', filters['filter[aio_state]'])` with its test.
- [ ] **Step 11: Screen tests:** a cited fixture keyword shows "Cited #n"; choosing "AI Overview: Cited" sends `filter[aio_state]=present_cited`; the mock keeps only matching rows.
- [ ] **Step 12: Gates** (`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm format:check`, `NEXT_PUBLIC_API_MOCKING=off pnpm build`, `pnpm run preview`, `pnpm e2e`).
- [ ] **Step 13: Independent review on Opus,** fixes with tests first, gates again.
- [ ] **Step 14: Commit** `git add apps/web/src apps/web/messages/en.json && git commit -m "Rankings: AI Overview column and filter"`.

### Task 3: Target URL match marker and filter

**Files:**
- Modify: `apps/web/src/components/app/data-table/columns.tsx` (+ test), `apps/web/src/features/rankings/feature-cells.tsx` (+ test), `keyword-columns.ts`, `rank-filters.ts` (+ test), `keyword-filters.ts`, `bulk/bulk-target.ts` (+ test), `apps/web/src/mocks/keyword-fixtures.ts` (only if no fixture has a target URL that differs from its ranking path), `apps/web/messages/en.json`, `rankings.test.tsx`

**Mock reference:** `design-preview/kw-inspector.js` Tracking card ("Target URL", "No target set") for the words. The mock has no mismatch marker; 24-page-templates.md section 9.3 column 1 puts "target mismatch icons" in the Keyword cell, which wins.

- [ ] **Step 1: Failing test for the marker slot** in the columns test: `col.keyword('keyword', (row) => row.text, { header: 'Keyword', marker: (row) => (row.flag ? <span data-testid="m" /> : null) })` renders the marker after the text for a flagged row and nothing for the other; the cell's tooltip and accessible name are unchanged by the marker.
- [ ] **Step 2: Run it.** Expected: FAIL (`marker` is not an option).
- [ ] **Step 3: Implement** in `col.keyword`: add `marker?: ((row: TRow) => ReactNode) | undefined` to its options; render `{marker}` as a `shrink-0` sibling after the label, before the copy button, inside the existing flex wrapper (wrap the label in the flex span when there is a marker and no copy button). The marker carries no text of its own (`aria-hidden`); what it means goes into the cell's `detail` (next step), so it is read once.
- [ ] **Step 4: Strings** under `rankings.target`:

```json
"target": {
  "mismatch": "Ranks with {ranking}, not the target {target}.",
  "markerLabel": "Target URL does not rank",
  "chip": "Target URL",
  "match": "Ranks with the target",
  "mismatchChoice": "Ranks with another URL"
}
```

- [ ] **Step 5: Marker component test first** (`feature-cells.test.tsx`): `TargetMismatchMarker` renders a 14 px `Crosshair` icon in `text-warning-text`, `aria-hidden`, and nothing else. Implement it.
- [ ] **Step 6: Wire it** in `keyword-columns.ts`: `marker: (row) => (row.state.target_url_match === false ? <TargetMismatchMarker /> : null)` (`keyword-columns.ts` becomes `.tsx`, or the marker is built in `rank-columns.tsx` and passed in: prefer renaming to `keyword-columns.tsx`, updating its imports). The `detail` gains the sentence when the match is `false`: `[keywordDetail, mismatchSentence].join(' ')` where `mismatchSentence` is `t('target.mismatch', { ranking: row.state.current.url?.path ?? '', target: row.target_url?.path ?? '' })`. Only `false` marks: `null` (no target or no ranking URL) and `true` show nothing.
- [ ] **Step 7: Filter (test first)** in `rank-filters.test.ts`:

```ts
  it('maps the target URL chip to target_url_match', () => {
    expect(rankFilterParams(one('tmatch', 'match'))).toEqual({ 'filter[target_url_match]': true });
    expect(rankFilterParams(one('tmatch', 'mismatch'))).toEqual({ 'filter[target_url_match]': false });
    expect(rankFilterParams(one('tmatch', 'maybe'))).toEqual({});
  });
```

  Implement with `export const TARGET_CHOICES = ['match', 'mismatch'] as const;` and `const target = choiceOf(values, 'tmatch', TARGET_CHOICES); if (target !== undefined) params['filter[target_url_match]'] = target === 'match';`. Field `{ id: 'tmatch', kind: 'enum', label: t('target'), multi: false, options: [match, mismatch] }` after `aio`; `rankings.filters.target`: "Target URL". A keyword without a target or not ranking matches neither choice (the API's `null`), which the chip's editor says in a hint line: add `"targetHint": "Keywords without a target URL, or not ranking, match neither."` and pass it as the field's description if `FilterField` has one (check `components/app/filters/types.ts`; if not, leave the hint out and note it). Bulk: `...given('target_url_match', filters['filter[target_url_match]'])` with its test.
- [ ] **Step 8: Mock data.** Check that some active fixture keywords have a target URL whose path differs from their mock ranking path and some match (`rankStateOf` already computes `target_url_match`). If none mismatch, give two fixture keywords in `keyword-fixtures.ts` a target URL on the project's domain with a different path, and one the same path, and add a `rank-state.test.ts` case that pins `true`, `false` and `null`.
- [ ] **Step 9: Screen tests:** the mismatching fixture row shows the marker and its cell description says "Ranks with /x, not the target /y."; "Target URL: Ranks with another URL" sends `filter[target_url_match]=false`.
- [ ] **Step 10: Gates** (full list as in Task 1 Step 15).
- [ ] **Step 11: Independent review on Opus,** fixes, gates again.
- [ ] **Step 12: Commit** `git commit -m "Rankings: target URL match marker and filter"` (add `apps/web/src apps/web/messages/en.json`).

### Task 4: Trend (sparkline) column

**Files:**
- Create: `apps/web/src/lib/charts/sparkline.ts`, `apps/web/src/lib/charts/sparkline.test.ts`, `apps/web/src/components/app/sparkline/sparkline-cell.tsx`, `apps/web/src/components/app/sparkline/sparkline-cell.test.tsx`
- Modify: `apps/web/src/lib/api/types.ts`, `apps/web/src/mocks/rank-state.ts` (+ test), `apps/web/src/mocks/factories/keyword.ts`, `apps/web/src/mocks/handlers/tracked-keywords.test.ts`, `apps/web/src/lib/tables/column-types.ts`, `apps/web/src/components/app/data-table/columns.tsx` (+ test), `rank-columns.tsx`, `keyword-columns.tsx`, `rankings-queries.ts`, `apps/web/messages/en.json`, `rankings.test.tsx`

**Mock reference:** `design-preview/charts.js` `renderSparklines`: copy the drawing (64 x 20 canvas scaled by `devicePixelRatio`, 1.5 px `chart-reference` stroke, round joins, ranks inverted on a fixed 1 to 20 scale, a gap breaks the line, a 1.5 px radius dot on the last point only when the last value exists). `prompts-cells.js` `sparkCell` for `role="img"` and its label. Its "n/a" for no data loses to 15 section 9 (dashed line); `perf-chart.js`'s SVG loses to the canvas rule.

- [ ] **Step 1: Write the failing geometry test** `apps/web/src/lib/charts/sparkline.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { SPARK_HEIGHT, SPARK_WIDTH, sparklineGeometry, sparklineSummary } from './sparkline';

const ranked = (rank: number) => ({ rank, state: 'ranked' as const });
const beyond = { rank: null, state: 'beyond_depth' as const };

describe('sparkline geometry', () => {
  it('puts rank 1 at the top and rank 20 at the bottom, inside the padding', () => {
    const { segments } = sparklineGeometry([ranked(1), ranked(20)]);
    const [first, second] = segments[0] ?? [];
    expect(first).toEqual({ x: 2.5, y: 2.5 });
    expect(second).toEqual({ x: SPARK_WIDTH - 2.5, y: SPARK_HEIGHT - 2.5 });
  });

  it('keeps a deeper rank on the bottom edge', () => {
    const { segments } = sparklineGeometry([ranked(1), ranked(45)]);
    expect(segments[0]?.[1]?.y).toBe(SPARK_HEIGHT - 2.5);
  });

  it('breaks the line at a check beyond the depth', () => {
    const { segments } = sparklineGeometry([ranked(3), ranked(4), beyond, ranked(5)]);
    expect(segments.map((segment) => segment.length)).toEqual([2, 1]);
  });

  it('marks the last point only when the last check ranked', () => {
    expect(sparklineGeometry([ranked(3), ranked(4)]).last).not.toBeNull();
    expect(sparklineGeometry([ranked(3), beyond]).last).toBeNull();
  });

  it('centres a single point', () => {
    expect(sparklineGeometry([ranked(10)]).segments).toEqual([[{ x: SPARK_WIDTH / 2, y: expect.any(Number) }]]);
  });

  it('has nothing to draw without points', () => {
    expect(sparklineGeometry([])).toEqual({ segments: [], last: null });
  });
});

describe('sparkline summary', () => {
  it('says where the rank started and ended, the best, and how many checks were beyond the depth', () => {
    expect(sparklineSummary([ranked(9), beyond, ranked(3), ranked(4)])).toEqual({
      checks: 4,
      first: 9,
      last: 4,
      best: 3,
      beyond: 1,
    });
  });

  it('has no ranks when every check was beyond the depth', () => {
    expect(sparklineSummary([beyond, beyond])).toEqual({ checks: 2, first: null, last: null, best: null, beyond: 2 });
  });
});
```

- [ ] **Step 2: Run it** (`pnpm vitest run src/lib/charts/sparkline.test.ts`). Expected: FAIL.
- [ ] **Step 3: Implement** `apps/web/src/lib/charts/sparkline.ts` (add `export type Sparkline = Schemas['Sparkline']; export type SparklinePoint = Schemas['SparklinePoint'];` to `src/lib/api/types.ts`):

```ts
import type { SparklinePoint } from '@/lib/api/types';

/**
 * Where a rank sparkline's line and last point fall in its box (15-data-visualization.md section 9): ranks
 * inverted, better up, on a scale fixed per table (1 to 20) so rows compare; a deeper rank sits on the bottom
 * edge; a check beyond the depth breaks the line. The canvas only draws what this returns.
 */

export const SPARK_WIDTH = 64;
export const SPARK_HEIGHT = 20;
const PAD = 2.5;
/** The rank at the bottom edge of every sparkline in a table. */
export const SPARK_RANK_SCALE = 20;

export interface SparkPoint {
  x: number;
  y: number;
}

export interface SparklineGeometry {
  /** Runs of ranked checks; a check beyond the depth ends a run. */
  segments: SparkPoint[][];
  /** The latest check, when it ranked. */
  last: SparkPoint | null;
}

type Point = Pick<SparklinePoint, 'rank' | 'state'>;

export function sparklineGeometry(
  points: readonly Point[],
  width: number = SPARK_WIDTH,
  height: number = SPARK_HEIGHT,
): SparklineGeometry {
  const segments: SparkPoint[][] = [];
  const step = points.length > 1 ? (width - PAD * 2) / (points.length - 1) : 0;
  let run: SparkPoint[] | null = null;
  for (const [index, point] of points.entries()) {
    if (point.state !== 'ranked' || point.rank === null) {
      run = null;
      continue;
    }
    const share = (Math.min(Math.max(point.rank, 1), SPARK_RANK_SCALE) - 1) / (SPARK_RANK_SCALE - 1);
    const at = { x: points.length > 1 ? PAD + index * step : width / 2, y: PAD + share * (height - PAD * 2) };
    if (run === null) {
      run = [at];
      segments.push(run);
    } else {
      run.push(at);
    }
  }
  const latest = points.at(-1);
  const last = latest?.state === 'ranked' && latest.rank !== null ? (segments.at(-1)?.at(-1) ?? null) : null;
  return { segments, last };
}

export interface SparklineSummary {
  checks: number;
  /** The first and last ranked checks' ranks, and the best. */
  first: number | null;
  last: number | null;
  best: number | null;
  /** Checks beyond the depth checked. */
  beyond: number;
}

/** The numbers of a sparkline's accessible name (20-accessibility.md: "from 9 to 4, best 3, 2 checks not in top 20"). */
export function sparklineSummary(points: readonly Point[]): SparklineSummary {
  const ranks = points.flatMap((point) => (point.state === 'ranked' && point.rank !== null ? [point.rank] : []));
  return {
    checks: points.length,
    first: ranks[0] ?? null,
    last: ranks.at(-1) ?? null,
    best: ranks.length === 0 ? null : Math.min(...ranks),
    beyond: points.length - ranks.length,
  };
}
```

  (Rounding: if the `toEqual` on `x: SPARK_WIDTH - 2.5` fails by floating point, compare with `toBeCloseTo` in the test, not by rounding in the code.)
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Cell test first** `sparkline-cell.test.tsx`: `<SparklineCell points={...} label="Rank trend..." />` renders a `canvas` with `role="img"` and that `aria-label`, width and height attributes 64 x 20 times `devicePixelRatio` and CSS size 64 x 20; with no points it renders the empty state: a `span` with a 1 px dashed `border-border` line across the width and the label still on a `role="img"` wrapper. jsdom has no 2D context: stub `HTMLCanvasElement.prototype.getContext` in the test to return an object with `beginPath`, `moveTo`, `lineTo`, `stroke`, `arc`, `fill`, `setTransform`, `clearRect` spies, and assert `moveTo` is called once per segment and `arc` once when `last` is set.
- [ ] **Step 6: Implement** `apps/web/src/components/app/sparkline/sparkline-cell.tsx` (`'use client'`): props `{ points: readonly SparklinePoint[]; label: string }`. A `useEffect` keyed on the points draws: read the stroke colour from the CSS custom property `--chart-reference` through the token reader the charts use (`src/lib/design/read-tokens.ts`; use its single-token helper if it has one, else `getComputedStyle(document.documentElement).getPropertyValue('--chart-reference')`), scale by `devicePixelRatio`, stroke each segment at 1.5 px with round joins, then the last point as a 1.5 px radius dot. If `getContext('2d')` returns `null`, draw nothing (the label still describes it). Rankings rows are all the own site, so the line is always gray (15 section 9). Re-draw on theme change: subscribe to the same theme signal `EChart` uses (read `components/app/chart/echart.tsx`), or a `MutationObserver` on the root's `class` and `data-theme` attributes if that is what it does.
- [ ] **Step 7: Column type** `sparkline: { width: 88, min: 88, max: 120, align: 'left', defaultDesc: null, flex: false }`, `rich` widened with `'sparkline'`, and `col.sparkline<TRow>(id, options: RichOptions<TRow>)` that passes `() => null` as the sort value and forces `sortable: false` (test first: type, width clamped to 96, never sortable).
- [ ] **Step 8: Mock block (test first).** In `tracked-keywords.test.ts`: `include=sparkline` answers `sparkline.points` with at most 30 points oldest first, each `state` `ranked` with a rank or `beyond_depth` with `rank: null`, the last point's `t` equal to `state.current.observed_at` for a checked keyword; a keyword never checked answers `points: []`; without the include `sparkline` is `null`. Run: FAIL. In `rank-state.ts` extract the part of `rankStateOf` that computes `checks` (pending, failed, stale and stopped rules, the domain rule) into an exported `checksAt(trackedId, createdAt, now, domain, stoppedAt): MockCheck[]` that `rankStateOf` calls, and add:

```ts
/** The keyword's sparkline as `include=sparkline` answers it: the last 30 checks, oldest first. */
export function sparklineOf(
  trackedId: string,
  createdAt: string,
  now: number,
  domain: string | null,
  stoppedAt: string | null = null,
): Schemas['Sparkline'] {
  return {
    depth_mode: 'daily_depth',
    points: checksAt(trackedId, createdAt, now, domain, stoppedAt).map((check) => ({
      t: check.observedAt,
      rank: check.rank,
      depth: check.depth,
      state: check.rank === null ? 'beyond_depth' : 'ranked',
    })),
  };
}
```

  In `factories/keyword.ts` fill `sparkline: include.has('sparkline') ? sparklineOf(row.tracked_keyword_id, row.created_at, rank.now, rank.domain, stoppedAtOf(row)) : null` and update the comment (sparkline is filled; the other three still answer null until their tasks). Run `pnpm vitest run src/mocks`. Expected: PASS.
- [ ] **Step 9: Ask for it.** In `rankings-queries.ts` `INCLUDE` becomes `['metrics', 'groups', 'terms', 'sparkline']` (both modes use it). Note in the file's comment that the pending-metrics poll (`refresh/pending-metrics.ts`) lays only `metrics` and `state` over a waiting row, so a first check's sparkline arrives with the next read of the list, which is acceptable for a keyword with one point.
- [ ] **Step 10: Strings** under `rankings.trend`:

```json
"trend": {
  "column": "Trend",
  "columnTooltip": "Rank at the last 30 checks, better up, on a scale of 1 to 20. A gap is a check beyond the depth.",
  "label": "Rank trend, last {checks, plural, one {check} other {# checks}}: from {first} to {last}, best {best}",
  "labelBeyond": "{count, plural, one {1 check} other {# checks}} beyond the depth checked",
  "labelNone": "Rank trend: not ranked within the depth in the last {checks, plural, one {check} other {# checks}}",
  "labelEmpty": "Rank trend: no checks yet",
  "tipTitle": "Last checks",
  "tipPoint": "{date}: {rank}"
}
```

- [ ] **Step 11: The column** in `rank-columns.tsx` (`RANK_COLUMN_IDS.trend = 'trend'`), tier 2, width 96: cell `<SparklineCell points={row.sparkline?.points ?? []} label={trendLabel(row)} />`; `trendLabel` joins `label` (when `first` is set) and `labelBeyond` (when `beyond > 0`) with ", ", or `labelNone` / `labelEmpty`. Cell tip: `{ content: tipTitle, detail: <the last 7 points, newest last, as "Oct 27: 4" joined by ", ", a beyond point as ">20" with its depth through `formatRankCell`> }` (15 section 9: "last 7 values with dates"; dates by `formatTableDateTime` date part in the project's time zone). Place it after the competitor slot (Task 5) or, before Task 5 lands, after AI Overview.
- [ ] **Step 12: Screen tests:** the Trend header is present; a fixture row's canvas has the label "Rank trend, last N checks: from a to b, best c"; a pending keyword's label is "Rank trend: no checks yet"; the list request carries `include=metrics,groups,terms,sparkline`.
- [ ] **Step 13: Gates** (full list).
- [ ] **Step 14: Independent review on Opus,** fixes, gates again.
- [ ] **Step 15: Commit** `git commit -m "Rankings: rank trend column"` (add `apps/web/src apps/web/messages/en.json`).

### Task 5: Competitor position columns

**Files:**
- Modify: `apps/web/src/lib/api/types.ts`, `apps/web/src/mocks/rank-state.ts` (+ test), `apps/web/src/mocks/factories/keyword.ts`, `apps/web/src/mocks/handlers/tracked-keywords.ts` (+ test), `apps/web/src/lib/tables/column-types.ts`, `apps/web/src/components/app/data-table/columns.tsx` (+ test), `apps/web/src/features/rankings/feature-cells.tsx` (+ test), `rank-columns.tsx`, `keyword-columns.tsx`, `rankings-queries.ts`, `rankings-screen.tsx`, `apps/web/messages/en.json`, `rankings.test.tsx`

**Mock reference:** none for keywords. `design-preview/prompts-cells.js` `topEngineCell` shows the compact one-value cell to imitate; the colour swatch and value of 12-tables.md `CompetitorCell` win.

- [ ] **Step 1: Mock block (test first)** in `tracked-keywords.test.ts`: `include=competitor_ranks` answers, for a checked fixture keyword, one `CompetitorRank` per project entity with role `competitor`, `track_seo` true and not removed (read `src/mocks/entity-fixtures.ts` for Fynix's competitors), each `{ entity: { entity_id, canonical_name, entity_type, role: 'competitor', color_index }, current: RankCell, change: RankChange }`; a keyword never checked answers `[]`; a keyword whose override excludes a competitor (read `overridesOf` in the factory) has no entry for it; without the include `null`. Run: FAIL.
- [ ] **Step 2: Implement** in `rank-state.ts`:

```ts
/**
 * A competitor's rank on the keyword as `include=competitor_ranks` answers it: the same walk as the keyword's
 * own, seeded by the keyword and the competitor, at the moments of the keyword's own checks.
 */
export function competitorRankOf(
  trackedId: string,
  createdAt: string,
  now: number,
  entity: Schemas['EntityRef'],
  stoppedAt: string | null = null,
): Schemas['CompetitorRank'] | null {
  // No competitor rank before the keyword's own first good check (pending or failed keywords have none)
  if (checksAt(trackedId, createdAt, now, null, stoppedAt).length === 0) return null;
  const until = stoppedAt === null ? now : Math.min(now, Date.parse(stoppedAt));
  const theirs = checksOf(`${trackedId}:${entity.entity_id}`, createdAt, until);
  const latest = theirs.at(-1);
  if (latest === undefined) return null;
  return {
    entity,
    current: {
      state: latest.rank === null ? 'beyond_depth' : 'ranked',
      rank: latest.rank,
      absolute_rank: latest.rank,
      depth_requested: latest.depth,
      url: null,
      observed_at: latest.observedAt,
      serp_snapshot_id: null,
    },
    change: changeOf(theirs.at(-2) ?? null, latest),
  };
}
```

  (`checksAt` comes from Task 4; with a `null` domain its checks have no ranks, but their count still says whether the keyword was ever checked.) The factory fills `competitor_ranks: include.has('competitor_ranks') ? effectiveCompetitors(...).flatMap((entity) => competitorRankOf(...) ?? []) : null`, with `effectiveCompetitors` built from the project's entities and the keyword's overrides exactly as `effectiveCompetitorIds` in `keyword-inspector/inspector-queries.ts` describes (copy the rule; do not import UI code into mocks). Export `CompetitorRank` from `src/lib/api/types.ts`. Run `pnpm vitest run src/mocks`: PASS.
- [ ] **Step 3: Column type** `competitor: { width: 160, min: 120, max: 240, align: 'left', defaultDesc: false, flex: false }`, `rich` widened with `'competitor'`, `col.competitor` like `col.features` (test first).
- [ ] **Step 4: Strings** under `rankings.competitor`:

```json
"competitor": {
  "headerTooltip": "{name}'s organic rank at the latest check.",
  "notTracked": "n/a",
  "notTrackedTooltip": "{name} is not in this keyword's competitor set.",
  "speech": "{name}: {rank}"
}
```

- [ ] **Step 5: Cell test first** in `feature-cells.test.tsx`: `CompetitorRankView` with an 8 px square swatch (`--chart-3` for `color_index: 3`, `aria-hidden`) followed by the competitor's rank shown through the existing `RankCellView` (`>20` beyond the depth, a number when ranked); a missing entry shows "n/a" in tertiary. Implement it: swatch `size-2 rounded-2xs` with `style={{ backgroundColor: 'var(--chart-N)' }}`, where N is `color_index` when it is 2 to 6, otherwise 2 plus the column's position modulo 5 (15 section 3: own brand is `chart-1`, competitors `chart-2` to `chart-6`).
- [ ] **Step 6: Columns.** In `rank-columns.tsx` add `useCompetitorColumns(competitors: readonly EntityRef[]): DataTableColumn<TrackedKeywordRow>[]`: one column per competitor, id `competitor_${entity_id}` (check `parseColumns` in `lib/tables/table-state.ts` accepts the id: it must survive the `cols` URL round trip; if it rejects `-`, strip dashes from the uuid), header the competitor's `canonical_name`, `headerTooltip` from `headerTooltip`, tier 4, width 120, `sortable: false`, `defaultVisible` true for the first only. Order: `color_index` ascending (nulls last), then name (`localeCompare`). Cell: the row's entry in `competitor_ranks` for that entity id through `rankDisplay(entry.current, false, 0)`; tooltip: `tips.rank(...)` of the same display. The competitors come from `projectEntitiesQuery(scope)` (in `keyword-inspector/inspector-queries.ts`) filtered to `role === 'competitor' && track_seo && removed_at === null`, read in `rankings-screen.tsx` and passed down to `useKeywordColumns(timeZone, competitors)`; while it loads, no competitor column exists (the chooser gains them when it lands).
- [ ] **Step 7: Ask for it.** `INCLUDE` gains `'competitor_ranks'`. Record in the as-built note that the block is always asked for (about 5 small objects per row), since asking only while a competitor column is visible would read the whole list again on every chooser change.
- [ ] **Step 8: Screen tests:** the first competitor column is visible at 1680 px and named after the competitor; the others are in the column chooser, off; turning one on shows its ranks without a new list request; a keyword that excludes a competitor shows "n/a" with the tooltip.
- [ ] **Step 9: Gates** (full list).
- [ ] **Step 10: Independent review on Opus,** fixes, gates again.
- [ ] **Step 11: Commit** `git commit -m "Rankings: competitor position columns"`.

### Task 6: Metric strip (counts)

**Files:**
- Create: `apps/web/src/features/rankings/strip/strip-queries.ts`, `strip/strip-queries.test.ts`, `strip/rank-strip.tsx`, `strip/rank-strip.test.tsx`
- Modify: `apps/web/src/features/rankings/rankings-screen.tsx`, `apps/web/src/features/rankings/keyword-cache.test.ts`, `apps/web/messages/en.json`, `rankings.test.tsx`

**Mock reference:** `design-preview/customize.js` `NUMBER_DATA` (`seo.keywords_tracked` "986 checked", `seo.top3_count` / `top10` / `top20` "of 986 checked") for the words of each item, and the summary panel in `index.html` (`data-zone="numbers"`, one bordered panel, not cards). The mock's deltas and the Visibility and Average rank items are not built here (Decision 5, Task 9).

- [ ] **Step 1: Write the failing test** `strip-queries.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { stripQueries } from './strip-queries';
import type { KeywordFilters } from '../rankings-queries';

const base: KeywordFilters = { 'filter[is_active]': true, 'filter[device]': 'mobile' };

describe('stripQueries', () => {
  it('counts ranked, beyond, top 3, top 10 and top 20 under the list filters', () => {
    expect(stripQueries(base)).toEqual({
      ranked: { ...base, 'filter[rank_is_null]': false },
      beyond: { ...base, 'filter[rank_is_null]': true },
      top3: { ...base, 'filter[rank_lte]': 3 },
      top10: { ...base, 'filter[rank_lte]': 10 },
      top20: { ...base, 'filter[rank_lte]': 20 },
    });
  });

  it('intersects a chosen rank bucket with each top count, and knows an empty one without asking', () => {
    const bucket: KeywordFilters = { ...base, 'filter[rank_gte]': 4, 'filter[rank_lte]': 10 };
    const queries = stripQueries(bucket);
    expect(queries.top3).toBeNull();
    expect(queries.top10).toEqual({ ...bucket, 'filter[rank_lte]': 10 });
    expect(queries.top20).toEqual({ ...bucket, 'filter[rank_lte]': 10 });
    // A ranked range excludes every keyword beyond the depth
    expect(queries.beyond).toBeNull();
  });

  it('has no ranked keywords to count under the beyond depth chip', () => {
    const queries = stripQueries({ ...base, 'filter[rank_is_null]': true });
    expect(queries.ranked).toBeNull();
    expect(queries.top3).toBeNull();
    expect(queries.top10).toBeNull();
    expect(queries.top20).toBeNull();
    expect(queries.beyond).toEqual({ ...base, 'filter[rank_is_null]': true });
  });
});
```

- [ ] **Step 2: Run it** (`pnpm vitest run src/features/rankings/strip`). Expected: FAIL.
- [ ] **Step 3: Implement** `strip-queries.ts`:

```ts
'use client';

import { useQueries } from '@tanstack/react-query';

import { keywordsKey, readPage, type KeywordFilters, type ProjectScope } from '../rankings-queries';

/**
 * The counts of the Rankings strip (24-page-templates.md section 9.3, "Strip"): how many keywords the list's
 * filters match that ranked, that were checked and not found, and that rank in the top 3, 10 and 20. The API
 * has no summary route, so each is the `page.total` of a one-row read with the filters and one more
 * condition. A count the filters already rule out is known to be 0 and not asked for. The search box is not
 * part of the strip's scope, so the strip reads the same in both list modes.
 */

export const STRIP_COUNTS = ['ranked', 'beyond', 'top3', 'top10', 'top20'] as const;
export type StripCount = (typeof STRIP_COUNTS)[number];

const TOPS = { top3: 3, top10: 10, top20: 20 } as const;
const DEEPEST = 700;

/** The filters of each count, or `null` for a count that is 0 under these filters. */
export function stripQueries(filters: KeywordFilters): Record<StripCount, KeywordFilters | null> {
  const beyondOnly = filters['filter[rank_is_null]'] === true;
  const rankedOnly = filters['filter[rank_is_null]'] === false;
  const from = filters['filter[rank_gte]'] ?? 1;
  const to = filters['filter[rank_lte]'] ?? DEEPEST;
  const ranged = filters['filter[rank_gte]'] !== undefined || filters['filter[rank_lte]'] !== undefined;
  const top = (limit: number): KeywordFilters | null => {
    const lte = Math.min(to, limit);
    return beyondOnly || from > lte ? null : { ...filters, 'filter[rank_lte]': lte };
  };
  return {
    ranked: beyondOnly ? null : { ...filters, 'filter[rank_is_null]': false },
    // A keyword beyond the depth has no rank, so a range or the ranked chip leaves none
    beyond: rankedOnly || ranged ? null : { ...filters, 'filter[rank_is_null]': true },
    top3: top(TOPS.top3),
    top10: top(TOPS.top10),
    top20: top(TOPS.top20),
  };
}

export interface StripCounts {
  counts: Record<StripCount, number> | null;
  loading: boolean;
  fetching: boolean;
  error: boolean;
}

/** The five counts, read together; they sit under the list's key, so a write that refreshes the list refreshes them. */
export function useStripCounts(scope: ProjectScope, filters: KeywordFilters, enabled: boolean): StripCounts {
  const queries = stripQueries(filters);
  const results = useQueries({
    queries: STRIP_COUNTS.map((id) => {
      const asked = queries[id];
      return {
        queryKey: [...keywordsKey(scope), filters, 'strip', id],
        queryFn: async ({ signal }: { signal: AbortSignal }): Promise<number> =>
          asked === null ? 0 : (await readPage(scope, { ...asked, limit: 1 }, signal)).page.total,
        enabled,
        placeholderData: (previous: number | undefined) => previous,
      };
    }),
  });
  const loading = results.some((result) => result.isPending);
  const counts = loading
    ? null
    : (Object.fromEntries(STRIP_COUNTS.map((id, index) => [id, results[index]?.data ?? 0])) as Record<
        StripCount,
        number
      >);
  return {
    counts,
    loading,
    fetching: results.some((result) => result.isFetching),
    error: results.some((result) => result.isError),
  };
}
```

  If lint refuses the `as Record<...>` cast, build the record with a typed `reduce` instead; no cast is the house preference.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Keep the cache logic blind to the new keys (test first).** In `keyword-cache.test.ts` add: a query cached under `[...keywordsKey(scope), filters, 'strip', 'top3']` is left alone by `applyKeywordWrite` (neither rewritten as a list nor crashing on a number), and is invalidated by `refreshKeywords`. Run; if `keyword-cache.ts` treats every key under `keywordsKey` as a list, make its shape match explicit (`'all'` or `'page'` at index 1 after the base) so the test passes.
- [ ] **Step 6: Strings** under `rankings.strip`:

```json
"strip": {
  "label": "Summary for the filtered keywords",
  "tracked": "Tracked",
  "trackedNote": "{count} checked",
  "top3": "Top 3",
  "top10": "Top 10",
  "top20": "Top 20",
  "ofChecked": "of {count} checked",
  "failed": "The summary did not load."
}
```

- [ ] **Step 7: Component test first** `rank-strip.test.tsx` (MSW, the real handlers): Rankings with no filters shows "Tracked", the fixture's active count, "{ranked + beyond} checked", and Top 3, 10 and 20 matching the mock's ranks; with `rank=top10` Top 3 reads 0 without a request for it; values show as bars while loading; an error shows the strip's labels with "n/a" values and one line "The summary did not load." with Try again. Run: FAIL.
- [ ] **Step 8: Implement `rank-strip.tsx`:** `RankStrip({ scope, filters, total })` renders `MetricStrip` `size="md"`, one group `seo`, four items: `tracked` (value `formatInteger(total)`, context `trackedNote` with `ranked + beyond`), `top3`, `top10`, `top20` (context `ofChecked`). No `delta` member. `status` is `loading` while the counts load, `refetching` while they read again, else `ready`. On error each value is `{ value: 'n/a', unknown: { kind: 'not-applicable' } }` and a `Banner` with Try again (`refetch` of each failed query) sits under the strip.
- [ ] **Step 9: Wire it** in `rankings-screen.tsx`: between the page header and the `FilterBar` (per `docs/design-system/24-page-templates.md` section 9.3), `{view.archived || list.total === 0 ? null : <RankStrip scope={scope} filters={filters} total={list.total} />}` (archived keywords are not checked; an empty list has its empty state). `list.total` is the list's own total, so Tracked costs no request.
- [ ] **Step 10: Screen tests:** the strip is gone in the Archived view and on an empty project; it follows a filter change (Top 10 under `dev=mobile` sends `filter[device]=mobile&filter[rank_lte]=10&limit=1`).
- [ ] **Step 11: Gates** (full list).
- [ ] **Step 12: Independent review on Opus,** fixes, gates again.
- [ ] **Step 13: Commit** `git commit -m "Rankings: summary strip with rank counts"`.

### Task 7: Rank history chart in the keyword inspector

**Files:**
- Create: `apps/web/src/mocks/handlers/rank-history.ts`, `apps/web/src/mocks/handlers/rank-history.test.ts`, `apps/web/src/lib/charts/rank-chart.ts`, `apps/web/src/lib/charts/rank-chart.test.ts`, `apps/web/src/features/rankings/keyword-inspector/rank-history-model.ts`, `rank-history-model.test.ts`, `rank-history-section.tsx`
- Modify: `apps/web/src/mocks/handlers/index.ts`, `apps/web/src/lib/api/types.ts`, `apps/web/src/components/app/chart/chart-frame.tsx` (+ test), `keyword-inspector/inspector-queries.ts`, `keyword-inspector/keyword-inspector.tsx`, `keyword-inspector/keyword-inspector.test.tsx`, `apps/web/messages/en.json`

**Mock reference:** `design-preview/index.html` prompt inspector History panel: a bordered card with a title row, a one-line note under it ("last 90 days"), and a 180 px chart (`#chart-prompt-history`, `h-45`). Take the card and height. `charts.js` `hatch()` shows the 45 degree hatching on `rank-band-none` for the depth band. The axis, guides, band and series rules are 15-data-visualization.md section 7, which wins.

- [ ] **Step 1: Mock route (test first)** `rank-history.test.ts`, through the handlers: `GET {P}/tracked-keywords/{id}/rank-history` answers `data.series[0]` for the own entity (`role: 'own'`) with one point per check of `checksAt` in the window (`last_90d` by default; the mock keeps 30 checks, so at most 30 points: say so in the handler's comment), `state` `ranked` with a rank or `beyond_depth` without, `date` the check's day in the project's time zone; one series per effective competitor after it; `bands` for each run of consecutive `beyond_depth` own points (`from`, `to`, `depth_requested` the run's smallest depth, `label` "Not in top N", `kind: 'beyond_depth'`, the own `entity_id`); `summary` counts (`checks`, `ranked_checks`, `beyond_depth_checks`, `failed_checks: 0`, `average_rank: null`); `window` with `from`, `to` and the project's `timezone`; `format=columns` and `include` are accepted (`columns: null`, `events: null`); `window=last_400d` is `422 validation_failed` at `window`; an unknown keyword is `404`; a member without `data:read` is `403`. Run: FAIL.
- [ ] **Step 2: Implement** `handlers/rank-history.ts` with the existing helpers of `tracked-keywords.ts` (caller resolution, `problem`, `invalid`), `checksAt` and `competitorRankOf`'s walk (export a `competitorChecksOf(trackedId, entityId, createdAt, now)` from `rank-state.ts` returning `MockCheck[]` so history and the row agree), and register it in `handlers/index.ts`. Fill `config_history` from the keyword's versions, `deep_check_weekday: 1`, `urls: {}`, `version_boundaries: []`. Run `pnpm vitest run src/mocks`: PASS.
- [ ] **Step 3: Model test first** `rank-history-model.test.ts` (export `RankHistory = Schemas['RankHistory']` from `src/lib/api/types.ts`; build the fixture with a helper typed as `RankHistory`, no casts):
  1. `rankHistoryChart(history, { ownName: (name) => \`${name} (you)\` })` gives `categories` as the sorted union of every series' dates; the own series first with role `{ kind: 'brand' }` and name "Fynix (you)"; competitors after it with `{ kind: 'palette', index: color_index }` when `color_index` is 2 to 6, else 2, 3, 4, 5, 6 by order.
  2. Values per category: the rank for `ranked`, `null` for `beyond_depth`, `failed` and a date the series lacks.
  3. `depthMax` is 20 when every own point's `depth_requested` is at most 20, the largest depth (at most 100) otherwise.
  4. `bands` keeps the own entity's bands only, as `{ from: <category index>, to: <category index>, depth }`.
  5. `summary` passes `checks`, `ranked_checks`, `beyond_depth_checks`, `failed_checks` through, and `empty` is true when `checks` is 0.
- [ ] **Step 4: Run it.** FAIL. **Implement** `rank-history-model.ts` as pure functions over `RankHistory` returning `{ categories: string[]; series: CategorySeries[]; depthMax: number; bands: { from: number; to: number; depth: number }[]; summary: { checks: number; ranked: number; beyond: number; failed: number }; empty: boolean }`. Run: PASS.
- [ ] **Step 5: Rank axis test first** `rank-chart.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { rankAxis } from './rank-chart';

const tokens = { axis: '#888', label: '#666', fontFamily: 'Inter', other: '#999' };
const base = { yAxis: { type: 'value' }, grid: { right: 16 }, series: [{ id: 'own', type: 'line', data: [3, null] }] };

describe('rankAxis', () => {
  it('inverts the axis from 1 to the depth shown, with labels at 1, 3, 10 and 20', () => {
    const option = rankAxis(base, tokens, { depthMax: 20, plotHeight: 240, bands: [], guide: (rank) => `Top ${String(rank)}`, bandLabel: () => 'Not in top 20' });
    expect(option.yAxis).toMatchObject({ inverse: true, min: 1, max: 20 });
    expect(option.grid).toMatchObject({ right: 52 });
  });

  it('drops the label at 3 below 200 px of plot but keeps the Top 3 guide', () => {
    const option = rankAxis(base, tokens, { depthMax: 20, plotHeight: 180, bands: [], guide: (rank) => `Top ${String(rank)}`, bandLabel: () => '' });
    const guides = (option.series as { markLine?: { data: { yAxis: number }[] } }[])[0]?.markLine?.data.map((line) => line.yAxis);
    expect(guides).toEqual([3, 10, 20]);
  });

  it('hatches each beyond depth run from its depth to the bottom of the axis', () => {
    const option = rankAxis(base, tokens, { depthMax: 50, plotHeight: 240, bands: [{ from: 2, to: 4, depth: 20 }], guide: () => '', bandLabel: () => 'Not in top 20' });
    const area = (option.series as { markArea?: { data: unknown[] } }[])[0]?.markArea?.data;
    expect(area).toEqual([[{ xAxis: 2, yAxis: 20, name: 'Not in top 20' }, { xAxis: 4, yAxis: 50 }]]);
  });
});
```

  Run: FAIL. **Implement** `rank-chart.ts`: `rankAxis(option, tokens, extras)` returns a new option: `yAxis` merged with `{ inverse: true, min: 1, max: depthMax, interval` none, `axisLabel.customValues` `[1, 3, 10, 20]` (or `[1, 10, 20]` when `plotHeight < 200`, 15 section 7 rule 2) filtered to at most `depthMax` `}`; `grid.right = 52`; on the first series a `markLine` (`silent: true`, `symbol: 'none'`, dashed 1 px `tokens.axis`, label at `end` in 12 px `tokens.label`) at 3, 10 and 20 within `depthMax`, and a `markArea` per band (`itemStyle.decal` with 45 degree lines on the `rank-band-none` colour: read it as `tokens.rankBandNone` if `ChartTokens` has it, else add it to `read-tokens.ts` with its test) from `[xAxis: from, yAxis: depth]` to `[xAxis: to, yAxis: depthMax]`, named by `bandLabel(depth)`. Run: PASS.
- [ ] **Step 6: Let a chart extend its option (test first).** In `chart-frame.test.tsx`: a `ChartFrame` given `extendOption={(option) => ({ ...option, marker: true })}` passes an option with `marker: true` to `EChart` (mock `./echart` as the existing test does). Then add to `ChartFrameProps`:

```ts
  /** Adds to the line or bar option, such as a rank axis (`lib/charts/rank-chart.ts`). Keep it stable (`useCallback`). */
  extendOption?: ((option: Record<string, unknown>, tokens: ChartTokens) => Record<string, unknown>) | undefined;
```

  and in the frame's `option` callback: `const base = categoryChartOption({ ... }); return extendOption === undefined ? base : extendOption(base, tokens);` with `extendOption` in the dependency list. Run: PASS.
- [ ] **Step 7: Query.** In `inspector-queries.ts`:

```ts
const RANK_HISTORY =
  '/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords/{tracked_keyword_id}/rank-history';

/** The keyword's rank over the last 90 days, with its competitors (the API's defaults). */
export const rankHistoryQuery = (scope: KeywordScope): ApiQueryOptions<typeof RANK_HISTORY> =>
  apiQuery(RANK_HISTORY, { params: { path: keywordPath(scope), query: { window: 'last_90d' } } });
```

  Confirm, as for `configHistoryQuery`, that the key `apiQuery` builds sits under `keywordsKey(scope)` so `refreshAfterWrite` and `refreshKeywords` read it again (read `src/lib/api/query.ts`); if it does not, add the history key to `refreshAfterWrite`'s invalidation.
- [ ] **Step 8: Strings** under `rankings.inspector.rankHistory`:

```json
"rankHistory": {
  "title": "Rank history",
  "meta": "Last 90 days · {checks, plural, one {1 check} other {# checks}}, {ranked} ranked",
  "you": "{name} (you)",
  "category": "Date",
  "guide": "Top {rank}",
  "band": "Not in top {depth}",
  "summary": "Organic rank of {name} over the last 90 days, 1 is best: from {first} to {last}, best {best}. {competitors, plural, =0 {} one {1 competitor is shown too.} other {# competitors are shown too.}}",
  "summaryUnranked": "Organic rank of {name} over the last 90 days: not ranked within the depth checked.",
  "empty": "No checks yet",
  "emptyReason": "The rank history fills in after the first check.",
  "failed": "The rank history did not load."
}
```

- [ ] **Step 9: Inspector test first** in `keyword-inspector.test.tsx`: the Overview tab of a checked fixture keyword shows a "Rank history" card above the demand chart with the meta line; its Table view lists the dates with the own and competitor ranks and an empty cell for a check beyond the depth; a pending keyword shows the empty state "No checks yet"; a failed read shows the section error with Try again; the chart's accessible description is the `summary` sentence. Run: FAIL.
- [ ] **Step 10: Implement** `rank-history-section.tsx`: `RankHistorySection({ scope })` reads `rankHistoryQuery`, builds the model, and renders an `InspectorSection` (icon `LineChart`, status loading, error, ready) holding `ChartFrame` with `variant="inspector"`, `kind="line"`, `height={180}`, `categories` formatted as short dates (`formatDay` or the date formatter `VolumeByMonth` uses for months), `categoryHeader` "Date", `series`, `formatValue={(value) => formatInteger(value)}`, `meta`, `summary`, and `extendOption` built with `useCallback` from `rankAxis` and the model's `depthMax` and `bands`. The empty model renders `EmptyState variant="inline"` with `empty` and `emptyReason`. In `keyword-inspector.tsx` insert `<RankHistorySection scope={keywordScope} />` right after `KeywordMetricStrip`, before `VolumeByMonth`, inside the `data !== null` branch. Run the test: PASS.
- [ ] **Step 11: What this card does not do yet** (write it in the as-built note, not as code): hollow markers inside the band (15 section 7 rule 3; the line breaks and the band shows the run), the events strip (rule 6), "Show deep checks" (rule 4), a window other than 90 days, absolute rank.
- [ ] **Step 12: Gates** (full list).
- [ ] **Step 13: Independent review on Opus,** fixes, gates again.
- [x] **Step 14: Commit** `git commit -m "Rankings: rank history in the keyword inspector"`.

**As-built notes:**
- Rank history card: does not yet support hollow markers inside the band (15 section 7 rule 3; the line breaks and the band shows the run), the events strip (rule 6), "Show deep checks" (rule 4), or absolute rank. Window is fixed to 90 days.
- Same-day checks: preserved without collapsing (multiple checks per day, shared slot x coordinate); meta point count matches drawn and listed points in the table.
- Failed checks: rendered with distinct triangle glyphs (`markPoint` at `depthMax`), listed as "failed" in the table, counted in the meta line and summary; an all-failed history explicitly describes check failure; accessible band descriptions provided for screen readers.
- Bands: `markArea` padded by half a category (from - 0.5 to + 0.5) with single-point min/max to ensure single-check and end runs cover full category width; competitor `depthMax` calculated over all depths and ranks to prevent clipping; unused `timeZone` prop removed.

### Task 8: Check now (one keyword and bulk)

**Files:**
- Create: `apps/web/src/features/rankings/check-now/check-now-model.ts`, `check-now/check-now-model.test.ts`, `check-now/use-check-now.tsx`, `check-now/check-now.test.tsx`
- Modify: `apps/web/src/mocks/handlers/runs.ts`, `apps/web/src/mocks/handlers/runs.test.ts`, `apps/web/src/features/rankings/refresh/refresh-queries.ts`, `refresh/refresh-progress.tsx`, `refresh/use-metrics-refresh.tsx`, `refresh/refresh.test.tsx`, `rankings-screen.tsx`, `keyword-inspector/keyword-inspector.tsx`, `keyword-inspector/keyword-inspector.test.tsx`, `apps/web/messages/en.json`

**Mock reference:** `design-preview/index.html` line 755: the inspector header's "Check now", a 32 px secondary button with the `refresh-cw` icon, which is the `frequentAction` slot of `InspectorHeaderProps`. `kw.js` lines 207 to 221: the bulk bar's change actions, then Refresh metrics, then Archive and Delete; Check now goes right before Refresh metrics (template 9.3 bulk order: "Set priority, Check now"). The mock's toast "Check queued. Results arrive in about 2 minutes." loses to the API's timing and the refresh's header progress.

- [x] **Step 1: Mock route (test first)** in `runs.test.ts`: `POST {P}/seo/check-now` with `{ tracked_keyword_ids: [two active ids] }` answers `202` with a run `workload: 'seo_rank'`, `trigger: 'manual'`, `status: 'planned'`, `tasks_total: 2`, and the run then moves like a refresh run (planned, running, completed) when read; it counts toward `meta.manual_runs_today` with refreshes; an archived or unknown id is `422 validation_failed` with `keyword_unknown` at `tracked_keyword_ids`; 0 or 101 ids, a repeated member, an extra member or `depth: 30` are `422 validation_failed`; the 21st manual run of the day (refreshes included) is `429 manual_run_limit` with `limit: 20`; a member without `runs:trigger` is `403`. Run: FAIL.
- [x] **Step 2: Implement** the handler beside `keyword-metrics/refresh` in `runs.ts`, in the backend's order (`runs.py`): shape, `keyword_unknown` (active tracked keywords of the project), the manual limit, then a monthly live check limit: count the `tasks_total` of this month's `seo_rank` manual runs against a mock workspace limit of 500 (`MOCK_SERP_CHECKS_PER_MONTH`) and answer `422 quota_exceeded` with `limit`, `used`, `requested`, `quota: 'max_serp_checks_per_month'`. The run is a `StoredRun` with `workload: 'seo_rank'`, `calls: n`, `keyword_count: n`, `stale_days: null`, `ending: 'completed'`; no budget pre-flight (state it in the comment: the mock prices only Labs reads). The mock does not change any rank (Decision 8). Register nothing new: the route is in `runHandlers`. Run `pnpm vitest run src/mocks`: PASS.
- [x] **Step 3: Model test first** `check-now-model.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { MAX_CHECK_NOW, checkNowRefusal, checkNowTarget } from './check-now-model';
import { ApiProblem } from '@/lib/api/problem';

const problem = (status: number, code: string, body: Record<string, unknown> = {}, errors: { loc: string[]; code: string; msg: string }[] = []) =>
  new ApiProblem({ status, code, title: code, detail: null, requestId: null, errors, retryAfterSeconds: null, body });

describe('checkNowTarget', () => {
  it('checks the chosen keywords, each once, in a stable order', () => {
    expect(checkNowTarget({ ids: new Set(['b', 'a']), allMatching: false }, false)).toEqual({ kind: 'ids', ids: ['a', 'b'] });
  });

  it('refuses a selection by filter, more than 100 keywords, none, or the Archived view', () => {
    expect(checkNowTarget({ ids: new Set(['a']), allMatching: true }, false)).toEqual({ kind: 'blocked', reason: 'allMatching' });
    const many = new Set(Array.from({ length: MAX_CHECK_NOW + 1 }, (_, index) => String(index)));
    expect(checkNowTarget({ ids: many, allMatching: false }, false)).toEqual({ kind: 'blocked', reason: 'tooMany' });
    expect(checkNowTarget({ ids: new Set(), allMatching: false }, false)).toEqual({ kind: 'blocked', reason: 'none' });
    expect(checkNowTarget({ ids: new Set(['a']), allMatching: false }, true)).toEqual({ kind: 'blocked', reason: 'archived' });
  });
});

describe('checkNowRefusal', () => {
  it('reads each refusal the route declares', () => {
    expect(checkNowRefusal(problem(429, 'manual_run_limit', { limit: 20 }))).toEqual({ kind: 'limit', limit: 20 });
    expect(checkNowRefusal(problem(422, 'quota_exceeded', { limit: 500, used: 499, requested: 3 }), 3)).toEqual({
      kind: 'quota', limit: 500, used: 499, requested: 3,
    });
    expect(checkNowRefusal(problem(503, 'provider_paused'))).toEqual({ kind: 'paused' });
    expect(
      checkNowRefusal(problem(422, 'validation_failed', {}, [{ loc: ['body', 'tracked_keyword_ids'], code: 'keyword_unknown', msg: 'x' }])),
    ).toEqual({ kind: 'unknownKeyword' });
    expect(checkNowRefusal(new Error('network'))).toEqual({ kind: 'other' });
  });
});
```

  (Match the `ApiProblem` constructor's init type and the `ValidationItem` shape in `src/lib/api/problem.ts`; adjust the helper, not the assertions.) Run: FAIL.
- [ ] **Step 4: Implement** `check-now-model.ts`:

```ts
import type { ActionScope } from '@/components/app/data-table/types';
import { isApiProblem } from '@/lib/api/problem';
import { quotaFacts } from '@/lib/keywords/quota';

/** The route takes at most this many tracked keywords (`CheckNow.tracked_keyword_ids`). */
export const MAX_CHECK_NOW = 100;

export type CheckNowTarget =
  | { kind: 'ids'; ids: string[] }
  | { kind: 'blocked'; reason: 'allMatching' | 'tooMany' | 'none' | 'archived' };

/** What Check now sends for a selection: ids only, since the route takes no filter. */
export function checkNowTarget(chosen: ActionScope, archived: boolean): CheckNowTarget {
  if (archived) return { kind: 'blocked', reason: 'archived' };
  if (chosen.allMatching) return { kind: 'blocked', reason: 'allMatching' };
  if (chosen.ids.size === 0) return { kind: 'blocked', reason: 'none' };
  if (chosen.ids.size > MAX_CHECK_NOW) return { kind: 'blocked', reason: 'tooMany' };
  return { kind: 'ids', ids: [...chosen.ids].sort() };
}

export type CheckNowRefusal =
  | { kind: 'limit'; limit: number | null }
  | { kind: 'quota'; limit: number; used: number; requested: number }
  | { kind: 'paused' }
  | { kind: 'unknownKeyword' }
  | { kind: 'other' };

/** The refusal behind a failed Check now (`POST {P}/seo/check-now`, backend `runs.py check_now`). */
export function checkNowRefusal(error: unknown, requested = 0): CheckNowRefusal {
  if (isApiProblem(error, 'manual_run_limit')) return { kind: 'limit', limit: error.number('limit') };
  if (isApiProblem(error, 'quota_exceeded')) {
    const facts = quotaFacts(error, requested);
    return { kind: 'quota', limit: facts.limit, used: facts.used, requested: facts.requested };
  }
  if (isApiProblem(error, 'provider_paused')) return { kind: 'paused' };
  if (isApiProblem(error, 'validation_failed') && error.errors.some((item) => item.code === 'keyword_unknown')) {
    return { kind: 'unknownKeyword' };
  }
  return { kind: 'other' };
}
```

  Run: PASS.
- [ ] **Step 5: Follow runs by workload (tests first).** In `refresh.test.tsx` the existing cases must still pass unchanged. Add one: an open `seo_rank` manual run started by the member is found on mount by the Check now follower and not by the refresh follower, and the reverse. Then in `refresh-queries.ts` add `export type FollowedWorkload = 'keyword_metrics' | 'seo_rank';`, give `refreshKey`, `openRefreshesKey`, `refreshRunKey`, `endedRefreshes`, `rememberEndedRefresh`, `useOpenRefreshes`, `forgetOpenRefresh`, `rememberRefreshRun` and `readOpen` a `workload: FollowedWorkload` parameter (the key's last fixed segment becomes `` `${workload}-runs` `` and `readOpen` sends `'filter[workload_in]': [workload]`), and pass `'keyword_metrics'` from every existing caller (`use-metrics-refresh.tsx`, `refresh-progress.tsx`). `RefreshProgress` gains `workload: FollowedWorkload` and reads its words from `rankings.refresh` or `rankings.checkNow.progress` by workload (same keys in both namespaces, so one component serves both). The day's count (`manual`) stays the same number for both, as the API counts both.
- [ ] **Step 6: Strings** under `rankings.checkNow`:

```json
"checkNow": {
  "action": "Check now",
  "actionDetail": "{left} of {limit} left today",
  "blocked": {
    "allMatching": "Check now takes chosen keywords, not every matching keyword. Choose up to 100.",
    "tooMany": "Check now takes up to 100 keywords at a time.",
    "none": "Choose keywords first.",
    "archived": "Archived keywords are not checked.",
    "noneLeft": "No manual runs left today. The limit resets at 00:00 UTC."
  },
  "refused": {
    "limit": "No manual runs left today. The limit resets at 00:00 UTC.",
    "quota": "This workspace has made {used} of its {limit} live checks this month. {requested, plural, one {1 more does} other {# more do}} not fit.",
    "paused": "The data provider is not being asked just now. Try again in a few minutes.",
    "unknownKeyword": "A keyword is no longer tracked here. The list was read again; try again.",
    "other": "The check did not start. Try again."
  },
  "progress": {
    "queued": "Rank check queued",
    "running": "Checking ranks",
    "slow": "Rank check is taking longer than usual to start",
    "started": "Rank check queued. Its progress shows under the page title.",
    "lost": "This rank check could not be followed here. It may still be running. Reload the page to check on it.",
    "counts": "{done} of {total} checked",
    "countsFailed": "{done} of {total} checked, {failed} failed"
  },
  "finished": {
    "completed": "Ranks checked: {done} of {total}",
    "nothing": "No keyword needed a check",
    "completedWithErrors": "Ranks checked: {done} of {total}, {failed} failed",
    "failed": "The rank check failed",
    "cancelled": "The rank check was cancelled",
    "budgetBlocked": "The rank check did not start: a budget for rank checks is used up this month"
  }
}
```

  `progress` and `finished` have exactly the keys of `rankings.refresh.progress` and `rankings.refresh.finished` (what `RefreshProgress` and `FINISH_KEYS` in `refresh-model.ts` read), so one component serves both namespaces. Add to `refresh-model.test.ts` the same catalog assertion for `rankings.checkNow` that holds `FINISH_KEYS` and the progress keys to `rankings.refresh`, so the two key sets cannot drift. The start is announced with `progress.started`, as the refresh does.
- [x] **Step 7: Hook test first** `check-now.test.tsx` (MSW): from the bulk bar, choosing two keywords and pressing Check now posts `{ tracked_keyword_ids: [sorted ids] }` without `depth`, announces `progress.started`, shows a progress bar under the page title, and on completion shows one toast and reads the list again; the action is disabled with the matching reason under "Select all matching", with 101 chosen, in the Archived view, and at 0 manual runs left; a `429`, `422 quota_exceeded`, `503` and `keyword_unknown` each show their sentence (the last also reads the list again and drops the vanished keywords from the selection, as `refresh` does through `onDrop`); a member without `runs:trigger` sees no action. From the inspector: the header shows "Check now" for a checked or pending active keyword, posts that one id, and the same progress follows; an archived keyword's inspector shows no button. Run: FAIL.
- [x] **Step 8: Implement `use-check-now.tsx`:** `useCheckNow({ scope, enabled, archived, chosen, onDrop })` returns `{ barAction: RecordAction<TrackedKeywordRow> | null; inspectorAction: (trackedId: string, active: boolean) => ReactNode; progress: ReactNode }`. It uses `apiMutation('post', '/api/v1/workspaces/{workspace_id}/projects/{project_id}/seo/check-now')`, `useOpenRefreshes(scope, userId, enabled, 'seo_rank')` for runs a reload finds and for `manual_runs_today` (shared with refresh), `rememberRefreshRun(..., 'seo_rank')` after a `202`, and renders one `RefreshProgress workload="seo_rank"` per followed run. `barAction`: `{ id: 'check-now', label: t('action'), icon: RefreshCw, group: 'object', disabledReason, onSelect }` where `disabledReason` comes from `checkNowTarget(chosen, archived)` and the day's count. `inspectorAction` renders `<Button variant="secondary" size="sm" icon={RefreshCw}>` (check `Button`'s icon prop name) with the same refusals as toasts.
- [x] **Step 9: Wire it.** In `rankings-screen.tsx` call `useCheckNow` with `enabled: canRefresh` (the `runs:trigger` check the refresh uses), put `checkNow.barAction` right before `refresh.barAction` in `bulkActions` (both ahead of the first destructive action), render `checkNow.progress` beside `refresh.progress`, and pass `checkNow.inspectorAction` to the keyword inspector. In `keyword-inspector.tsx` accept an optional `frequentAction?: ((trackedId: string, active: boolean) => ReactNode) | undefined` prop and pass `frequentAction?.(scope.trackedKeywordId, scopeOf?.is_active ?? false)` as the header's `frequentAction`.
- [x] **Step 10: Run** `pnpm vitest run src/features/rankings src/mocks`. Expected: PASS.
- [x] **Step 11: Gates** (full list).
- [ ] **Step 12: Independent review on Opus,** fixes, gates again.
- [x] **Step 13: Commit** `git commit -m "Rankings: check now for one keyword or a selection"`.

**As-built notes:**
- Check now: records a run and increments manual run count but does not change any rank in the mock world (mock rank is purely derived from fixtures and mock time; storing up to 100 ids per run does not fit the operations cookie budget).
- Single inspector button: placed in inspector header `frequentAction` slot, disabled during in-flight runs and when quota is exhausted.
- Single toast announcement: announces once at start (`progress.started`), followed by header progress bar; lost toast id matches `keyword-${workload}-${runId}`.
- Quota synchronization: refetches quota on run start and on bulk bar open.
- Refetch on completion: rank state is invalidated and refetched when check now completes.

### Task 9: Metric strip: average rank, visibility and deltas (BLOCKED)

**Status: blocked on the backend.** The API has no route that gives an average rank, a visibility figure or a comparison with a previous period for a filtered set of tracked keywords. The client cannot compute them honestly: in server mode it holds one page, visibility depends on the project's `visibility_weight_scheme` and `visibility_volume_mode` and a CTR curve the backend owns, and "previous period" needs ranks as of a past date.

**Backend request (send as written):**

> `GET /api/v1/workspaces/{workspace_id}/projects/{project_id}/seo/rank-summary`, permission `data:read`. Query: every `filter[...]` of `GET {P}/tracked-keywords` (same names, same validation, same AND rules, including `filter[q]`), plus `compare` (`previous_period` or absent) and `window` (`last_7d`, `last_28d`, `last_90d`; default `last_7d`, used only for the comparison point). Answer `data`: `tracked` (int), `checked` (int), `ranked` (int), `top3`, `top10`, `top20` (int), `average_rank` (`MetricValue` with `n` equal to the ranked count, null when none ranked), `visibility` (`MetricValue`, a share 0 to 1, with `scheme` and `volume_mode` named), and `compare`: the same members as of the comparison date, or null without `compare`. `meta.as_of` (timestamp of the newest check counted). Errors as the list (`422 validation_failed` per parameter).

**When it lands** (the steps, for the session that unblocks it):

- [ ] **Step 1:** Regenerate the client (`pnpm gen:api`), add the mock route with handler tests for the counts (reuse `rankStateOf` over the filtered fixture rows), the average over ranked rows, visibility as the mock's documented formula, and `compare` from `checksAt` at `now - window`.
- [ ] **Step 2:** Replace `useStripCounts`' five reads with one read of the summary (delete `stripQueries` and its tests), keep `RankStrip`'s items, add Average rank (context "{n} ranked") and Visibility (label addon `MetricInfo` naming the scheme, context "volume-weighted" or "equal-weight"), and add deltas: `RankDelta` for Top counts and Average rank (lower is better), `Delta` in points for Visibility, left out when `compare` is null.
- [ ] **Step 3:** Tests first for each item and for no delta without a comparison; gates; independent review on Opus; commit "Rankings: summary strip with average rank, visibility and change".

### Task 10: End to end, documents, whole-branch review

**Files:**
- Modify: `apps/web/e2e/flows/rankings.spec.ts`, `apps/web/e2e/visual/pages.spec.ts`, `docs/20-frontend-specification.md` (section 5.3 as built), `docs/design-system/24-page-templates.md` (section 9.3 as-built paragraph), `docs/design-system/13-filters-search.md` (section 5 key table: `featown`, `tmatch`), `docs/design-system/25-component-inventory.md` (deviations: `col.features`, `col.aiOverview`, `col.competitor`, `col.sparkline`, `marker` on `col.keyword`, `SparklineCell`, `SerpFeatureListView`, `AioStatusView`, `CompetitorRankView`, `ChartFrame.extendOption`, `rankAxis`), `docs/superpowers/plans/2026-10-06-rank-columns-ui.md` (Decisions item 1: a pointer to this plan), `docs/review-log.md`

**Mock reference:** `design-preview/kw-table.js` and `kw-model.js` `DEFAULT_COLUMNS` to compare the final column order at 1440 and 1680 px; the template, not the mock, is the reference where they differ.

- [x] **Step 1: E2E flows** (`e2e/flows/rankings.spec.ts`): an editor opens Rankings and sees the strip with Tracked and Top 10; at 1440 px the SERP features, AI Overview and Trend columns show for fixture keywords; filters "AI Overview: Cited" and sees only cited keywords; filters "SERP feature: Video"; opens a keyword and sees the Rank history card and its Table view; chooses two keywords and presses Check now, moves the clock with `page.clock.runFor` until the run completes, and sees the finished toast; at 1680 px the first competitor column shows.
- [x] **Step 2: Visual:** the Rankings entry's screenshot gains the strip and the new columns; the inspector entry gains the rank history card (no baseline is committed: they are made in the pinned image only).
- [x] **Step 3: Documents** (Edit and Write tools only): as-built notes for every limit recorded in the tasks (sparkline 64 x 20 in both densities; hollow markers, events strip, deep checks and other windows not in the history card; competitor ranks always included; mock check now changes no rank; no sort for the four new column types; the strip without deltas, Average rank and Visibility until Task 9), the two new URL keys, the inventory deviations, and a review log row.
- [x] **Step 4: Gates** (all in `apps/web`): `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm format:check`, `NEXT_PUBLIC_API_MOCKING=off pnpm build`, `pnpm run preview`, `pnpm e2e`.
- [ ] **Step 5: Whole-branch review on Opus:** the lead dispatches an independent reviewer on the Opus model with this plan and the diff from the branch point; fix every Critical and Important finding with its test first; gates again.
- [x] **Step 6: Commit** "Rankings: rank features, end to end and documents".

**As-built notes:**
- Column sorting: none of the four new column types (SERP features, AI Overview, sparkline, competitor) supports sorting.
- Sparkline dimensions: 64 x 20 px in both compact and comfortable densities; single point rendered as dot with radius 2; failed and not_checked checks show explicit trend labels.
- Competitor ranks: always included (`INCLUDE` contains `'competitor_ranks'`) because conditional inclusion based on column visibility would refetch the entire table on every column chooser toggle; tooltips display rank change; error banner displayed on query failure.
- Rank history card: does not yet include hollow markers inside the band, events strip, deep checks toggle, or custom time windows (fixed to 90 days); supports same-day checks, failed check glyphs, padded bands, and full table accessibility.
- Metric strip: implemented with five one-row queries for Tracked, Top 3, Top 10, and Top 20 counts; placed between page header and filter bar per design system 24 section 9.3; invalidated on keyword membership changes. Deltas, Average rank and Visibility wait for backend route `GET {P}/seo/rank-summary` (Task 9).
- Check now: single inspector header button; single toast announcement at start (`progress.started`); in-flight mutual exclusion; quota refetched on start and bulk bar open; rank state refetched on completion.
- Merged Rank and Change column: 32 px fixed rank box with change slot starting at identical x coordinate across ranked, beyond-depth, failed and stale rows. Stale ">100" contained to prevent overflow into change slot.
- Data table header: options chevron positioned at right-0 with pointer-events-none when hidden, ensuring sorted Rank label sorts cleanly without opening column menu at 96 px minimum width.
- Trailing arrow link on keyword column uses ICU plural messages and opens ranking URL in a new tab.
- Cell formatting: cited badge uses role="img" with descriptive accessible name ("AI Overview present, cited at position N"); +N overflow token uses 12 px font; stale clock icons display last successful check date tooltip; duplicate native title removed from n/a cells.
- Beyond depth filtering and display: positions to 100 at depth 100 (">100") and depth 20 (">20"); Beyond depth filter reads "Over 100" at depth 100; legacy `cols` values containing `rank_change` dropped gracefully.
- Primary route: `/seo/keywords` with redirect from `/seo/rankings`.
- URL filter keys: added `featown` and `tmatch`.

Never add `.claude/launch.json` or `research/`. No attribution lines. Push and merge only on the user's word.

## Order and sizing

| Run | Tasks | Size | Why together |
|---|---|---|---|
| A | 1, 2, 3 | Small each, about one session in a row | All read `row.state` only, add one column type and one chip each in the same four files (`rank-columns.tsx`, `keyword-columns`, `rank-filters.ts`, `bulk-target.ts`); doing them in a row avoids three rebases of the same lines |
| B | 4, 5 | Medium | Both extend the mock's rank world (`checksAt`) and the list's `include`; Task 5 reuses Task 4's extraction |
| C | 6 | Small | Independent of the columns; touches only the screen and a new folder |
| D | 7 | Medium to large | New mock route, chart option work and an inspector card; touches no table code |
| E | 8 | Large | Refactors the refresh's run following; best done alone, after A to D have merged, since it edits `rankings-screen.tsx` and the inspector header |
| F | 10 | Medium | After A to E |
| (G) | 9 | Medium | Only when the backend route exists |

One builder can do A, B and C in a row (they share files and conventions, and each ends green), then D. E is best a fresh session with this plan, since it is the riskiest change to code that works today. Runs C and D can go in parallel with A and B in separate worktrees if two builders are free; E waits for both.

## Self-review

- Every item of the brief has a task: sparkline (4), rank history (7), metric strip (6, and 9 blocked), SERP features (1), AI Overview (5 in the brief, Task 2 here), competitor positions (5), target URL match (3), Check now (8).
- What the API lacks is said once, with the request (Task 9). Nothing else is blocked: rank history and check now routes exist on main.
- Types used across tasks: `checksAt` (Task 4, used in 5 and 7), `competitorChecksOf` (Task 7, built on Task 5's walk), `FollowedWorkload` (Task 8), `rich` widened step by step (Tasks 1, 2, 4, 5).
