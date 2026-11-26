# Pages: Overview, All pages and the page drawer: design

Status: written 2026-11-26 for the real-app build. The owner's settled decisions are in section 1. Technical
decisions taken here are numbered D1 to D16 in section 3, each with its reason. What blocks or narrows the build
is in section 15.

Reference mock (not committed, read only, main checkout): `apps/web/design-preview/pages-overview.js`,
`pages-overview-data.js`, `pages-overview-data.check.mjs`, `il.js` (`showPagesIn`), `il-pages.js`, `il-drawer.js`,
`il-model.js`, `il-outline.js`, `outline-data.js`, `il-notes.js`, `issues-audit.js`, `perf.js`, `interactions.js`, `index.html`.

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
7. The page drawer opens for any page, with the tabs Overview, Search, Outline, Issues, AI, Links, Notes, in
   that order, and no Track box. Its Overview is the page at a glance: chips, 8 tiles that open the tabs, needs attention, about,
   tier and tags.
8. The drawer's Search tab shows what exists today and leaves a named slot for the detail the Search Console
   session adds (queries, countries, devices).
9. Added 2026-11-26: the drawer has an Outline tab for every live page, between Search and Issues. It shows what
   the page says to a search engine: four numbers (H1, Headings, Words, Images), then six folding blocks
   (Search listing, Headings, Languages, Social sharing, Structured data, Content), each with a one-line
   summary and a Fine or To fix chip. It is read on demand from the stored HTML of the latest crawl: no new
   storage and no provider spend.
10. Added 2026-11-26: the drawer has a Notes tab on every page, last in the strip. The team writes what changed
    on a page and when; a note shows its author and the date and time. The author can edit or delete their
    own note (delete has Undo). Notes belong to the page's address, so they stay across crawls and exist for
    redirect and error pages too. Everyone in the workspace sees them. Built in full, with its own table.

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

**Notes.** `Permission.NOTES_WRITE` (`notes:write`: owner, admin, editor; owner decision D-18) exists, and
`backend/src/idraft/api/notes/routes.py` holds three routes for notes on a project's charts (`{P}/notes`) that
answer `501`. They are another thing (a note on a day of a chart) and are not touched. No table holds a note
on a page. `api/audit.py` records project writes (`audit.record`, the `AuditAction` literal;
`page_tags.changed` is the pattern for a page write).

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
| D13 | The Outline is read on demand: one route parses the page's stored HTML (`html_key`, latest crawl only) with the standard library and returns the whole outline. Nothing is stored. | The crawl keeps only the title and the canonical per page, but the raw HTML of the latest crawl is in object storage. A read on demand needs no migration, no re-read of a crawl and no provider call. |
| D14 | The parser is one pure module, `backend/src/idraft/crawl/outline.py`, with the limits (title 30 to 60, description 70 to 160, thin under 200 words) as its constants. The Issues session's slice 2 fills its new `crawl_pages` columns by calling the same functions. | Then the Outline and the Issues checks cannot disagree on a count. The Issues branch has no HTML reader yet (its plan names "an extractor beside `crawl/head.py`"), so this build writes it and that session reuses it. |
| D15 | Notes are rows of a new table `core.page_notes`, keyed by project and `core.urls.id`, never by a crawl page row. A delete sets `deleted_at`. | A note must outlive the crawl it was written under and must exist for an address that redirects or errors. A soft delete makes Undo one request and keeps the audit trail readable. |
| D16 | Reading notes needs `data:read`; writing needs the existing `notes:write`. Only the author changes a note; the author, an owner or an admin deletes one. The page detail carries `notes_count`. | The permission exists for exactly this kind of write and editors hold it. An admin can clear a note nobody else can, without a new permission. The count on the detail gives the tab its badge with no extra request. |

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

`?inspect=page:<url_id>` opens it; `itab` is `search`, `outline`, `issues`, `ai`, `links` or `notes`, and absent for Overview
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
  /** `notes:write`: may add a note, and change or delete their own (9.7). */
  canNote: boolean;
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

`hrefs.issueCheck` serves two places: "See all pages with this issue" of the Issues tab and "See in Issues" of
the Outline tab (9.6). It answers `null` while the Issues page is not on the branch, and both links are then
not rendered.

This build does not edit the shared drawer: `components/app/inspector/inspector.tsx`, `inspector-layout.tsx`,
`use-inspector.ts` and the files of `lib/inspector/` belong to the shared drawer session. `PageInspector` only
fills the shared `Inspector` (its header, tabs, body and footer).

### 9.3 Always over the table

The drawer never docks (D5). At every width it lies over the page, and the table under it keeps its full width
and its own scroll, so the 1280 by 720 budget of section 8 does not depend on the drawer. The width (one saved
width for the whole app), the resize limits and the full-width sheet on a narrow window are the shared
`Inspector`'s, with its props unchanged. No width of its own and no new breakpoint is introduced here.

### 9.4 Tabs

`InspectorTabs` with seven items, in the owner's order: Overview, Search, Outline, Issues, AI, Links, Notes.
The Notes item carries the count of the page's notes (`TabItem.count`) when there is at least one. Seven tabs
do not fit the drawer at its least width (480 px), so the row is given `overflowLabel` ("More sections"): the
tabs that do not fit move into the More menu the shared tabs already have, last tabs first. The header keeps the path, the title line, the position
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

**Outline.** What the page says to a search engine, read from the stored HTML of the latest crawl. Section
9.6 describes the read and the tab.

