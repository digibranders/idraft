# Pages: Overview, All pages and the page drawer: design

Status: written 2026-11-26 for the real-app build. The owner's settled decisions are in section 1. Technical
decisions taken here are numbered D1 to D12 in section 3, each with its reason. What blocks or narrows the build
is in section 15.

Reference mock (not committed, read only, main checkout): `apps/web/design-preview/pages-overview.js`,
`pages-overview-data.js`, `pages-overview-data.check.mjs`, `il.js` (`showPagesIn`), `il-pages.js`, `il-drawer.js`,
`il-model.js`, `issues-audit.js`, `perf.js`, `interactions.js`, `index.html`.

Sibling work, neither merged: Issues (`claude/issues-page-8b4da8`, spec
`docs/superpowers/specs/2026-11-26-issues-page-design.md` on that branch) and Search Console per page plus
Monitoring (`claude/gsc-page-detail-monitoring-6f43c3`, no commit of its own on 2026-11-26). This spec depends on
no unmerged code: every dependency is a seam of section 10.

## 1. What the owner decided

1. The sidebar group "Website audit" lists Pages, Issues, Internal links, in that order. The name "Pages" stays.
2. Pages has the tabs Overview (the landing), All pages and Monitoring. Monitoring belongs to another session:
   this build reserves its tab slot and its route, nothing more.
3. Overview shows page counts, page types, orphans, errors and indexed numbers, with charts. Issue totals count
   every address and equal the Issues page. Every other number counts live pages. Each chart has a Chart and
   Table switch, and each mark opens All pages on the pages it counts.
4. Nothing is faked. A number the app does not collect is left out or clearly labelled.
5. All pages is a table first. The page has a fixed height, the table scrolls inside its panel under a pinned
   header, and at 1280 by 720 the first row sits about 30% down the screen.
6. All pages has column groups (Page, Indexing, Issues, Search, AI, Links), saved views, folder and status
   filters, search and "Track in Monitoring". Default columns: Tier, Status, Indexable, Issues, Clicks, Tracked.
7. The page drawer opens for any page, with the tabs Overview, Search, Issues, AI, Links, in that order, and no
   Track box. Its Overview is the page at a glance: chips, 8 tiles that open the tabs, needs attention, about,
   tier and tags.
8. The drawer's Search tab shows what exists today and leaves a named slot for the detail the Search Console
   session adds (queries, countries, devices).

## 2. What is true in the code today

Read from the code on 2026-11-26.

**Routes and sidebar.** `apps/web/src/lib/navigation/registry.ts` holds `pages` at `/seo/pages` with
`status: 'planned'` (no screen, absent from the sidebar) and `internalLinks` at `/seo/internal-links`, live, both
in the group `seo`. `NavGroup` is `'seo' | 'ai'`. `destinationOf` matches the longest path prefix, so
`/seo/pages/all` resolves to `pages` with no change. Doc 32 decision D-PP-2 reserves the static segment
`performance` under Pages.

**The inventory already exists as a tab.** Internal links > Pages
(`apps/web/src/features/internal-links/pages/pages-tab.tsx`) is the table the mock calls All pages: server
filter, sort and cursor paging (`cursor-paging.ts`, Previous and Next, 100 or 200 rows), a column chooser, bulk
tier and tag changes, a CSV export, and the page inspector. An absent `tab` key means this tab
(`url-state.ts`, `parseLinksSearch`). Its state is in the address: `view` (worklist), `sort`, `q`, `scope`, `run`,
the filter keys `tier`, `tag`, `status`, `idx`, `flag`, and the table keys `cols` and `density`.

**The backend list.** `GET /api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/pages`
(`backend/src/idraft/api/internal_links/read_routes.py`, `reads.py`, `page_filter.py`, `page_sort.py`) takes
`run`, `scope`, `filter[tier]`, `filter[tag]`, `filter[status]` (classes `2xx`, `3xx`, `4xx`, `5xx`, `blocked`),
`filter[indexable]`, `filter[flags]`, `filter[include_variants]`, `filter[worklist]`, `q`, `sort`, `include`
(`changes`, `keywords`, `citations`, `anchors`, `gsc`), `cursor`, `limit` and `format=csv`. Sorts that matter
here: `path`, `status_code`, `click_depth`, `linking_pages`, `outlinks`, `tier`, `clicks`, `title`, `indexable`,
`in_sitemap`, `rank`, `citations`, `anchor`, `change`.

**What a crawl stores per address** (`seo.crawl_pages`): `status_code`, `resource_type`, `redirect_url_id`,
`is_indexable`, `non_indexable_reason`, `canonical_url_id`, `variant_of_url_id`, `title`, `in_sitemap`,
`click_depth`, the link counters per scope, `broken_outlinks`, `redirect_outlinks`, `non_indexable_outlinks`,
`is_orphan`, `is_editorial_orphan`. `seo.crawl_runs` has `sitemap_pages`, `pages_blocked`, `pages_variant`,
`previous_run_id`. Tiers are in `core.project_pages` (joined when read), tags in `core.page_terms`.

**Search Console per page.** `fp.gsc_page_daily` holds clicks and impressions per property, day and URL, only
for addresses `core.urls` knows, and only the last 35 days (`collectors/gsc_pages.py`, `PAGE_KEEP_DAYS`). The
list reads window totals (`extras.gsc_of`, `include=gsc`, 28 days). No route returns the days of one page. No
average position, query, country or device is stored per page.

**The inspector.** `apps/web/src/features/internal-links/inspector/page-inspector.tsx` is one scrolling body
with no tabs: tier and tags, a strip (depth, links in, links out), linking pages by tier and by placement, the
extras cards (changes, keywords, citations, anchors, Google), linking pages, outlinks, flags. It takes the whole
`LinksTabContext`, so only Internal links can host it. The shared parts
(`apps/web/src/components/app/inspector/`) already give tabs (`InspectorTabs`, `InspectorPanel`), the address
(`useInspector`: `?inspect=page:<id>&itab=<tab>`), stepping, resizing and the docking rule
(`apps/web/src/lib/inspector/placement.ts`).

**What does not exist in the real app.**

| Thing | State |
|---|---|
| Monitoring (tracked pages) | No table, no route, no web feature. `WATCH_LIMIT = 200` exists only in the mock (`design-preview/perf-add.js`). Doc 32 plans `core.watched_pages`, the quota key `watched_pages` (200 per project), the permission `pages:write` and `page-performance/watchlist`. None is built. |
| Issues per page | The Issues branch has `GET …/issues` (the checks and `summary`), `filter[issue]=<check id>` and `include=issue` on the pages list. It has no "issues of one page" read and no per-row issue count. Its rules are SQL conditions per row (`api/issues/rules.py`, `condition(check_id, …)`), so both can be built there. |
| Google's index state per page | Not stored. No URL Inspection collector and no table. |
| Page types | Not collected. A crawl knows `resource_type` (`html`, `redirect`, `broken`, `other`) only. |

## 3. Decisions

