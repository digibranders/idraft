# Keywords: add in several countries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Add keywords dialog tracks keywords in one or more countries (up to 10) on the devices chosen, shows `keywords x devices x countries = checks a day`, the estimated cost and the plan use before and after, and refuses an add over the plan. The table's country control lists only the countries the project has keywords in, the Filter bar has a multi-value Country filter, and a Country column shows when more than one country is in view.

**Architecture:** Three small backend additions (a `country_id_in` filter, a "countries in use" read, a tracked keyword quota read), then the web side: pure helpers (plan arithmetic, chunking), the dialog, the filter and the column. One tracked keyword per keyword x country x device already exists in the API (identity includes location and device), so adding in several countries is a client fan-out into one `bulk-create` item per keyword and country, sent in chunks of at most 1,000 items.

**Tech Stack:** FastAPI, SQLAlchemy Core, pytest (backend, `backend/check.sh`); Next.js, TypeScript strict, react-hook-form + zod, next-intl, MSW, vitest, Playwright (apps/web).

**Source of truth:** `docs/08-seo-keyword-system.md` section 3.1.1 (rules and cost), the design mock `apps/web/design-preview/kw-grouped-dialogs.js`, `kw-grouped-model.js` (`FILTER_FIELDS`, `shown`, country column) and `docs/design-system/24-page-templates.md` ("Country scope" row).

**Decisions made here (the owner asked for countries; the API takes any location):**
- The dialog picks **countries** (a multi-select over the cached country list, `useCountries()`), not cities. A city can still be tracked through import and through the project default. 10 countries at most per add, no "Global" (Google has no worldwide search).
- The cost line is `up to` and assumes depth 100, the standard queue and the async AI Overview (the deepest and dearest case, about $0.0066 a check). It is read from the price book (`GET /workspaces/{w}/price-book`, endpoint `serp/google/organic`); where the price book cannot be read, the cost is left out and the checks and the plan line stay.
- The plan line needs the workspace's tracked keyword limit and use, which no endpoint gives before submitting. This plan adds `GET /workspaces/{w}/tracked-keyword-quota` (the first piece of the deferred `{W}/quotas` of doc 19; the full `QuotaUsage` stays deferred).
- The scope country (top of the page) and the Country filter chip both apply (the keyword must match both), as in the mock.

**Conflict note:** the main checkout (`/Users/a12345/Desktop/AI/idraft/platform`) holds another session's uncommitted Search Console edits to `backend/openapi/v1.json`, `apps/web/src/lib/api/schema.ts`, `backend/src/idraft/api/main.py` and the keywords routes, service and schemas. This plan's edits to routes, schemas and filters do not overlap their hunks. `openapi/v1.json` and `schema.ts` are generated files: when branches merge, resolve them by running the two generation commands again, never by hand. Work only in the worktree `/Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/keywords-grouped`; do not run `pnpm gen:api` against the main checkout's JSON.

Backend commands run from `backend` (`uv run ...`, gates with `./check.sh`); web commands from `apps/web` (`pnpm ...`).

---

### Task 1: Backend, filter by several countries

**Files:**
- Modify: `backend/src/idraft/api/schemas/keywords.py` (`TrackedKeywordFilter`, near the `country_id` field, line ~550)
- Modify: `backend/src/idraft/api/keywords/routes.py` (`list_tracked_keywords` parameters ~line 290 and the dict ~line 349)
- Modify: `backend/src/idraft/api/keywords/filters.py` (`conditions`, after the `country_id` block ~line 219)
- Modify: `backend/openapi/v1.json` (regenerated)
- Test: `backend/tests/api/keywords/test_tracked_keyword_list.py`, `backend/tests/api/keywords/test_bulk_changes.py`

- [ ] **Step 1: Write the failing tests**

In `test_tracked_keyword_list.py`, next to `test_the_country_filter_takes_the_country_and_every_place_inside_it` (line ~140), copy that test's setup and add:

```python
async def test_the_country_in_filter_takes_every_country_named_and_the_places_inside_them(
    migrated, ...  # the same fixtures that test uses
) -> None:
    # Keywords tracked in country A, in a city of country B, and in country C.
    # filter[country_id_in]=A,B must return the A and the B-city keywords, not the C one.
    ...
```

Fill the body by copying the setup of the single-country test (it already tracks a keyword in a country and one inside it) and add a third location in another country using `OTHER_LOCATION` from `tests/api/keywords/support.py`; assert the keyword texts returned for `{"filter[country_id_in]": f"{country_a},{country_b}"}` equal the A and B keywords. Also add to the `cases` table of `test_each_filter_keeps_the_matching_keywords` (line ~93) nothing; the new test is separate. In `test_bulk_changes.py` add a case beside the `"filter": {"device": "mobile"}` one (line ~132): `bulk-archive` with `{"filter": {"country_id_in": [country_a]}}` archives only that country's keywords.

