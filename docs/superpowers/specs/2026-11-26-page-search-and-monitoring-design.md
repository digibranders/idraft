# Page search detail and Monitoring: design

Status: for the owner's review. Written 2026-11-26 on branch `claude/gsc-page-detail-monitoring-6f43c3`.
Related: [32-page-performance.md](../../32-page-performance.md) (the draft of 2026-10-27 this design reconciles with the approved mock), [18-first-party-integrations.md](../../18-first-party-integrations.md) section 4, [19-api-specification.md](../../19-api-specification.md) section 3.10, [20-frontend-specification.md](../../20-frontend-specification.md) section 5.5, the mock in `apps/web/design-preview/` (`perf*.js`, `il-drawer.js`), the Issues spec `2026-11-26-issues-page-design.md` (branch `claude/issues-page-8b4da8`, section 7.5 for the sidebar).

Plans: `docs/superpowers/plans/2026-11-26-page-search-and-monitoring-01-backend.md` and `-02-web.md`.

## 1. Summary

Two parts of Website audit > Pages.

**A. Search detail for every page.** The page drawer has a Search tab. For any live page of the project it shows Search Console clicks, impressions, CTR and average position for a period, the change against a compared period, a line per day, and the top queries, locations and devices. This design supplies the data and one component, `PageSearchPanel`, that the drawer shell renders in that tab.

**B. Monitoring.** A tab of Pages that lists the pages a team chose to track (at most 200 per project) with the same four numbers, their change, a health verdict and a trend, filtered by tier and searched by path or title. Two more sortable columns follow Average position (owner addition, 2026-11-26): Queries (how many different queries gave the page an impression, with the change) and Cannibalization (how many tracked keywords the page competes on with another page of the site). Queries is built; Cannibalization is specified here and its values are reserved for the Cannibalization work (D22). A row opens the page's search detail. Pages are added by pasting addresses or from a list of the pages with the most clicks.

No new data source and no provider cost: everything comes from the Search Console connection the project already has.

## 2. What exists today

| Piece | State |
|---|---|
| Search Console connection, property choice, daily pull | Built (`collectors/gsc_sync.py`, `gsc_plan.py`, `gsc_store.py`, `domain/gsc_pull.py`). Final data only. |
| Clicks and impressions per page and day | Built: `fp.gsc_page_daily`, one `[date, page]` call per final day, for the 28 days ending on the last final day, kept 35 days, only for addresses `core.urls` knows. No position is stored, though the call returns it. |
| Queries, locations, devices per page | Not collected. Shape B (`[date, query, country, device]`) has no page since 2026-11-05. |
| Call budgets | `collectors/gsc_limits.py`: 300 calls a minute per property, 600 per Google account, 20,000 for the installation, in the worker process. |
| Tier of a page | `core.project_pages.tier_id` (Internal links feature, read only for us). |
| Tracked pages | Nothing. Doc 32 section 7.3 drafted `core.watched_pages`. |
| Pages screen in the real app | Nothing on this branch. The Pages session (`claude/pages-overview-all-drawer-f3d1f7`) has no commits yet. |

## 3. Decisions

Each row has its reason. "Doc 32" marks where the 2026-10-27 draft is superseded.

| ID | Decision | Reason |
|---|---|---|
| D1 | Daily totals of every page come from the existing bulk call `[date, page]`. It now also stores `position_sum` (position times impressions) and the rows are kept 16 months. | The call already returns position, so it costs no extra call. One call a day covers every page of the property. |
| D2 | History before the bulk rows comes from one filtered call per page (`[date]`, the page filter of D4, 16 months, at most 487 rows). The worker makes it for tracked pages; the API makes it the first time a page's search detail is opened. A marker row says it was done. | The mock opens on the last full month against the month before, and the stored rows cover 35 days today. One call per page, once, is cheaper than re-pulling 459 days for the property, and it also serves a page that became known after its days were pulled. |
| D3 | Queries, locations and devices are not stored for all pages. They are fetched from Google for one page and one period (three calls: `[query]` asked for 25,000 rows and the top 100 kept, see D21; `[country]` top 50; `[device]`), then kept in `fp.gsc_page_breakdown`. Tracked pages get the last full month and the month before it fetched by the worker (the month before once, when the page is tracked; a later month reuses the stored month); any other page is fetched when its drawer asks. | Storing `[date, country, device]` per page (doc 32 shape D) for 5,000 pages is about 5,000 calls a day and gigabytes of rows (section 5.4). The Monitoring list has no location or device filter in this build, so nothing needs those rows per day. Doc 32 D-PP-4 (queries live and cached) now covers all three dimensions. |
| D4 | A page is filtered with `includingRegex` over the exact address strings Google reported for it. The bulk pull keeps those strings in `fp.gsc_page_forms`. A page with no stored string gets a pattern made from its canonical address: either scheme, with or without the trailing slash. | `canonicalize` folds several Google strings into one URL, and a page filter needs Google's own strings. The bulk pull sees them before it folds them, so keeping them is free. |
| D5 | The API process makes the on-demand calls itself, under its own small budget (60 calls a minute per property, 120 per Google account, per API process), and never waits for a token: with none left it answers `429 gsc_busy`. | The integrations service already reads the stored token and calls Google from the API. A drawer wants its answer in one request, and the worker's queue can be busy with a crawl. The worker keeps 300 a minute; Google allows 1,200 per property, so both fit. |
| D6 | Only final data. A period never ends after the last final day. | The pull stores final days only, so there is nothing provisional to hatch or exclude. Doc 32 D-PP-3 holds by construction; the "Include provisional days" switch is not built. |
| D7 | CTR is summed clicks over summed impressions. Average position is `sum(position_sum) / sum(impressions)` over the rows that carry a position. Neither is ever an average of daily values. | Google's definition (doc 18 section 10). |
| D8 | Tracked pages are a new table `core.tracked_pages (project_id, url_id)`. No groups, no archive flag. The tier shown and filtered is `core.project_pages.tier_id`. | The owner replaced Group by Tier. Removing a page deletes only this row; its numbers stay in `fp.*`, so adding it again shows its history at once. Doc 32 section 7.3 `core.page_groups` and `group_id` are dropped. |
| D9 | Only a page of the project can be tracked: it must have a row in `core.project_pages` (a crawl found it). | In the mock a tracked page is a crawled page: it has a tier, a title and a page drawer. A pasted address the crawl never saw answers "Not in the crawl". |
| D10 | The limit is 200 tracked pages per project, a constant (`TRACKED_PAGES_LIMIT`). | `WATCH_LIMIT` in the mock. The quota table of doc 32 section 9 is not needed for a constant. |
| D11 | Tracking and untracking need `projects:write`; reading needs `data:read`. No new permission key. | Setting a page's tier already uses `projects:write` (Internal links D15), on the same pages. Doc 32 D-PP-1 (`pages:write`) is dropped. To be confirmed by the owner (section 15). |
| D12 | The health verdict is the pure function `page_health_v1` of doc 32 section 6.1, computed by the API. Flags built: `position_slipped`, `position_improved`, `ctr_fell_impressions_rose`. | The list sorts and filters by it, so it must be one definition on the server. The other flags need data this build does not collect (section 13). |
| D13 | Period: the shared `DateRangePicker`, at most 92 days, ending on the last final day, opening on the last full calendar month. Compare with: previous period (default), same period last year, no comparison. A whole calendar month compares with the calendar month before it. | Doc 32 D-PP-7, with the picker the app already has. "Whole history" needs week and month buckets and a longer picker: not built. |
| D14 | The Monitoring list has no location, device, search type or query filter. Search type is Web. | Task scope: tier filter and search. These filters are what would force D3 the expensive way. |
| D15 | Routes live under the existing first-party prefix `{P}/fp/`: `tracked-pages` and `page-search`. | The pattern of `fp/ai-referrals`. Doc 32 section 8 `{P}/page-performance/*` is superseded. |
| D16 | `PageSearchPanel` is a component of the feature `features/page-search`. The route file composes it into the drawer shell through a slot. | A feature may not import another feature (lint boundary); a route may import several. |
| D18 | Numbers in these responses are plain values with `null` for not collected, not the `MetricValue` object of doc 19 section 2.6. | Every value here is the same kind (Search Console, first party, final, a census count), so the wrapper would repeat five constant fields on up to 1,600 numbers of a list. `fp/ai-referrals` made the same choice. Doc 19 section 3.10 gets a note. |
| D19 | A page's numbers and verdict are shown only once its history marker exists. Before that they are `null`. | Without the history the stored rows cover about 35 days, and a total or a verdict over part of a period would be wrong, not incomplete. |
| D20 | The period, the comparison, the ticked metrics and the open breakdown tab have their own address keys (`sp_win`, `sp_from`, `sp_to`, `sp_cmp`, `sp_m`, `sp_tab`), not the shared `win`, `from`, `to`. | The shared keys are the project's own period (project days, ending today). This period is in Search Console days and ends on the last final day; sharing the keys would make one control change the other. |
| D17 | Words follow the glossary: Tracked (never Monitored or Watched), Location (never Country), Period, Compare with, Not enough data, Not collected yet, Search Console (never GSC), Average position. "Monitoring" is only the tab's name. | `docs/glossary/final-list.md`. The mock and doc 32 still say "Low data", "No data", "Watch" and "Country" in places. |
| D21 | The Queries column is the number of different queries that gave the page an impression in the period. It is counted from the page-level query read (dimension `query`, page filter), asked with the maximum `rowLimit` of 25,000 in one request and never paged: the number of rows returned is the count. The top 100 rows are kept as before. The count is stored as `query_count` (integer) and `query_count_capped` (boolean, true when 25,000 rows came back, so the real number is at least that) on `fp.gsc_page_fetches`, the marker row of the query read for the page and period. It is a count of the queries Google reports: Google omits anonymized queries, so the real number is higher. Both periods are stored for the change (tracked pages already fetch the last full month and the month before, D3). | Counting without reading every row of every page needs one number per page and period, and the call that fetches the top 100 can return it for free: it is the same one call, only with a larger row limit. The marker is one row per page, period and kind, so the number is stored once; on `fp.gsc_page_breakdown` it would repeat on up to 100 key rows and a page with no query rows would have no place for its 0. Owner addition 2026-11-26; the owner's wording was "the breakdown cache table", read as the marker, which is where `row_count` and `truncated` of the same read already live. |
| D22 | The Cannibalization column is specified here but not implemented now. `GET {P}/fp/tracked-pages` returns `cannibalization: null` on every row (a reserved field, section 7.2) and the web does not draw the column while every row has `null`. The web builds the cell and its test now against the typed field, so the column appears the day the API fills it. | The Cannibalization backend does not exist in the real app: no Cannibalization tables, no page, and no join of a tracked keyword's rank to the page that ranks for it. The verdict rules (docs/33 and the mock's `analyse` in `canni-data.js`, `conflictsOfPath` at its end) cannot be run without inventing that backend, and it belongs to the Cannibalization work. The column, cell and tooltip are specified in section 10.1 so that work only fills the field. Owner addition 2026-11-26. |