| # | Decision | Reason |
|---|---|---|
| D1 | Routes are `/seo/pages` (Overview), `/seo/pages/all` (All pages) and `/seo/pages/performance` (Monitoring, reserved). Not `/pages`. | The registry already names `/seo/pages`; Issues took `/seo/issues`; Internal links keeps `/seo/internal-links`; doc 32 reserves `performance`. One prefix, no redirect of a live page. |
| D2 | The Pages tab leaves Internal links. `?tab=pages`, and a bare address that carries a key only that tab used, redirect on the server to `/seo/pages/all` with the query kept. Internal links then opens on Journey. | One inventory in the app. The mock's `#/internal-links/pages` is this case. |
| D3 | The drawer is `?inspect=page:<url_id>&itab=<tab>` on every host page, through the existing `useInspector`. | It already works, makes clean history entries and is shareable. No new address scheme. |
| D4 | `PageInspector` is extended into a tabbed drawer and given a narrow context, not rewritten. | Its sections, bulk actions and tests stay; only their grouping and their exits change. |
| D5 | The drawer always lies over the page and never docks. Its width, its resize limits and its sheet breakpoint are those of the shared `Inspector`, which this build does not change. | The shared drawer session (`claude/shared-drawer-121ede`) makes every drawer of the app an overlay with one saved width (640 px by default, 480 px at least, 60% of the window and 960 px at most, a full-width sheet below 900 px). A width of its own for this drawer would undo that. |
| D6 | Paging stays the existing cursor pager (Previous, Next, 100 or 200 rows). No "Show 25 more", no load on scroll. | "Select all matching", J and K stepping and the pinned footer are built on it. The pager sits in the panel's footer, so it costs no height above the rows. |
| D7 | One new read, `GET …/internal-links/overview`, returns every crawl count of the Overview. Issue totals and changes are read from their own existing routes. | The counts need one pass over `seo.crawl_pages`; the browser cannot count a crawl of up to 200,000 pages. Totals owned elsewhere are not computed twice. |
| D8 | Each Overview mark and the list it opens share one server predicate, exposed as `filter[view]`. | Then "the mark's number equals the list's total" is a test, not a hope. |
| D9 | "Saved views" are built-in views in one View menu, with the whole table state in the address. No per-user stored views in this build. | The address is already shareable and bookmarkable. Stored views exist for AI screens (`backend/src/idraft/api/views/`); wiring All pages to them is a later slice. |
| D10 | Tracked, "Track in Monitoring" and the Issues column render only when their source exists (section 10). | The owner's rule 4. An empty column would promise data the app does not have. |
| D11 | The "indexed by Google" bar of the mock is not built. | No index state is stored for any page. It returns when URL Inspection is collected (Issues spec, slice 4). |
| D12 | The Overview has no "page types" card. Sections (first folder of the path) and tiers are the two groupings. | Page types are not collected. Sections and tiers are real and already filterable. |

## 4. Words

"Counted", "live", "redirected", "broken" and "blocked" mean what the Issues spec section 4 and
`backend/src/idraft/crawl/status.py` say. They are repeated here because every number below uses them.

| Word | Definition |
|---|---|
| address | Any row of `seo.crawl_pages` of the crawl in view, variants included. |
| counted | `variant_of_url_id IS NULL`. |
| variant | `variant_of_url_id IS NOT NULL`: the same page under another address. |
| live | counted, `status_code = 200`, `resource_type = 'html'`. |
| redirected | counted, `status_code` from 300 to 399. |
| blocked | counted, `status_code` is 401, 403 or 429. Unknown, not broken. |
| client error | counted, `status_code` from 400 to 499, not blocked. |
| server error | counted, `status_code` from 500 to 599. |
| other | counted and none of the above: no status, or a 200 that is not HTML. |
| orphan | counted and `is_orphan`, as the existing worklist `orphans` of Internal links. The Issues check `orphans` adds "live", so its count can be lower by the orphans that are not live. |
| indexable | live and `is_indexable`. |
| reachable | live and `click_depth IS NOT NULL`. |
| section | The first folder of `core.urls.path` (`/blog/` for `/blog/post`); `/` for a page with one segment or none. |

Every address is in exactly one of: live, variant, redirected, client error, server error, blocked, other.

Where the mock differs: it calls any 200 "live", counts 403 as a client error and has no variants. The real
rules above win, so the real numbers of the Eventus crawl differ from the mock's.

## 5. Routes, tabs and redirects

### 5.1 Files

| File | What |
|---|---|
| `apps/web/src/app/[workspace]/[project]/seo/pages/page.tsx` (+ `page.test.tsx`) | Overview. Copies `seo/internal-links/page.tsx`: membership, project lookup, `PagesScreen tab="overview"`. |
| `apps/web/src/app/[workspace]/[project]/seo/pages/all/page.tsx` (+ test) | All pages: `PagesScreen tab="all"`. |
| `apps/web/src/app/[workspace]/[project]/seo/pages/performance/` | Not created here. The Monitoring session adds it. Until then the path is the 404 page. |
| `apps/web/src/app/[workspace]/[project]/seo/internal-links/page.tsx` | Gains the redirect of 5.3. |
| `apps/web/src/lib/routes/paths.ts` | `pagesTabPath(workspace, project, tab?)` beside `rankingsPath`. Not `pagesPath`: `lib/internal-links/queries.ts` already exports a `pagesPath` (the API path of the list), and the table imports it. |
| `apps/web/src/lib/pages/tabs.ts` (+ test) | `PAGES_TABS`: `overview`, `all`, `monitoring`, each with `path`, `status: 'live' | 'planned'`. Monitoring is `planned`. |

The screen lives in `apps/web/src/features/internal-links/pages-page/`, because the lint rules forbid one
feature importing another and Pages reuses the crawl reads, the crawl states, the table and the drawer of that
feature. The Issues session made the same choice (`features/internal-links/issues/`). Pure logic goes to
`apps/web/src/lib/pages/`.

### 5.2 Tabs

The tabs are route tabs: a segmented `TabNav` (`components/app/shell/tab-nav.tsx`, as the Citations board) at
the start of the toolbar row. It lists the `live` entries of `PAGES_TABS`, so Monitoring appears the day its
session sets it to `live`, in third place, with no change to this code. A planned tab is absent, not disabled:
the segmented variant has no "unavailable" state, and a dead tab would promise a page that is a 404.

`run` (the crawl in view) is carried between Overview and All pages in the tab links. Nothing else is.

### 5.3 What leaves Internal links, and the redirects

- `LINKS_TABS` (`features/internal-links/tabs.ts`) loses the `pages` entry. `LinksTabId`, `TABS` and `ORDER`
  in `url-state.ts` and `tabs.ts` lose `pages`; the default tab becomes `journey`. Order: Journey, Link map,
  Links, Tier flow, Changes, Opportunities, as the mock the owner reviewed.
- `seo/internal-links/page.tsx` reads `searchParams` and redirects (`redirect` from `next/navigation`, the
  query built with `queryOf`, as `seo/rankings/page.tsx` does) to `/seo/pages/all` when `tab=pages`, or when
  `tab` is absent and the query has one of `view`, `sort`, `q`, `tier`, `tag`, `status`, `idx`, `flag`, `cols`,
  `density`. `tab` is dropped; every other key is kept, `inspect` and `itab` included. The All pages address
  uses the same keys with the same meaning, so no key is translated.
- A bare `/seo/internal-links` does not redirect: it is Internal links, on Journey.
- Checked on 2026-11-26: Journey, the new default tab, writes none of those keys. The tabs that use `q`-like
  searches, filter keys, `cols` or `density` (Links, Opportunities) always carry their own `tab`, so they never
  match the rule. The plan repeats this check, and the redirect test lists a Journey address with its own keys
  (`focus`, `jv`, `open`) as one that stays.
- Links inside the app that pointed at the old tab are changed to `pagesTabPath(…, 'all')`:
  `internal-links-screen.tsx` (`untieredHref`, built from `UNTIERED_QUERY`) and the worklist chips, which move
  into the View menu of All pages (section 7.3). `flow/flow-tab.tsx` and `journey/journey-tab.tsx` link to the
  Links tab only (`tab=links`), so they do not change (checked at plan time).