**Issues.** The list from `usePageIssues` (10.1): each issue with its severity badge, its name and what was
found, and a link "See all pages with this issue" (`hrefs.issueCheck`). While the seam is `unavailable`, the
tab shows the existing flags with their texts under the line "Checks from the Issues page appear here once
they are available", so the tab is never empty and never invented. When the page has none: "No issues found on
this page".

**AI.** The existing citations card (ChatGPT, Gemini, Google AI Mode, total, the date). With none: "No AI
answer cited this page in the last 28 days".

**Links.** The strip (depth, links in, links out), linking pages by tier and by placement, the anchors card,
the changes card, linking pages and outlinks (`NeighborSection`, unchanged), with "View all in Links" as links.

**Notes.** What the team wrote about this page, newest first, with a box to add one. Section 9.7.

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

### 9.6 The Outline tab

Owner addition of 2026-11-26 (D13, D14). Mock: `il-outline.js` (the tab), `outline-data.js` (the shape, sample
data), `il-drawer.js` (the tab strip).

#### 9.6.1 The read

`GET /api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/pages/{url_id}/outline`

Needs `data:read`. It takes no `run`: the stored HTML is one object per project and URL, overwritten by the
next crawl, so the read is always of the latest crawl with data (`latest_run`). `404 no_crawl` before any
crawl, `404 not_found` when the latest crawl holds no such page, as the page detail. Every other case answers
`200` with a `state`; a storage failure is never a `5xx`.

| `state` | When | `outline` |
|---|---|---|
| `ok` | The page is live (counted or variant, `status_code = 200`, `resource_type = 'html'`) and its HTML was read | set |
| `redirect` | `status_code` from 300 to 399. Decided from the crawl row; storage is not read | null |
| `error` | Any other status that is not 200, or no status. Decided from the crawl row | null |
| `not_html` | A 200 that is not HTML | null |
| `no_html` | The page is live but its HTML cannot be read: object storage is not set up, the object is missing (a crawl older than the HTML store, or the provider gave no HTML), or it cannot be unpacked | null |

```json
{
  "data": {
    "state": "ok",
    "run_id": "0192f0a1-3c44-7e10-8a51-2b7d9c0e4f11",
    "status_code": 200,
    "outline": {
      "url": "https://example.com/managed-soc-service",
      "truncated": false,
      "title": { "text": "Managed SOC service | Example", "chars": 29, "state": "short" },
      "description": { "text": "…", "chars": 142, "state": "ok" },
      "canonical": { "state": "self", "href": "https://example.com/managed-soc-service" },
      "robots": { "meta": "index, follow", "noindex": false },
      "html_lang": "en",
      "headings": [ { "level": 1, "text": "Managed SOC service" }, { "level": 2, "text": "How it works" } ],
      "headings_total": 23,
      "level_counts": [1, 8, 14, 0, 0, 0],
      "skipped_at": null,
      "languages": {
        "x_default": true,
        "pairs": [ { "code": "en-UK", "href": "https://example.com/uk/managed-soc-service", "is_self": false, "valid": false, "suggestion": "en-GB" } ]
      },
      "social": { "og_title": "…", "og_description": null, "og_image": "https://example.com/og/soc.png", "og_type": "website", "twitter_card": "summary_large_image" },
      "structured_data": [ { "types": ["Service"], "parses": true }, { "types": [], "parses": false } ],
      "content": { "words": 1240, "read_minutes": 5, "thin": false, "images": 9, "images_without_alt": 2 }
    }
  }
}
```

Typed fields (`schemas/internal_links_extra.py`):

| Field | Type | Meaning |
|---|---|---|
| `state` | `ok`, `redirect`, `error`, `not_html`, `no_html` | the table above |
| `run_id` | uuid | the crawl that was read (the latest) |
| `status_code` | int or null | of the crawl row |
| `outline.url` | string | `core.urls.url` of the page |
| `outline.truncated` | bool | the HTML was longer than the byte cap and was read up to it |
| `title`, `description` | `{ text: string or null, chars: int, state }` | `state` is `ok`, `short`, `long` or `missing`; `chars` is the length after trimming, before any cut of `text` |
| `canonical` | `{ state: self, elsewhere or none, href: string or null }` | from the crawl row, see below |
| `robots` | `{ meta: string or null, noindex: bool }` | `meta` is the content of the first `<meta name="robots">`; `noindex` is from the crawl row |
| `html_lang` | string or null | the `lang` of `<html>` |
| `headings` | list of `{ level: 1 to 6, text }` | document order, at most 200 |
| `headings_total` | int | every heading the parser saw, also past the 200 |
| `level_counts` | six ints | headings per level H1 to H6, counted over all of them; `level_counts[0]` is the H1 count |
| `skipped_at` | int or null | index in `headings` of the first heading more than one level deeper than the one before it |
| `languages` | `{ x_default: bool, pairs: [{ code, href, is_self, valid, suggestion }] }` | `<link rel="alternate" hreflang>` of the head, at most 100; the `x-default` pair is in the list |
| `social` | five strings or nulls | `og:title`, `og:description`, `og:image`, `og:type`, `twitter:card` |
| `structured_data` | list of `{ types: [string], parses: bool }` | one row per JSON-LD block, at most 20 |
| `content` | `{ words, read_minutes, thin, images, images_without_alt }` | of the body text and the `<img>` elements |

**Where each verdict comes from.** A fact that an Issues check of slice 1 already reads from the crawl row is
taken from the same row with the same rule, not from a second parse, so the two screens agree:

| Fact | Source | Rule |
|---|---|---|
| title `text`, `chars`, `state` | `crawl_pages.title` | trimmed; `missing` when empty, `short` under 30, `long` over 60 (Issues spec section 4: `title-missing`, `title-short`, `title-long`) |
| `canonical` | `crawl_pages.canonical_url_id` | null is `none`; the page's own id is `self`; another id is `elsewhere` with that address (`canonical-elsewhere`: `canonical_url_id IS NOT NULL AND canonical_url_id <> url_id`) |
| `robots.noindex` | `crawl_pages.non_indexable_reason` | true when the reason is `meta_tag` or `http_header` (`noindex`, as `api/issues/rules.py` of the Issues branch writes it). A noindex sent as a header is therefore true while `robots.meta` shows no noindex |

On the Issues branch the title limits are `TITLE_MIN` and `TITLE_MAX` of `api/issues/catalogue.py`; here they are
constants of `crawl/outline.py` with the same values (30 and 60). At the merge one of the two imports the other
(section 14).

Everything else is parsed from the HTML by `crawl/outline.py`, whose functions and constants are the definitions
the Issues session's slice 2 uses for its columns (D14): description (`description-missing`, 70 to 160), H1
count (`h1-missing`, `h1-multiple`), hreflang pairs and their validity (`hreflang`), Open Graph tags
(`social-tags`: no `og:title`), JSON-LD blocks that do not parse (`schema-errors`), word count
(`thin-content`: under 200 words) and images without alt text (`image-alt`: an `<img>` with no `alt`
attribute; an empty `alt` is a decorative image and counts as described).

Two things the mock shows are not readable from one page's HTML and are not in the answer (rule 4 of section
1): whether other pages use the same description (`description-duplicate` is known only to the Issues page;
the tab shows it only when `usePageIssues` lists it), and the size of the sharing image or a note on what is
wrong inside a JSON-LD block (a block parses or it does not).

"Internal links out" of the Content block is `outlinks` of the page detail, which the drawer already holds.

#### 9.6.2 The parser and its limits

`backend/src/idraft/crawl/outline.py`, pure (standard library `html.parser`, `json`, `re`; it may import
`idraft.crawl.head`, `placement` and `mentions`, nothing else of the app). The import contract "crawl is pure"
already forbids the database, storage and the API there, and `api/` already imports `idraft.crawl`.

```python
TITLE_MIN, TITLE_MAX = 30, 60
DESCRIPTION_MIN, DESCRIPTION_MAX = 70, 160
THIN_WORDS = 200          # fewer words than this is thin
WORDS_PER_MINUTE = 230
HTML_BYTES_MAX = 2_000_000
HEADINGS_MAX = 200
HEADING_TEXT_MAX = 200
META_TEXT_MAX = 1_000
HREF_MAX = 2_048
HREFLANG_MAX = 100
JSONLD_BLOCKS_MAX = 20
JSONLD_BLOCK_CHARS_MAX = 200_000
JSONLD_TYPES_MAX = 10

def length_state(chars: int, low: int, high: int) -> LengthState: ...
def hreflang_valid(code: str) -> tuple[bool, str | None]: ...
def parse_outline(html: str, page_url: str) -> ParsedOutline: ...
```

- The HTML is untrusted. `parse_outline` never raises: every parser call sits in a `try` that keeps what was
  read so far, as `crawl/head.py` does. A test feeds it truncated tags, a megabyte of `<`, 10,000 nested
  elements, deeply nested JSON, invalid UTF-8 replaced on decode, and a null byte.
- Bytes: the route inflates at most `HTML_BYTES_MAX` bytes of the stored object (a streamed read, not the whole
  frame) and sets `truncated` when there was more. Counts: every list and every text has a cap from the table
  above; a text over its cap is cut and `chars` keeps the true length.
- Headings are the `h1` to `h6` elements of the body, outside `template`, `script`, `style` and `noscript`;
  the text is the element's text with whitespace as one space.
- A hreflang code is valid when it is `x-default`, or a language of ISO 639-1 with an optional script (four
  letters) and an optional region of ISO 3166-1 alpha-2, compared without letter case. The two code lists are
  constants in `backend/src/idraft/crawl/lang_codes.py`. `en-UK` is not valid (`UK` is not an assigned
  region) and gets the suggestion `en-GB`. An href is resolved against the page and kept only when it is an
  http or https address, as `head.py` does for the canonical.
- A JSON-LD block is a `<script type="application/ld+json">`. `parses` is whether `json.loads` reads it;
  `types` are the `@type` values of the top level, of a top-level list and of `@graph`.
- Words are the words (`[^\W_]+`) of `mentions.visible_blocks(html)`: the text of `main` or `article` when the
  page has one, else of the body, without menus, header, footer and scripts. `read_minutes` is words over 230,
  rounded, at least 1.
- Known limit: the object is overwritten while a new crawl runs, so until that crawl finishes the HTML can be
  newer than the crawl row beside it. The tab's footer names the latest crawl; nothing more is done.

The route (`reads.py` `LinkReadService.page_outline`) reads the crawl row in the workspace transaction, leaves
it, reads the object and parses in a thread (`asyncio.to_thread`), so a page of megabytes holds up neither the
database nor the event loop. `LinkReadService` gains the object store the API already opens for imports
(`Resources.import_store`, the raw bucket the crawl writes to); it is `None` without storage settings, which
answers `no_html`.

#### 9.6.3 The tab

