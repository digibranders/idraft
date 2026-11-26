# Issues page: design

Status: written 2026-11-26 for the build of slice 1. The owner's settled decisions are in section 1. Everything
the owner has not confirmed in words is in section 14, "Open for the owner".

Reference mock (not committed, read only): `apps/web/design-preview/issues.js`, `issues-data.js` and
`issues-data.check.mjs` in the main checkout.

## 1. What the owner decided

1. The sidebar gets a group "Website audit" with three items: Issues, Pages, Internal links. The group "SEO" keeps
   Keywords and Cannibalization.
2. Issues is a new page: every problem found on the project's website, in two tabs, Technical and On-page.
3. Issues takes its checks from everything the project collects: the site crawl, the daily rank checks, Search
   Console, Google Analytics and AI answers. Each check says where it was found ("Found by").
4. Cannibalization stays its own page. Issues only links to it with one row.
5. With one check open, the pages start high on a 1280 by 720 screen. The compact header of the mock is the
   pattern: the first page row sits about 29% down.

## 2. What is true in the code today

Read from the code on 2026-11-26, not from the mock.

**The crawl keeps few fields per page.** `backend/src/idraft/providers/dataforseo/on_page.py` reads seven fields
of the provider's page item: `url`, `status_code`, `resource_type`, `location`, `meta.title`, `meta.canonical`
and `checks.from_sitemap`. The provider's other `checks`, `meta.description`, `meta.htags`, `page_timing` and
`meta.social_media_tags` are dropped at this point. Nothing else of the page payload is stored.

**What a crawl stores** (`seo.crawl_pages`, migrations 0025, 0027, 0037): status code, resource type, redirect
target, canonical target, title, indexable or not and the reason, in the sitemap or not, click depth, counts of
linking pages and of outgoing links per scope, counts of outgoing links to broken, redirected and non-indexable
pages, the orphan flags, and whether the page is a variant of another crawled page. `seo.crawl_links` keeps each
internal link with its placement, scope and `is_followed`. Link rows are dropped for crawls older than the last
four (`crawl_runs.links_dropped_at`); page rows are kept for every crawl.

**Raw HTML is stored**, one object per project and URL, overwritten by the next crawl
(`collectors/crawl_store.py`, `html_key`). So anything that can be read from HTML (description, H1, hreflang,
Open Graph, image alt, text length) can be computed with no provider spend, but only for the latest crawl.

**Other sources already stored per page:**

| Data | Table | Read today by |
|---|---|---|
| Search Console clicks and impressions per page and day | `fp.gsc_page_daily` | Internal links Pages (`include=gsc`, sort by clicks) |
| The page a tracked keyword ranks with, and its target page | `seo.tracked_keyword_state.current_url_id`, `seo.tracked_keywords.target_url_id` | Internal links Pages (`include=keywords`) |
| Pages cited in AI answers | `ai.citations` (`domain_role = 'own'`) | Internal links Pages (`include=citations`) |
| Google Analytics landing pages | `fp.ai_referral_daily`: AI referral visits only | AI visibility |

Not stored anywhere: average position per page (Search Console), Google's index state per page, visits to all
landing pages (Google Analytics), cannibalization conflicts.

**The real sidebar** (`apps/web/src/lib/navigation/registry.ts`) has the groups SEO and AI visibility. Internal
links is live at `/seo/internal-links`. Pages is `planned` (no screen, absent from the sidebar). There is no
Cannibalization page and no cannibalization backend in the real app.

**Rules of Internal links that Issues must follow:**

- A page that answers 401, 403 or 429 refused the crawler. It is unknown, not broken
  (`backend/src/idraft/crawl/status.py`).
- A crawled page whose canonical names another crawled page is a variant. Variants are stored, but they do not
  count as pages, and links to them count as links to the page they name (`crawl/variants.py`).

## 3. The 47 checks and where each can run

"Today" means slice 1. The rule column of slice 1 checks is exact; section 4 defines the words it uses.