- The folders `features/internal-links/pages/` and `inspector/` keep their place and names. Only their host
  changes.

### 5.4 Sidebar

`registry.ts`: the `pages` entry gets `status: 'live'`. Its key, path, icon and permission do not change. This
is the whole diff of this build in that file when the Issues branch has merged first, because that branch adds
the group `audit`, moves `pages` and `internalLinks` into it and orders them Pages, Issues, Internal links
(its spec 7.5, its commit 89296698).

If this branch merges first, Pages would appear in the group SEO between Keywords and Internal links, which is
its present place. That is acceptable for the hours between two merges and needs no temporary code.

`registry.test.ts`, `features/shell/project-shell.test.tsx` and `docs/design-system/11-navigation.md` (the row
"SEO > Pages", whose tabs become Overview, All pages, Monitoring) are updated with it.

## 6. Overview

### 6.1 API

`GET /api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/overview?run=latest`

Needs `data:read`. `run` is `latest` or a crawl id, as on every read of this router. `404 no_crawl` before the
first finished crawl; `404 not_found` for a project outside the workspace.

```json
{
  "data": {
    "run_id": "…",
    "crawled_at": "2026-11-25T09:12:00Z",
    "addresses": 420,
    "status": {
      "live": 389, "variant": 15, "redirected": 6,
      "client_error": 7, "server_error": 1, "blocked": 2, "other": 0
    },
    "indexable": 372,
    "not_indexable": 17,
    "reachable": 117,
    "unreachable": 272,
    "orphans": 244,
    "sitemap": {
      "state": "read",
      "indexable_in_sitemap": 330,
      "indexable_missing": 42,
      "listed_not_live": 4,
      "listed_not_indexable": 9
    },
    "depth": [
      { "clicks": 0, "pages": 1 }, { "clicks": 1, "pages": 24 }, { "clicks": 2, "pages": 61 },
      { "clicks": 3, "pages": 20 }, { "clicks": 4, "pages": 8 }, { "clicks": 5, "pages": 2 },
      { "clicks": 6, "pages": 1 }
    ],
    "tiers": [ { "tier": { "tier_id": "…", "code": "T1", "name": "Money pages" }, "pages": 12 },
               { "tier": null, "pages": 310 } ],
    "sections": [ { "section": "/cybersecurity/", "pages": 151 }, { "section": "/", "pages": 40 } ],
    "sections_total": 14
  }
}
```

Types (Pydantic, in `backend/src/idraft/api/schemas/internal_links_extra.py`, beside `ChangesSummary`):

| Field | Type | Counts |
|---|---|---|
| `run_id` | `UUID` | |
| `crawled_at` | `datetime | None` | `crawl_runs.finished_at` |
| `addresses` | `int` | every address |
| `status` | `OverviewStatus`: seven `int` fields | the seven groups of section 4; they add up to `addresses` |
| `indexable`, `not_indexable` | `int` | live pages; they add up to `status.live` |
| `reachable`, `unreachable` | `int` | live pages; they add up to `status.live` |
| `orphans` | `int` | counted and `is_orphan`: the predicate of the existing worklist `orphans`, so the number equals that list |
| `sitemap.state` | `'read' | 'no_sitemap'` | `no_sitemap` when `crawl_runs.sitemap_pages` is null or 0; the four counts are then `null` |
| `sitemap.indexable_in_sitemap` | `int | None` | indexable and `in_sitemap` |
| `sitemap.indexable_missing` | `int | None` | indexable and not `in_sitemap` |
| `sitemap.listed_not_live` | `int | None` | counted, `in_sitemap`, not live |
| `sitemap.listed_not_indexable` | `int | None` | live, `in_sitemap`, not `is_indexable` |
| `depth` | `list[OverviewDepth]`, always 7 rows | reachable pages by `least(click_depth, 6)`; the row 6 is "6 and more" |
| `tiers` | `list[TierCount]` (the existing schema) | live pages by their tier today; `tier: null` is Untiered; a tier with no live page is left out |
| `sections` | `list[OverviewSection]`, at most 50 | live pages by section, largest first, then by name in byte order |
| `sections_total` | `int` | how many sections the crawl has |

The sitemap card counts counted addresses only. A variant listed in the sitemap is the Issues check
`sitemap-nonindexable`, and is not repeated here.

### 6.2 How it is read

New module `backend/src/idraft/api/internal_links/inventory.py`:

- `PageView`: the literal of section 7.3's server views.
- `view_condition(view: PageView) -> ColumnElement[bool]`: the predicate of one view over `crawl_pages` and
  `urls`. The words of section 4 are private helpers of this module, one definition each.
- `section_of() -> ColumnElement[str]`: `'/' || split_part(path, '/', 2) || '/'` when the path has a second
  segment, else `'/'`.
- `overview_statement(scope: PageScope)`: one `SELECT` over `crawl_pages JOIN urls` of the run with
  `count(*) FILTER (WHERE view_condition(...))` per number, and the seven depth buckets.

`LinkReadService.overview(access, project_id, run=...)` in `reads.py` runs, in the one `REPEATABLE READ`
transaction the other reads use: `read_scope`, the aggregate above, a grouped count by tier (the join of
`page_rows`, live pages only), a grouped count by section (limit 50, plus a count of distinct sections), and the
`crawl_runs` row for `sitemap_pages` and `finished_at`. Four statements, one snapshot. If the read takes over a
second on a real crawl, store the counts per crawl then, as the Issues service notes for its own aggregate.

The route goes in `read_routes.py` (`@router.get("/overview")`). `backend/tests/api/test_route_access.py` gets
its row (the release fix b2129aee was a route missing from that table). `backend/openapi/v1.json` is
regenerated in the backend commit; the web runs `pnpm gen:api` in `apps/web` in its own commit right after.

### 6.3 What comes from elsewhere

| Card | Source | Owner |
|---|---|---|
| Issues snapshot, and the strip number "Pages with an issue" | `summary` of `GET …/issues` (`pages_with_issue`, `pages_with_error`, `pages_with_warning`, `pages_with_notice`), through the seam `useIssueTotals` (10.1) | Issues session |
| Changes since the last crawl | `GET …/internal-links/changes/summary` (`changesSummaryQuery`, exists): `state`, `pages_added`, `pages_lost`, `editorial_added`, `editorial_lost`, `lost_to_top`, `previous_finished_at` | exists |
| Tiered x of y (toolbar) | the existing `ContextLine` | exists |

The Overview never computes an issue total itself. That is the only way it equals the Issues page.

### 6.4 The page

Template T2 with a fixed height (section 8). Under the toolbar row the cards scroll in their own container.

**Strip** (`MetricStrip`, six numbers, each a link to its list):

| Number | Value | Opens |
|---|---|---|
| Addresses crawled | `addresses` | All pages, `variants=1`, no view |
| Live pages | `status.live` | view `live` |
| Indexable | `indexable` | view `indexable` |
| Orphan pages | `orphans` | view `orphans` (the existing worklist) |
| Error pages | `status.client_error + status.server_error` | view `errors` |
| Pages with an issue | from `useIssueTotals` | the Issues page |

The sixth number is absent while the Issues seam answers `unavailable`; the strip then has five.

**Cards.** Each is a `ChartFrame` (`components/app/chart/chart-frame.tsx`, `variant="panel"`, `kind="html"`),
which already has the Chart and Table switch, the title, the info text and the menu. The table of a card lists
the same rows with their counts and shares, each row a link.