Data: `usePageOutline(scope, urlId)` over the read above, asked only while the tab is open. The verdicts are
computed once on the server; the web maps states to words and to check ids, in the pure module
`lib/pages/outline-model.ts`.

In order, top to bottom:

1. **The strip**, four numbers in one joined panel (two by two in a narrow drawer):

   | Cell | Value | Note | Warns when |
   |---|---|---|---|
   | H1 | the H1 count, or "None" | "as it should be", "missing", "more than one" | not exactly one |
   | Headings | `headings_total` | "H2 8, H3 14" | never |
   | Words | `content.words` | "5 min read", or "very little text" | `thin` |
   | Images | `content.images` | "all described", or "2 without alt text" | any without alt |

   A warning is said in the note's words, not by colour alone.

2. **Six folding blocks.** Each is a bordered card whose header is one button: a caret, the title, a one-line
   summary, and a chip "Fine" or "To fix" (no chip where there is nothing to judge). The button has
   `aria-expanded` and `aria-controls`; the body is a `region` named by the title; Enter and Space fold and
   unfold; the focus stays on the button. Search listing and Headings start open, the other four closed. What
   is open is kept while you step from page to page (state of the drawer, not of the address). This is the one
   place an inspector card folds: `docs/design-system/16-drawers-dialogs-popovers.md` section 2.4 says cards
   are not collapsible, and gets one sentence that names the Outline tab as the exception.

   | Block | Summary line | Body |
   |---|---|---|
   | Search listing | "Title and description are the right length", or "2 things to fix" | A preview drawn as a search result (the host and path, the title cut at 60 characters, the description on two lines or "No description. Google picks a sentence from the page."); the findings; then the facts: Title and Description each with a length meter and its count ("29 characters, short of 30"), Canonical ("This page" with "Self", or the address with "Elsewhere", or "None named"), Robots (the meta text with "Indexable" or "Not indexed"), Language (`html_lang`) |
   | Headings | "23 headings, H1: Managed SOC service", or "No headings" | The findings (no H1, more than one H1, a skipped level), then the headings as an ordered list in document order, each with an H-level badge and an indent of one step per level. The first 12, then a button "Show all 23 headings" that becomes "Show fewer headings"; the focus stays on the button; the choice resets on another page. When `headings_total` is over 200 a last line says "The first 200 of 1,240 headings" |
   | Languages | "2 versions, with x-default", "2 versions, no x-default", or "One language (en), no versions" | One row per pair: the code, the path of the address, and "This page" or "Wrong code". A finding per wrong code with its suggestion. With no pairs: one sentence that this is fine for a site in one language, and no chip |
   | Social sharing | "Open Graph and X card set", or "No Open Graph tags" | Title, Description, Image, Type, X card; a missing one reads "Missing" |
   | Structured data | "3 blocks: Service, BreadcrumbList, FAQPage", or "No structured data" | One row per block: its types (or "Unnamed block") and "Valid JSON" or "Cannot be read". A finding per block that does not parse |
   | Content | "1,240 words, 9 images" | Words with the read time, Images with "All have alt text" or "2 without alt text", Links out ("14 internal links", from the page detail). Findings for thin content and for images without alt text |

   The length meter is a thin bar with the count beside it as text; the bar is decoration (`aria-hidden`), the
   text carries the verdict.

3. **The footer line**: "Read from the stored HTML of the latest crawl, so it shows the page as the crawler
   saw it." When the crawl in view is an older one (`crawl.older`), a line above the strip says "This is the
   outline from the latest crawl, not from the crawl you are viewing."

**Findings.** A finding is one row: a warning icon, a sentence that says what is wrong and what to do, and
"See in Issues" at its end. The link is `hrefs.issueCheck(checkId)` (10.1): a link when it gives a route,
nothing when it gives `null` (always on this branch), and nothing for a finding with no check.

| Finding | Check id |
|---|---|
| no title | `title-missing` |
| title short, title long | `title-short`, `title-long` |
| no description | `description-missing` |
| description short, description long | none |
| other pages use this description (only from `usePageIssues`) | `description-duplicate` |
| the page asks not to be indexed | `noindex` |
| the canonical names another address | `canonical-elsewhere` |
| no H1, more than one H1 | `h1-missing`, `h1-multiple` |
| a heading skips a level | none |
| a wrong hreflang code | `hreflang` |
| no Open Graph tags | `social-tags` |
| a JSON-LD block that does not parse | `schema-errors` |
| very little text | `thin-content` |
| images without alt text | `image-alt` |

**The numbers and the Issues checks.** The Outline states facts of one page; the Issues page lists the pages a
check matches. They use the same definitions: the slice 1 checks through the crawl row, the slice 2 checks
through `crawl/outline.py` (D14). One difference is by design and is said in the footer: the Outline always
reads the latest crawl, as the Issues page does today.

**Text is text.** Every string that comes from the page (title, description, headings, hreflang codes and
addresses, Open Graph values, JSON-LD types, the robots text) is rendered as a React text node. Nothing from
the page is set as HTML, used as an `href` or a `src`, or put in a `style`. The sharing image is shown as its
address in text, not drawn.

**States of the tab.**