Run: `uv run pytest tests/api/keywords/test_tracked_keyword_list.py -k country_in tests/api/keywords/test_bulk_changes.py -k country -q`
Expected: FAIL (unknown filter or 422).

- [ ] **Step 2: Implement**

In `schemas/keywords.py`, after `country_id`:

```python
    country_id_in: FilterList[int] | None = Field(
        default=None,
        description="Any of these countries' location ids: the keywords tracked in one of them or "
        "anywhere inside one.",
    )
```

In `routes.py`, after the `country_id` parameter add:

```python
    country_id_in: Annotated[
        list[int] | None,
        Commas,
        Query(
            alias="filter[country_id_in]",
            description="Any of these countries (comma separated location ids).",
        ),
    ] = None,
```

and in the dict passed to `_query_filter` add `"country_id_in": country_id_in,` after `"country_id": country_id,`.

In `filters.py` after the `country_id` block:

```python
    if given.country_id_in is not None:
        country = locations.c.country_iso
        found.append(
            t.location_id.in_(
                select(locations.c.id).where(
                    country.in_(
                        select(country).where(locations.c.id.in_(list(given.country_id_in)))
                    )
                )
            )
        )
```

(The existing `scope()` binds cursors to the filter through `model_dump`, so the new field is covered; the body filter used by bulk changes is the same `TrackedKeywordFilter`.)

- [ ] **Step 3: Run, regenerate the document, commit**

Run: `uv run pytest tests/api/keywords -q` then `uv run python -m idraft.api.openapi > openapi/v1.json` then `uv run pytest tests/api/test_openapi.py -q` then `./check.sh`
Expected: all pass.

```bash
git add backend && git commit -m "Keywords API: filter by several countries (country_id_in)"
```

---

### Task 2: Backend, the countries a project has keywords in

**Files:**
- Modify: `backend/src/idraft/api/keywords/routes.py` (a new `GET /tracked-keywords/countries`, declared BEFORE the `/{tracked_keyword_id}` routes)
- Modify: `backend/src/idraft/api/keywords/service.py` (a `countries_in_use` method) and a response schema in `backend/src/idraft/api/schemas/keywords.py`
- Modify: `backend/openapi/v1.json` (regenerated)
- Test: `backend/tests/api/keywords/test_tracked_keyword_countries.py` (new)