| # | Card | Chart | Rows, and what each opens |
|---|---|---|---|
| 1 | Addresses by status | `RingsChart`, one ring, centre "389 live" (checked at plan time: one row of `rows` is one ring, with one share per entry of `segments`, so a single row draws a ring of seven segments) | Live pages (`live`), Parameter variants (`variants`), Redirects (`redirects`), Client errors (`client_errors`), Server errors (`server_errors`), Blocked (`blocked`), Other (`other`). A group of 0 is left out of the ring and kept in the table. |
| 2 | From crawled to indexable | `BarList`, four rows on one scale | Addresses crawled, Live pages, Indexable, Indexable and in the sitemap (`in_sitemap_indexable`). The fourth row is absent when `sitemap.state` is `no_sitemap`. No "indexed by Google" row (D11). |
| 3 | Pages by section | `BarList`, the 8 largest sections and "Other sections (n)" | A section opens All pages with `view=live&folder=<section>`: the bar counts live pages, so the list must too (D8). The folded row opens nothing. |
| 4 | Pages by tier | `BarList` with the tier badge | A tier opens `view=live&tier=<tier_id>`; Untiered opens `view=live&tier=none`. The Untiered entry of the View menu (7.3) keeps counting every counted address, as the toolbar's "Tiered x of y" does. |
| 5 | Click depth | `BarList`, 0 to "6 and more", then "Not reachable by links" in the warning colour | A depth opens `depth=<n>`; the last row opens view `unreachable`. |
| 6 | Sitemap coverage | `StackedShareBar` with its legend | In the sitemap and indexable (`in_sitemap_indexable`), Indexable, missing from the sitemap (`not_in_sitemap`), In the sitemap, not live (`sitemap_not_live`), In the sitemap, not indexable (`sitemap_not_indexable`). With `no_sitemap`: the card's empty state "The crawl found no sitemap". |
| 7 | Issues | three rows: errors, warnings, notices (pages with at least one) | Each opens the Issues page with `severity=`. The card is absent while the seam answers `unavailable`. |
| 8 | Since the last crawl | no chart: four lines | Pages added, Pages removed, Editorial links added and lost, Links lost to important tiers. Each line links to Internal links > Changes. `state: first_crawl`: "This is the first crawl. Changes appear after the next one." `pending`: "Comparing with the crawl before". `unavailable`: the existing words of the Changes tab. |

Marks that open a list are links (`BarList` rows take `href`), so they work with the keyboard, open in a new
tab and are announced as links. The ring's segments are not the only way in: its legend rows and its table rows
carry the same links. The mock's split of card 3 into pages with and without issues needs a per-page issue flag
(seam 10.1) and is added with it.

Percent bases are named in each row's tooltip: status shares are of every address; every other share is of live
pages.

**States** reuse `features/internal-links/crawl-states.tsx` and `crawl-reads.ts`, exactly as the Issues spec
7.4 lists them: no access, no website, never crawled, first crawl running, first crawl failed, a newer crawl
running or failed (banner over the finished crawl), loading (skeleton cards), error (inline error with retry).
An older crawl chosen in the picker shows its numbers; cards 7 and 8 follow `run` too.

Export on this tab downloads one CSV of every card's rows (card, row, count), built in the browser with
`lib/csv/csv-write.ts`.

## 7. All pages

### 7.1 What moves and what changes

`PagesTab` becomes the body of All pages. It keeps its reads, paging, selection, bulk tier and tag dialogs, tier
keys, CSV export and empty states. It changes in six places:

1. It takes a narrow `PagesContext` instead of `LinksTabContext` (see 9.2 for the same step on the drawer).
2. The worklist chip row is removed; its lists move into the View menu (7.3). This row is what the 1280 by 720
   budget cannot afford. The four other things the row held move too: the "Suggested tiers" chip
   (`TierSuggestions`) goes into the table toolbar's end slot, before the filter bar; the Parameter variants count
   becomes the View menu entry Parameter variants; the "may be incomplete" coverage note becomes the last line of
   the View menu; the "no issues" text becomes the line of the menu's Link problems section when all its counts
   are 0.
3. Column groups are switched on (`columnGroups` of `DataTable`, with `group` on each column). `ColumnChooser`
   has no groups today: it gains an optional group label per column and draws a heading over each run of
   columns that share one.
4. New filters `folder` and `depth`, the `variants` key, and server views (7.3, 7.4).
5. The default sort becomes `path` (an inventory reads best by address, and it needs no extra read to know
   whether Search Console is connected). The old default `-linking_pages` remains a sort.
6. The row that holds `FilterBar` and `ScopeMenu` today, outside the table, goes into the table's own toolbar.
   `DataTable` has one slot, `toolbarEnd` (before density and columns); the Add filter button and the scope menu
   go there. The View menu belongs at the start, before the search box, and no slot exists for it: `DataTable`
   and `DataTableToolbar` (`components/app/data-table/toolbar.tsx`) gain an optional `toolbarStart?: ReactNode`.
   `FilterBar` cannot draw its button and its chips apart (one group owns the focus moves between them), and
   it is not split: the whole bar goes into `toolbarEnd` with `compact`. With no filter set it is the one
   "+ Filter" button; the toolbar already wraps its end slot to a second line when the chips do not fit, so a
   second row appears only while filters are set.

### 7.2 Columns

Ids are those of `pages/page-columns.tsx` and `page-extras-cells.tsx`. "Exists" means the column, its data and
its sort are in the code today.

| Group | Column (id) | Today | Default |
|---|---|---|---|
| Page | Page (`page`, pinned, required) | exists | shown |
| Page | Tier (`tier`) | exists | shown |
| Page | Status (`status`) | exists | shown |
| Page | Tags (`tags`) | exists | hidden |
| Indexing | Indexable (`reason`: yes, or the reason it is not) | exists, sort `indexable` | shown |
| Indexing | Canonical (`canonical`) | new column; `canonical_url` is already on `PageRow`. "This page" when it names itself. No sort. | hidden |
| Indexing | In sitemap (`sitemap`) | exists, sort `in_sitemap` | hidden |
| Issues | Issues (`issues`) | seam 10.1: absent until the Issues session provides the per-row counts | shown when present |
| Issues | Flags (`flags`) | exists | shown until `issues` is present, hidden after |
| Search | Clicks (`clicks`) | exists (`include=gsc`), sort `clicks` | shown |
| Search | Impressions (`impressions`) | exists; new sort `impressions` | hidden |
| Search | Tracked keywords (`keywords`), Best rank (`rank`) | exist, sort `rank` | hidden |
| Search | Tracked (`tracked`) | seam 10.2: absent until Monitoring exists | shown when present |
| AI | AI citations (`citations`) | exists, sort `citations` | hidden |
| Links | Depth (`depth`), Linking pages (`linking`), Linked from tiers (`fromTiers`), Outlinks (`outlinks`), Change (`change`), Outlinks to T1 (`toT1`), Broken outlinks (`broken`), Links to redirects (`redirects`), Links to non-indexable (`nonIndexable`), Top anchor (`topAnchor`), Anchors (`anchors`), Anchor matches keyword (`matches`) | exist | hidden |

So the default set on this branch alone is Tier, Status, Indexable, Flags, Clicks. It becomes the owner's set
(Tier, Status, Indexable, Issues, Clicks, Tracked) as the two seams are filled, with no change to this code
beyond the two column definitions.

Differences from the mock, on purpose:

- Clicks and Impressions are "last 28 days", the window `extras.gsc_window` already uses, not "the last full
  month". The header tooltip says "Google Search clicks on this page in the last 28 days, from Search Console".
- The mock's "Average rank" is the existing Best rank column. No new rank number is invented.
- The link scope menu (`ScopeMenu`) shows only while a column of the Links group that depends on the scope is
  visible (`linking`, `fromTiers`, `outlinks`), as in the mock.