| Case | What the tab shows |
|---|---|
| loading | a skeleton of the strip and two blocks |
| the read failed | the inline error with Retry |
| `redirect` | one sentence: "This address redirects to /new-path, so it has no content of its own. Open the page it leads to for its outline." The target is the redirect target of the page row; without one, "to another page" |
| `error` | "This address answers with 404, so there is no page to read." Without a status: "This address did not answer, so there is no page to read." |
| `not_html` | "This address is not an HTML page, so it has no outline." |
| `no_html` | "The HTML of this page was not kept in the latest crawl, so its outline cannot be shown. It appears after the next crawl." |
| `404` from the read | "This page is not in the latest crawl." |

The tab is listed for every page, so the tab strip does not change while you step through rows; a page that
is not live shows its one sentence. The sentence for a redirect or an error may be shown from the page row
without waiting for the read only while the crawl in view is the latest; with an older crawl in view the row
is that crawl's and the outline is the latest crawl's, so the tab waits for the read and uses its `state`.

### 9.7 The Notes tab

Owner addition of 2026-11-26 (D15, D16). Mock: `il-notes.js` (the tab), `il-drawer.js` (the tab strip and its
count badge).

#### 9.7.1 The table

Migration `0042_page_notes.py` (the next free revision; renumber on a conflict, section 14), written as
`0038_keyword_prompt_links.py` is: raw SQL through `statements`, `tenant_isolation`, `grants`.

```sql
CREATE TABLE core.page_notes (
    id           uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id uuid NOT NULL,
    project_id   uuid NOT NULL,
    url_id       bigint NOT NULL REFERENCES core.urls(id),
    author_id    uuid NOT NULL REFERENCES auth.users(id),
    body         text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000 AND body = btrim(body)),
    created_at   timestamptz NOT NULL DEFAULT now(),
    edited_at    timestamptz,
    deleted_at   timestamptz,
    deleted_by   uuid REFERENCES auth.users(id),
    CHECK ((deleted_at IS NULL) = (deleted_by IS NULL)),
    FOREIGN KEY (project_id, workspace_id) REFERENCES core.projects(id, workspace_id) ON DELETE CASCADE
);
CREATE INDEX page_notes_page ON core.page_notes (project_id, url_id, created_at DESC, id DESC)
    WHERE deleted_at IS NULL;
```

Row-level security by `workspace_id` (`tenant_isolation`). Grants: the API role `SELECT, INSERT` and `UPDATE`
on `body`, `edited_at`, `deleted_at`, `deleted_by` only; no `DELETE` for anyone (a row leaves only with its
project); the worker role nothing. `db/tables.py` gains `page_notes`. The schema tests that list every table
(`tests/db/test_tables.py`, the tenant column map and the seed of `tests/db/support.py`, `test_grants.py`)
and `docs/04-data-model.md` (a new section 5.4 "Page notes") get the table.

The key is the address (`core.urls.id`), so a note shows on the page in every crawl, old and new, and on an
address that now redirects or errors. A note is not copied to a redirect's target.

#### 9.7.2 The API

All under `/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/pages/{url_id}/notes`, in a
new module `api/internal_links/page_notes.py` (service) and `page_note_routes.py`, wired as the other
internal links routers are.

| Method and path | Needs | Does |
|---|---|---|
| `GET …/notes` | `data:read` | The page's notes that are not deleted, newest first (`created_at DESC, id DESC`), cursor paged: `limit` 1 to 100 (default 50), `cursor`. `meta.total` is the count |
| `POST …/notes` | `notes:write` | Adds a note by the caller. `201` with the note |
| `PATCH …/notes/{note_id}` | `notes:write`, and the caller is the author | Changes the body. `edited_at` is set only when the body really changed |
| `DELETE …/notes/{note_id}` | `notes:write`, and the caller is the author, or an owner or admin of the workspace | Sets `deleted_at` and `deleted_by`. `204`. Deleting a deleted note is `404` |
| `POST …/notes/{note_id}/restore` | `notes:write`, and the caller is the one who deleted it | Clears `deleted_at` and `deleted_by`. `200` with the note. This is Undo |

```json
{
  "data": {
    "id": "0192f0a1-3c44-7e10-8a51-2b7d9c0e4f11",
    "author": { "id": "0192…", "name": "Priya Nair" },
    "body": "Rewrote the title and H1.\nCheck clicks again after 8 Dec.",
    "created_at": "2026-11-24T10:12:00Z",
    "edited_at": null,
    "can_edit": true,
    "can_delete": true
  }
}
```

- `can_edit` and `can_delete` are computed for the caller on the server (author; author, owner or admin), so
  the web compares no user ids. A caller without `notes:write` gets both false.
- The body: `\r\n` becomes `\n`, then it is trimmed; 1 to 2,000 characters after that; a null character is
  refused. Anything else is `422`. Line breaks inside are kept. The body is plain text: it is stored as
  written and never read as HTML or Markdown.
- The page: `url_id` must be an address a crawl of this project holds (any crawl, not only the one in view);
  otherwise `404 not_found`. A note id of another page, another project or another workspace is `404`.
  Someone who may write notes but is not the author gets `403` on `PATCH`, and on `DELETE` unless owner or
  admin.
- An author who left the workspace: the note stays with their name; nobody can edit it, an owner or admin
  can delete it.
- Every write records one audit entry inside its transaction (`audit.record`, `target_type` `page_note`,
  `target_id` the note id): `page_note.created` (after: `url_id`, `body`), `page_note.updated` (before and
  after: `body`), `page_note.deleted` (before: `url_id`, `body`, `author_id`), `page_note.restored`. The four
  actions are added to `AuditAction`.
- `PageDetail` (the page detail read) gains `notes_count: int`: the notes of the page that are not deleted.
  It is the tab's badge.