## 4. Requirements

1. The Search tab works for every live page of the project, tracked or not, without any setup by the user.
2. A first open of a page that was never fetched shows its numbers within one request (about 1 to 3 seconds; a page with thousands of queries makes the query read slower, risk R8); a later open reads stored rows only.
3. Monitoring shows only tracked pages. It is table first: at 1280 by 720 the first row starts at about 29% of the screen height (section 10.1).
4. Numbers on Monitoring, in the drawer and in the All pages columns come from the same rows (`fp.gsc_page_daily`), so they agree.
5. Every state has a reason and a next step: not connected, first pull running, reconnect needed, no access to the property, Google busy, nothing collected for the page, no tracked pages.
6. No call to Google is made for a request that stored rows can answer.

## 5. Collection

### 5.1 The four reads of Google

| Read | Dimensions | Filter | Range | Row limit | When | Stored in |
|---|---|---|---|---|---|---|
| Bulk page totals (exists, changed) | `date, page` | none | one final day | 25,000 a call, paged | Daily pull, each newly final day | `fp.gsc_page_daily` (now with `position_sum`), `fp.gsc_page_forms` |
| Page history (new) | `date` | page (D4) | 16 months to the last final day | 25,000 (at most 487 rows come back) | Once per page: worker for tracked pages, API on first open | `fp.gsc_page_daily`, missing days only |
| Page breakdown (new) | `query`, then `country`, then `device` (three calls) | page (D4) | the period asked for | `query` 25,000 asked and 100 kept (D21), `country` 50, `device` 25 | Worker: the last full month and the month before it, for each tracked page. API: any page and period on demand | `fp.gsc_page_breakdown`; the query read's row count in `fp.gsc_page_fetches` |
| Probe (exists) | `date` | none | 16 months | none | Each pass | none |

All with `dataState: final`, search type `web`. The filtered reads use `aggregationType: auto`: Google refuses aggregation by property when a call groups or filters by page (to be confirmed against the first real call, section 15 R6).

A history row never replaces a bulk row: the insert skips days that exist, and only fills a missing `position_sum`. Google sorts a call's rows by clicks, so the first 100 rows of the query read are the top 100 by clicks.

The query read is one request with `rowLimit` 25,000, the most Google allows, and is never paged (`startRow` stays 0). The rows it returns are distinct queries, so their number is the page's query count for the period (D21). When exactly 25,000 rows come back the count is capped: `query_count_capped` is true and the real number is higher. Only the top 100 rows and the count are stored; the other rows are dropped as soon as they are counted.

### 5.2 Calls

| Event | Calls |
|---|---|
| Daily pull, totals of all pages | 0 more than today: 1 call per newly final day (2 when more than 25,000 pages had impressions that day) |
| A page's history | 1, once |
| A page's breakdown for one period | 3 (the query read is one call whatever its row limit, D21); with a compared period 6 |
| Opening the Search tab of a page never fetched | 3: the history, and the open breakdown tab for the period and the compared period. Each other tab opened: 2 more (7 in all) |
| Opening it again, or another person opening it | 0 |
| Tracking one page: the history (1), and the three dimensions of the last full month (3) and of the month before it (3). The month before is what the Queries change needs | 7, by the worker, once |
| Each month, per tracked page: the three dimensions of the month that just became final. The month before it is the stored last month of the pass before, so it is not fetched again | 3 |
| The Monitoring list and its Queries column | 0 (stored counts only) |