Backend change for this section: `page_sort.py` gains the key `impressions` (the `_clicks` subquery, summing
`impressions`), added to `EXTRA_SORTS`, to the dispatch of `extra_sort`, to `PageSort` in
`schemas/internal_links.py`, to `PAGE_SORTS` in `url-state.ts` and to `SORT_FIELD` in `page-columns.tsx`.
`_sorter` in `reads.py` reads the Search Console window only for the key `clicks` today: it must read it for
`impressions` too, or the sort is all zeros. `_cursor_value` needs no change (an integer is its default).

### 7.3 Views

One "View" menu at the start of the table toolbar, with the count beside each view. Choosing a view writes
`view=<id>` and makes a history entry. A view narrows the list; filters, search and sort apply on top of it.

| Section of the menu | View (id) | Predicate (section 4 words) | Count from |
|---|---|---|---|
| Pages | All pages (none) | counted | `addresses - status.variant` |
| Pages | Live pages (`live`) | live | overview |
| Pages | Indexable (`indexable`) | indexable | overview |
| Pages | Not indexable (`not_indexable`) | live and not `is_indexable` | overview |
| Pages | Redirects (`redirects`) | redirected | overview |
| Pages | Error pages (`errors`) | client error or server error | overview |
| Pages | Untiered (`untiered`) | writes `tier=none`, not a view | the existing ContextLine read |
| Sitemap | Indexable and in the sitemap (`in_sitemap_indexable`) | | overview |
| Sitemap | Missing from the sitemap (`not_in_sitemap`) | | overview |
| Sitemap | In the sitemap, not live (`sitemap_not_live`) | | overview |
| Sitemap | In the sitemap, not indexable (`sitemap_not_indexable`) | | overview |
| Reach | Reachable by links (`reachable`), Not reachable by links (`unreachable`) | | overview |
| Link problems | the six existing page worklists: `under_linked_t1`, `orphans`, `editorial_orphans`, `deep_only_through_auto`, `lost_links_top`, `weak_outlinks` | unchanged (`page_filter.py`) | `GET …/internal-links/worklists` (exists) |
| Link problems | Broken and redirected links, Links to non-indexable pages | open Internal links > Links on the existing edge worklists | the same read |

Views reached only from the Overview, listed in the menu only while active: `client_errors`, `server_errors`,
`blocked`, `other`. Parameter variants (`variants`) is listed under Pages while its count is above 0, because
it replaces the variants count of the old chip row. The literal `PageView` is defined in
`schemas/internal_links.py` beside `PageWorklist` (the schema cannot import the route package) and
`inventory.py` imports it. Views that wait for a seam: With issues (`with_issues`, 10.1) and Tracked
(`tracked`, 10.2).

A view with a count of 0 is hidden unless it is the active one. Sitemap views are hidden when the crawl found
no sitemap.

Server: `filter[view]: PageView | None` on `GET …/internal-links/pages`, added to `PageFilter`
(`schemas/internal_links.py`) so that the bulk bodies and the CSV export honour it, and applied in
`page_conditions` through `inventory.view_condition`. `variants` implies `include_variants`. `filter[view]` and
`filter[worklist]` cannot be combined (`422`); the web writes one key, `view`, and sends it as the one or the
other by its id.

The web keeps using its own `view` key and does not use `useSavedView` here: that hook also owns a key named
`view` and treats a view as a set of other keys, which is a different model. Persisted views are D9.

### 7.4 Filters and search

The filter bar keeps `tier`, `tag`, `status`, `idx` and `flag` and gains:

| Filter (address key) | API | Options |
|---|---|---|
| Folder (`folder`) | `filter[folder]=<section>`: `section_of() = :section`, on `PageFilter` | the `sections` of the overview read (at most 50, largest first). The read is shared with the Overview through the query cache. |
| Depth (`depth`) | `filter[depth]=<0 to 6>`: reachable and `least(click_depth, 6) = :n` | not in the filter bar; set by the Overview's depth card, shown as a removable chip |
| Parameter variants (`variants=1`) | `filter[include_variants]=true` (exists) | set by the Overview's "Addresses crawled"; shown as a chip |

Status stays the five classes the API has. The mock lists every crawled status code; that needs a distinct
query per crawl and is not built. The status badge in each row shows the exact code, and the Status column
sorts by it.

Search is the existing box: the path contains the text, and a pasted address of the site finds its page
(`lib/internal-links/pasted-url.ts`).

### 7.5 Track in Monitoring

A bulk action "Track in Monitoring" in the selection bar, and nothing in the drawer (owner decision 7). It
renders only when the tracking seam is available (10.2). The limit is never a web constant: the Monitoring API
answers how many pages were added, already tracked, refused as not live, and left out over the limit, and the
toast repeats those numbers ("3 pages added, 1 already tracked, 2 not added: the limit is 200 pages"), as the
mock does. The action is offered for an explicit selection only, not for "all matching".

## 8. Layout and the 1280 by 720 budget

Both tabs use the fixed-height page of Keywords and the Citations board:
`flex h-page-body min-h-page-body-min flex-col gap-3 px-3 pt-3 pb-5 md:px-4 lg:px-5` inside `InspectorLayout`.
`DataTable` already fills what is left (`min-h-0 flex-1`), scrolls inside its panel and pins its header and
footer. Below `--size-page-body-min` (480 px) the page scrolls as a whole, as every T2 page.

There is no visible page title (`PageHeader` with `titleHidden`, as Keywords): the sidebar and the breadcrumb
name the page.

All pages, top to bottom, with the heights the tokens give:

| Part | Height | Running total |
|---|---|---|
| Top bar (`--size-topbar`) | 52 | 52 |
| Page padding | 12 | 64 |
| Toolbar row: tabs, crawl picker, "Tiered x of y", then Crawl now, Export and the more menu, all `h-control` | 36 | 100 |
| Gap | 12 | 112 |
| Table toolbar inside the panel: View menu, search, Add filter, link scope, Columns, density (`min-h-12`) | 48 | 160 |
| Header: the group row (`GROUP_ROW_HEIGHT`, 24) and the column row (`HEADER_HEIGHT`, 40) | 64 | 224 |
| First row | starts at 224 | 31% of 720 |

The heights are those of the code, read at plan time: the table's toolbar is 48 px and its column header row
40 px, not the 44 and 32 first written here. `CrawlHeader` draws two lines today (the tabs and actions, then the
crawl picker and the context line); Pages needs them on one, so it gains a one-line layout that Internal links
does not use.

Filter chips add a row only while a filter is set. Crawl banners (a newer crawl running or failed) add a row
only while they apply. Nothing else may sit above the table: no strip, no chip row, no description.

This budget holds only with change 6 of section 7.1 and the one-line toolbar row. With today's separate
filter row (36 px and a 12 px gap), the chip row and two header lines the first row would start far lower.

The first row's position is measured on the running app at 1280 by 720 and at a wide screen. The target is at
or above 224 px (31%) with no filter set and no banner. That is 8 px lower than the 216 px (30%) first
targeted: reaching 216 would mean a lower shared table toolbar or header row, or no group row, and none of
those is this build's to change. The owner decides whether "about 30%" covers 31%.

The Overview uses the same toolbar row. Below it the strip and the cards sit in one
`min-h-0 flex-1 overflow-y-auto` container, in a grid of one column below `lg`, two from `lg` and four from
`2xl`. The page itself never scrolls.

## 9. The page drawer

### 9.1 Address and hosts