- No limit on the notes of a page, no mentions, no notification, no attachment (section 13).

`docs/19-api-specification.md` (the paragraph that lists `{P}/notes`) and the `notes:write` row of
`docs/24-security.md` say that the permission now also covers notes on a page.

#### 9.7.3 The tab

Data: `usePageNotes(scope, urlId)` (the list, asked only while the tab is open, with "Show older notes" for the
next cursor page) and `usePageNoteWrites(scope, urlId)` (add, change, delete, restore). After a write the list
and the page detail (for `notes_count`) are read again.

Top to bottom:

1. **The box** (only with `canNote`): a `textarea` named "Add a note to /path", with the placeholder "What
   changed on this page, what is planned, what to check later", at most 2,000 characters (`maxLength`), and
   under it the button "Add note", the hint "Cmd or Ctrl + Enter saves", and, from 1,800 characters on, the
   count "1,812 of 2,000". The button is disabled while the trimmed text is empty or a save runs; an empty
   note is never sent. Cmd or Ctrl + Enter saves. After a save the box is empty and keeps the focus. A draft
   that was typed and not saved survives a tab switch, a step to another page and back, and the closing of
   the drawer, for as long as the browser tab lives: it is kept per project and page in memory
   (`lib/pages/note-drafts.ts`), not in the address and not in storage.
2. **The list**: an ordered list named "Notes, newest first". Each note: the author's initials (the app's
   `Avatar`, hidden from assistive technology), the author's name, the date and time in a `time` element
   (`dateTime` the instant; the text through `formatDetailDateTime` in the viewer's time zone,
   `browserTimeZone()`), the word "edited" when `edited_at` is set, with a tooltip "Edited" and that time
   (the tooltip's text is also the element's accessible description), and the body with its line breaks
   kept (`whitespace-pre-wrap`, long words broken).
   - With `can_edit`: an icon button "Edit note". The note's body becomes a box with "Save" and "Cancel";
     Cmd or Ctrl + Enter saves; Escape cancels the edit and does not close the drawer; after either, the
     focus returns to the note's Edit button. One note is edited at a time.
   - With `can_delete`: an icon button "Delete note". The note leaves the list at once and a toast "Note
     deleted" offers "Undo", which restores it. After a delete the focus goes to the box (or to the list's
     next note for someone who cannot write).
3. **Empty**: "No notes on this page yet. Write down what you changed and when, so the next drop or rise in
   its numbers has a reason beside it." Someone who cannot write sees the first sentence only.
4. **The footer line**: "Everyone in this workspace can read these notes. They stay with this address when the
   site is crawled again."

States: a skeleton while loading; the inline error with Retry when the list fails; a failed write keeps the
text in its box and shows an error toast with what failed. Each successful write is announced through
`announce` ("Note added", "Note saved", "Note deleted", "Note restored").

The body is rendered as a text node. A note that holds markup shows the characters; a note that holds an
address shows it as text (no automatic link in this build).

Keys: the shared drawer closes on Escape pressed inside its card and steps on J and K. The edit box handles
its own Escape (cancel the edit) and stops it there, as the mock does, so the drawer stays open; typing J or K
in either box types the letter. Escape in the add box closes the drawer as anywhere else, and the draft is
kept. This build tests all three against the real `Inspector` and changes no shared file; if the shared drawer
cannot be stopped from inside a field, that is a request to the shared drawer session, not a workaround here.

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
| "See in Issues" of the Outline tab (9.6.3) | Nothing new here: `hrefs.issueCheck` of each host returns the route of the check once `/seo/issues` exists. Its slice 2 extractor calls `crawl/outline.py` (D14). |

The Outline's links add no seam of their own. They follow the rule of the Issues tab's "See all pages with
this issue": rendered only when `hrefs.issueCheck` gives a route, absent otherwise, never a dead or disabled
link.

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
menu, the new filters and the drawer's tabs and tiles, and `pages.drawer.outline` for the Outline tab (the
strip, the six blocks, the findings, the states, the footer), and `pages.drawer.notes` for the Notes tab. The moved table and the drawer sections keep their keys
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
- "Outline" is the tab's name (glossary row added first, in its own commit). "Fine" and "To fix" are the two
  chips. "Alt text", "Open Graph", "X card", "Structured data", "Canonical" are written this way everywhere.
  A sentence says "the latest crawl", never "the last crawl" for this tab.
- "Notes" is the tab and "Add note" its button (glossary rows first). A note is "added", "saved", "deleted"
  and "restored"; never "posted", "comment" or "annotation".

Accessibility, by the rules the repository already has (`AI_DEVELOPMENT_UI_RULES.md`, `DESIGN_SYSTEM.md`):

- The table is one tab stop with arrow-key movement inside (`data-table/grid-focus.ts`); nothing here changes it.
- A change of view is announced with its count through `announce` (`lib/a11y/announcer`), which the table
  already uses for the selection.
- Every chart has its table (the `ChartFrame` switch) and a text summary (`summary`); after the switch, focus
  stays on the switch.
- A mark that opens a list is a link with a name that says where it goes ("Live pages, 389. Opens All pages").
- Colour is never the only sign: status groups and severities carry their words.
- The drawer's tiles are buttons with full aria labels; J and K step through the visible rows as today.
- The Outline's folding blocks are buttons with `aria-expanded` and `aria-controls` over a named region; the
  headings are an ordered list whose items say their level in text ("H2"); a chip and a meter always carry
  words.
