# Rank Columns in Rankings (Frontend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rankings shows what the backend now knows about each keyword's rank: the current position, the change since the previous check, and the URL that ranks, with sorts, filters and honest states for keywords that are not checked yet, failed or stale.

**Architecture:** Step 5 part 2 of the keywords UI (backend: `docs/superpowers/plans/2026-10-05-rank-collection.md`, merged to main). Every tracked keyword row already carries `state` (`TrackedKeywordState`) in the generated client; the mocks give every keyword a "not checked" state today (`src/mocks/factories/keyword.ts`, `NOT_CHECKED_STATE`). This plan (1) gives the mocks a rank world derived from fixtures and mock time, with the API's rank filters, sorts and first-check behaviour, (2) adds three column types (`rank`, `rankDelta`, `url`) to the data table, (3) adds the Rankings columns and the three most useful filters, and (4) lets rows waiting for their first check fill in while the page is open. A pure model turns the API's rank facts into what a cell shows, so the cells only lay out.

**Tech Stack:** Next.js 16, React 19, TypeScript strict (`exactOptionalPropertyTypes`), TanStack Query 5, nuqs, next-intl, MSW, Vitest with Testing Library, Playwright.

---

## Read first

| What | Where |
|---|---|
| Executor rules (gates, review on Opus, no dashes, edit tools only) | `docs/superpowers/plans/2026-10-01-keywords-ui.md`, "Notes for the executor" |
| What Rankings looks like now | its Task 4 to 12 as-built notes; `apps/web/src/features/rankings/{keyword-columns,keyword-filters,rankings-queries,keyword-cache}.ts`, `rankings-screen.tsx` |
| Column specs | `docs/design-system/24-page-templates.md` section 9.3 (columns 2 to 4 and 11, lines 456 to 484), `12-tables.md` sections 6 and 7 (types, `RankCell`, `RankDeltaCell`, `URLCell`, unknown values, sort), `14-badges-status.md` section 5 (rank change), `22-content-formatting.md` section 3, `20-accessibility.md` (rank values for screen readers) |
| Filter specs | `docs/design-system/13-filters-search.md` (rank bucket, `chg`, URL keys) |
| The API | `backend/openapi/v1.json` (`TrackedKeywordState`, `RankCell`, `RankChange`, `UrlRef`; list parameters `filter[rank_*]`, `filter[improved]`, `filter[declined]`, `filter[is_stale]`, `sort`), `backend/src/idraft/api/keywords/filters.py` (exact filter and sort semantics: read lines 226 to 345) |
| Methodology | `docs/09-rank-tracking-methodology.md` sections 4 and 5 (depth-aware nulls, change labels) |
| Existing rank helpers | `apps/web/src/lib/format/rank.ts` (`formatRankCell`, `classifyRankChange`, `formatRankChange`, `RANK_BUCKETS`) and its test |

All commands run in `apps/web`. Before any markup, invoke `design-taste-frontend` (house rule); the project's design system outranks its generic advice.

## Facts this plan relies on