`?inspect=page:<url_id>` opens it; `itab` is `search`, `issues`, `ai` or `links`, and absent for Overview
(`DEFAULT_INSPECTOR_TAB`). `useInspector` already drops `itab` when another page opens from closed, keeps it
when stepping, and closes by going back when the page pushed the entry.

Hosts: All pages, Overview (a link that names a page), every tab of Internal links, and, by the other sessions,
Issues and Monitoring. A host mounts `InspectorLayout`, calls `useInspector` and renders
`<PageInspector context={…} urlId={…} />`. The crawl is the host's `run`. A host with no crawl in view shows no
drawer, as today.

### 9.2 PageInspector becomes the tabbed drawer

`inspector/page-inspector.tsx` keeps its file name and its export `PageInspector`, so the Issues web work,
which opens it today, merges with the smallest diff. In this spec "PageDrawer" names that component. It stops
taking `LinksTabContext` and takes:

```ts
export interface PageDrawerContext {
  scope: LinksScope;
  crawl: CrawlInView;
  linkScope: LinkScope;
  tiers: readonly PageTier[];
  timeZone: string;
  canWrite: boolean;
  /** Opens another page in the drawer, keeping the tab. */
  openPage: (urlId: string) => void;
  /** Exits, as links: each host builds them with `projectPath`. */
  hrefs: {
    journey: (urlId: string) => Route;
    linksFrom: (urlId: string) => Route;
    linksTo: (urlId: string) => Route;
    issueCheck: (checkId: string) => Route | null;
    taxonomy: Route;
  };
}
```

The exits were `context.setSearch({ tab: 'links', … })` and `context.openJourney`. They become links, so the
drawer works from a page that is not Internal links. `LinksTabContext` builds a `PageDrawerContext` in
`internal-links-screen.tsx`; the tabs of Internal links are otherwise untouched.

This build does not edit the shared drawer: `components/app/inspector/inspector.tsx`, `inspector-layout.tsx`,
`use-inspector.ts` and the files of `lib/inspector/` belong to the shared drawer session. `PageInspector` only
fills the shared `Inspector` (its header, tabs, body and footer).

### 9.3 Always over the table

The drawer never docks (D5). At every width it lies over the page, and the table under it keeps its full width
and its own scroll, so the 1280 by 720 budget of section 8 does not depend on the drawer. The width (one saved
width for the whole app), the resize limits and the full-width sheet on a narrow window are the shared
`Inspector`'s, with its props unchanged. No width of its own and no new breakpoint is introduced here.

### 9.4 Tabs

`InspectorTabs` with five items, in the owner's order. The header keeps the path, the title line, the position
("12 of 986") and Previous and Next. The footer keeps Copy address, Visit and Open in journey.

**Overview.** The page at a glance.

- Chips: status code, Indexable or the reason, In sitemap or Not in sitemap, tier badge, "Parameter variant"
  when it is one. All from `PageRow`.
- Eight tiles in one joined panel, four by two. Each is a button that opens a tab, with an aria label
  "Clicks: 1,240, last 28 days. Opens the Search tab."

  | Tile | Value | Note | Opens | Source |
  |---|---|---|---|---|
  | Clicks | `extras.gsc.clicks` | last 28 days | Search | page detail |
  | Impressions | `extras.gsc.impressions` | last 28 days | Search | page detail |
  | Tracked keywords | count of `extras.keywords` | best rank, or "none rank yet" | Search | page detail |
  | AI citations | `extras.citations.total` | last 28 days | AI | page detail |
  | Links in | `linking_pages` | "editorial, n in all" | Links | page detail |
  | Links out | `outlinks` | "editorial, n in all" | Links | page detail |
  | Depth | `click_depth` | "clicks from the home page", or "Not reachable by links" | Links | page detail |
  | Issues | from `usePageIssues` | most severe count, or "None found" | Issues | seam 10.1 |

  A Search Console tile shows "Not connected" or "Not collected yet" from `extras.gsc.state`, never 0. The
  Issues tile is absent while the seam is `unavailable`; the panel is then seven tiles and the grid closes up.
- Needs attention: the existing flags list with what each means (`pageFlags`, `flagText.*`). When the Issues
  seam is available it lists the page's issues instead, most severe first, at most five, with "See all" to the
  Issues tab.
- About: title, address (with copy), canonical, redirect target when it redirects, last crawled.
- Tier and tags: the existing tier select with its origin line and "Reset to rule", the tags with add and
  remove, on one line where they fit.

**Search.** In this order:

1. Search Console in the last 28 days: clicks and impressions totals, and one chart of the days
   (`ChartFrame`, `variant="inspector"`, `kind="line"`, two series, with its table). Data: the new read of 9.5.
   States: not connected (with the link to Integrations for a member who may connect), not collected yet, and
   "Google reported no clicks or impressions for this page in these 28 days".
2. The slot `PageSearchDetailSlot` (10.3): nothing is drawn while it is empty.
3. Tracked keywords: the existing keywords card of `extras-sections.tsx` (keyword, rank, change, volume).

**Issues.** The list from `usePageIssues` (10.1): each issue with its severity badge, its name and what was
found, and a link "See all pages with this issue" (`hrefs.issueCheck`). While the seam is `unavailable`, the
tab shows the existing flags with their texts under the line "Checks from the Issues page appear here once
they are available", so the tab is never empty and never invented. When the page has none: "No issues found on
this page".

**AI.** The existing citations card (ChatGPT, Gemini, Google AI Mode, total, the date). With none: "No AI
answer cited this page in the last 28 days".

**Links.** The strip (depth, links in, links out), linking pages by tier and by placement, the anchors card,
the changes card, linking pages and outlinks (`NeighborSection`, unchanged), with "View all in Links" as links.

Nothing of today's inspector is dropped; every section has a tab.

### 9.5 One small read for the Search tab

`GET /api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/pages/{url_id}/search?run=latest`

Needs `data:read`. `404 not_found` when the crawl in view has no such page, as the page detail.

```json
{
  "data": {
    "state": "ok",
    "window_start": "2026-10-28",
    "window_end": "2026-11-24",
    "clicks": 1240,
    "impressions": 31800,
    "days": [ { "date": "2026-10-28", "clicks": 40, "impressions": 1100 } ]
  }
}
```

`state` is `ok`, `pending` or `not_connected` (the meanings of `extras.gsc_window`). With `ok`, `days` has one
row per day of the window, a day without a stored row as zeros; otherwise `days` is empty and the numbers are
`null`. The window is the property's stored window, 28 days; the table keeps 35 days, so no longer period can
be offered. Implementation: `extras.gsc_window`, then one `SELECT metric_date, clicks, impressions FROM
fp.gsc_page_daily` for the integration, the URL and the window, in `extras.py`; schema `PageSearchDaily` in
`schemas/internal_links_extra.py`; route in `read_routes.py`; a row in `test_route_access.py`.

If the Search Console session ships a series route for any page first, the web hook `usePageSearchDaily` reads
that one and this route is not built. The hook is the contract, not the path.

## 10. Seams

Each seam is one small typed module in `apps/web/src/lib/pages/`. On this branch each answers `unavailable`.
The owning session replaces the body of the module; no component of this build changes.

### 10.1 Issues (owner: the Issues session)