- The note box is a labelled `textarea`; its hint and its count are tied to it with `aria-describedby`; the
  icon buttons have names ("Edit note", "Delete note"); every write is announced; the time is a `time`
  element; "edited" has its time as text for assistive technology, not only in a tooltip.

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
- `tests/crawl/test_outline.py` (pure, no database): every field of 9.6.1 on a small page; the length states
  at 29, 30, 60, 61 and at 69, 70, 160, 161; H1 none, one, two; a skipped level; an `img` without `alt`, with
  an empty `alt`, with a text; `en-UK` invalid with `en-GB` suggested, `en-GB`, `zh-Hant-TW` and `x-default`
  valid; a JSON-LD block that parses, one that does not, `@graph`; the caps (201 headings give 200 and
  `headings_total` 201; a long heading is cut; 101 hreflang pairs give 100); and the hostile inputs of 9.6.2,
  none of which raises.
- `test_page_outline.py`: `ok` from a stored object; `redirect`, `error` and `not_html` without a storage read
  (the fake store counts its reads); `no_html` for a missing object, a damaged object and no store; `truncated`
  when the HTML is over the cap; the title, canonical and noindex verdicts come from the crawl row even when
  the HTML says otherwise; a page of an older crawl only is `404`; before any crawl `404 no_crawl`.
- Workspace isolation and `data:read` for the three new routes, `tests/api/test_route_access.py`,
  `tests/api/test_openapi.py`.
- `tests/db`: the migration up and down; the table in `test_tables.py`, its tenant column and seed row in
  `support.py` (so `test_rls.py` covers it), its grants in `test_grants.py` (the API role cannot `DELETE`
  and cannot update `author_id`, `url_id` or `created_at`); the body check refuses an empty, an untrimmed
  and a 2,001 character body.
- `test_page_notes.py`: add, list newest first, cursor paging over two notes written in the same instant,
  `meta.total`; the body rules (trim, `
`, 2,000 and 2,001, only spaces, a null character); a body with
  markup comes back unchanged; change by the author sets `edited_at`, the same body does not; change by
  another editor is `403`; delete by the author, by an admin and by an owner works, by another editor is
  `403`; a deleted note is gone from the list and from `notes_count`; restore by the one who deleted it
  brings it back with its `created_at` and `edited_at`, by anyone else is `403` or `404`; a viewer reads and
  gets `403` on every write, with `can_edit` and `can_delete` false; an address no crawl of the project
  holds is `404`; a note of another page, project or workspace is `404`; a note written under one crawl is
  listed after a second crawl and on a page that now redirects; one audit row per write with its action;
  `notes_count` on the page detail.
- The five note routes in `tests/api/test_route_access.py`.

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
- `inspector/page-inspector.test.tsx`: seven tabs in order (the Notes tab with its count), each tile opens
  its tab, `itab` in the address, the seam states of the Issues tab and tile, the Search tab's three Search
  Console states, the exits as links.
- `lib/pages/outline-model.test.ts` (pure): the strip's four cells and their notes, each block's summary and
  chip, the findings with their check ids (the table of 9.6.3), the first 12 headings and the rest.
  `inspector/drawer-outline-tab.test.tsx`: Search listing and Headings open and the other four closed; a block
  folds and unfolds with the keyboard and says so (`aria-expanded`); "Show all N headings" and back, with the
  focus kept; "See in Issues" is a link when `hrefs.issueCheck` gives a route and absent when it gives `null`;
  the six states of the tab; a title holding `<img src=x onerror=alert(1)>` is shown as those characters and
  adds no element; `axe` finds nothing.
- `inspector/drawer-notes-tab.test.tsx`: add with the button and with Cmd or Ctrl + Enter; an empty or
  all-space text is not sent; the count from 1,800; the draft survives a tab switch and a step to another
  page and back; the list newest first with name, `time` and "edited"; edit and delete only where
  `can_edit` and `can_delete` say so, and no box for someone without `notes:write`; Escape in the edit box
  cancels the edit and the drawer stays open; delete, the toast, Undo; a failed write keeps the text; the
  announcements; a body `<img src=x onerror=alert(1)>` is shown as characters; line breaks are kept; `axe`.