| Site | One-off | Each month | Each day |
|---|---|---|---|
| 400 pages, 40 tracked | 280 calls for the tracked pages (40 x 7; about 1 minute at 300 a minute); up to 7 per other page when someone first opens it (2,520 if all 360 are opened) | 120 (40 x 3) | 1 |
| 5,000 pages, 200 tracked | 1,400 calls for the tracked pages (200 x 7; 4.7 minutes of budget, so one or two passes); up to 7 per other page on first open (33,600 only if all 4,800 are opened) | 600 (200 x 3; 2 minutes) | 1 |

Recomputed for the Queries column (2026-11-26): the numbers above are the same as before the column. The month before was already part of tracking (7 calls, not 4), and asking the query read for 25,000 rows instead of 100 is still one call. What grows is the size of the query answers, not the number of calls:

| Site | Query calls, one-off | Largest answer volume, one-off | Each month |
|---|---|---|---|
| 400 pages, 40 tracked | 80 (40 pages x 2 months) | at most 300 MB (80 x 3.75 MB) | at most 150 MB (40 x 3.75 MB) |
| 5,000 pages, 200 tracked | 400 | at most 1.5 GB (400 x 3.75 MB) | at most 750 MB (200 x 3.75 MB) |

A full answer is 25,000 rows at about 150 bytes, 3.75 MB. Most pages have a few hundred queries, so the usual volume is a small fraction of these bounds. Nothing of it is stored but the top 100 rows and the count.

A pass has 5 minutes and 300 calls a minute, so at most 1,500 calls. The tracked-page work is resumable: each finished fetch writes its marker, and the next pass does what has no marker. A large query answer takes seconds, so the pass can run out of its 5 minutes before it runs out of calls; it then stops between pages and the next pass goes on (section 8).

The API's own budget of 60 calls a minute per property allows 20 never-fetched pages to be opened per minute per API process (8 if every tab of each is opened). Past that the panel shows "Google is busy" and retries.

### 5.3 Rows and bytes

Upper bounds: a row exists only for a page-day with impressions. Sizes are heap row (24 header, 4 pointer, columns) plus index entries.

| Table | Bytes a row | Rows a page | Bytes a page |
|---|---|---|---|
| `fp.gsc_page_daily` (2 indexes) | about 210 | at most 487 for 16 months | at most 102 KB |
| `fp.gsc_page_breakdown` (1 index) | about 230 | at most 153 a period (100 queries, 50 locations, 3 devices); about 50 is usual | at most 35 KB a period, about 12 KB usual |
| `fp.gsc_page_forms` | about 150 | 1 to 3 | under 1 KB |
| `fp.gsc_page_fetches` | about 130 (with the query count and its flag) | 1 history, 3 a period | under 1 KB a period |

| Site | Daily totals, 16 months | Breakdowns of tracked pages, a year | Breakdowns on demand (kept 30 days) |
|---|---|---|---|
| 400 pages, 40 tracked | at most 41 MB; about 12 MB when 30% of page-days have impressions | at most 17 MB (40 x 12 x 35 KB); about 6 MB usual | at most 25 MB if every other page is opened with a comparison |
| 5,000 pages, 200 tracked | at most 511 MB; about 153 MB at 30% | at most 84 MB; about 29 MB usual | at most 336 MB if all 4,800 are opened in 30 days; about 34 MB if 10% are |

### 5.4 Why not store the breakdown per day for every page

Doc 32 shape D is `[date, country, device]` filtered to one page. For 5,000 pages that is 5,000 calls for each day's refresh, 17 minutes of the property's budget every day, and about 5,000 x 487 x 8 rows (2 locations by devices a day is optimistic) at 180 bytes: over 3 GB a property. For 200 tracked pages it is affordable (200 calls a day, about 140 MB), and it is the upgrade to take if the owner wants location and device filters on the Monitoring list (section 15, Q2).

### 5.5 Retention

- `fp.gsc_page_daily`: rows older than 16 months are deleted by the daily pull, except rows of tracked pages, which are kept. `PAGE_KEEP_DAYS` (35) goes away.
- `fp.gsc_page_breakdown` and its markers: a fetch older than 30 days is deleted unless its page is tracked and its period is a whole calendar month. So a tracked page keeps its query history month by month, beyond Google's 16 months. The query count lives in the marker, so it is kept and pruned with it.

## 6. Schema

One Alembic revision (the next free number after the newest on `origin/develop` when the task is built; 0041 was the newest). It is built as `0042_page_search.py` and, being unpushed, is amended in place by plan 01 task 2b for the query count (D21), the grants below, the count and date checks, and a downgrade that revokes the grants it added on `fp.gsc_page_daily`. SQL in the style of `0041_ai_referrals.py`: `statements`, `tenant_isolation`, `grants` from `idraft.db.ddl`.

```sql
ALTER TABLE fp.gsc_page_daily ADD COLUMN position_sum numeric(14,2);  -- position x impressions; NULL on rows stored before this revision

CREATE TABLE fp.gsc_page_forms (
    integration_id uuid NOT NULL,
    url_id         bigint NOT NULL REFERENCES core.urls(id),
    page           text NOT NULL,          -- the address exactly as Search Console returned it
    workspace_id   uuid NOT NULL,
    last_seen      date NOT NULL,
    PRIMARY KEY (integration_id, url_id, page),
    FOREIGN KEY (integration_id, workspace_id) REFERENCES fp.integrations(id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE fp.gsc_page_fetches (
    integration_id uuid NOT NULL,
    url_id         bigint NOT NULL REFERENCES core.urls(id),
    kind           text NOT NULL CHECK (kind IN ('history','query','country','device')),
    date_from      date NOT NULL,
    date_to        date NOT NULL,
    workspace_id   uuid NOT NULL,
    project_id     uuid NOT NULL,
    row_count      integer NOT NULL CHECK (row_count >= 0),  -- rows stored (at most 100 for kind 'query')
    truncated      boolean NOT NULL DEFAULT false,   -- more rows came back than were stored (the row limit for country and device; 100 for query)
    query_count    integer,                          -- kind 'query' only: rows Google returned, the page's distinct queries it reports (D21)
    query_count_capped boolean NOT NULL DEFAULT false, -- the call returned its 25,000 row limit: query_count is a lower bound
    fetched_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (integration_id, url_id, kind, date_from, date_to),
    CHECK (date_from <= date_to),
    CHECK ((kind = 'query') = (query_count IS NOT NULL)),
    CHECK (query_count IS NULL OR query_count >= 0),
    FOREIGN KEY (integration_id, workspace_id) REFERENCES fp.integrations(id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE fp.gsc_page_breakdown (
    integration_id uuid NOT NULL,
    url_id         bigint NOT NULL REFERENCES core.urls(id),
    date_from      date NOT NULL,
    date_to        date NOT NULL,
    dimension      text NOT NULL CHECK (dimension IN ('query','country','device')),
    key            text NOT NULL,          -- the query text, the ISO 3166-1 alpha-3 code in upper case, or DESKTOP, MOBILE, TABLET
    workspace_id   uuid NOT NULL,
    project_id     uuid NOT NULL,
    clicks         integer NOT NULL CHECK (clicks >= 0),
    impressions    integer NOT NULL CHECK (impressions >= 0),
    position_sum   numeric(14,2) NOT NULL,
    PRIMARY KEY (integration_id, url_id, date_from, date_to, dimension, key),
    CHECK (date_from <= date_to),
    FOREIGN KEY (integration_id, workspace_id) REFERENCES fp.integrations(id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE core.tracked_pages (
    project_id   uuid NOT NULL,
    url_id       bigint NOT NULL REFERENCES core.urls(id),
    workspace_id uuid NOT NULL,
    added_by     uuid,                     -- the user, as core.project_pages.set_by
    added_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, url_id),
    FOREIGN KEY (project_id, workspace_id) REFERENCES core.projects(id, workspace_id) ON DELETE CASCADE
);
```