### 3.1 Runs today on the stored crawl (24 checks)

| # | id | Tab | Category | Severity | Reads |
|---|---|---|---|---|---|
| 1 | `status-4xx` | Technical | Status | Error | `status_code` |
| 2 | `status-5xx` | Technical | Status | Error | `status_code` |
| 3 | `redirect-broken` | Technical | Redirects | Error | `redirect_url_id`, target `status_code` |
| 4 | `redirect-chain` | Technical | Redirects | Warning | `redirect_url_id`, target `status_code` |
| 5 | `links-to-redirect` | Technical | Redirects | Warning | `redirect_outlinks` |
| 6 | `redirect-pages` | Technical | Redirects | Notice | `status_code`, `redirect_url_id` |
| 7 | `canonical-broken` | Technical | Indexing | Error | `canonical_url_id`, target `status_code` |
| 8 | `noindex` | Technical | Indexing | Warning | `non_indexable_reason` |
| 9 | `canonical-elsewhere` | Technical | Indexing | Notice | `canonical_url_id` |
| 10 | `sitemap-broken` | Technical | Sitemap | Error | `in_sitemap`, `status_code` |
| 11 | `sitemap-nonindexable` | Technical | Sitemap | Warning | `in_sitemap`, `is_indexable` |
| 12 | `not-in-sitemap` | Technical | Sitemap | Notice | `in_sitemap`, `is_indexable` |
| 13 | `broken-internal-links` | Technical | Links | Error | `broken_outlinks` |
| 14 | `orphans` | Technical | Links | Warning | `is_orphan` |
| 15 | `editorial-orphans` | Technical | Links | Warning | `is_editorial_orphan` |
| 16 | `links-to-nonindexable` | Technical | Links | Warning | `non_indexable_outlinks` |
| 17 | `deep-pages` | Technical | Links | Notice | `click_depth` |
| 18 | `nofollow-internal` | Technical | Links | Notice | `seo.crawl_links.is_followed` |
| 19 | `title-missing` | On-page | Titles | Error | `title` |
| 20 | `title-duplicate` | On-page | Titles | Warning | `title`, `is_indexable` |
| 21 | `title-long` | On-page | Titles | Notice | `title` |
| 22 | `title-short` | On-page | Titles | Notice | `title` |
| 23 | `url-format` | On-page | Addresses | Notice | `core.urls.path` |
| 24 | `url-long` | On-page | Addresses | Notice | `core.urls.path` |

### 3.2 Runs today on another stored source, joined with the crawl (5 checks)

| # | id | Tab | Category | Severity | Found by | Reads |
|---|---|---|---|---|---|---|
| 25 | `clicks-page-broken` | Technical | Pages that earn visits | Error | Search Console | `fp.gsc_page_daily` |
| 26 | `rank-page-broken` | Technical | Pages that earn visits | Error | Rank checks | `seo.tracked_keyword_state.current_url_id` |
| 27 | `cited-page-broken` | Technical | Pages that earn visits | Error | AI answers | `ai.citations` |
| 28 | `clicks-page-orphan` | Technical | Pages that earn visits | Warning | Search Console | `fp.gsc_page_daily`, `is_orphan` |
| 29 | `off-target` | On-page | Keywords | Warning | Rank checks | `tracked_keywords.target_url_id`, `tracked_keyword_state.current_url_id` |