- `lib/navigation/registry.test.ts`, `src/i18n/messages.test.ts`, `src/lib/glossary/glossary-words.test.ts`.
- Mock handlers for the five note routes and `notes_count` on the mocked page detail.
- Mock handlers for the three new routes in `apps/web/src/mocks/handlers/` beside the internal links handlers,
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
- For Notes: a Notes count column in All pages (it needs the count on every row of the pages list and its
  sort; the drawer's badge does not), notes in the CSV export, mentions, notifications, attachments, links
  made from addresses in a note, a history of a note's edits in the app (the audit log has it), a purge of
  deleted notes, and any use of the chart notes routes (`{P}/notes`).
- For the Outline: storing any of its fields, an outline of an older crawl, a rendered page (the stored HTML is
  what the server sent, before scripts run), a validator of what is inside a JSON-LD block, the size of the
  sharing image, "other pages use this description" without the Issues data, and the Issues session's slice 2
  (the new `crawl_pages` columns and the checks that read them).
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
| `backend/openapi/v1.json`, `apps/web/src/lib/api/schema.ts` | three reads, the five note routes, `notes_count`, `filter[view]`, `filter[folder]`, `filter[depth]`, the sort `impressions` | the issues routes, `filter[issue]`, `include=issue` | its routes | Never merge by hand: regenerate both after the merge (`backend` first, then `pnpm gen:api` in its own commit) |
| `backend/src/idraft/api/internal_links/read_routes.py`, `schemas/internal_links.py` | parameters and `PageFilter.view`, `folder`, `depth` | `filter[issue]`, `PageExtras.issue` | maybe a tracked sort | Keep both sets of parameters |
| `backend/tests/api/test_route_access.py` | eight rows (three reads, five note routes) | one row | its rows | Keep all rows |
| `backend/src/idraft/crawl/outline.py`, `lang_codes.py` | new: the pure HTML reader of the Outline (D14) | its slice 2 extractor calls `parse_outline` and the constants for `description`, `h1_count`, `word_count`, `images_without_alt`, `has_open_graph`, `jsonld_errors`, `hreflang`; `TITLE_MIN` and `TITLE_MAX` get one home (its `api/issues/catalogue.py` imports them from `crawl/outline.py`, since `crawl` may not import `api`) | none | One parser. If the Issues session wrote its own first, keep theirs, move the Outline to it and delete the duplicate |
| `backend/src/idraft/api/main.py`, `reads.py` (`LinkReadService.__init__`) | the service takes the object store | none expected | none expected | Keep the new argument |
| `backend/src/idraft/db/migrations/versions/0042_page_notes.py`, `db/tables.py`, `tests/db/*` | the table `core.page_notes` | maybe its slice 2 columns in a migration of its own | maybe `core.watched_pages` | Two branches may both take revision `0042`: the one that merges second renumbers its file and its `down_revision`, changes nothing else |
| `backend/src/idraft/api/audit.py` | four `page_note.*` actions | none expected | maybe its own actions | Keep all |
| `docs/04-data-model.md`, `docs/19-api-specification.md`, `docs/24-security.md` | section 5.4; the notes paragraph; the `notes:write` row | none expected | its tables | Keep all |
| `docs/design-system/16-drawers-dialogs-popovers.md` | one sentence in 2.4: the Outline's blocks fold | none expected | none expected | Keep the sentence |
| `docs/glossary/terms.md`, `final-list.md` | A5 changed, All pages added, Website audit (same text as Issues) | A12 to A14, U9b, U13 to U15 | Monitoring, Tracked wording | Keep both; drop the duplicate Website audit row |
| `docs/design-system/11-navigation.md` | the Pages row | the group and the Issues row | the Monitoring tab | Keep all |
| `features/internal-links/inspector/` | tabbed, same file and export name, new context type | opens it from Issues | fills the Search slot | The other sessions pass a `PageDrawerContext` instead of `LinksTabContext` (with `canNote` from `useCan('notes:write')`) |
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
5. **The Outline needs the stored HTML.** A page crawled before the HTML store existed, or whose HTML the
   provider did not give, has no outline until the next crawl (`no_html`). Without object storage settings
   (a local setup) every live page answers `no_html`.
6. **The thin content limit (200 words) and the description limits (70 to 160) are set here**, because the
   Issues spec names the checks but not their numbers. The Issues session confirms or changes them in
   `crawl/outline.py`, the one place both read.

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

- [ ] A row opens the drawer on Overview; the tabs are Overview, Search, Outline, Issues, AI, Links, Notes; the
      tab is in the address; in a narrow drawer the tabs that do not fit are in the More menu; J and K step through the rows and keep the tab.
- [ ] The eight tiles open their tabs. There is no Track control in the drawer.
- [ ] The Search tab shows 28 days of clicks and impressions for any page, or says why it cannot, and the slot
      for the Search Console detail renders nothing.
- [ ] The Outline tab shows, for a live page, the four numbers and the six blocks, with Search listing and
      Headings open; every block folds with the keyboard; "Show all N headings" works and keeps the focus.
- [ ] The Outline's title, canonical and noindex verdicts equal what the row of All pages says; its other
      numbers come from `crawl/outline.py` and nothing is stored.
- [ ] A redirect, an error page, a page that is not HTML and a page with no stored HTML each show one sentence
      on the Outline tab. No "See in Issues" link is rendered while the Issues page is not on the branch.
- [ ] Text from the page is shown as text: a title or heading that holds markup adds no element.
- [ ] The Issues tab shows the page's flags with the note of 9.4 until the Issues data exists.
- [ ] The Notes tab is on every page, redirects and error pages included, and shows a count when the page has
      notes. An editor adds a note with the button or Cmd or Ctrl + Enter; an empty note is not saved; 2,000
      characters at most; a draft survives a tab switch.
- [ ] Notes are listed newest first with the author, the date and time in the viewer's time zone, and "edited"
      when changed. Only the author edits; the author, an owner or an admin deletes; delete has Undo. Escape
      in an edit box cancels the edit and leaves the drawer open.
- [ ] A note written before a new crawl is still on the page after it. A viewer reads notes and sees no box
      and no edit or delete button. A note that holds markup is shown as its characters.
- [ ] Every note write has its audit entry; no route removes a note's row.
- [ ] The drawer opens from every tab of Internal links exactly as before, and its exits (journey, links) are
      links that work from All pages.
- [ ] At every width the drawer lies over the table and the table keeps its width; no shared drawer file is
      changed by this build.

Quality

- [ ] No banned word, no em-dash and no en-dash in `messages/en.json`; the glossary test passes.
- [ ] Backend: ruff, mypy, the import contracts and the targeted tests pass; `openapi/v1.json` is regenerated.
- [ ] Web: lint, typecheck, format check and the targeted tests pass; the client is regenerated in its own
      commit.