The route answers `{ "data": [ { "location": LocationRef (the country), "keyword_count": int } ] }`, one entry for every country the project has active tracked keywords in (a keyword tracked in a city counts for the city's country), sorted by `keyword_count` descending then name. `keyword_count` counts distinct keywords (a keyword on both devices is one). Permission and project scoping: copy the list route (`keywords:read`, workspace and project path, `is_active` rows of the project only).

- [ ] **Step 1: Write the failing tests**

Create `test_tracked_keyword_countries.py` using `keyword_project` and `tracked_id` from `support.py` and the copied fixtures of `test_tracked_keyword_list.py`. Tests:
1. A project with keywords in a country, in a city of the same country and in another country returns two entries, the first with the larger `keyword_count`, each `location` a `Country` with its own `location_id`.
2. A keyword on both devices counts once.
3. An archived keyword does not count; a project with no keywords returns `{"data": []}`.
4. A viewer of another workspace gets 404 (copy the isolation test of the list route).

Run: `uv run pytest tests/api/keywords/test_tracked_keyword_countries.py -q`
Expected: FAIL (404 route).

- [ ] **Step 2: Implement**

Schemas (in `schemas/keywords.py`):

```python
class TrackedKeywordCountry(ApiModel):
    location: LocationRef
    keyword_count: int


class TrackedKeywordCountries(ApiModel):
    data: list[TrackedKeywordCountry]
```

(use the base model and `LocationRef` the file already uses for `TrackedKeywordRow.location`). Service method, using SQLAlchemy Core in the style of `filters.py`: join the project's active tracked keywords to `locations` (`l`) on `t.location_id == l.c.id`, group by `l.c.country_iso`, `count(distinct t.keyword_id)`, then join `locations` (`c`) on `c.country_iso == l.c.country_iso and c.location_type == 'Country'` to return the country row. A location with no country row of type `Country` is left out. Route:

```python
@router.get("/countries", response_model=TrackedKeywordCountries, ...)
async def tracked_keyword_countries(...) -> TrackedKeywordCountries:
```

with the same dependencies and `operation_id` style as `list_tracked_keywords` (copy its decorator and permission dependency; name it `list_tracked_keyword_countries`).

- [ ] **Step 3: Run, regenerate, commit**

Run: `uv run pytest tests/api/keywords -q && uv run python -m idraft.api.openapi > openapi/v1.json && uv run pytest tests/api/test_openapi.py -q && ./check.sh`
Expected: pass.

```bash
git add backend && git commit -m "Keywords API: the countries a project has keywords in"
```

---

### Task 3: Backend, the tracked keyword quota

**Files:**
- Create: `backend/src/idraft/api/quotas/__init__.py`, `routes.py`, `service.py` (or the smallest layout the other `api/*` packages such as `api/workspaces` use; copy it)
- Modify: `backend/src/idraft/api/main.py` (include the router, as the other routers at lines ~212-232)
- Modify: `backend/openapi/v1.json` (regenerated); `docs/19-api-specification.md` (section 3.2.5)
- Test: `backend/tests/api/quotas/test_tracked_keyword_quota.py` (new)

`GET /api/v1/workspaces/{workspace_id}/tracked-keyword-quota` (workspace member) returns `{ "data": { "limit": int, "used": int } }` from `writer.quota_usage(db, workspace_id)` (`backend/src/idraft/keywords/writer.py:142`, already used by the import preview). The count is workspace wide (active tracked keywords of live projects), the same as the figure `quota_exceeded` carries.

- [ ] **Step 1: Failing test**

Using the workspace fixtures of `tests/api/keywords/support.py`: a workspace with a `workspace_quotas` row of 7 and 3 active tracked keywords returns `{"limit": 7, "used": 3}`; a workspace without a quota row returns the default limit (`DEFAULT_TRACKED_KEYWORD_LIMIT`, 5000); a user outside the workspace gets 404. Run `uv run pytest tests/api/quotas -q`; expect FAIL.

- [ ] **Step 2: Implement**

Schema `TrackedKeywordQuota(ApiModel)` with `limit: int`, `used: int` and an `One[...]` envelope in the style the other single-object responses use (`WorkspaceResponse` or similar in `api/schemas`; copy it). The route reads the quota through a session from the same `sessions` factory `KeywordService` receives (`main.py:178`). Register the router in `main.py`. In `docs/19-api-specification.md` section 3.2.5 add one row under the deferred `GET {W}/quotas` row: `GET {W}/tracked-keyword-quota | member | none | One<{ limit, used }> | no | | 5` and a sentence that the full `QuotaUsage` stays deferred.

- [ ] **Step 3: Run, regenerate, commit**

Run: `uv run pytest tests/api -q && uv run python -m idraft.api.openapi > openapi/v1.json && ./check.sh`

```bash
git add backend docs && git commit -m "API: tracked keyword quota of a workspace"
```

---

### Task 4: Web client types and mocks

**Files:**
- Modify: `apps/web/src/lib/api/schema.ts` (regenerated, in the worktree only)
- Modify: `apps/web/src/mocks/handlers/keyword-rules.ts` (`FILTER_NAMES` ~616, `TrackedFilter` ~563, `readFilter` ~765, `filteredRows` ~951), `apps/web/src/mocks/handlers/tracked-keywords.ts` (a `countries` handler), a new `apps/web/src/mocks/handlers/keyword-quota.ts` and its registration where the other handlers are listed, `apps/web/src/mocks/operations-fixtures.ts` (`MOCK_PRICES` ~302)
- Test: `apps/web/src/mocks/handlers/tracked-keywords.test.ts`

- [ ] **Step 1: Regenerate the client**

Run (from `apps/web`): `pnpm gen:api`
Expected: `src/lib/api/schema.ts` gains `filter[country_id_in]`, `TrackedKeywordCountries`, the quota path. `git diff --stat` shows only additions for them. Run `pnpm typecheck`; fix nothing yet.

- [ ] **Step 2: Failing mock tests**

In `tracked-keywords.test.ts`, with the `editor.call` helper used by the file (`const answer = await editor.call('GET', ...)`), add tests:
- `GET ${TK}?filter[country_id_in]=2276,2840` returns only keywords tracked in Germany or the US (the seed has both, `mocks/keyword-table.ts`); `filter[country_id_in]=2356` returns none;
- `GET ${TK}/countries` returns `data` with Germany first (the larger count) and the United States, each `location.location_type === 'Country'` and a `keyword_count` equal to the distinct keywords of the seed in that country;
- `GET /api/v1/workspaces/{ws}/tracked-keyword-quota` returns `{ data: { limit: 5000, used: <active rows> } }`.

Run: `pnpm vitest run src/mocks/handlers/tracked-keywords.test.ts`; expect FAIL.

- [ ] **Step 3: Implement the mocks**

- `keyword-rules.ts`: add `country_id_in` to `FILTER_NAMES`; `countryIdIn?: readonly number[]` to `TrackedFilter`; in `readFilter` copy the `ids()` helper pattern (lines ~718-740) to parse the comma list into integers; in `filteredRows` keep a row when `inCountry(row.location_id, id)` (line 557) holds for any of the ids.
- `tracked-keywords.ts`: add a `GET .../tracked-keywords/countries` handler (registered before the `/{id}` handler) that groups the project's active rows by country (use `MOCK_LOCATIONS` in `mocks/entity-fixtures.ts:229` and the same `country_iso` matching as `inCountry`) into `{ location, keyword_count }`, distinct by keyword id, sorted by count desc then name.
- `keyword-quota.ts`: a handler for the quota path returning `{ data: { limit: MAX_TRACKED_KEYWORDS, used } }` with `used` computed as `quotaProblem` does in `keyword-rules.ts:156` (active rows across the workspace's projects). Export the helper if it is private.
- `MOCK_PRICES`: add two rows for endpoint `serp/google/organic`, `provider_code: 'dataforseo'` (copy the shape and ids style of the existing rows): `price_unit: 'page'`, `conditions: { queue: 'standard' }`, `unit_price_usd: '0.0006'`; and `price_unit: 'task'`, `conditions: { queue: 'standard', async_ai_overview: true }`, `unit_price_usd: '0.0006'`.

- [ ] **Step 4: Run and commit**

Run: `pnpm vitest run src/mocks && pnpm typecheck && pnpm lint`
Expected: pass.

```bash
git add apps/web && git commit -m "Web: client types and mocks for several countries, countries in use and the quota"
```

---

### Task 5: Pure helpers, the arithmetic of an add

**Files:**
- Create: `apps/web/src/features/rankings/add-keywords/add-plan.ts`
- Test: `apps/web/src/features/rankings/add-keywords/add-plan.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';

import { addPlan, chunkKeywords, checkPriceUsd, costOf, MAX_ADD_COUNTRIES } from './add-plan';

describe('addPlan', () => {
  it('multiplies keywords, devices and countries into the checks a day', () => {
    expect(addPlan({ keywords: 12, device: 'both', countries: 2 })).toEqual({
      keywords: 12,
      devices: 2,
      countries: 2,
      checksPerDay: 48,
    });
  });
  it('counts one device for desktop or mobile, and for a default not yet known', () => {
    expect(addPlan({ keywords: 3, device: 'mobile', countries: 4 }).checksPerDay).toBe(12);
    expect(addPlan({ keywords: 3, device: null, countries: 4 }).checksPerDay).toBe(12);
  });
  it('counts nothing without keywords or countries', () => {
    expect(addPlan({ keywords: 0, device: 'both', countries: 3 }).checksPerDay).toBe(0);
    expect(addPlan({ keywords: 5, device: 'both', countries: 0 }).checksPerDay).toBe(0);
  });
});

describe('costOf', () => {
  it('gives the cost a day and a month (30 days) of the checks', () => {
    expect(costOf(48, 0.0066)).toEqual({ day: 0.3168, month: 9.504 });
  });
  it('gives nothing when the price is not known', () => {
    expect(costOf(48, null)).toBeNull();
  });
});

describe('checkPriceUsd', () => {
  const page = { endpoint: 'serp/google/organic', price_unit: 'page', conditions: { queue: 'standard' }, unit_price_usd: '0.0006' };
  const task = {
    endpoint: 'serp/google/organic',
    price_unit: 'task',
    conditions: { queue: 'standard', async_ai_overview: true },
    unit_price_usd: '0.0006',
  };
  it('is ten pages of results plus the AI Overview task at depth 100', () => {
    expect(checkPriceUsd([page, task])).toBeCloseTo(0.0066, 6);
  });
  it('is null when a price is missing', () => {
    expect(checkPriceUsd([page])).toBeNull();
    expect(checkPriceUsd([])).toBeNull();
  });
});

describe('chunkKeywords', () => {
  it('keeps keywords x countries within the 1,000 items one request takes', () => {
    const keywords = Array.from({ length: 250 }, (_, index) => `k${String(index)}`);
    const chunks = chunkKeywords(keywords, 10);
    expect(chunks.map((chunk) => chunk.length)).toEqual([100, 100, 50]);
    expect(chunks.flat()).toEqual(keywords);
  });
  it('is one chunk when everything fits', () => {
    expect(chunkKeywords(['a', 'b'], 3)).toEqual([['a', 'b']]);
  });
  it('allows ten countries at most', () => {
    expect(MAX_ADD_COUNTRIES).toBe(10);
  });
});
```

Run: `pnpm vitest run src/features/rankings/add-keywords/add-plan.test.ts`; expect FAIL (module missing).

- [ ] **Step 2: Implement**

```ts
import type { components } from '@/lib/api/schema';

type Price = Pick<components['schemas']['Price'], 'endpoint' | 'price_unit' | 'conditions' | 'unit_price_usd'>;

/** Countries one add may name (docs/08 section 3.1.1): one request stays inside the batch limit. */
export const MAX_ADD_COUNTRIES = 10;
/** Items one `bulk-create` request takes (backend `BULK_CREATE_MAX`). */
export const BULK_CREATE_MAX_ITEMS = 1000;
/** Days a month is priced at. */
const DAYS_A_MONTH = 30;
/** The depth the estimate assumes: the deepest check, so the figure is an upper bound. */
const ESTIMATE_DEPTH = 100;
const PAGE_SIZE = 10;

export interface AddPlan {
  keywords: number;
  devices: 1 | 2;
  countries: number;
  /** Rank checks a day: keywords x devices x countries. */
  checksPerDay: number;
}

export function addPlan(input: { keywords: number; device: 'desktop' | 'mobile' | 'both' | null; countries: number }): AddPlan {
  const devices = input.device === 'both' ? 2 : 1;
  return {
    keywords: input.keywords,
    devices,
    countries: input.countries,
    checksPerDay: input.keywords * devices * input.countries,
  };
}

export function costOf(checksPerDay: number, perCheckUsd: number | null): { day: number; month: number } | null {
  if (perCheckUsd === null) return null;
  const day = checksPerDay * perCheckUsd;
  return { day, month: day * DAYS_A_MONTH };
}

/** The cost of one depth-100 check on the standard queue with the asynchronous AI Overview, from the price book. */
export function checkPriceUsd(prices: readonly Price[]): number | null {
  const serp = prices.filter((price) => price.endpoint === 'serp/google/organic');
  const standard = (price: Price): boolean => price.conditions?.['queue'] === 'standard';
  const page = serp.find((price) => price.price_unit === 'page' && standard(price));
  const task = serp.find((price) => price.price_unit === 'task' && standard(price) && price.conditions?.['async_ai_overview'] === true);
  if (page === undefined || task === undefined) return null;
  return Math.ceil(ESTIMATE_DEPTH / PAGE_SIZE) * Number(page.unit_price_usd) + Number(task.unit_price_usd);
}

/** The keywords in groups, so each request's items (keywords x countries) stay within the request limit. */
export function chunkKeywords<T>(keywords: readonly T[], countries: number): T[][] {
  const size = Math.max(1, Math.floor(BULK_CREATE_MAX_ITEMS / Math.max(1, countries)));
  const chunks: T[][] = [];
  for (let at = 0; at < keywords.length; at += size) chunks.push(keywords.slice(at, at + size));
  return chunks;
}
```

If `Price.conditions` is not indexable in the generated type, narrow it with a small `conditionOf(price, name)` helper and keep the same behaviour. `costOf(48, 0.0066)` is `{ day: 0.3168, month: 9.504 }` up to floating point: if the test fails on the last digit, use `toBeCloseTo` for both fields in the test.

- [ ] **Step 3: Run and commit**

Run: `pnpm vitest run src/features/rankings/add-keywords/add-plan.test.ts && pnpm lint && pnpm typecheck`

```bash
git add apps/web && git commit -m "Keywords: the arithmetic of adding in several countries"
```

---

### Task 6: Queries, the countries in use, the quota and the price

**Files:**
- Create: `apps/web/src/features/rankings/keyword-countries.ts` (hook `useKeywordCountries(scope)`), `apps/web/src/features/rankings/add-keywords/add-queries.ts` (`useTrackedKeywordQuota(scope, enabled)`, `useCheckPrice(scope, enabled)`)
- Test: `apps/web/src/features/rankings/keyword-countries.test.tsx`, `add-keywords/add-queries.test.tsx`

- [ ] **Step 1: Failing tests**

With the harness helpers the neighbouring query tests use (`renderHook` with the providers wrapper; see `rank-columns.test.tsx` and `strip/strip-queries` tests for the pattern): `useKeywordCountries` returns the mock's Germany and United States entries (`locationId`, `name`, `countryIso`, `keywordCount`); `useTrackedKeywordQuota` returns `{ limit: 5000, used: n }`; `useCheckPrice` returns about `0.0066` once the price book has loaded and `null` while it loads or when the call is refused (override the price-book handler with a 403 in one test).

- [ ] **Step 2: Implement**

```ts
// keyword-countries.ts
const COUNTRIES = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords/countries';

export interface KeywordCountry { locationId: number; name: string; countryIso: string; keywordCount: number }

export function useKeywordCountries(scope: ProjectScope): { countries: readonly KeywordCountry[]; loading: boolean } {
  const query = useQuery(apiQuery(COUNTRIES, { params: { path: { workspace_id: scope.workspaceId, project_id: scope.projectId } } }));
  const countries = useMemo(
    () => (query.data?.data ?? []).map((entry) => ({ locationId: entry.location.location_id, name: entry.location.name, countryIso: entry.location.country_iso, keywordCount: entry.keyword_count })),
    [query.data],
  );
  return { countries, loading: query.isPending };
}
```

Invalidate it where `refreshKeywords` (`rankings-queries.ts`) invalidates the list: add the countries key to that function so an add, archive or delete refreshes it (read `refreshKeywords` and extend it with the same `queryClient.invalidateQueries`). `add-queries.ts`: `useTrackedKeywordQuota` uses `apiQuery('/api/v1/workspaces/{workspace_id}/tracked-keyword-quota', ...)` with `enabled`; `useCheckPrice` uses `usePriceBook` from `features/costs/costs-queries.ts` (read lines 60 to 90 for its exact signature) filtered to `serp/google/organic`, passes the rows to `checkPriceUsd`, returns `null` while pending or on error. Both take `enabled` so nothing is read until the dialog opens.

- [ ] **Step 3: Run and commit**

Run: `pnpm vitest run src/features/rankings/keyword-countries.test.tsx src/features/rankings/add-keywords && pnpm lint && pnpm typecheck`

```bash
git add apps/web && git commit -m "Keywords: read the countries in use, the quota and the price of a check"
```

---

### Task 7: The Add dialog takes several countries

**Files:**
- Modify: `apps/web/src/features/rankings/add-keywords/add-keywords-dialog.tsx`, `add-keywords-result.tsx`
- Modify: `apps/web/messages/en.json` (`rankings.add`)
- Modify: `apps/web/src/components/ui/multi-select.tsx` only if its keyboard or label props cannot serve (it should not need changes: the country list is cached and filtered client side)
- Test: `apps/web/src/features/rankings/add-keywords/add-keywords.test.tsx`, `apps/web/src/test/keyword-defaults-add-keywords.test.tsx`

Behaviour (copy the mock, `kw-grouped-dialogs.js` `openAdd` and `countryPicker`):
- The "Location" single combobox becomes a "Countries" `MultiSelect<Country>` (items from `useCountries()`, `itemToString` the name, `itemKey` the location id), required (at least one), at most `MAX_ADD_COUNTRIES`; over the limit the field says "At most 10 countries in one add". The initial value is the project's default country (`defaults.location`; when that is a city, the country of its ISO code from `useCountries()`), falling back to the scope country the page opened on.
- Below the form fields, a plan panel (a `type-meta` block in the dialog body, no card): `12 keywords x 2 devices x 2 countries = 48 checks a day`, then `Up to $0.32 a day, $9.50 a month` (from `costOf`, formatted with `formatCurrency`, left out when `useCheckPrice` is `null`), then `Plan: 120 of 500 tracked keywords used, 168 after this add` (the figures are `used` and `limit` from `useTrackedKeywordQuota`; "after" is `used + checksPerDay`, since each check is one tracked keyword). Over the limit, the panel turns negative-toned with `Over the plan by N` and the submit button is disabled; the API still has the last word (`quota_exceeded`).
- Submit fans out: `chunkKeywords(read.keywords, countries.length)`; for each chunk (sequentially) one `bulk-create` with `items = chunk.flatMap(({ keyword }) => countries.map((country) => ({ ...sharedFields, keyword, location_id: country.location_id })))`. Results are merged with an index offset so `skipped` and `rejected` name the keyword and the country (`items[index]`). A `quota_exceeded` in chunk n stops the loop, keeps what earlier chunks added (counted in the outcome) and shows the quota sentence with the figures of the problem.
- The toast and the outcome say tracked keywords: `{count} keywords tracked` with the device wording already there (`both`), and the result list shows `keyword (Country)` for skipped and rejected lines.

- [ ] **Step 1: Failing tests (copy the existing patterns of `add-keywords.test.tsx`)**

Add, using `renderDialog` or the file's own helper and the `bulk-create` capture used in the existing "two tracked keywords of each" test (line ~54):
1. Two countries chosen (type "Ger", pick Germany, type "Uni", pick United States): the dialog shows `x 2 countries` and the checks a day for 3 pasted keywords on Desktop (`6 checks a day`), and the submit sends 6 items, three per `location_id` (2276 and 2840).
2. The cost line shows `Up to` a figure for those checks, and is absent when the price-book handler answers 403.
3. The plan line shows used and "after"; when the quota handler answers `{limit: 5, used: 3}` and the add is 6 checks, the panel says `Over the plan by 4` and the submit button is disabled.
4. With 11 countries picked the field shows the limit message and submit is disabled.
5. 250 keywords x 10 countries sends three requests (100, 100, 50 keywords: 1000, 1000, 500 items) and the toast counts all created rows.
6. A `quota_exceeded` on the second request keeps the first chunk's count in the outcome text and shows the quota sentence.
7. The existing test "disables Add until a location is chosen" becomes "until a country is chosen"; the existing quota test keeps working with one country.

Run: `pnpm vitest run src/features/rankings/add-keywords src/test/keyword-defaults-add-keywords.test.tsx`; expect FAIL.

- [ ] **Step 2: Implement**

Follow the behaviour list above. Form value `location: LocationRef | null` becomes `countries: Country[]`; the zod schema: `countries: z.array(z.custom<Country>()).min(1, { error: t('countriesRequired') }).max(MAX_ADD_COUNTRIES, { error: t('countriesTooMany', { max: MAX_ADD_COUNTRIES }) })`. Replace the `LocationCombobox` field with the `MultiSelect<Country>` field modelled on the tags field (same props: `chipsLabel`, `removeLabel`, `emptyText`, `...multiSelectHints`). Keep `useLocationSearch` out of this dialog (delete the import and the `locations` constant). Extract the submit loop into a pure async function `createInChunks({ chunks, countries, send })` in `add-plan.ts` (or a sibling `add-submit.ts`) so it is unit testable: it returns `{ created, restored, skipped, rejected, stoppedBy: ApiProblem | null }` with indices mapped to `{ keyword, country }`; keep the dialog's own code to wiring. Messages (`rankings.add`): `countries`, `countriesPlaceholder`, `countriesRequired`, `countriesTooMany`, `countriesEmpty`, `plan.checks` (`"{keywords} keywords x {devices} devices x {countries} countries = {checks} checks a day"` with plural rules as the existing `counter` message does), `plan.cost`, `plan.quota`, `plan.over`. No em-dashes. The `x` is the multiplication sign `×`.

- [ ] **Step 3: Run and commit**

Run: `pnpm vitest run src/features/rankings/add-keywords src/test && pnpm lint && pnpm typecheck && pnpm format:check`
Expected: pass.

```bash
git add apps/web && git commit -m "Keywords: add in several countries, with the checks, the cost and the plan before Add"
```

---

### Task 8: Country control, filter and column

**Files:**
- Modify: `apps/web/src/features/rankings/keyword-scope.tsx` (control lists the countries in use), `keyword-filters.ts` (a `country` field), `rankings-queries.ts` (`keywordFilters` mapping), `keyword-cache.ts` (`LOOKS_AT`), `bulk/bulk-target.ts` (`bodyFilterOf`), `keyword-columns.tsx` (Country column), `rankings-screen.tsx`
- Modify: `apps/web/messages/en.json` (`rankings.filters.country`, `rankings.columns.country`, `rankings.scope`)
- Test: `rankings-filters.test.ts`, `bulk/bulk-target.test.ts`, `keyword-cache` tests if present, `rankings.test.tsx`, `keyword-scope` tests if present

- [ ] **Step 1: Failing tests**

1. `bulk-target.test.ts`: `bodyFilterOf` carries `country_id` (the scope country; today it is dropped, so a bulk action on "all matching" reaches every country: fix this existing bug) and `country_id_in`.
2. `rankings-filters.test.ts`: values `{ country: ['2276', '2840'] }` map to `'filter[country_id_in]': [2276, 2840]` (copy the `intent` case; ids are integers, so read them with `idsOf` and `Number`, dropping non-integers, at most the shared `MAX_FILTER_VALUES`).
3. `rankings.test.tsx`: (a) the country control lists the mock project's countries in use (Germany and the United States) plus "All countries", and not Japan; (b) with `?loc=0` (all countries) a Country column shows with both countries, and with `?loc=2276` it does not; (c) choosing Germany and United States in the Filter bar's Country field sends `filter[country_id_in]=2276,2840` (capture requests as the test at line ~129 does) and shows one chip; (d) a project with no keywords shows its default country in the control and no "All countries".

- [ ] **Step 2: Implement**

- `keyword-scope.tsx`: `useKeywordScope(projectLocation, countries, opensOn)` takes the countries in use (from `useKeywordCountries`) instead of every country: the default is the project's own country when it is among them, else the one with most keywords, else `DEFAULT_COUNTRY_ID`. `KeywordScopeControls` lists those countries, and "All countries" only when there is more than one; with exactly one it renders a plain label (a non-interactive button-looking `span`, as the mock does). `useCountries()` stays for the Add dialog and export.
- `keyword-filters.ts`: a `country` field `{ id: 'country', kind: 'enum', label: t('country'), multi: true, options: countriesInUse.map(({ locationId, name, keywordCount }) => ({ value: String(locationId), label: name, count: keywordCount })), optionsLoading }` placed after `grp`; `useKeywordFilterFields` gains the countries-in-use argument (read its callers).
- `rankings-queries.ts` `keywordFilters`: `const countries = idsOf(values.country).map(Number).filter(Number.isInteger).slice(0, MAX_FILTER_VALUES);` and `...(countries.length === 0 ? {} : { 'filter[country_id_in]': countries })`.
- `keyword-cache.ts` `LOOKS_AT`: `'filter[country_id_in]': (row) => row.location_id` and make sure `'filter[country_id]'` is present too (the `satisfies` forces both).
- `bulk-target.ts` `bodyFilterOf`: `...given('country_id', filters['filter[country_id]']), ...given('country_id_in', filters['filter[country_id_in]'])`.
- `keyword-columns.tsx`: a `country` text column after `keyword`/`rank` (id `country`, header `t('country')`, width 120, priority 2, not sortable, `defaultVisible` true, cell: the country name by ISO from `useCountries()`, else `row.location.name`); `rankings-screen.tsx` drops it from `columns` unless the loaded rows hold more than one distinct `location.country_iso` (the mock's rule: `Country` shows only when more than one country is in view).
- The scope country and the chip both apply (no code: both are sent).

- [ ] **Step 3: Run and commit**

Run: `pnpm vitest run src/features/rankings src/test && pnpm lint && pnpm typecheck && pnpm format:check`
Expected: the only failures are the three known ones (rank trend sparkline test; two rank-strip tests).

```bash
git add apps/web && git commit -m "Keywords: country control from the countries in use, a Country filter and column, and the country kept in bulk actions"
```

---

### Task 9: End to end, docs, full checks

**Files:**
- Modify: `apps/web/e2e/flows/rankings.spec.ts`
- Modify: `docs/design-system/24-page-templates.md` ("As built" paragraph), `docs/08-seo-keyword-system.md` (3.1.1: a sentence on the quota read and the 1,000-item chunking), `docs/19-api-specification.md` (`country_id_in` and `GET .../tracked-keywords/countries` in section 3.6.x; find with `grep -n "filter\[country_id\]" docs/19-api-specification.md`)

- [ ] **Step 1: e2e**

Add one flow to `rankings.spec.ts`: open the Add dialog, paste two keywords, pick Germany and the United States, check the plan line text (`2 keywords × 1 devices × 2 countries = 4 checks a day`, with the device the dialog defaults to), add, and see the toast and the control now listing both countries. Run `pnpm e2e e2e/flows/rankings.spec.ts`. The four failures that existed before this work (Updated column counts at narrow widths, a Pending count) are not yours; report them separately.

- [ ] **Step 2: Docs**

Write the As built paragraph (what the dialog, control, filter and column do, the 10-country cap, the cost assumptions) and the two API rows. No em-dashes.

- [ ] **Step 3: Final checks**

Run `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build` in `apps/web`, and `./check.sh` in `backend`.

```bash
git add apps/web docs && git commit -m "Keywords: add in several countries, end to end and in the docs"
```

---

## Self-review

- **Spec coverage:** multi-select countries, cap 10, no Global (task 7); checks a day, cost and plan check before Add, refusal over quota (tasks 3, 5, 6, 7); fan-out keeps one tracked keyword per keyword x country x device (task 7, chunking in 5); all stored, filters to show them: country control from countries in use (tasks 2, 8), multi-value Country filter (tasks 1, 8), Country column when more than one country is in view (task 8); group counts of distinct keywords are the grouped plan's. The existing bug that bulk actions on "all matching" drop the country scope is fixed in task 8.
- **Placeholders:** none. Where a step says to copy a neighbouring test or hook ("copy the setup of the single-country test", "read `usePriceBook` lines 60 to 90"), the target is named by file and line and the behaviour is specified.
- **Type consistency:** `Country` is the existing `Location` type (`keyword-filters.ts:31`); `KeywordCountry` is the countries-in-use entry; `MAX_ADD_COUNTRIES`, `BULK_CREATE_MAX_ITEMS`, `addPlan`, `costOf`, `checkPriceUsd`, `chunkKeywords` are defined in task 5 and used in 7; `filter[country_id_in]` is `list[int]` in the API (task 1), `number[]` in `keywordFilters` and the body filter (task 8).
- **Known limits:** the cost is an upper bound (depth 100); a multi-request add is not atomic (a quota error in a later chunk leaves the earlier chunks added, and says so); the country list is the cached list of at most 1,000 countries filtered in the browser.