Row-level security (`tenant_isolation`) on the four new tables. Grants:

| Table | API role | Worker role |
|---|---|---|
| `fp.gsc_page_daily` (existing: API SELECT; worker SELECT, INSERT, DELETE) | adds INSERT, UPDATE | adds UPDATE |
| `fp.gsc_page_forms` | SELECT | SELECT, INSERT, UPDATE |
| `fp.gsc_page_fetches`, `fp.gsc_page_breakdown` | SELECT, INSERT, UPDATE, DELETE | SELECT, INSERT, UPDATE, DELETE |
| `core.tracked_pages` | SELECT, INSERT, DELETE | SELECT |

UPDATE on the two fetch tables is needed because the stores write with `INSERT ... ON CONFLICT DO UPDATE` (two first opens of one page at the same moment must not fail on each other), which Postgres checks as an UPDATE privilege. Revision 0042 as first built granted SELECT, INSERT and DELETE only; plan 01 task 2b corrects it.

The query text is stored as the key, not as a hash into `fp.gsc_queries`: at most 100 short strings a page and period, and the API then needs no write on a table the worker owns. Query text is customer data: it is never logged.

## 7. API

`{P}` is `/api/v1/workspaces/{workspace_id}/projects/{project_id}`. Url ids are strings, as everywhere in this API. Numbers are plain values; `null` means not collected, never zero. No English in a response: verdicts and flags are codes.

### 7.1 Shared parts

`from`, `to`: Pacific Time days, both included, at most 92 days (`422 window_too_large`), `to` not after the last final day (it is cut to it). Both absent: the last full calendar month that ends on or before the last final day.
`compare`: `previous_period` (default on these routes), `previous_year`, `none`.

```json
"meta": {
  "state": "ok",
  "property": "sc-domain:eventussecurity.com",
  "final_through": "2026-11-22",
  "window": { "from": "2026-10-01", "to": "2026-10-31", "days": 31 },
  "compare_window": { "from": "2026-09-01", "to": "2026-09-30", "days": 30 }
}
```

`state`: `ok`; `pending` (connected, the first 28 days are not stored yet); `not_connected`; `reauth_required` (stored numbers are still served, no call to Google is made); `no_access` (Google refused the property; stored numbers are served). With `not_connected` or `pending` every number is `null` and `final_through`, `window` and `compare_window` are `null`.

```json
"current":  { "clicks": 317, "impressions": 41200, "ctr": 0.0077, "position": 5.9 },
"previous": { "clicks": 412, "impressions": 39600, "ctr": 0.0104, "position": 3.8 },
"health":   { "verdict": "declining", "basis": "clicks", "change": -0.2554, "absolute": -108.7, "small": false,
              "flags": ["position_slipped"] }
```

`change` is the relative change of the basis metric per day; `absolute` is its difference scaled to the current period's length. `previous` is `null` with `compare=none`, or when the compared period starts before the page's first stored day.

### 7.2 Routes

| Method | Path | Permission | What |
|---|---|---|---|
| GET | `{P}/fp/tracked-pages` | `data:read` | Every tracked page (at most 200, no paging) with its numbers for the period |
| GET | `{P}/fp/tracked-pages/ids` | `data:read` | `{ "data": ["812", "907"], "meta": { "limit": 200 } }`: for the Tracked column of All pages |
| POST | `{P}/fp/tracked-pages` | `projects:write` | Track pages, by address or by url id; `dry_run` checks without writing |
| POST | `{P}/fp/tracked-pages/remove` | `projects:write` | Stop tracking |
| GET | `{P}/fp/tracked-pages/suggestions` | `data:read` | The 25 untracked pages of the project with the most clicks in the last 28 final days, from stored rows |
| GET | `{P}/fp/page-search/{url_id}` | `data:read` | One page: totals, health and the daily series |
| GET | `{P}/fp/page-search/{url_id}/breakdown` | `data:read` | One page and dimension: the rows now and before |

Every route answers `404 not_found` for a project outside the workspace. The two `page-search` routes answer `404 not_found` for a url id that is not a page of the project (`core.project_pages`).

**`GET {P}/fp/tracked-pages?from&to&compare`**

```json
{
  "data": [
    {
      "url_id": "812",
      "url": "https://eventussecurity.com/pricing",
      "path": "/pricing",
      "title": "Pricing",
      "tier_id": "5e0c2b1e-0000-4000-8000-000000000001",
      "added_at": "2026-11-20T09:12:00Z",
      "history": "ready",
      "current": { "clicks": 317, "impressions": 41200, "ctr": 0.0077, "position": 5.9 },
      "previous": { "clicks": 412, "impressions": 39600, "ctr": 0.0104, "position": 3.8 },
      "health": { "verdict": "declining", "basis": "clicks", "change": -0.2554, "absolute": -108.7, "small": false, "flags": ["position_slipped"] },
      "queries": { "value": 1240, "previous": 1105, "capped": false },
      "cannibalization": null,
      "trend": [12, 9, 14, 11]
    }
  ],
  "meta": { "state": "ok", "property": "sc-domain:eventussecurity.com", "final_through": "2026-11-22",
            "window": { "from": "2026-10-01", "to": "2026-10-31", "days": 31 },
            "compare_window": { "from": "2026-09-01", "to": "2026-09-30", "days": 30 },
            "limit": 200, "tracked": 41 }
}
```

`history` is `ready` once the page's history marker exists, else `loading` (the worker fetches it within about a minute). A `loading` row has `current`, `previous`, `health` and `trend` as `null` (D19). `trend` is the clicks of each day of the period. `title` is the page's title in the latest finished crawl, or `null`. `tier_id` is `null` for Untiered. Rows come ordered by path; the web sorts, filters by tier, health and search text itself (at most 200 rows).

`queries` (D21) is read from the stored `query` markers of `fp.gsc_page_fetches`, never from Google, and only for a period that has a marker with exactly that window (the worker stores whole calendar months for tracked pages; the drawer stores the period it was opened on):

- `value`: `query_count` of the current window, the number of different queries that gave the page an impression, as Google reports them (it omits anonymized queries). `queries` is `null` when the current window has no marker. That is "not collected yet" and is never shown as 0; a stored 0 is a real 0 (Google returned no query rows).
- `previous`: `query_count` of the compared window, `null` with `compare=none`, when the compared window has no marker, or when its count was capped.
- `capped`: true when `value` is the 25,000 row limit, so the real number is at least that. A capped `previous` is returned as `null` instead, because the change against a lower bound would be wrong. Most pages never reach the cap.
- The change shown beside the value is `value - previous`, absolute, with no percent. More queries is good news.