```ts
// lib/pages/issue-source.ts
export type IssueSeverity = 'error' | 'warning' | 'notice';
export interface PageIssue { checkId: string; severity: IssueSeverity; detail: string | null }
export type Seam<T> = { state: 'unavailable' } | { state: 'loading' } | { state: 'error'; retry: () => void }
  | { state: 'ready'; data: T };

/** The strip and card 7 of the Overview: the `summary` of `GET …/issues`. */
export function useIssueTotals(scope: LinksScope, run: string | null):
  Seam<{ withIssue: number; error: number; warning: number; notice: number }>;
/** The drawer's Issues tab and tile: every issue of one page. */
export function usePageIssues(scope: LinksScope, run: string | null, urlId: string): Seam<readonly PageIssue[]>;
/** Whether the pages list offers `include=issues`, the sort `issues` and `filter[view]=with_issues`. */
export const ISSUE_COLUMNS_AVAILABLE: boolean;
/** The Issues column's numbers of one row, read from its `extras`; null on this branch. */
export function issueCountsOf(row: PageRow): { error: number; warning: number; notice: number } | null;
```

What the Issues session must add for the three parts, as a request, not as work of this build:

| Part | Needs |
|---|---|
| `useIssueTotals` | Nothing new: `GET …/issues` is built on its branch. Wiring only. |
| `usePageIssues` | A read of the checks that match one page, for example `GET …/issues/pages/{url_id}`, built from `rules.condition` per check. |
| Issues column, its sort, the view With issues, the section split of Overview card 3 | Per-row counts on the pages list: `include=issues` giving `extras.issues: { error, warning, notice }`, a sort key `issues`, and `with_issues` as a `filter[view]`. |

### 10.2 Tracking (owner: the Monitoring session)

```ts
// lib/pages/tracking.ts
export const TRACKING_AVAILABLE: boolean; // false on this branch
export interface TrackOutcome { added: number; alreadyTracked: number; notLive: number; overLimit: number; limit: number }
export function useTrackedPages(scope: LinksScope): Seam<ReadonlySet<string>>; // url ids
export function useTrackPages(scope: LinksScope): { track: (urlIds: readonly string[]) => Promise<TrackOutcome>; pending: boolean };
```

The Tracked column, the Tracked view and the bulk action read only this module. The real limit and the real
table are the Monitoring session's: doc 32 plans `core.watched_pages`, the quota key `watched_pages` (200 per
project by default), the permission `pages:write` and `POST …/page-performance/watchlist` with per-URL outcomes
(`added`, `already_watched`, `over_quota` and others). Two requests to that session: accept URL ids (the doc's
body takes URL strings), and return the limit with the outcome. Sorting by Tracked and the view `tracked` need
its table joined in `page_sort.py` and `inventory.py`; that is its change, in those two files.

### 10.3 Search detail (owner: the Search Console session)

```ts
// lib/pages/search-detail-slot.tsx
export interface PageSearchDetailProps { scope: LinksScope; urlId: string; url: string; timeZone: string }
/** The queries, countries and devices of one page. Renders nothing on this branch. */
export function PageSearchDetailSlot(props: PageSearchDetailProps): ReactElement | null;
```

It is drawn in the drawer's Search tab between the daily chart and the tracked keywords. The Search Console
session fills it, and may replace the body of `usePageSearchDaily` (9.5) with its own series read.

## 11. Words and messages

Glossary first (`docs/glossary/terms.md`, in its own commit, done in afc686bf): Pages (A5) is redefined as the Website audit page
with its three tabs; All pages is added; Website audit is added with the text of the Issues branch, so the two
branches add the same line. `final-list.md` follows `terms.md`.

Messages: a new namespace `pages` in `apps/web/messages/en.json` for the screen, the Overview cards, the View
menu, the new filters and the drawer's tabs and tiles. The moved table and the drawer sections keep their keys
under `internalLinks` (`internalLinks.pages.*`, `internalLinks.columns.*`, `internalLinks.inspector.*`), so
their tests and translations do not move. `navigation.items.pages` exists ("Pages").

Rules that bite here (`src/lib/glossary/glossary-words.test.ts` fails on a banned word in `en.json`):