The Clicks column (clicks of a check's pages, and the order of pages inside a check) reads `fp.gsc_page_daily`
too, so it is part of slice 1.

### 3.3 Needs a field the crawl does not keep yet (14 checks)

**From the stored HTML, no provider spend (slice 2, 11 checks).** Each needs a new column on `seo.crawl_pages`,
filled when the crawl reads the HTML, and a one-time re-read of the latest crawl's stored HTML.

| id | Tab | Category | Severity | New field |
|---|---|---|---|---|
| `description-missing` | On-page | Descriptions | Warning | meta description |
| `description-duplicate` | On-page | Descriptions | Notice | meta description |
| `h1-missing` | On-page | Headings | Warning | H1 count |
| `h1-multiple` | On-page | Headings | Notice | H1 count |
| `thin-content` | On-page | Content | Warning | word count of the body text |
| `duplicate-content` | On-page | Content | Warning | hash of the body text |
| `image-alt` | On-page | Images | Notice | count of images without alt text |
| `social-tags` | On-page | Social tags | Notice | Open Graph title, description, image present |
| `schema-errors` | On-page | Structured data | Warning | JSON-LD blocks that do not parse (a full validator is more work) |
| `hreflang` | Technical | Languages | Warning | hreflang pairs per page |
| `mixed-content` | Technical | Security | Warning | count of `http://` resources on an HTTPS page |

**From provider fields (slice 3, 3 checks).**

| id | Tab | Category | Severity | Needs | Spend |
|---|---|---|---|---|---|
| `slow-pages` | Technical | Speed | Warning | `page_timing` of the page item, dropped today | None: the base crawl returns it |
| `broken-external-links` | Technical | Links | Warning | Status of external links. Unknown whether the provider's links endpoint fills it; verify on one real crawl first | Unknown until verified |
| `broken-images` | On-page | Images | Error | `load_resources` on the crawl order | Yes: $0.00045 a page in total against $0.00015 today |

### 3.4 Needs another source that is not collected yet (4 checks)

| id | Tab | Category | Severity | Found by | Needs | Slice |
|---|---|---|---|---|---|---|
| `low-ctr` | On-page | Search results | Notice | Search Console | Average position per page: add `position` to the page pull that fills `fp.gsc_page_daily` | 4 |
| `google-not-indexed` | Technical | Indexing | Warning | Search Console | URL Inspection API for the pages you track (free, 2,000 a day per property) | 4 |
| `visits-page-broken` | Technical | Pages that earn visits | Error | Google Analytics | One more GA4 report: sessions per landing page, all channels | 5 |
| `cannibalization` | On-page | Keywords | Warning | Rank checks | The Cannibalization page and its backend, which do not exist in the real app | 6 |

Count: 24 + 5 + 14 + 4 = 47.

## 4. The rules of slice 1

Rules are SQL conditions on one row of `seo.crawl_pages` of the crawl in view, joined with `core.urls`. They are
not Python functions: the lists and the counts must run in the database (a crawl holds up to 200,000 pages), and
one definition must serve both. Each rule is tested on a small seeded crawl, one known case per check, as
`issues-data.check.mjs` does for the mock.

Words used below:

- **counted**: `variant_of_url_id IS NULL`.
- **live**: counted, `status_code = 200` and `resource_type = 'html'`.
- **redirected**: counted, `status_code` from 300 to 399.
- **broken**: counted, `status_code >= 400` and not 401, 403 or 429.
- **unreachable**: redirected or broken.
- **target**: the row of the same crawl whose `url_id` is this row's `redirect_url_id` (or `canonical_url_id`).
  A target the crawl did not fetch has no row and never makes a rule true. A rule about a target reads only
  the target's status: "its target is broken" means the target's status is 400 or more and not 401, 403 or 429.
- A sitemap check matches nothing when the crawl found no sitemap (section 5), in the counts and in the list
  of pages alike.

| id | Rule | Detail shown per page |
|---|---|---|
| `status-4xx` | broken and `status_code < 500` | status, linking pages (all placements) |
| `status-5xx` | broken and `status_code >= 500` | status |
| `redirect-broken` | redirected, and its redirect target is broken | target path and status |
| `redirect-chain` | redirected, and its redirect target has a status from 300 to 399 | target path |
| `links-to-redirect` | live and `redirect_outlinks > 0` | count of redirected pages linked |
| `redirect-pages` | redirected | target path, when stored |
| `canonical-broken` | `status_code = 200`, `resource_type = 'html'`, `canonical_url_id` is another URL, and that target has a status from 300 to 399 or is broken. Variants included. | target path and status |
| `noindex` | live and `non_indexable_reason` is `meta_tag` or `http_header` | the reason |
| `canonical-elsewhere` | `status_code = 200`, `resource_type = 'html'`, `canonical_url_id` is set and is another URL. Variants included. | canonical path |
| `sitemap-broken` | unreachable and `in_sitemap` | status |
| `sitemap-nonindexable` | `status_code = 200`, `resource_type = 'html'`, `in_sitemap`, not `is_indexable`. Variants included: a sitemap that lists another address of a page is the problem. | the reason |
| `not-in-sitemap` | live, `is_indexable`, not `in_sitemap` | none |
| `broken-internal-links` | live and `broken_outlinks > 0` | count of broken pages linked |
| `orphans` | live and `is_orphan` | none |
| `editorial-orphans` | live and `is_editorial_orphan` | linking pages (all placements) |
| `links-to-nonindexable` | live and `non_indexable_outlinks > 0` | count of non-indexable pages linked |
| `deep-pages` | live and `click_depth > 3` | click depth |
| `nofollow-internal` | live, and at least one link row from this page to another page with `is_followed = false` and `ignored = false` | count of such links |
| `title-missing` | live, and the title is null or empty after trimming | none |
| `title-duplicate` | live, `is_indexable`, title not empty, and at least one other such page has the same title after trimming, without letter case | count of other pages, and one of their paths |
| `title-long` | live and the trimmed title is longer than 60 characters | length |
| `title-short` | live, title not empty, and the trimmed title is shorter than 30 characters | length |
| `url-format` | live, and the path has a capital letter or an underscore. Percent escapes (`%2F`) are removed before the test for capitals. | which of the two |
| `url-long` | live and the path is longer than 115 characters | length |
| `clicks-page-broken` | unreachable, and Search Console clicks in the window are above 0 | status |
| `clicks-page-orphan` | live, `is_orphan`, and Search Console clicks in the window are above 0 | none |
| `rank-page-broken` | unreachable, and at least one tracked keyword (active, not deleted) has a rank and ranks with this URL | status, count of keywords |
| `cited-page-broken` | unreachable, and at least one AI answer of the last 28 days that was not superseded cites this URL as your own page | status, count of answers |
| `off-target` | counted, and at least one tracked keyword (active, not deleted) has this URL as its target, has a rank, and ranks with another URL | count of keywords |

Notes on the rules:

- The stored counters (`broken_outlinks`, `redirect_outlinks`, `non_indexable_outlinks`) count distinct linked
  pages after variants are folded, and `broken_outlinks` already leaves out 401, 403 and 429. Issues uses them
  as they are, so its numbers equal the Internal links inspector.
- `non_indexable_outlinks` counts every linked page marked non-indexable, whatever its status. The mock asked
  for a live target. The difference is a redirect or an error page that is also marked non-indexable, which is
  rare; using the stored counter keeps one number in the app.
- `is_orphan` is stored as: in the sitemap, no linking page, not the start page, not a variant. A crawl reaches
  a page through a link or the sitemap, so a page without links in was found in the sitemap.
- The Search Console window is the one the Internal links Pages list uses (`extras.gsc_window`): the property's
  stored window, 28 days.
- The keyword rules follow decision D8 of the internal links plan, the citation rule decision D9
  (`api/internal_links/extras.py`).
- The thresholds (60 and 30 characters, 115 characters, 3 clicks) are the mock's and live in one module.

## 5. How and when checks run

**Decision: checks are computed when the page is read. Nothing is stored per check.**

Reasons:

1. A crawl's derived columns are re-derived after it finishes: the re-read from stored HTML
   (`collectors/crawl_relink.py`), the variants recount and the blocked-pages recount all rewrite
   `seo.crawl_pages`. Stored check results would be stale after each, and every such job would have to remember
   to run the checks again.
2. Five checks join data that changes every day (clicks, ranks, citations) while the crawl does not change.
   Stored results would be wrong the next morning.
3. No migration, no worker step, no backfill. Every crawl already stored gets its checks at once.
4. The rule of a check is one SQL condition, so the counts, the pages of a check, the paging, the search and the
   export all read the same definition. The pages of a check are the existing Pages list of Internal links with
   one more filter.

Cost of this choice: the list of checks runs one aggregate query over the crawl's pages on every read. The web
keeps the answer for the session's stale time, as it does for other lists. If a read of the list takes longer
than 1 second on a real crawl, store the counts per crawl then (`shortcut` comment in the service).

**A check that could not run is told apart from one that passed.** Each check in the API answer has a `state`:

| `state` | `reason` | When | The web shows |
|---|---|---|---|
| `ran` | none | The rule was evaluated. `pages` is a number; 0 means passed. | The count, or "Passed" |
| `not_run` | `source_not_connected` | A Search Console check, and the project has no active Search Console property | "Not connected", with a link to Integrations |
| `not_run` | `not_collected` | The source is there but holds nothing yet: Search Console has no stored page day in its window, no tracked keyword has a rank check, or no AI answer was collected | "Not collected yet" |
| `not_run` | `no_sitemap` | A sitemap check, and the crawl found no page in a sitemap (`crawl_runs.sitemap_pages` is null or 0) | n/a, tooltip "The crawl found no sitemap" |
| `not_run` | `links_dropped` | `nofollow-internal`, and the crawl's link rows were dropped | n/a, tooltip "This crawl no longer holds its links" |

A check that did not run has `pages: null`, is left out of every total of the strip, and its row does not open.

Checks of section 3.3 and 3.4 are not returned by the API until their slice ships. The real app never shows
sample data for them.

## 6. API contract

All routes need `data:read`. `run` is `latest` (default) or a crawl id, as on the internal links reads.
`404 no_crawl` before the first finished crawl; `404 not_found` for a project outside the workspace.

### 6.1 List of checks with counts and the strip

`GET /api/v1/workspaces/{workspace_id}/projects/{project_id}/issues?run=latest`

```json
{
  "data": [
    {
      "id": "status-4xx",
      "tab": "technical",
      "category": "status",
      "severity": "error",
      "found_by": "crawl",
      "state": "ran",
      "reason": null,
      "pages": 12,
      "clicks": 340,
      "example_path": "/old-pricing"
    }
  ],
  "summary": {
    "pages_crawled": 1840,
    "pages_with_issue": 412,
    "pages_with_error": 37,
    "pages_with_warning": 180,
    "pages_with_notice": 301,
    "checks_ran": 27,
    "checks_passed": 9
  },
  "meta": {
    "run_id": "…",
    "crawled_at": "2026-11-25T09:12:00Z",
    "links_available": true,
    "gsc": { "state": "ok", "window_start": "2026-10-28", "window_end": "2026-11-24" }
  }
}
```

- `data` is in catalogue order (section 3.1 and 3.2, grouped by category). The web orders rows inside a
  category: most severe first, then most pages.
- Enums: `tab` is `technical` or `on_page`; `severity` is `error`, `warning` or `notice`; `found_by` is `crawl`,
  `ranks`, `gsc`, `ga4` or `ai`; `category` is a snake case id (`status`, `earning_pages`, `redirects`,
  `indexing`, `sitemap`, `links`, `titles`, `addresses`, `keywords` in slice 1).
- `clicks` is the sum of Search Console clicks of the check's pages in the window; `null` when the check did not
  run or `meta.gsc.state` is not `ok`.
- `example_path` is the first path in byte order among the check's pages; `null` when there is none.
- `summary.pages_crawled` counts every address of the crawl, variants included, because three checks list
  variants. The other four page counts count an address once, over the checks that ran. `checks_passed` counts
  checks that ran and found no page.
- The API returns ids, never English sentences. Names, "Why it matters" and "How to fix it" are in
  `apps/web/messages/en.json`, keyed by check id. A web test fails when a check id of the API has no texts.
- `format=csv` returns the same rows as CSV: tab, category, check id, severity, found by, state, pages, clicks.

### 6.2 Pages of one check

The existing list `GET …/internal-links/pages` gets one more filter and one more `include`:

- `filter[issue]=<check id>`: only the pages the check found. It sets the variant handling the check needs, so
  `filter[include_variants]` is ignored with it. `422` for an unknown id.
- `include=issue`: each row's `extras.issue` is the detail of section 4:
  `{ "target_path": string | null, "target_status": int | null, "count": int | null, "reason": string | null }`.

Everything else is the list as it is today: cursor paging (`cursor`, `limit`), search on the path (`q`), the
sorts (`-clicks`, `path`, `-linking_pages`, `-click_depth` and the rest), `include=gsc` for the Clicks cell,
tiers, and `format=csv`. With `filter[issue]`, the CSV has four more columns: the three detail values and clicks.

A check that did not run has no pages: the filter matches nothing, except `nofollow-internal` on a crawl whose
links were dropped, which answers `410 links_dropped` as every read of link rows does.

The page inspector is the existing `GET …/internal-links/pages/{url_id}`.

## 7. The web page

Template T2, as Internal links. One route, the state in the address.

### 7.1 Route and address

`/{workspace}/{project}/seo/issues`. The path stays under `/seo`, as Internal links does, so no address changes
when the group label does. Address state (nuqs, as `features/internal-links/url-state.ts`):

| Key | Values | Default |
|---|---|---|
| `tab` | `technical`, `on-page` | `technical` |
| `check` | a check id; opens the check | none |
| `severity` | `error`, `warning`, `notice` | all |
| `by` | `crawl`, `ranks`, `gsc`, `ai` | all |
| `q` | search text, up to 200 characters | empty |
| `passed` | `hide` | shown |
| `sort` | a sort of the pages list, in the open check | `-clicks` when Search Console is connected, else `path` |
| `inspect` | the page inspector, as on Internal links | none |

A `check` that belongs to the other tab switches the tab to its own. An unknown `check` shows the list.

### 7.2 List view

Top to bottom:

1. Toolbar: the "Found by" select, the crawl line (host, date of the crawl, pages), "Crawl now" (the existing
   button, needs `runs:trigger`) and Export (the CSV of 6.1).
2. MetricStrip with six measures: Pages crawled, Pages with an issue, Pages with an error, Pages with a warning,
   Pages with a notice, Checks passed ("9 of 27"). Each has its definition in a tooltip.
3. One panel: the two tabs with the number of checks that found pages, search, the severity pills, "Show passed
   checks", then the table. Rows are grouped by category with a group header row.

Columns: Issue, Severity, Found by, Pages, Clicks, Example, and an open arrow. A row opens its check. A row of a
check that did not run shows its state in the Pages cell (section 5) and does not open. Pages has a tooltip with
the share of pages crawled. Clicks shows n/a with a tooltip when Search Console is not connected or has no page
data yet.

Empty result of the filters: "No checks match" with "Clear filters".

### 7.3 Open-check view

The toolbar and the strip are hidden. The panel's bar holds: "All issues" (back), the check's name, the severity
badge, the "Found by" badge, search ("Search pages"), and Export at the right (the CSV of 6.2). Under it two
short lines side by side: "Why it matters: …" and "How to fix it: …". Then the table.

Columns: Page (path, opens the inspector), What was found, Clicks, Status, Tier, Links in. Cursor paging as the
Pages tab of Internal links. Footer: "N pages" and the date of the crawl.

At 1280 by 720 the first page row starts at or above one third of the height. This is checked on the running
app at 1280 by 720 and at a wide screen.

A check that ran and found nothing: "No pages have this issue" with "All issues". A search with no match:
"No pages match" with "Clear search".

### 7.4 States

| State | When | Shows |
|---|---|---|
| No access | The member lacks `data:read` | The no-access empty state, as Internal links |
| No website | The project has no website | The existing "No website" state with the link to Settings |
| Never crawled | A website, no crawl yet | The existing state with "Crawl now" |
| First crawl running | The first crawl is under way | The existing progress state; the page reads again when it finishes |
| First crawl failed | The only crawl failed | The existing failed state with its reason and "Crawl now" |
| A newer crawl is running or failed | A finished crawl exists | The list of the finished crawl, with the existing banner |
| Loading | A read is under way | Skeleton rows, no spinner |
| Error | A read failed | Inline error with retry |
| Source not connected, not collected yet, could not run | Per check, section 5 | In the row's Pages cell |

The crawl states reuse the components of Internal links (`crawl-states.tsx`, `crawl-reads.ts`, `crawl-button.tsx`),
and a page opens the existing page inspector. The lint rules forbid one feature importing another, so the Issues
screen lives inside the feature that owns the crawl: `apps/web/src/features/internal-links/issues/`. Pure logic
is in `apps/web/src/lib/issues/`. Renaming that feature folder to a name that covers both pages is separate work.

Slice 1 reads the latest finished crawl only. The crawl picker of Internal links is not on this page.

### 7.5 Sidebar

A third group, "Website audit", between SEO and AI visibility: Issues (new, live), Pages (stays `planned`, so it
is absent until its screen exists) and Internal links (moved from SEO, path unchanged). SEO keeps Keywords.
`docs/design-system/11-navigation.md` is updated in the same commit.

## 8. Permissions

| Action | Permission |
|---|---|
| See the page, open a check, export | `data:read` |
| Crawl now | `runs:trigger` (existing rule of the button) |

Row-level security and the workspace check are those of the internal links reads: every query names the
workspace and the project.

## 9. Costs

Slice 1 adds no provider spend. It reads rows the app already stores and calls no provider. "Crawl now" on this
page is the existing action with its existing price and budget check.

Later slices: slice 2 (stored HTML) adds none. Slice 3 adds none for `slow-pages`; `broken-images` triples the
price of a crawl ($0.00045 a page against $0.00015) and needs the owner's yes; `broken-external-links` is
unknown until one crawl is checked. Slices 4 and 5 use Google's free APIs. Core Web Vitals need browser
rendering ($0.0051 a page) or Lighthouse ($0.005 a page); they are not part of this page.

## 10. Later slices

| Slice | What | Depends on |
|---|---|---|
| 2 | The 11 checks read from stored HTML | New columns on `seo.crawl_pages`; an extraction step in `crawl_ingest` where the HTML is read; a re-read of the latest crawl (as `crawl_relink`); the rules and texts |
| 3 | `slow-pages`, `broken-external-links`, `broken-images` | `page_timing` kept by `on_page.py`; one real crawl to see what the links endpoint returns for external links; the owner's decision on `load_resources` |
| 4 | `low-ctr`, `google-not-indexed` | `position` added to the Search Console page pull and to `fp.gsc_page_daily`; a URL Inspection collector for the pages you track, with its quota |
| 5 | `visits-page-broken` | A GA4 report of sessions per landing page, stored per page and day |
| 6 | The Cannibalization row | The Cannibalization page and an API that counts its conflicts |
| 7 | The crawl picker on Issues, and "new since the last crawl" | Nothing new: every crawl's pages are kept. Design work first |

Not planned here: the Pages tabs (All pages, Monitoring) and a reorder of the Internal links tabs.

## 11. Tests

Backend (`backend/tests/api/issues/`):

- One seeded crawl of about 14 addresses with one known case per rule (the mock's site, plus a blocked page, a
  variant, a non-HTML resource and a percent-escaped path). Each check finds exactly its pages.
- The strip counts an address once per severity and leaves out checks that did not run.
- Each `not_run` reason: no Search Console property, a property with no stored page day, no rank check, no AI
  answer, no sitemap, links dropped.
- `filter[issue]` on the pages list: paging, search, sort by clicks, the detail of `include=issue`, the CSV, an
  unknown id.
- Workspace isolation and the `data:read` permission, as the other read routes.
- `backend/openapi/v1.json` is regenerated in the backend commits; `tests/api/test_openapi.py` stays green.

Web:

- `lib/issues`: the address state parser, the row order, the tab counts, and that every check id of the
  generated client has a name, a why and a fix in `en.json`.
- The list view: rows by category, the filters, the states of a check that did not run, the empty result.
- The open-check view: the header, the detail texts per check, the empty states, Export.
- The crawl states: no website, never crawled, first crawl running, first crawl failed.
- The navigation registry and the shell: the new group and its two items.
- `src/i18n/messages.test.ts` and `src/lib/glossary/glossary-words.test.ts` stay green.

## 12. Words

New glossary rows are added to `docs/glossary/terms.md` in the commit of this spec: Website audit (group),
Issues (page), Issue, Check in its second sense (one test of the Issues page), Severity with Error, Warning and
Notice, Found by, and the tab names Technical and On-page. The check names are in the catalogue of this spec and
in `en.json`.

Traps: "Monitored" is banned (the mock's note on `google-not-indexed` must say "the pages you track");
"Rankings" and "Ranking" as a noun are banned; "Source" is only "Source: provider", so the column is "Found by";
"n/a" only in a table cell with a tooltip; "Not collected yet" is the state when nothing was collected.

## 13. What slice 1 leaves out on purpose

- The 18 checks of sections 3.3 and 3.4.
- Old crawls on this page.
- Storing check results, trends of issue counts, and alerts on new issues.
- An "ignore this issue" or "ignore this page" action.

## 14. Open for the owner

Proposals of the mock that the owner has seen and not confirmed in words. Slice 1 is built on them:

1. Three severities: Error, Warning, Notice. Orphan pages is a Warning.
2. Issues lists only things someone can fix on the site. A rank drop or a traffic drop is a change, so it stays
   in alerts and on Pages > Monitoring.
3. Search Console clicks order the work: each check shows the clicks of its pages, and the pages inside a check
   sort by clicks.
4. The strip counts pages once per severity and counts only checks that really ran.

Found while reading the code:

5. **Cannibalization row.** The real app has no Cannibalization page, so slice 1 has no such row. It appears
   when that page ships (slice 6).
6. **Pages in the sidebar.** Pages has no screen in the real app, so the group shows Issues and Internal links.
7. **The 18 checks without data are hidden**, not listed as "Not collected yet". Listing them would promise
   checks the app cannot run. Say if you prefer them listed.
8. **Refused pages.** A page that answers 401, 403 or 429 is not in "Pages that return a 4xx error", following
   the Internal links rule that it is unknown, not broken.
9. **"Pages crawled" counts every address**, variants included, so it can be higher than the page count in the
   Internal links header.
10. **Sitemap checks do not run** when the crawl found no sitemap. A check "The site has no sitemap" is not in
    the catalogue; it could be added from stored data.
11. **"Blocked by robots.txt"** is stored (`non_indexable_reason = 'robots_txt'`) and has no check in the
    catalogue. It could be added from stored data.
12. **The word "check" has two senses now**: one rank reading of a keyword (glossary U9) and one test of the
    Issues page. The glossary row says so. Say if you want another word.
13. **The route is `/seo/issues`** while the group is "Website audit". Moving both pages under a new path
    prefix would need redirects for Internal links.
14. **`broken-images` costs money** (three times the price of a crawl). It waits for your yes.
15. **`visits-page-broken`** could run today on AI referral visits only. It waits for the full landing page
    report so that its name is true.
16. **Thresholds** are the mock's: titles 30 to 60 characters, addresses 115 characters, 3 clicks from the home
    page.