`cannibalization` is reserved (D22). It is `null` on every row today and the web hides the column while all rows have `null`. The shape the Cannibalization work fills in, in the contract now so the web can be typed against it: `{ "keywords": 3, "likely": 1, "co_ranking": 1, "unstable": 1 }`, where `keywords` is the number of tracked keywords on which the page and another page of the same site compete (the verdicts likely, co_ranking and unstable of docs/33 and `analyse` in the mock's `canni-data.js`; `likely + co_ranking + unstable` equals `keywords`, and `keywords` is 0 for a page that competes on none). A page the keyword checks never see has `keywords: 0`, not `null`; `null` means the feature is not filling the field. The counting window and device are those of the Cannibalization page's own default, decided by that work.

**`POST {P}/fp/tracked-pages`**

```json
{ "urls": ["/pricing", "https://eventussecurity.com/blog/soc-guide", "https://other.example/x"], "url_ids": [], "dry_run": false }
```

`urls` (at most 500) and `url_ids` (at most 500) may both be given. A path is read against the project's website. Answer `200`:

```json
{
  "data": [
    { "input": "/pricing", "outcome": "added", "url_id": "812", "path": "/pricing", "clicks_28d": 1240 },
    { "input": "https://eventussecurity.com/blog/soc-guide", "outcome": "already_tracked", "url_id": "907", "path": "/blog/soc-guide", "clicks_28d": 88 },
    { "input": "https://other.example/x", "outcome": "wrong_host", "url_id": null, "path": null, "clicks_28d": null }
  ],
  "meta": { "limit": 200, "tracked": 42, "added": 1 }
}
```

Outcomes: `added` (with `dry_run`: `ok`), `already_tracked`, `invalid_url`, `wrong_host`, `not_crawled` (no row in `core.project_pages`), `over_limit` (the 200 are full; inputs are taken in order). `clicks_28d` is from stored rows, `null` when none. An audit row `tracked_page.add` is written per request that added something.

**`POST {P}/fp/tracked-pages/remove`**: body `{ "url_ids": ["812", "907"] }` (at most 200), answer `{ "data": { "removed": 2 } }`, audit `tracked_page.remove`.

**`GET {P}/fp/tracked-pages/suggestions`**: `{ "data": [{ "url_id": "933", "url": "...", "path": "/services/soc", "title": "SOC as a service", "clicks_28d": 410, "impressions_28d": 22100 }], "meta": { "state": "ok" } }`.

**`GET {P}/fp/page-search/{url_id}?from&to&compare`**

```json
{
  "data": {
    "url_id": "812", "url": "https://eventussecurity.com/pricing", "path": "/pricing", "title": "Pricing",
    "tier_id": null, "tracked": true,
    "current": { "clicks": 317, "impressions": 41200, "ctr": 0.0077, "position": 5.9 },
    "previous": { "clicks": 412, "impressions": 39600, "ctr": 0.0104, "position": 3.8 },
    "health": { "verdict": "declining", "basis": "clicks", "change": -0.2554, "absolute": -108.7, "small": false, "flags": ["position_slipped"] },
    "series": [ { "date": "2026-10-01", "clicks": 12, "impressions": 1410, "position": 5.4 } ],
    "previous_series": [ { "date": "2026-09-01", "clicks": 15, "impressions": 1320, "position": 3.9 } ]
  },
  "meta": { "state": "ok", "property": "sc-domain:eventussecurity.com", "final_through": "2026-11-22",
            "window": { "from": "2026-10-01", "to": "2026-10-31", "days": 31 },
            "compare_window": { "from": "2026-09-01", "to": "2026-09-30", "days": 30 },
            "history_from": "2025-07-28" }
}
```

The series has one point for every day of the period. A day without a row has clicks 0, impressions 0 and position `null`. `history_from` is the first day the page's history covers, `null` before the history was fetched. With `state: ok` and no history marker, this request makes the history call first (D2). If that call cannot be made (our budget is spent, Google is busy or does not answer, or the state is not `ok`), the response is still `200`, with `history_from: null`, `current`, `previous` and `health` as `null` and both series empty (D19), and `meta.retry_after` in seconds when trying again can help. The panel shows "Google is busy" with Retry.

**`GET {P}/fp/page-search/{url_id}/breakdown?dimension=query|country|device&from&to&compare`**

```json
{
  "data": [
    { "key": "IND", "current": { "clicks": 88, "impressions": 9000, "ctr": 0.0098, "position": 6.2 },
                    "previous": { "clicks": 201, "impressions": 9400, "ctr": 0.0214, "position": 3.1 } },
    { "key": "USA", "current": { "clicks": 120, "impressions": 14100, "ctr": 0.0085, "position": 5.7 }, "previous": null }
  ],
  "meta": { "state": "ok", "dimension": "country",
            "window": { "from": "2026-10-01", "to": "2026-10-31", "days": 31 },
            "compare_window": { "from": "2026-09-01", "to": "2026-09-30", "days": 30 },
            "row_limit": 50, "truncated": false, "coverage": 0.88, "fetched_at": "2026-11-26T10:02:11Z" }
}
```

Rows are the union of both periods' keys, ordered by current clicks, then previous clicks. `current` or `previous` is `null` for a key outside that period's stored rows (for queries: outside its top 100). `coverage` is the stored rows' clicks over the page's clicks for the period (`null` when the page had none): the rest are queries Google does not report, or rows past the limit. A period with no marker is fetched (D3) and stored in the same request; `state` other than `ok` answers `200` with stored rows only. For `dimension=query` the fetch asks Google for 25,000 rows, stores the top 100 and the count (D21); `row_limit` is the 100 kept and `truncated` is true when more queries came back than were kept.

Errors of the two live paths: `429 gsc_busy` with `retry_after` (seconds; our budget or Google's quota), `503 google_unavailable`. A refused token (`invalid_grant`) or a refused property answers `200` with stored rows and `state: reauth_required` or `no_access`. The API does not write that state: the worker's next pass records it, as today.

## 8. Worker

In each pass of a property (`gsc_sync._Pass.run`), as its last step:

The step runs after the query history sweep of the pass, so a failing page can never hold the property's own pull back.

1. For each tracked page of the project without a `history` marker: the history call, then the marker.
2. For each tracked page: the breakdown of the last full calendar month and of the month before, where a marker is missing. The query read of each asks for 25,000 rows and stores the top 100 and the count (D21). A page tracked now gets both months; a month later only the new month is missing, so the month before costs nothing again (3 calls a month, section 5.2).
3. Prune (section 5.5).

Each step checks the pass budget between pages and stops cleanly. An answer Google gives for one page that cannot be used, or no answer, is logged and that page is skipped; the other pages go on, and the pass then ends as failed, so the planner waits (15, 30, 60 minutes) before it tries the skipped page again. A quota error, a refused token or a refused property ends the pass at once, as today. The planner (`gsc_plan._send_unfinished`) also sends a property that has a tracked page without a history marker, so a page added now is fetched at the next tick, not the next morning. A Google error ends the pass the way it does today (backoff through `PullState.failed`).

## 9. Freshness and states

| State | Monitoring | Search tab |
|---|---|---|
| `not_connected` | Empty state: "Connect Search Console to see how your pages perform", with a link to Integrations for a member with `integrations:manage`; others read "Ask an owner or admin to connect Search Console". Tracked pages are not listed. | The same sentence, compact. |
| `pending` | Banner "Search Console is loading the last 28 days." Rows listed with skeleton numbers. | "Not collected yet. The first numbers arrive within minutes." |
| `reauth_required` | Warning banner "Search Console needs a new sign-in. The numbers below stop at {date}." with a link to Integrations. Stored numbers shown. | The same banner in the panel. Stored numbers and stored breakdowns shown; a breakdown never fetched reads "Not collected yet". |
| `no_access` | Warning banner "This Google account can no longer read the property." Stored numbers shown. | Same. |
| No tracked pages | Empty state "Add the pages that matter", the limit of 200, and the Add pages button (with `projects:write`). | Does not apply. |
| A row's history is `loading` | Skeleton cells in that row; it is left out of the Health counts and sorts last; the list refetches every 10 seconds while any row is loading. | Does not apply (the panel's own request fetches it). |
| Page has no impressions in the period | Health "Not collected yet"; numbers 0; position and CTR "n/a" with the reason in a tooltip. | Sentence "Google reported no impressions for this page in this period." |
| `429 gsc_busy` | Does not happen (no live call). | Inline "Google is busy. Trying again in {seconds} s." with a Retry button, in the section that failed. Other sections stay. |
| `503 google_unavailable` | Does not happen. | Inline error with Retry in the section that failed. |
| Compared period before the first stored day | Change cells read "Not collected yet". | Same in the tiles; the previous line is not drawn. |
| A row has no stored query count for the period (`queries: null`): a period that is not a whole calendar month and was never opened in the drawer, or a tracked page whose month is not fetched yet | The Queries cell reads "Not collected yet" in quiet text, never 0, and sorts last. | Does not apply. |
| `queries.previous` is `null`, or `queries.capped` is true | The Queries value is shown and no change; a capped value reads "25,000+" with a tooltip that Google returned its limit. | Does not apply. |
| Every row has `cannibalization: null` (today, D22) | The Cannibalization column is not drawn, and its sort key does nothing. | Does not apply. |
| No `data:read` | The no access empty state, as Internal links. | The shell does not open the drawer. |
| No `projects:write` | Add pages and Stop tracking are absent. | Does not apply. |

The line "Final data to {date}, Pacific Time" is the freshness note on both screens.

## 10. Screens

### 10.1 Monitoring (table first)

Route `/[workspace]/[project]/seo/pages/monitoring`. A fixed-height page (template T2): the rows scroll inside the table, the header is pinned.

```
+------------------------------------------------------------------------------------------------+
| [Overview][All pages][Monitoring]  eventussecurity.com, final data to Nov 22   [Export] [Add pages] |  row 1, 36 px
| Period [Oct 2026 v] Compare with [vs previous period v] Tier [All v] [Health: All 41 | Lost 1 | Sharp drop 3 | ...]  [Search pages] |  row 2, 32 px
| [ ] Page                 Tier  Health      Clicks        Impressions    CTR         Average position  Queries    Cannibalization  Trend |
| [ ] /pricing             T1    Declining   317  -25.5%   41.2K  +0.7%   0.8% -0.3   5.9  slipped 2.1   1,240 +135  [3 keywords]    ~~  |
```

Pixel budget at 1280 by 720: top bar 52, page padding 12, row 1 36, gap 12, row 2 32, gap 12, table header 40. The first row starts at 196 px, 27% of 720. Nothing else may sit above the table: the mock's summary line is folded into row 2 as the Health group with counts, and its sentence about the ranges is the tooltip of the Period control. A banner (section 9) is the one thing that may add a row, and only in its state. The bulk bar replaces row 2 while rows are selected (the `DataTable` bulk bar).

- Row 1: the tab strip is a slot the route fills (section 11); the context line (property and freshness); Export CSV (the rows as shown, with Queries and, when drawn, Cannibalization); Add pages (primary).
- Row 2: the period scope (`DateRangePicker` and the Compare with select), then the shared `FilterBar` with two fields, Tier (All tiers, each tier, Untiered) and Health (each verdict that occurs, with its count), then the search box (path or title, not in the address). The period sits in the page, not in the top bar, as on Citations and the AI visibility overview: it is not the project's period (D20). This is the recorded exception to UI rule 8.
- Columns: select, Page (path, the title under it, the full address in the tooltip), Tier (`TierBadge`), Health (badge), Clicks, Impressions, CTR, Average position (each: value and change; position says "improved" or "slipped"), Queries, Cannibalization, Trend (sparkline of daily clicks, from 1440 px). There is no Indexing column (section 13). In every metric cell, and in Queries, the change is set in a smaller font size than the value beside it (owner, 2026-11-26).
- **Queries** (D21): the number of different search queries that gave the page an impression in the period, from `queries.value`, with the change against the compared period beside it from `value - previous`: "+12" in the positive tone when it grew, "-5" in the negative tone when it fell, nothing when equal. More queries is good, so growth is never negative. The change has the tooltip "{previous} queries in the period before". An unknown value reads "Not collected yet" (section 9), a capped one "25,000+" with no change. The header tooltip says: "Different search queries that gave this page an impression in the period. Counts the queries Google reports: it leaves out anonymized queries, so the real number is higher." Sortable by `queries.value`; rows without a value sort last in both directions.
- **Cannibalization** (D22): per tracked page, the number of tracked keywords it competes on with another page of the same site, from `cannibalization`. The cell is a badge "N keywords" ("1 keyword"), warning tone when `likely` is at least 1 and neutral otherwise, and it is a button that opens the Cannibalization page of the project; the click does not open the row's detail. Zero keywords reads "None" in quiet text, with no badge. The tooltip splits the count: "Competes with another of your pages on 3 tracked keywords: 1 likely, 1 co-ranking, 1 unstable. Opens Cannibalization." (parts with a zero are left out). The verdicts are those of the Cannibalization page: likely (two or more of the site's pages swap the best rank, and the keyword ranks 3 or more places worse when the other page is the one that ranks), co-ranking (two pages are both in the top 20 on at least half of the checks; often fine) and unstable (the ranking page changes often but the rank does not get worse). Sortable by `likely * 100 + keywords`, rows with `null` last. The column is drawn only when at least one row has a non-null `cannibalization`, so today it is not drawn. Not built now: the values (section 13).
- Sideways scroll: at 1280 by 720 the table is about 170 px wider than its panel with the two new columns, so it scrolls sideways. The select column and the Page column stay pinned at the left while it does. `DataTable` already does this: its select column and its identity column are sticky left (`stickyLeft`), the identity column pinned while it leaves at least 360 px for the other columns (`PIN_LEAVES_ROOM`). The Page column is the identity column, so no component work is needed. Queries and Cannibalization have the same priority as Clicks, so they are not hidden at a narrow width; they scroll.
- Default sort: attention first (Lost traffic, Sharp drop, Declining by clicks lost, Stable, Growing, New, Not collected yet, Not enough data). Any column sorts; the address keeps it.
- Row click or Enter opens the page's search detail in the inspector (section 10.3). Bulk: Stop tracking, Export selection.
- Address state: `sp_win` or `sp_from` and `sp_to`, `sp_cmp`, the `FilterBar` keys of Tier and Health, `sort`, `inspect`.