- "Tracked", never "Monitored". The tab is "Monitoring"; sentences say "the pages you track".
- "Search Console", never its abbreviation. "Best rank", never "Rankings" or "Ranking" as a noun.
- No "Source" as a label. No "No data" and no "N/A": a state says what is true ("Not connected", "Not
  collected yet", "None found").
- "Parameter variant", "Orphan page", "Tier", "Untiered", "Linking pages", "Outlinks" as Internal links
  already writes them.
- No em-dash or en-dash in any string. Ranges are written "0 to 6".

Accessibility, by the rules the repository already has (`AI_DEVELOPMENT_UI_RULES.md`, `DESIGN_SYSTEM.md`):

- The table is one tab stop with arrow-key movement inside (`data-table/grid-focus.ts`); nothing here changes it.
- A change of view is announced with its count through `announce` (`lib/a11y/announcer`), which the table
  already uses for the selection.
- Every chart has its table (the `ChartFrame` switch) and a text summary (`summary`); after the switch, focus
  stays on the switch.
- A mark that opens a list is a link with a name that says where it goes ("Live pages, 389. Opens All pages").
- Colour is never the only sign: status groups and severities carry their words.
- The drawer's tiles are buttons with full aria labels; J and K step through the visible rows as today.

## 12. Tests

Targeted and serial only (the machine rule): `pytest -n 0 --no-cov <path>`, `vitest run --maxWorkers=1 <path>`.

**Backend** (`backend/tests/api/internal_links/`):

- `test_inventory.py`: one seeded crawl with one known case of each kind, the cases of the mock's
  `pages-overview-data.check.mjs` plus a blocked page (403), a variant, a 200 that is not HTML, a page with no
  status, a page at depth 9 and a top-level page. It asserts the mock's invariants on the real read:
  the seven status groups add up to `addresses`; indexable plus not indexable equals live; reachable plus
  unreachable equals live; the depth rows add up to reachable and depth 9 lands in row 6; the tiers add up to
  live; the sections add up to live when there are 50 or fewer; indexable in the sitemap plus indexable missing
  equals indexable.
- The same file: for every view of `PageView`, the overview's number equals `meta.total` of the pages list
  with `filter[view]`. This is the test of D8.
- `no_sitemap`: the four sitemap counts are null and the sitemap views match nothing.
- `filter[folder]`, `filter[depth]`, the sort `impressions` (paging over a tie, a page with no row sorts as 0),
  `filter[view]` with `filter[worklist]` is `422`, and the CSV honours `filter[view]`.
- The page search read: `ok` with zero days filled, `pending`, `not_connected`, a page of another crawl is 404.
- Workspace isolation and `data:read` for both new routes, `tests/api/test_route_access.py`,
  `tests/api/test_openapi.py`.

**Web:**

- `lib/pages/overview-model.ts` (pure): turns the overview answer into the strip, the rows of each card with
  their shares and their hrefs, the folded "Other sections" row, and the hidden rows (zero groups, no sitemap).
  Its test is the web half of `pages-overview-data.check.mjs`: shares use the right base, the folded row keeps
  the total, a mark's href names the view whose count it shows.
- `lib/pages/url-state.ts`: `view` read as a server view or a worklist, `depth`, `variants`, unknown values
  ignored. `folder` is a key of the filter bar (`useUrlFilters`), as `tier` and `status` are, and is tested
  with the filters. `lib/pages/tabs.ts`: a planned tab is not listed.
- `seo/internal-links/page.test.tsx`: the redirect table of 5.3 (each key, `tab=pages`, a bare address, the
  query kept). `seo/pages/page.test.tsx` and `all/page.test.tsx`: copies of the Internal links route test.
- `pages-page/overview-tab.test.tsx`: the cards, the Chart and Table switch, the states, the absent cards while
  a seam is `unavailable`, no sitemap, first crawl.
- `pages-page/all-pages-tab.test.tsx`: the View menu with counts, a view in the address, the new filters, the
  default columns with and without the seams, the bulk action hidden without tracking. The existing
  `pages/*.test.tsx` keep passing after the context change.
- `inspector/page-inspector.test.tsx`: five tabs in order, each tile opens
  its tab, `itab` in the address, the seam states of the Issues tab and tile, the Search tab's three Search
  Console states, the exits as links.
- `lib/navigation/registry.test.ts`, `src/i18n/messages.test.ts`, `src/lib/glossary/glossary-words.test.ts`.
- Mock handlers for the two new routes in `apps/web/src/mocks/handlers/` beside the internal links handlers,
  so the page can be checked on the mocked app.

**On the running app** (by the lead, mocked app on a free port, stopped after): the first row of All pages at
1280 by 720 and at a wide screen; the drawer over the table, which keeps its width (9.3); every Overview
mark opens a list whose total is the mark's number.

## 13. Not in this build

- Monitoring: its tab, route, table, API, limit and the Tracked data.
- The Search tab's queries, countries, devices, average position and any period other than the stored 28 days.
- "Indexed by Google" anywhere.
- Per-page issue counts, the Issues column's data, the list of a page's issues.
- Page types.
- Per-user stored views and remembered columns outside the address.
- A filter by exact status code.
- The mock's "Landing pages" tab (removed by the owner) and its rank columns beyond the existing ones.
- Trends of the Overview numbers over crawls. Every crawl's pages are kept, so it is possible later.
- Doc updates of `docs/20-frontend-specification.md` section 5.5 and `docs/32-page-performance.md` section 5.1,
  which still describe the old Pages tabs. They are updated when Monitoring ships.

## 14. Merge points with the other sessions

| File | This build | Issues | Search Console and Monitoring | On conflict |
|---|---|---|---|---|
| `apps/web/src/lib/navigation/registry.ts` | `pages` becomes `live` | adds the group `audit`, `issues`, reorders | none expected | Keep the Issues structure; apply `status: 'live'` to its `pages` entry |
| `apps/web/messages/en.json` | namespace `pages` | namespace `issues`, `navigation.groups.audit`, `navigation.items.issues` | its own namespace | Keep all; the namespaces do not overlap |
| `backend/openapi/v1.json`, `apps/web/src/lib/api/schema.ts` | two routes, `filter[view]`, `filter[folder]`, `filter[depth]`, the sort `impressions` | the issues routes, `filter[issue]`, `include=issue` | its routes | Never merge by hand: regenerate both after the merge (`backend` first, then `pnpm gen:api` in its own commit) |
| `backend/src/idraft/api/internal_links/read_routes.py`, `schemas/internal_links.py` | parameters and `PageFilter.view`, `folder`, `depth` | `filter[issue]`, `PageExtras.issue` | maybe a tracked sort | Keep both sets of parameters |
| `backend/tests/api/test_route_access.py` | two rows | one row | its rows | Keep all rows |
| `docs/glossary/terms.md`, `final-list.md` | A5 changed, All pages added, Website audit (same text as Issues) | A12 to A14, U9b, U13 to U15 | Monitoring, Tracked wording | Keep both; drop the duplicate Website audit row |
| `docs/design-system/11-navigation.md` | the Pages row | the group and the Issues row | the Monitoring tab | Keep all |
| `features/internal-links/inspector/` | tabbed, same file and export name, new context type | opens it from Issues | fills the Search slot | The other sessions pass a `PageDrawerContext` instead of `LinksTabContext` |
| `components/app/inspector/`, `lib/inspector/` | no change | none expected | none expected | The shared drawer session (`claude/shared-drawer-121ede`) owns them: take its version |

## 15. What blocks or narrows the build

1. **Monitoring does not exist.** Tracked (column, view, sort) and "Track in Monitoring" ship as seams that
   render nothing. The owner's default column set is complete only after the Monitoring session delivers.
2. **No per-page issue read exists, even on the Issues branch.** The Issues column, the With issues view, the
   drawer's Issues list and the section split wait for the request of 10.1. The Overview's issue totals need
   only wiring once that branch merges.
3. **Two sessions may build the same daily series.** Section 9.5 names the hook as the contract. The two
   sessions should agree which route exists before either builds it.
4. **The order of the Internal links tabs changes** (Journey first) as a consequence of D2. The owner saw this
   order in the mock; it was outside the Issues session's scope and is taken here.

## 16. Acceptance checklist

Routes and sidebar

- [ ] `/seo/pages` shows Overview, `/seo/pages/all` shows All pages, both under `data:read`, with the states of
      the crawl (no website, never crawled, first crawl running or failed).
- [ ] The sidebar shows Pages. After the Issues merge the group Website audit lists Pages, Issues, Internal
      links.
- [ ] Monitoring is not listed as a tab and `/seo/pages/performance` is the 404 page.
- [ ] `/seo/internal-links?tab=pages&view=orphans&tier=none` lands on `/seo/pages/all?view=orphans&tier=none`.
      A bare `/seo/internal-links` opens Journey. No tab named Pages remains in Internal links.

Overview

- [ ] The strip and the eight cards show the numbers of the crawl in view; choosing an older crawl changes them.
- [ ] The seven status groups add up to Addresses crawled. Every other number counts live pages, and its
      tooltip names its base.
- [ ] Every mark, legend row and table row that names pages opens All pages, and the list's total equals the
      number on the mark.
- [ ] Each chart switches to its table and back, with the keyboard, and keeps the focus.
- [ ] There is no "indexed by Google" number and no sample data anywhere.
- [ ] With no sitemap the sitemap card says so and the funnel has three rows.
- [ ] On a first crawl the card "Since the last crawl" says there is nothing to compare yet.
- [ ] The issue numbers are those of the Issues page, or are absent while that page is not merged.

All pages

- [ ] At 1280 by 720 the first row starts at or above 224 px (section 8) with no filter and no banner. The page does not
      scroll; the table scrolls inside its panel under a pinned header.
- [ ] The header shows the groups Page, Indexing, Issues, Search, AI, Links over their columns, and the Columns
      menu lists the columns under the same groups.
- [ ] Default columns: Tier, Status, Indexable, Flags, Clicks; Issues replaces Flags and Tracked appears when
      their seams are filled.
- [ ] The View menu lists the built-in views with counts, then Link problems; the view, filters, search, sort,
      columns and density are all in the address, and the address reproduces the table.
- [ ] Folder and Status filter the list; search finds by path and by a pasted address.
- [ ] Previous and Next page through the list; "select all matching" and the bulk tier and tag changes work as
      before; Export downloads the filtered list, the view included.
- [ ] "Track in Monitoring" is absent until tracking exists, and then respects the limit the API reports.

Drawer

- [ ] A row opens the drawer on Overview; the tabs are Overview, Search, Issues, AI, Links; the tab is in the
      address; J and K step through the rows and keep the tab.
- [ ] The eight tiles open their tabs. There is no Track control in the drawer.
- [ ] The Search tab shows 28 days of clicks and impressions for any page, or says why it cannot, and the slot
      for the Search Console detail renders nothing.
- [ ] The Issues tab shows the page's flags with the note of 9.4 until the Issues data exists.
- [ ] The drawer opens from every tab of Internal links exactly as before, and its exits (journey, links) are
      links that work from All pages.
- [ ] At every width the drawer lies over the table and the table keeps its width; no shared drawer file is
      changed by this build.

Quality

- [ ] No banned word, no em-dash and no en-dash in `messages/en.json`; the glossary test passes.
- [ ] Backend: ruff, mypy, the import contracts and the targeted tests pass; `openapi/v1.json` is regenerated.
- [ ] Web: lint, typecheck, format check and the targeted tests pass; the client is regenerated in its own
      commit.