- **`state` on every row** (`TrackedKeywordRow['state']`, also on the detail): `current` (`RankCell`: `state` is `ranked`, `beyond_depth`, `not_checked` or `failed`; `rank` is set only when `ranked`; `depth_requested` is null only when `not_checked`; `url` is a `UrlRef` or null; `observed_at`), `change` (`RankChange`: `label` is `numeric`, `new`, `lost`, `unchanged_beyond`, `consistent_beyond` or `first_check`; `value` is previous minus current, positive means improved, set only for `numeric`; `previous_rank`, `previous_observed_at`), `best_rank`, `best_rank_at`, `worst_rank`, `first_ranked_at`, `last_observed_at`, `is_stale` (no successful check for 36 hours, or 9 days for weekly profiles; the API computes it, the UI never does), `consecutive_failures`, `ranking_url_count` (own URLs that ranked at the last check), `target_url_match`, `url_changed_at`, `feature_types_present`, `owned_feature_types`, `aio`.
- **`UrlRef`**: `{ url_id, canonical_url, host, path, registrable_domain }`.
- **Change is against the previous successful check**, not calendar yesterday (methodology section 4: within the smaller depth of the two). With daily checks that is yesterday's; the header tooltip says "since the previous check".
- **API words vs UI words:** `new` is shown as "New" (entered the tracked depth), `lost` as "Lost" (dropped out). The URL filter value for the Change chip is `entered` / `lost` / `improved` / `declined` (13-filters-search.md).
- **List parameters** (`GET {P}/tracked-keywords`): `filter[rank_lte]` and `filter[rank_gte]` (1 to 700), `filter[rank_is_null]` (`true`: checked and beyond the depth, a keyword never checked does not match; `false`: ranked), `filter[rank_change_label_in]` (list of labels), `filter[improved]` / `filter[declined]` (booleans; `false` means "not improved", i.e. everything else), `filter[is_stale]`, plus `filter[feature_present]`, `filter[feature_owned]`, `filter[aio_state]`, `filter[ranking_url_id]`, `filter[target_url_match]` (not used by this plan's UI). Filters combine with AND. A keyword never checked matches none of the rank filters except `is_stale=false` and `improved=false` / `declined=false`.
- **Sorts** (`sort=current_rank`, `rank_change`, `best_rank`, `last_observed_at`, with `-` for descending, at most 2 keys, each once): a keyword beyond depth or never checked sorts last in both directions; `rank_change` is the numeric value, so rows with label `new`, `lost`, beyond or first check have no value and sort last in both directions.
- `include` also takes `sparkline`, `competitor_ranks`, `features`, `aio` (not used here; the mocks accept them and answer `null`).
- The rank contract is in the generated client (`src/lib/api/schema.ts`) since main's commit 4ba4381; main's mock factory and `src/test/api-shapes.ts` already carry a `state`. The row's `state` is always present (not behind `include`).

## Decisions

1. **Columns built:** Rank (`current_rank`), Change (`rank_change`), Ranking URL (`ranking_url`, not sortable), Best rank (`best_rank`, chooser only), Updated (`last_observed_at`). Sparkline, SERP features, AI Overview, competitor positions, target URL match, the metric strip, "Check now" and the rank history in the inspector are separate plans.
2. **Order and tiers** (12-tables and template 9.3): Keyword, Rank (tier 1), Change (tier 1), Ranking URL (tier 2), Volume (tier 2, was 1: it keeps working at tier 2 since the template puts Rank and Change first), KD, CPC, Intent, Priority, Group, Tags, Best rank (tier 3, off by default), Updated (tier 4), Added (tier 4). **Default sort stays Volume descending** (the template).
3. **States of the Rank cell** (never an empty cell, 12-tables section 7.3):
   - `ranked`: the number, right aligned.
   - `beyond_depth`: `>20` (the depth of that check) as plain tertiary text, never a chip; screen readers hear "not in top 20".
   - `not_checked`: "Pending" (tertiary) with a tooltip "The first check has not run yet".
   - `failed` (a keyword that never had a good check; the API keeps `current` from the last good check, so `failed` occurs only then): a 14 px warning icon with a tooltip "The last check failed" and the accessible name "check failed". One rule for a failed row: Rank shows the warning, Ranking URL and Best rank show tertiary "n/a" (tooltip "The last check failed"), Updated says "Check failed" with the Stale marker when the API flags it, and Change says nothing visible and nothing spoken.
   - Whatever the state, `is_stale` adds a small "Stale" marker in the Updated column and a 12 px clock in the Rank cell itself (with the hidden word "stale"; Updated is tier 4, so below 1680 px the Rank cell is where a stale rank shows), and the tooltip of the rank says "Last successful check: <date>". A rank or `>20` with `consecutive_failures > 0` (checks failed after the last good one) gets a 12 px warning glyph with the hidden words "last check failed" and the failure in the tooltip. (Review fix, see the end of this plan.)
4. **Change cell** (14-badges-status.md section 5, 22-content-formatting.md section 3): arrow glyphs in text, never an icon, no badge box. `numeric` positive is `↑5`, negative `↓3`, zero `0`; `new` is "New", `lost` is "Lost"; `first_check`, `unchanged_beyond` and `consistent_beyond` are empty with only screen reader text ("first check", "still beyond tracked depth", and for `consistent_beyond`, where one side may have a rank, "no change within the depth checked"); before any good check (`not_checked` or `failed`) the cell says nothing at all. Color only when emphasised: the rule is `abs(change) > max(2, 2 x mean absolute daily change)`; the API gives no mean, so the emphasis threshold here is `abs(change) > 2` for `numeric` and "New" and "Lost" are always emphasised (record this in the as-built note as a limit: the API does not send the keyword's normal movement). Neutral text is `foreground`.
5. **Ranking URL cell:** the `UrlRef.path` in mono, middle-truncated, host hidden (a project tracks one domain; show the host when `registrable_domain` differs from the project's domain is NOT in this plan), tooltip with the canonical URL and the check date; `+1` after it when `ranking_url_count > 1`; "Not ranking" (tertiary) when `current.url` is null and the state is `ranked` or `beyond_depth`; "Pending" for `not_checked`; "n/a" for `failed`. The path keeps its last 12 characters in view and gives way at its start by CSS (the first draft shortened it in the middle by code and then clipped it again).
6. **Filters (chips):** `rank` (single choice: Top 3, 4 to 10, 11 to 20, 21 to 50, 51 to 100, Beyond depth), `chg` (single choice: Improved, Declined, Entered ("New"), Lost), `stale` (single choice: Stale). The API combines rank filters with AND and offers one `lte`/`gte` pair, so several buckets at once cannot be expressed: the chip is single choice, and the template's bucket facets with counts wait for an API that supplies them. The Rank bucket maps to parameters: Top 3 is `gte=1, lte=3`; 4 to 10 is `gte=4, lte=10`; 11 to 20; 21 to 50; 51 to 100 likewise; Beyond depth is `rank_is_null=true`. Change maps: Improved is `improved=true`; Declined is `declined=true`; Entered is `rank_change_label_in=new`; Lost is `rank_change_label_in=lost`. Stale is `is_stale=true`.
7. **First check fills in while the page is open:** a keyword added a moment ago is `not_checked`. The pending-metrics poll (`refresh/pending-metrics.ts`) already re-reads rows waiting for metrics; it also treats `state.current.state === 'not_checked'` as waiting when the keyword was added within the last hour (a keyword never checked that is older is in a paused or budget-blocked project or an old import, and is not polled for; same 15 minute cap per row, same visible-time rule) and lays the new `state` over the row.
8. **Mock rank world is derived, not stored:** the state of a keyword is computed from its tracked id, its creation time and the mock clock, so the cookie does not grow. A keyword gets its first check 3 minutes after it was created (mock time), like the metrics' 2 minutes.

## File structure

| File | Responsibility |
|---|---|
| Create `src/mocks/rank-history.ts` (+ test) | Deterministic daily rank history of a tracked keyword: pure functions |
| Create `src/mocks/rank-state.ts` (+ test) | `TrackedKeywordState` of a keyword at a time, from its history |
| Modify `src/mocks/factories/keyword.ts` | Use `rankStateOf` instead of `NOT_CHECKED_STATE` |
| Modify `src/mocks/handlers/keyword-rules.ts`, `tracked-keywords.ts` (+ tests) | The 12 rank filters, the 4 rank sorts, accept the new `include` values |
| Create `src/lib/format/rank-display.ts` (+ test) | API rank facts to what a cell shows (pure) |
| Modify `src/lib/tables/column-types.ts`; `src/components/app/data-table/columns.tsx` (+ test) | Column types `rank`, `rankDelta`, `url` and `col.rank`, `col.rankDelta`, `col.url` |
| Create `src/features/rankings/rank-cells.tsx` (+ test) | The three cell renderers with tooltips and screen reader text |
| Modify `src/features/rankings/keyword-columns.ts` | The five columns, sort fields |
| Modify `src/features/rankings/keyword-filters.ts`, `rankings-queries.ts`, `rankings-screen.tsx` | The three chips and their API parameters |
| Modify `src/features/rankings/refresh/pending-metrics.ts` | Also wait for a first rank check |
| Modify `messages/en.json` | `rankings.rank.*`, columns, filters |
| Modify `e2e/flows/rankings.spec.ts`, `e2e/visual/pages.spec.ts` | Flows and the Rankings visual |
| Modify docs | Doc 20 section 5.3 as built, doc 25 rows, doc 24 note, parent plan note, review log |

---

### Task 1: Mock rank history (pure)

**Files:**
- Create: `apps/web/src/mocks/rank-history.ts`
- Test: `apps/web/src/mocks/rank-history.test.ts`

The history is a pseudo-random walk seeded by the tracked keyword id, so the same keyword always has the same ranks. Checks are daily at 02:00 UTC for the 30 days before "now" (mock time), starting no earlier than the keyword's creation.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import { checksOf, FIRST_CHECK_DELAY_MS } from './rank-history';

const NOW = Date.parse('2026-10-06T12:00:00Z');
const CREATED = '2026-06-15T08:00:00Z';

describe('mock rank history', () => {
  it('is the same every time for the same keyword', () => {
    const a = checksOf('0192d1a8-e007-7a10-8e07-000000000003', CREATED, NOW);
    const b = checksOf('0192d1a8-e007-7a10-8e07-000000000003', CREATED, NOW);
    expect(a).toEqual(b);
  });

  it('has up to 30 daily checks, oldest first, none before the keyword existed', () => {
    const checks = checksOf('0192d1a8-e007-7a10-8e07-000000000003', CREATED, NOW);
    expect(checks.length).toBeGreaterThan(0);
    expect(checks.length).toBeLessThanOrEqual(30);
    const times = checks.map((check) => Date.parse(check.observedAt));
    expect([...times].sort((x, y) => x - y)).toEqual(times);
    expect(times.every((time) => time >= Date.parse(CREATED))).toBe(true);
  });

  it('has no check for a keyword created less than the first check delay ago', () => {
    const created = new Date(NOW - FIRST_CHECK_DELAY_MS + 1000).toISOString();
    expect(checksOf('0192d1a8-e007-7a10-8e07-000000000004', created, NOW)).toEqual([]);
  });

  it('gives a keyword created just over the delay ago its one first check', () => {
    const created = new Date(NOW - FIRST_CHECK_DELAY_MS - 1000).toISOString();
    expect(checksOf('0192d1a8-e007-7a10-8e07-000000000004', created, NOW)).toHaveLength(1);
  });

  it('keeps ranks within the checked depth or null beyond it', () => {
    const checks = checksOf('0192d1a8-e007-7a10-8e07-000000000005', CREATED, NOW);
    for (const check of checks) {
      expect(check.depth).toBeGreaterThanOrEqual(10);
      if (check.rank !== null) expect(check.rank).toBeLessThanOrEqual(check.depth);
    }
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run src/mocks/rank-history.test.ts`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Write the module**

```ts
/**
 * Rank checks of a tracked keyword as the mocks invent them. Nothing is stored: the checks are a function of
 * the keyword's id, its creation time and the mock clock, so the cookie does not grow and a reload shows the
 * same ranks. The first check of a new keyword runs `FIRST_CHECK_DELAY_MS` after it was created, as the
 * metrics' first reading does (the worker plans a new keyword within minutes).
 */

export const FIRST_CHECK_DELAY_MS = 3 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const CHECKS_KEPT = 30;
/** Daily checks run at 02:00 UTC. */
const CHECK_HOUR_UTC = 2;
const DEPTHS = [20, 20, 20, 50, 100] as const;

export interface MockCheck {
  observedAt: string;
  /** The organic rank, or null when beyond `depth`. */
  rank: number | null;
  depth: number;
  /** Own URL path that ranked, null when beyond depth. */
  path: string | null;
  /** How many own URLs ranked. */
  urlCount: number;
}

/** A small deterministic generator (mulberry32) seeded from a string. */
function seeded(seed: string): () => number {
  let state = 0;
  for (const char of seed) state = (Math.imul(state, 31) + char.charCodeAt(0)) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PATHS = ['/', '/services', '/pricing', '/blog/seo-audit', '/blog/local-seo', '/contact'] as const;

/** The checks of a keyword up to `now`, oldest first. */
export function checksOf(trackedId: string, createdAt: string, now: number): MockCheck[] {
  const created = Date.parse(createdAt);
  const firstCheckAt = created + FIRST_CHECK_DELAY_MS;
  if (now < firstCheckAt) return [];
  const random = seeded(trackedId);
  const start = random();
  // The walk starts somewhere between 2 and 60 and drifts by up to 4 places a day, now and then jumping
  let rank = 2 + Math.floor(start * 58);
  const times: number[] = [];
  // The day of the first check ends the history's start; the first check itself is `firstCheckAt`
  times.push(firstCheckAt);
  const today = new Date(now);
  const lastDaily = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), CHECK_HOUR_UTC);
  for (let at = lastDaily <= now ? lastDaily : lastDaily - DAY_MS; at > firstCheckAt; at -= DAY_MS) {
    times.push(at);
  }
  const ordered = [...new Set(times)].sort((a, b) => a - b).slice(-CHECKS_KEPT);
  const path = PATHS[Math.floor(random() * PATHS.length)] ?? '/';
  return ordered.map((time) => {
    const step = Math.round((random() - 0.5) * 8);
    rank = Math.max(1, rank + (random() < 0.04 ? Math.round((random() - 0.5) * 60) : step));
    const depth = DEPTHS[Math.floor(random() * DEPTHS.length)] ?? 20;
    const ranked = rank <= depth;
    const second = random() < 0.15;
    return {
      observedAt: new Date(time).toISOString(),
      rank: ranked ? rank : null,
      depth,
      path: ranked ? path : null,
      urlCount: ranked ? (second ? 2 : 1) : 0,
    };
  });
}
```

Notes: the walk is allowed to leave the depth, which gives the `beyond_depth` states and `new`/`lost` changes. If `rank` drifts above 100 keep it (it is only compared to `depth`). Adjust constants only if a test below needs it; keep determinism.

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm vitest run src/mocks/rank-history.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/mocks/rank-history.ts apps/web/src/mocks/rank-history.test.ts
git commit -m "Mocks: a deterministic rank history per tracked keyword"
```

### Task 2: Mock rank state

**Files:**
- Create: `apps/web/src/mocks/rank-state.ts`
- Test: `apps/web/src/mocks/rank-state.test.ts`
- Modify: `apps/web/src/mocks/factories/keyword.ts`

- [ ] **Step 1: Write the failing test.** `rankStateOf(trackedId, createdAt, now, domain)` answers a `TrackedKeywordState` (type `TrackedKeywordRow['state']`). Cases:
  1. A keyword created a minute ago is `not_checked` with label `first_check`, null ranks, `is_stale: false`, `ranking_url_count: 0`, `depth_requested: null`.
  2. After its first check it is `ranked` or `beyond_depth` with `observed_at` set, `depth_requested` set, `url` a `UrlRef` for `https://<domain><path>` when ranked (`url_id` a stable string, `host`, `path`, `canonical_url`, `registrable_domain`), null when beyond depth.
  3. The change follows the methodology within the smaller depth of the two latest checks: both ranked within the smaller depth gives `numeric` with `value = previous - current`, previous only gives `lost`, current only gives `new`, neither (one beyond) gives `consistent_beyond` when either rank exists and `unchanged_beyond` when both are null, a single check gives `first_check`. Test each label with hand-built check lists through an exported pure `changeOf(previous, current)`; this is the same rule as `ranks.state.classify_change` and the backend's `change_label()` (read `backend/src/idraft/ranks/state.py` and `api/keywords/filters.py` lines 226 to 250, and copy its exact rule).
  4. `best_rank`, `worst_rank`, `best_rank_at` are over ranked checks only.
  5. `is_stale` is true for a few fixture keywords: export `STALE_IDS` (a small set of tracked ids chosen by index, for example every 17th fixture keyword) which also have their latest check 40 hours old; and one fixture keyword is `failed`: `current.state: 'failed'`, `consecutive_failures: 3`, no ranked check (a keyword whose checks all failed).
  6. `feature_types_present` and `owned_feature_types`: a deterministic small set from the id (for example `['featured_snippet', 'people_also_ask']` for some, `[]` for others, owned a subset); `aio`: `{ state: 'absent' | 'present_not_cited' | 'present_cited' | 'unknown', citation_position, observation_id }` deterministic from the id; `target_url_match`: null when the keyword has no target URL, else a boolean from the id.
- [ ] **Step 2: Run it to see it fail.**
- [ ] **Step 3: Implement `rank-state.ts`** using `checksOf`, writing the state exactly as the contract's `TrackedKeywordState` (fields listed in Facts). `url_id` is a deterministic string of digits from the path (the API's id is a number in a string field? read the schema: `UrlRef.url_id` is a string; the filter `ranking_url_id` is an integer: keep the string a decimal integer so `filter[ranking_url_id]` can match it).
- [ ] **Step 4:** In `src/mocks/factories/keyword.ts` replace `NOT_CHECKED_STATE` by `rankStateOf(row.tracked_keyword_id, row.created_at, Date.now(), <the project's domain>)` in `trackedKeywordRowView` and `trackedKeywordDetailView` (find the project's domain from the mock project fixtures: `MOCK_PROJECTS` has the domain; read `src/mocks/fixtures.ts`). `Date.now()` is the mock clock: Playwright's `page.clock` and Vitest fake timers move it.
- [ ] **Step 5:** Run `pnpm vitest run src/mocks src/test` and fix tests that assumed `not_checked` for every row (`src/test/api-shapes.ts`, handler tests): update an assertion only where the rank state changed by design.
- [ ] **Step 6: Commit**

```bash
git add apps/web/src/mocks apps/web/src/test
git commit -m "Mocks: rank state of tracked keywords from a derived history"
```

### Task 3: Mock list filters, sorts and includes

**Files:**
- Modify: `apps/web/src/mocks/handlers/keyword-rules.ts`, `apps/web/src/mocks/handlers/tracked-keywords.ts`
- Test: `apps/web/src/mocks/handlers/tracked-keywords.test.ts`

- [ ] **Step 1: Write failing tests** through the file's existing call helper:
  1. `filter[rank_lte]=3` and `filter[rank_gte]=4` keep exactly the ranked keywords in range; a never-checked keyword matches neither.
  2. `filter[rank_is_null]=true` keeps only checked keywords beyond depth; `false` keeps ranked ones.
  3. `filter[rank_change_label_in]=new,lost`, `filter[improved]=true`, `filter[declined]=true`, `filter[improved]=false` (everything not improved, including first checks), `filter[is_stale]=true` and `false`.
  4. `filter[feature_present]=featured_snippet`, `filter[feature_owned]=...`, `filter[aio_state]=present_cited,absent`, `filter[ranking_url_id]=<an id from a row>`, `filter[target_url_match]=true`.
  5. Out of range values are 422 as the contract declares (`rank_lte` 1 to 700, `feature_*` 1 to 100 characters, `aio_state` values from the enum).
  6. `sort=current_rank` puts the best rank first and beyond-depth and never-checked rows last; `sort=-current_rank` keeps them last; `sort=rank_change` and `sort=-rank_change` put rows without a numeric value last; `sort=best_rank` and `sort=-last_observed_at` likewise; two keys at most, each once (the existing `invalid_sort` rule now lists the new fields).
  7. `include=sparkline,competitor_ranks,features,aio` is accepted and answers `null` for each block (comment: the real API fills them; this UI does not ask yet).
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.** Extend `SORT_KEYS` and `sortRows` (`keyword-rules.ts` about lines 812 to 862: the rank sorts use the state from `rankStateOf`, null for the last-both-ways cases: `current_rank` null unless `ranked`; `rank_change` the numeric `value` or null; `best_rank`; `last_observed_at` as time), the filter parsing (`TrackedKeywordFilter` type and the filter function about lines 780 to 808: add the 12 parameters with the contract's validation, and AND semantics exactly as `_rank_conditions`: a never-checked keyword has no state, `improved=false` is "not improved" (`coalesce(value, 0) <= 0`), `is_stale=false` matches keywords with no state), the `Include` set (add the four values). Body filters of bulk routes (`TrackedKeywordFilter` in the bulk requests) take the same members: check `src/mocks/handlers/keyword-writes.ts` and the contract's `TrackedKeywordFilter` schema and support them the same way.
- [ ] **Step 4: Run** `pnpm vitest run src/mocks` and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/web/src/mocks
git commit -m "Mocks: rank filters, sorts and includes on the tracked keyword list"
```

### Task 4: What a rank cell shows (pure)

**Files:**
- Create: `apps/web/src/lib/format/rank-display.ts`
- Test: `apps/web/src/lib/format/rank-display.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import { changeDisplay, rankDisplay, urlDisplay } from './rank-display';

const current = (over: Record<string, unknown> = {}) => ({
  state: 'ranked' as const,
  rank: 3,
  absolute_rank: 4,
  depth_requested: 20,
  observed_at: '2026-10-06T02:00:00Z',
  serp_snapshot_id: null,
  url: null,
  ...over,
});

describe('rank display', () => {
  it('shows a ranked keyword by its number', () => {
    expect(rankDisplay(current(), false)).toEqual({
      kind: 'ranked', rank: 3, depth: 20, observedAt: '2026-10-06T02:00:00Z', stale: false,
    });
  });

  it('shows a keyword beyond the depth with the depth that was checked', () => {
    expect(rankDisplay(current({ state: 'beyond_depth', rank: null }), false)).toEqual({
      kind: 'beyond', depth: 20, observedAt: '2026-10-06T02:00:00Z', stale: false,
    });
  });

  it('shows pending before the first check and a failure as such', () => {
    expect(rankDisplay(current({ state: 'not_checked', rank: null, depth_requested: null, observed_at: null }), false)).toEqual({ kind: 'pending' });
    expect(rankDisplay(current({ state: 'failed', rank: null }), true)).toEqual({
      kind: 'failed', observedAt: '2026-10-06T02:00:00Z', stale: true,
    });
  });

  it('marks a stale keyword', () => {
    expect(rankDisplay(current(), true)).toMatchObject({ kind: 'ranked', stale: true });
  });
});

const change = (label: RankChange['label'], value: number | null = null): RankChange => ({
  label, value, previous_rank: null, previous_observed_at: null,
});

describe('change display', () => {
  it('shows an arrow with the amount, and a tone only for a move of more than 2 places', () => {
    expect(changeDisplay(change('numeric', 5))).toEqual({ kind: 'arrow', direction: 'up', amount: 5, tone: 'positive' });
    expect(changeDisplay(change('numeric', -3))).toEqual({ kind: 'arrow', direction: 'down', amount: 3, tone: 'negative' });
    expect(changeDisplay(change('numeric', 1))).toEqual({ kind: 'arrow', direction: 'up', amount: 1, tone: 'neutral' });
    expect(changeDisplay(change('numeric', -2))).toEqual({ kind: 'arrow', direction: 'down', amount: 2, tone: 'neutral' });
    expect(changeDisplay(change('numeric', 0))).toEqual({ kind: 'flat' });
  });

  it('shows New and Lost, always emphasised, and nothing visible for the rest', () => {
    expect(changeDisplay(change('new'))).toEqual({ kind: 'new' });
    expect(changeDisplay(change('lost'))).toEqual({ kind: 'lost' });
    expect(changeDisplay(change('first_check'))).toEqual({ kind: 'empty', reason: 'firstCheck' });
    expect(changeDisplay(change('unchanged_beyond'))).toEqual({ kind: 'empty', reason: 'stillBeyond' });
    expect(changeDisplay(change('consistent_beyond'))).toEqual({ kind: 'empty', reason: 'stillBeyond' });
  });

  it('gives a numeric change with no value the same as no change', () => {
    expect(changeDisplay(change('numeric', null))).toEqual({ kind: 'flat' });
  });
});

describe('url display', () => {
  const ref = { url_id: '7', canonical_url: 'https://fynix.digital/pricing', host: 'fynix.digital', path: '/pricing', registrable_domain: 'fynix.digital' };
  it('shows the path, the full address and a +1 for a second ranking URL', () => {
    expect(urlDisplay(current({ state: 'ranked', url: ref }), 2)).toEqual({ kind: 'url', path: '/pricing', full: 'https://fynix.digital/pricing', extra: 1 });
    expect(urlDisplay(current({ state: 'ranked', url: ref }), 1)).toMatchObject({ extra: 0 });
  });
  it('shows not ranking when nothing ranks and pending before the first check', () => {
    expect(urlDisplay(current({ state: 'beyond_depth', rank: null }), 0)).toEqual({ kind: 'none' });
    expect(urlDisplay(current({ state: 'not_checked', rank: null }), 0)).toEqual({ kind: 'pending' });
    // A failed check is not pending: it shows n/a (review fix)
    expect(urlDisplay(current({ state: 'failed', rank: null }), 0)).toEqual({ kind: 'failed' });
  });
  it('shows not ranking for a ranked cell the API sent without a URL', () => {
    expect(urlDisplay(current({ state: 'ranked', url: null }), 0)).toEqual({ kind: 'none' });
  });
});
```

Add to the imports: `import type { RankChange } from '@/lib/api/types';` (check that `RankChange` and `RankCell` are exported there, else take them from `components['schemas']` in `@/lib/api/schema`, as `src/lib/api/types.ts` does for the other schemas). Type the `current` fixture as `RankCell` (override its `state` with a typed value, no casts) and the url fixture as `UrlRef`.

- [ ] **Step 2: Run it to see it fail** (`pnpm vitest run src/lib/format/rank-display.test.ts`).
- [ ] **Step 3: Implement.** The module returns codes and numbers, never English, so components format the words with `next-intl` (no literal strings). The shapes:

```ts
import type { RankCell, RankChange, UrlRef } from '@/lib/api/types';

/** A move of more than this many places is colored; the API sends no figure for the keyword's normal movement. */
export const EMPHASIS_ABOVE = 2;

export type RankDisplay =
  | { kind: 'ranked'; rank: number; depth: number; observedAt: string; stale: boolean }
  | { kind: 'beyond'; depth: number; observedAt: string | null; stale: boolean }
  | { kind: 'pending' }
  | { kind: 'failed'; observedAt: string | null; stale: boolean };

export type ChangeDisplay =
  | { kind: 'arrow'; direction: 'up' | 'down'; amount: number; tone: 'positive' | 'negative' | 'neutral' }
  | { kind: 'flat' }
  | { kind: 'new' }
  | { kind: 'lost' }
  | { kind: 'empty'; reason: 'firstCheck' | 'stillBeyond' };

export type UrlDisplay =
  | { kind: 'url'; path: string; full: string; extra: number }
  | { kind: 'none' }
  | { kind: 'pending' };
```

  `rankDisplay(current: RankCell, stale: boolean)`: `ranked` needs `rank` and `depth_requested` and `observed_at` (if the API ever sends a ranked cell without them, show `pending`: never throw); `beyond_depth` uses `depth_requested`; `not_checked` is `pending`; `failed` carries `observed_at`. `changeDisplay(change: RankChange)`: `numeric` with a positive `value` is an up arrow, negative a down arrow (`amount` is the absolute value, `tone` is `positive`/`negative` only when `amount > EMPHASIS_ABOVE`, else `neutral`), zero or a missing value is `flat`; `new` and `lost` as in the tests; `first_check` is `empty/firstCheck`; `unchanged_beyond` and `consistent_beyond` are `empty/stillBeyond`. `urlDisplay(current: RankCell, rankingUrlCount: number)`: `ranked` with a `url` is `url` (`path` from `UrlRef.path`, `full` from `canonical_url`, `extra` is `max(0, count - 1)`); `ranked` or `beyond_depth` with no url is `none`; `not_checked` is `pending` and `failed` is `failed` (shown as "n/a"). Reuse nothing from `rank.ts` that produces English (`formatRankCell` gives ">20" which is language independent: the cell may use it for the `>depth` text). The arrows are glyphs rendered by the component from `direction`.
- [ ] **Step 4: Run the tests** and typecheck. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/format/rank-display.ts apps/web/src/lib/format/rank-display.test.ts
git commit -m "Rankings: what a rank, a change and a ranking URL show"
```

### Task 5: Column types and builders

**Files:**
- Modify: `apps/web/src/lib/tables/column-types.ts`, `apps/web/src/components/app/data-table/columns.tsx`
- Test: `apps/web/src/components/app/data-table/data-table.test.tsx` (or a new `columns.test.tsx`), `src/lib/tables/*.test.ts` if column types have tests

- [ ] **Step 1: Write failing tests:**
  1. `COLUMN_TYPES` has `rank` (width 64, min 56, max 80, right aligned, default sort ascending), `rankDelta` (56, 48, 72, right, default sort descending: biggest improvement first) and `url` (260, 180, 480, left, not sortable by this plan's use, default ascending A to Z) from 12-tables.md section 6; read how existing types state alignment, direction and sortability and follow them.
  2. `col.rank(id, sortValue, { header, headerTooltip, priority, cell })`, `col.rankDelta(...)` and `col.url(...)` build a `DataTableColumn` whose width is clamped to the type, with the cell supplied by the screen (these types differ from `count`: the cell content is a rich element, so the builders take a `cell: (row) => ReactNode`). Sorting in client mode puts rows whose `sortValue` is `null` last in both directions (the table already does this for `unknown` values: verify with a test on a `rank` column).
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement** the three types in `column-types.ts` (the `ColumnType` union, `COLUMN_TYPES` entries and any switch over the union, found by typechecking) and the three builders in `columns.tsx`, beside `col.badge`/`col.status`. Add `rank`, `rankDelta`, `url` to the column chooser's grouping if types are used there (`column-chooser.tsx`).
- [ ] **Step 4: Run** `pnpm vitest run src/components/app/data-table src/lib/tables` and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/app/data-table apps/web/src/lib/tables
git commit -m "Table: rank, change and URL column types"
```

### Task 6: The cells and the Rankings columns

**Files:**
- Create: `apps/web/src/features/rankings/rank-cells.tsx`
- Test: `apps/web/src/features/rankings/rank-cells.test.tsx`
- Modify: `apps/web/src/features/rankings/keyword-columns.ts`, `apps/web/messages/en.json`, `apps/web/src/features/rankings/rankings.test.tsx`

- [ ] **Step 1: Invoke `design-taste-frontend`**, then read 12-tables.md sections 6 and 7 and 14-badges-status.md section 5 once more.
- [ ] **Step 2: Strings** under `rankings.rank` in `messages/en.json` (camelCase keys; plain text without en or em dashes; pluralisation by ICU):

```json
"rank": {
  "rank": "Rank",
  "rankTooltip": "Organic rank at the latest check. A keyword beyond the depth that was checked shows the depth, such as >20.",
  "change": "Change",
  "changeTooltip": "How the rank moved since the previous check. Arrows show the direction; color marks a move of more than 2 places, and New and Lost always.",
  "rankingUrl": "Ranking URL",
  "bestRank": "Best rank",
  "bestRankTooltip": "The best organic rank in the checks kept.",
  "updated": "Updated",
  "pending": "Pending",
  "pendingTooltip": "The first check has not run yet.",
  "failed": "Check failed",
  "failedTooltip": "The last check failed. It will be tried again.",
  "stale": "Stale",
  "staleTooltip": "No successful check for {hours} hours.",
  "notRanking": "Not ranking",
  "rankTip": "Rank {rank}, {date}, depth {depth}",
  "beyondTip": "Not in the top {depth}, {date}",
  "lastGood": "Last successful check: {date}",
  "speech": {
    "ranked": "rank {rank}",
    "beyond": "not in top {depth}",
    "pending": "first check pending",
    "failed": "check failed",
    "improved": "{count, plural, one {improved # position} other {improved # positions}}",
    "declined": "{count, plural, one {declined # position} other {declined # positions}}",
    "noChange": "no change",
    "entered": "entered the tracked depth",
    "dropped": "dropped out of the tracked depth",
    "firstCheck": "first check",
    "stillBeyond": "still beyond tracked depth"
  },
  "new": "New",
  "lost": "Lost",
  "urlTip": "{url}, {date}",
  "moreUrls": "{count, plural, =1 {and 1 more of your URLs ranks} other {and # more of your URLs rank}}"
}
```

  Add the matching column names under `rankings.columns` only if the existing keys cover them (they do not: use the `rankings.rank` keys).
- [ ] **Step 3: Write failing tests** in `rank-cells.test.tsx` (render the cell elements directly with `NextIntlClientProvider` as the other cell tests do): rank cell for ranked, beyond (`>20` as plain text, `speech` hidden text "not in top 20"), pending, failed (an icon with the accessible name "Check failed"); change cell arrows and tones for `numeric` 5, -3, 1, 0, New, Lost and empty with speech for the three empty labels (visible text empty, `sr-only` text present, `aria-hidden` on the glyph text); URL cell path middle-truncated with the full URL in the tooltip, `+1` marker, "Not ranking" and "Pending"; the Updated cell shows the date in the project's time zone and a "Stale" marker when `state.is_stale`; tooltips open on keyboard focus of the cell (use the grid's focus pattern from `columns.tsx`: the earlier review of the table found tooltips must hang on the focused cell, so give the cell the description through the table's cell-tip option, `CellTip` in `data-table/types.ts`).
- [ ] **Step 4: Implement `rank-cells.tsx`** with small components `RankCellView`, `RankChangeView`, `RankingUrlView` taking the pure display values and `useTranslations('rankings.rank')`. Tone classes: positive `text-positive-text`, negative `text-negative-text`, neutral `text-foreground`; beyond depth and pending `text-foreground-tertiary`; the arrow is a text glyph in the same span (no icon, no badge box); failed uses the same `TriangleAlert` icon component other cells use for row errors (find it: `grep -rn "TriangleAlert" src/components`). Mono path with `Truncate` (middle truncation if the component has that mode; check `src/components/ui/truncate.tsx`).
- [ ] **Step 5: Columns.** In `keyword-columns.ts` add, in this order after Keyword: `current_rank` (`col.rank`, tier 1, header `rank`, tooltip, sort value the `ranked` number or null), `rank_change` (`col.rankDelta`, tier 1, sort value the numeric `value` or null), `ranking_url` (`col.url`, tier 2, `sortable: false`), then the existing Volume (set tier 2), KD, CPC, Intent, Priority, Group, Tags, then `best_rank` (`col.rank`, tier 3, `defaultVisible: false`, sort value `best_rank` or null), `last_observed_at` (`col.date`, tier 4, header "Updated", `timeZone`, secondary text the Stale marker when `is_stale`, sort value the instant or null), and Added as before. Add the four ids to `SORT_FIELDS` (`current_rank`, `rank_change`, `best_rank`, `last_observed_at`). Keep `DEFAULT_SORT` Volume descending. Update the file's doc comment (columns now include the rank ones; rank columns of the template that wait: sparkline, features, AI Overview, competitor).
- [ ] **Step 6: Update tests that count columns or read the header names** in `rankings.test.tsx` and the rankings harness (the grid now has more columns; update only the assertions that enumerate columns). Add Rankings tests: a ranked keyword row shows its number and arrow; a new keyword added through Add keywords shows "Pending" in Rank; sorting by Rank in server mode sends `sort=current_rank` and puts beyond-depth rows last; the column chooser lists "Best rank" off by default.
- [ ] **Step 7: Run** `pnpm vitest run src/features/rankings src/components/app/data-table` and `pnpm lint && pnpm typecheck`. Expected: PASS.
- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/rankings apps/web/messages/en.json
git commit -m "Rankings: rank, change, ranking URL, best rank and updated columns"
```

### Task 7: Filters

**Files:**
- Modify: `apps/web/src/features/rankings/keyword-filters.ts`, `rankings-queries.ts` (the `KeywordFilters` the list sends), `rankings-screen.tsx` if the filter values are wired there, `messages/en.json`
- Test: `apps/web/src/features/rankings/rankings.test.tsx`, a model test for the parameter mapping

- [ ] **Step 1: Write failing tests:**
  1. A pure `rankFilterParams(values)` (put it in `keyword-filters.ts` or a small `rank-filter-params.ts`): `{ rank: 'top3' }` gives `{ 'filter[rank_gte]': 1, 'filter[rank_lte]': 3 }`; `top10` is 4 to 10, `top20` 11 to 20, `top50` 21 to 50, `top100` 51 to 100, `beyond` gives `{ 'filter[rank_is_null]': true }`; `{ chg: 'improved' }` gives `{ 'filter[improved]': true }`, `declined` gives `{ 'filter[declined]': true }`, `entered` gives `{ 'filter[rank_change_label_in]': ['new'] }`, `lost` gives `['lost']`; `{ stale: 'stale' }` gives `{ 'filter[is_stale]': true }`; unknown values give nothing (they are dropped by the URL filter hook as for the other chips).
  2. In the screen: choosing "Top 3" in the Rank chip sends `filter[rank_gte]=1&filter[rank_lte]=3`, writes `rank=top3` to the URL, and only ranked keywords within 1 to 3 remain; choosing "Improved" in Change sends `filter[improved]=true`; "Stale" sends `filter[is_stale]=true`; a link with `rank=beyond` applies it; an invalid value is dropped with the notice the other chips give.
  3. The selection and bulk actions use the same body filter: `bodyFilterOf` in `bulk/bulk-target.ts` maps each `filter[x]` to `x` explicitly: add the new members there (and the test in `bulk-target.test.ts`: "Select all matching" under a rank filter sends `rank_lte`, `rank_gte`, `rank_is_null`, `rank_change_label_in`, `improved`, `declined`, `is_stale` in the body filter with the same values).
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.** In `keyword-filters.ts` add three `FilterField`s (kind `enum`, single choice: `multi` not set), ids `rank`, `chg`, `stale`, labels and option labels from messages (`rankings.filters.rank`, `rankBuckets.top3`, and so on; "4 to 10" style labels come from `RANK_BUCKETS` in `lib/format/rank.ts` formatted through messages, not literals). `keywordFilters(values, archived)` (about `keyword-filters.ts` or `rankings-queries.ts`: find it) adds `rankFilterParams`. Extend the `KeywordFilters` type and the keyword cache rules (`keyword-cache.ts` already lists the rank filters). The chips appear after "Group" in the filter bar's "+ Filter" list in the template's order (Rank bucket, then Change; Stale last).
- [ ] **Step 4: Strings** under `rankings.filters`: `rank` "Rank", `chg` "Change", `stale` "Stale", options "Top 3", "4 to 10", "11 to 20", "21 to 50", "51 to 100", "Beyond depth", "Improved", "Declined", "Entered", "Lost", "Stale".
- [ ] **Step 5: Run** `pnpm vitest run src/features/rankings`, lint, typecheck. Expected: PASS.
- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/rankings apps/web/messages/en.json
git commit -m "Rankings: rank, change and stale filters"
```

### Task 8: First checks fill in while the page is open

**Files:**
- Modify: `apps/web/src/features/rankings/refresh/pending-metrics.ts` (and its tests in `refresh.test.tsx` or `pending-metrics.test.ts`)

- [ ] **Step 1: Read** `pending-metrics.ts` and the tests of the poll (`refresh.test.tsx`: the "pending poll" cases) to see how a row is "waiting" and what the poll lays over it (it lays `metrics` over rows from a re-read of the first pages with `include=metrics`).
- [ ] **Step 2: Write failing tests** (fake timers; use the mock clock): a keyword added a moment ago shows "Pending" in Rank; after the mock's first check delay (3 minutes) and a poll, its Rank cell shows a number or `>depth` without a reload; the poll stops once no row waits for either metrics or a first rank check; the 15 minute per-row cap and the visible-time rule hold for a keyword that is never checked (a keyword in a paused project: use a mock keyword whose `created_at` is in the future relative to mock time, or an override that keeps it `not_checked`).
- [ ] **Step 3: Implement.** A row waits when `row.metrics === null` OR `row.state.current.state === 'not_checked'` (and the keyword is active). The overlay copies both `metrics` and `state` from the fresh row onto the waiting row (identity of the other rows stays, selection and scroll are kept as today). Keep the cap per row. The refetch already returns `state` (always present).
- [ ] **Step 4: Run** `pnpm vitest run src/features/rankings`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/rankings
git commit -m "Rankings: a first rank check fills in while the page is open"
```

### Task 9: End to end, documents, gates, review

**Files:**
- Modify: `apps/web/e2e/flows/rankings.spec.ts`, `apps/web/e2e/visual/pages.spec.ts`, docs

- [ ] **Step 1: E2E:** an editor opens Rankings; the Rank and Change columns show numbers and arrows for fixture keywords; sorts by Rank (best first, beyond depth last) by clicking the header; filters Top 10 and sees only keywords ranked 4 to 10; adds a keyword (existing flow) and sees "Pending" in Rank, moves the clock past the first check delay with `page.clock.runFor`, and sees its rank appear (the pending poll). At 1280 px the Rank, Change, Ranking URL and Volume columns are visible and the Keyword column is not squeezed to nothing. The existing visual entry for Rankings gains the new columns in its screenshot (no baseline is committed).
- [ ] **Step 2: Documents** (Edit and Write tools only): doc 20 section 5.3 "As built" gets a part 2 note (columns built and their tiers, filters `rank`, `chg`, `stale`, the single-choice limit, the emphasis limit, what still waits: sparkline, SERP features, AI Overview, competitor positions, target URL match, the metric strip, "Check now", the inspector's rank history, group-by); doc 25 gets entries for `col.rank`, `col.rankDelta`, `col.url` and the three cell views (match the style of deviations 132 to 143); the parent plan's "Not in this plan" line is amended with a pointer to this plan; `docs/review-log.md` gets a row in the keywords UI entry (what this plan built; F89 closed).
- [ ] **Step 3: Gates** (all in `apps/web`, all must pass): `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm format:check`, `NEXT_PUBLIC_API_MOCKING=off pnpm build`, `pnpm run preview`, `pnpm e2e`.
- [ ] **Step 4: Opus review.** The lead dispatches an independent reviewer on the Opus model with this plan and the diff from the branch point; fix every Critical and Important finding, run the gates again.
- [ ] **Step 5: Commit** the end to end flows and documents, "Rankings: rank columns, end to end and documents".

Never add `.claude/launch.json` or `research/`. No attribution lines. Push and merge only on the user's word.

---

## Review fixes (2026-10-06, after the independent review on the Opus model)

The review found the following; each is fixed, with its test written first, and the statements above that it overtakes are amended in place (decisions 3, 4, 5 and 7, and the `urlDisplay` cases of Task 4).

1. DOM tests timed out in full runs, since the grid renders 13 data columns: the dom project's `testTimeout` is 15 s and `findBy` and `waitFor` wait up to 5 s (`vitest.config.ts`, `vitest.setup.ts`).
2. A stale rank looked current below 1680 px, where Updated is hidden: the Rank cell carries a 12 px clock and the hidden word "stale" for ranked, beyond and failed states.
3. A failed check after good ones (the API keeps `current`, and only `consecutive_failures` says it): a warning glyph and "last check failed" beside the rank, with the failure in the tooltip. `rankDisplay(current, stale, consecutiveFailures)`.
4. A keyword that never had a good check and is stale shows the marker in Updated too (the mock judges it as the backend does: from its creation).
5. One rule for a failed row (Rank warning; Ranking URL and Best rank "n/a"; Updated "Check failed" with the marker; Change nothing).
6. Change says nothing before any good check (`rowChangeDisplay`); a keyword checked once keeps "first check".
7. The rank change type is 84 / 88 px wide at least, so the resolver cannot shrink it below its header (75 px at 1680 px before).
8. Ranking URL keeps the end of a long path: its last 12 characters never shrink, the start gives way by CSS. A mock path of 33 characters shows it.
9. A link that names several values of a single-choice chip: the hook already reported what it dropped (`losesSomething`); tests now pin it, in the hook and in Rankings.
10. The first-check poll waits only for keywords added in the last hour (`FIRST_CHECK_WINDOW_MS`).
11. Rows that tie on a sort come in row id order in client mode, as the API orders them (`useSortedRows`).
12. A bulk action by filter counts the matches again before it acts, and stops with a message when the count is not the one confirmed (`matchCountQuery`, `confirmMatch`).
13. The Keyword column's 200 px at 1680 px stays as recorded; Added and Tags may move to the chooser later (doc 20 section 5.3).
14. Copy: the change tooltip's own sentence ("Improved 5 positions"), the chip "Freshness: Stale", the previous rank in the rank tooltip, no repeat of "not in the top 20" for a screen reader, and "no change within the depth checked" for `consistent_beyond`.
15. The mock stops checking an archived keyword at its archive time (`stoppedAtOf`: `updated_at`, or 5 days after creation for a fixture, which has no archive time), and a date beside a marker wraps with it instead of spilling into the next column; a date alone is as it was in the Runs table.