### 10.2 Add pages

A dialog with two tabs.

- **Paste addresses.** A text area (one per line, at most 500; paths or full addresses of the project's website), a Check pages button (the `dry_run` request), then one line per input with its outcome: "Found, 1,240 clicks in 28 days", "Already tracked", "Not on {host}", "Not a valid address", "Not in the crawl", "Over the limit of 200 pages".
- **Suggested from Search Console.** The suggestions list with checkboxes: path, clicks and impressions in 28 days.

Footer: "{n} of 200 pages tracked", Cancel, "Add {n} pages". After adding: a toast, the list refetches, new rows show skeleton numbers until their history is ready. The mock's "From a sitemap" tab is not built.

### 10.3 Search detail (`PageSearchPanel`)

The panel is content for the shared `Inspector` (`apps/web/src/components/app/inspector/`), never a drawer of its own. The shared drawer is an overlay with one saved width for the whole app (480 px to 960 px, 640 px by default, a full-width sheet below 900 px; branch `claude/shared-drawer-121ede`). So the panel sets no width, lays out from its container width (one column at 480 px), and the table behind it does not shrink. Top to bottom:

1. Controls: Period and Compare with (the same two controls as Monitoring).
2. Verdict: the health badge and one sentence built from the codes and numbers ("Clicks are down 26% (412 to 317) against Sep 1 to Sep 30."), then one sentence per flag.
3. Four tiles (a `MetricStrip`): Clicks, Impressions, CTR, Average position, each with the value now, the value before and the change. A row of four toggles under it picks the metrics that are drawn (default Clicks and Impressions, at least one).
4. Over time: one line chart (`ChartFrame`, 140 px) per ticked metric, this period solid and the compared period dashed, aligned by day number. Position is drawn inverted. Chart and Table views as every chart.
5. What changed: tabs Queries, Locations, Devices. A compact table: name, now, before, change of the first ticked metric. Under Queries: "The queries shown cover {percent} of this page's clicks. Google does not report the rest."
6. Note: "Search Console, web search. Days are Pacific Time. Final data to {date}."

A page that is not live (status other than 200) shows one line instead: "Only a page that answers 200 has search data." The shell knows the status and passes it.

## 11. The join with the Pages session

The Pages session owns the Pages tabs (Overview, All pages), the page drawer shell and the sidebar item. This build never edits its files.

| What | Who provides | How |
|---|---|---|
| Search tab content | This build | `import { PageSearchPanel } from '@/features/page-search'`. Props: `{ workspaceId: string; projectId: string; workspaceSlug: string; projectSlug: string; urlId: string; statusCode: number | null; timeZone: string }`. The route file passes it to the shell as a render prop, for example `searchTab={(page) => <PageSearchPanel ... urlId={page.urlId} statusCode={page.statusCode} />}`. |
| Monitoring tab | This build | `MonitoringScreen` from the same feature, at the route file `src/app/[workspace]/[project]/seo/pages/monitoring/page.tsx`, the only file this build creates under `seo/pages/`. It has a `tabs?: ReactNode` prop: the Pages session's tab strip goes there (from a `seo/pages/layout.tsx` or passed by the route). |
| The drawer itself | The shared-drawer session | `Inspector`, `InspectorLayout`, `useInspector` (`?inspect=type:id`) and `useInspectorStepping` (`src/lib/inspector`). Used as they are; their files are never edited, and no drawer or width is added here. |
| Opening a page from Monitoring | This build now, the shell later | Until the shell exists, Monitoring opens the shared `Inspector` through `useInspector` (`?inspect=page:<url id>`) with `PageSearchPanel` as its content, and steps through the rows with `useInspectorStepping`. `MonitoringScreen` takes `onOpenPage?: (urlId: string) => void`; when given, a row calls it instead, so the route can open the shell's drawer on its Search tab. |
| Tracked column and "Track in Monitoring" on All pages | The Pages session, with this build's API | `GET {P}/fp/tracked-pages/ids` and `POST {P}/fp/tracked-pages` with `url_ids`. The feature exports `useTrackedIds(scope)` and `useTrackPages(scope)` for it. |
| Address keys of the panel | This build | `sp_win`, `sp_from`, `sp_to`, `sp_cmp`, `sp_m`, `sp_tab`, exported as `PAGE_SEARCH_KEYS`. None is used by another screen today (checked against `use-date-range-params.ts`, `use-inspector.ts` and the internal links address state). The shell passes them to `useInspector({ entryKeys })`, so closing the drawer removes them. On Monitoring the four period keys belong to the page and stay. |
| Cannibalization column | This build (cell and field), the Cannibalization work (values and page) | The cell takes an `href` the screen builds from `src/lib/navigation` when that module has a Cannibalization route, else `null` (the badge is then plain text). The Cannibalization work fills `cannibalization` in `GET {P}/fp/tracked-pages` and changes nothing in the web. |
| Sidebar | Issues and Pages sessions | Not touched here. |

## 12. Words (i18n)

All strings go in `apps/web/messages/en.json`. New words go to `docs/glossary/terms.md` and `final-list.md` first: Monitoring (tab of Pages), Track in Monitoring, Stop tracking, and the health labels. The column words Queries and Cannibalization are checked against the list; Cannibalization is the name of another session's page, so if it is not there yet it is used as that session spells it and not added here. The Issues branch edits the same glossary files and `en.json`: resolve by keeping both sides.

| Namespace | Keys (outline) |
|---|---|
| `pageSearch` | `period`, `compareWith`, `compare.previousPeriod`, `compare.previousYear`, `compare.none`, `metrics.clicks`, `metrics.impressions`, `metrics.ctr`, `metrics.position`, `overTime`, `whatChanged`, `tabs.queries`, `tabs.locations`, `tabs.devices`, `columns.now`, `columns.before`, `columns.change`, `coverage`, `note`, `notLive`, `positionImproved`, `positionSlipped`, `perDay`, `states.notConnected`, `states.askAdmin`, `states.pending`, `states.reauth`, `states.noAccess`, `states.noImpressions`, `states.busy`, `states.retry`, `states.unavailable`, `states.notCollected`, `devices.DESKTOP`, `devices.MOBILE`, `devices.TABLET` |
| `pageSearch.health` | `lost` "Lost traffic", `sharp_drop` "Sharp drop", `declining` "Declining", `stable` "Stable", `growing` "Growing", `new` "New", `low_data` "Not enough data", `no_data` "Not collected yet" |
| `pageSearch.verdict` | one ICU sentence per verdict (`lost`, `sharp_drop`, `declining`, `growing`, `stable`, `stableAlone`, `new`, `lowData`, `smallNumbers`, `noData`) and per flag (`position_slipped`, `position_improved`, `ctr_fell_impressions_rose`) |
| `monitoring` | `title`, `context`, `contextTip`, `export`, `addPages`, `tier`, `allTiers`, `untiered`, `health`, `allHealth`, `searchPlaceholder`, `searchLabel`, `caption`, `one`, `other`, `columns.page`, `columns.tier`, `columns.health`, `columns.trend`, `columns.queries`, `columns.queriesTip`, `columns.cannibalization`, `queries.previous`, `queries.capped`, `cannibalization.none`, `cannibalization.keywords`, `cannibalization.tip`, `cannibalization.likely`, `cannibalization.coRanking`, `cannibalization.unstable`, `cannibalization.label`, `bulk.stopTracking`, `bulk.exportSelection`, `removed`, `removedDetail`, `empty.title`, `empty.reason`, `noMatch`, `noAccessTitle`, `noAccessReason`, `loadingHistory` |
| `monitoring.add` | `title`, `tabs.paste`, `tabs.suggested`, `urlsLabel`, `urlsHint`, `check`, `outcome.ok`, `outcome.added`, `outcome.already_tracked`, `outcome.invalid_url`, `outcome.wrong_host`, `outcome.not_crawled`, `outcome.over_limit`, `suggestedIntro`, `allTracked`, `count`, `submit`, `added`, `addedDetail` |

Country names come from the existing locations formatter; a code it does not know is shown as the code.

## 13. Not built, and why

| Not built | Why |
|---|---|
| Indexing column, the index status in the verdict, "Check now" (doc 32 D-PP-8) | Needs the URL Inspection API: a new client call, table and daily job, and its scope and quota are unverified (doc 32 PP-Q1). The crawl's "indexable" is a different fact and must not stand in for it. Next slice. |
| Location, device, search type and query filters; search appearance | Decision D14 and section 5.4. |
| The flags `segment_drives_change`, `index_status_changed`, `url_form_changed`, `provisional_excluded` | Their data is not collected here. The What changed tables show the segment. |
| "Whole history", week and month buckets, custom compared range | Decision D13. |
| Sitemap import, "Watch this page" buttons on keyword screens | Slice 2 of doc 32; nothing in the approved mock depends on them. |
| More metrics (share of site, tracked keyword rank, AI citations, GA4) | Off by default in doc 32 D-PP-9; each needs another read. |
| The full-page shell of the detail, `j` and `k` stepping of its own | The page drawer is the one detail (owner, 2026-11-26). Stepping belongs to the shell; Monitoring's own inspector uses the shared inspector stepping. |
| Landing pages tab | Removed by the owner (2026-11-26). |
| Server-side CSV export | The list is at most 200 rows already in the browser. |
| The values of the Cannibalization column (the backend: tables, rules, the join of a tracked keyword's rank to the page that ranks, and the page the badge opens) | Decision D22. The Monitoring API returns `cannibalization: null`, documented as reserved, and the web hides the column while every row has `null`. No Cannibalization tables, page or per-page tracked keyword rank join exist yet; running the verdict rules would mean inventing them, and they belong to the Cannibalization work. What is built: the contract field, the typed cell with its tooltip and test, the sort key and the CSV columns. |
| Queries for every period | The count is stored for whole calendar months of tracked pages and for periods a drawer opened (D21). Any other period reads "Not collected yet" on Monitoring. Storing the count per day for every page would need the `[date, query]` read per page, which section 5.4 rejects. |
| A query count that is exact past 25,000 | One request, no paging (D21). A capped page shows "25,000+" and no change. |
| A quota key for the limit, `pages:write`, page groups | Decisions D8, D10, D11. |

## 14. Permissions and security

| Action | Permission |
|---|---|
| See Monitoring and the Search tab, export | `data:read` |
| Add pages, stop tracking | `projects:write` |
| Connect or reconnect Search Console | `integrations:manage` (existing screens) |

- Every statement names the workspace and the project; the new tables have row-level security; each new route gets its rows in `tests/api/test_route_access.py` and `tests/security/test_cross_tenant.py`.
- A pasted address is parsed and canonicalized, never fetched.
- The refresh token is read for one request, the access token lives in that request's memory; neither is logged or returned.
- The page filter is a regular expression built only from stored strings passed through `re.escape`; no user text reaches it.
- Query text stays out of logs and error reports.

## 15. Risks and open questions

| ID | Risk | Mitigation |
|---|---|---|
| R1 | A filtered call and the bulk call can disagree by a few clicks for the same page and day (aggregation by page, anonymized rows). | Bulk rows win; a history row only fills missing days. Test with a two-form fixture. |
| R2 | Google's load quota (10 minute and daily) can refuse filtered calls before the per-minute budget is reached. | The quota error slows the property's bucket for 30 minutes (existing) and the panel shows "Google is busy"; stored sections keep working. |
| R3 | Several API processes each have the 60 a minute budget. | 4 processes plus the worker is 540 a minute against Google's 1,200. Move the buckets to Redis before a second worker (the limiter's own note). |
| R4 | 16 months of daily totals for a 5,000 page site is up to 511 MB. | Section 5.5 can change to 190 days for untracked pages (about 200 MB at most) with one constant and one clause. |
| R6 | Whether Google accepts `byProperty` with a page filter was read from memory of its reference, not checked today. | The filtered reads always send `auto`; the fake refuses `byProperty` with a filter; the first real pass on staging confirms. |
| R7 | The number of API processes on the server, and the next free migration number, were not checked. | R3 covers the first; plan 01 task 2 step 1 reads the second when it is built. |
| R5 | `schema.ts`, `backend/openapi/v1.json`, `en.json` and the glossary files will conflict with the Issues and Pages branches. | Regenerate the two generated files after a merge, never merge them by hand; keep both sides in the word files. |
| R8 | The query read now asks for up to 25,000 rows: seconds and up to about 3.75 MB for a page with a long tail, in the worker's pass and in a drawer's first open (D21). The calls are not more, but the Google client's timeout and the API process's memory for one answer must allow it. | One request, parsed once, cut to 100 rows and counted at once. Plan 01 task 7 reads the client's timeout for the filtered read and raises it for that call if it is shorter than 30 seconds. The pass already stops between pages on its time budget. |

| ID | Question for the owner or the main session |
|---|---|
| Q1 | `projects:write` for tracking (D11), or the new `pages:write` of doc 32? |
| Q2 | Are location and device filters on the Monitoring list wanted soon? If yes, shape D for tracked pages (section 5.4) becomes the next slice. |
| Q3 | Indexing status (URL Inspection) is out of this build. The mock shows the column. Confirm it may follow as its own slice. |
| Q4 | 16 months of daily totals for every page (R4), or 190 days for untracked pages? |
| Q5 | This build creates `apps/web/src/app/[workspace]/[project]/seo/pages/monitoring/page.tsx`. Confirm with the Pages session that it creates no file at that path. |
| Q6 | Only crawled pages can be tracked (D9). Confirm. |
| Q7 | The query count (D21) is stored on `fp.gsc_page_fetches`, the marker of the query read, not on `fp.gsc_page_breakdown` (one row per key). Confirm this reading of "the breakdown cache table". |
| Q8 | Monitoring shows the Queries count only for whole calendar months of tracked pages and for periods opened in a drawer; another period reads "Not collected yet". Confirm, or ask for the count per week (an extra `[query]` read per page and week). |
| Q9 | The Cannibalization work decides the counting window and device behind `cannibalization` and the route the badge opens. Tell that session about the reserved field (section 7.2). |
