# Page history: the History tab of the page drawer

Status: design decided by the owner on 2026-11-27 (mock: `apps/web/design-preview/il-history.js`, `history-data.js`).
This document fixes the technical details. Branch `claude/page-history-4fc06d`.

## 1. What the tab answers

For one page: when it was last edited, when idraft first saw it, what changed in each crawl, and whether Google has
crawled the latest change. Plus one line on the Overview tab ("Last edited 12 Nov 2026. See history").

Tab order of the drawer: Overview, Search, Outline, Issues, AI, Links, History, Notes. The drawer is the shared overlay
`Inspector`. The History tab is a self-contained component in `apps/web/src/features/page-history/`; the Pages session owns
the drawer host and mounts it (section 9).

## 2. Three kinds of date (header comment of `history-data.js` is the reference)

| Date | Source | Reliability |
|---|---|---|
| Last edited | The page's own declaration: JSON-LD `dateModified`, then `article:modified_time`, then `og:updated_time`, then the sitemap `lastmod`. First one present wins. | Real on a site that fills it in. Marked unreliable for a crawl when most pages share one day (section 4.3). |
| Last change seen | The newest crawl whose main-content hash differs from the crawl before. | As exact as the crawl schedule. |
| Google crawled | Search Console URL Inspection `lastCrawlTime`, for pages in Monitoring only. | Exact; read daily. |

The HTTP `Last-Modified` header is **ignored**: measured on eventussecurity.com (WordPress, All in One SEO) it is the cache
rebuild time of every page (26 Nov, 11:10 to 11:58) while the pages' own dates range from August to November. The tab says
so in its "How these dates are read" note.

## 3. What is kept (data model, migration `0042_page_history`)

The crawl keeps one raw HTML object per project and URL and overwrites it (`crawl_store.html_key`), so there is no past to
read. From the first crawl after this ships, ingest reads each page's HTML (it already does, for links) and keeps:

`seo.page_checks`: one light row per page and crawl (PK `run_id, url_id`)
- `main_hash`, `full_hash` (bytea, 16 bytes of sha256), `declared_at` (timestamptz, null), `declared_source`
  (`json_ld` | `meta_modified` | `og_updated` | `sitemap`, null), `snapshot_id` (the snapshot that holds this crawl's content).

`seo.page_snapshots`: kept ONLY when `main_hash` differs from the page's previous check (or there is no previous check)
- `id` bigint identity, `workspace_id`, `project_id`, `url_id`, `run_id` (the crawl that first saw this content), `taken_at`,
  `title`, `description`, `headings` (jsonb `[[level, text], ...]`, H1 to H3, at most 60, 200 chars each), `words`,
  `links_all`, `links_editorial` (internal links of the page), `canonical`, `main_hash`, `full_hash`.

`seo.page_history_runs`: one row per crawl (PK `run_id`)
- `pages_checked`, `pages_main_changed`, `pages_site_wide`, `site_wide` (bool), `declared_unreliable` (bool).

`seo.crawl_pages.sitemap_lastmod` (timestamptz, null): the provider's `last_modified.sitemap` (section 4.1).

`seo.page_google_crawl`: PK `project_id, url_id`; `last_crawl_time` timestamptz null, `coverage_state` text null,
`inspected_at` timestamptz. Tenant isolation and grants as the other `seo` tables (`idraft.db.ddl.tenant_isolation`,
`grants`); the worker writes, the API reads.

Retention: snapshots and checks go with the crawl run (`ON DELETE CASCADE` on `run_id`) except snapshots, which are keyed
by project and URL and are kept as long as the project. Size: a snapshot is about 3 KB; only changed pages add one.

Migration number: develop is at 0041. Other branches already use 0042 (`0042_page_notes`, `0042_page_search`), so this
migration is `0042_page_history` and the merge order needs renumbering (reported to the owner).

## 4. Detection

### 4.1 Declared dates (pure: `idraft/crawl/declared_dates.py`)
`declared_of(html, sitemap_lastmod) -> Declared | None`. Reads JSON-LD (walks `@graph` and arrays) for `dateModified`,
`<meta property="article:modified_time">`, `<meta property="og:updated_time">`; else the sitemap value. Accepts ISO 8601
with or without zone (no zone is read as UTC); ignores values in the future (more than one day ahead) and before 1995.
DataForSEO On-Page items carry `last_modified {header, sitemap, meta_tag}` and `fetch_time`; today `providers/dataforseo/
on_page.py` drops them. `PageItem` gains `sitemap_lastmod` read defensively from `last_modified.sitemap`. **Not verified on
a real payload**: no stored payload with that field exists on this machine, so the parser accepts a missing, null or
malformed value and the field is checked on the first real crawl (open item in the final report). The header is never read.

### 4.2 Content hashes (pure: `idraft/crawl/page_text.py`)
`read_page_text(html, noncontent_links) -> PageText` (title, description, headings H1 to H3, words, `main_text`,
`full_text`). Same output shape as the Outline parser of the Pages branch (`crawl/outline.py`: `Heading(level, text)`,
`description`, `headings`, `words`); that module has not landed on develop, so this one is written as a pure module with the
same names and the two are to be merged by pointing `page_text` at `parse_outline` when it lands.
- Full text: all visible text with scripts, styles, comments, templates and tags removed, whitespace collapsed,
  case kept. (Verified on 2026-11-27: Cloudflare email obfuscation changes raw HTML but not this text.)
- Main text: the text inside the first `<main>` (else the first `<article>`, else `body`), with `nav`, `header`, `footer`
  and `aside` left out, and with the text of every link the placement classifier of the crawl (`crawl/placement.classify`)
  placed outside `content` (auto-generated, template) left out. The classifier works on links, not text offsets, so a link
  is matched by its (resolved address, anchor text) pair. Limit: text around an auto-generated link (an excerpt in a
  related-posts card) stays in the main text.
- Hash: sha256 of the text, first 16 bytes.
- Internal link counts come from the edges the ingest already builds for the page.

### 4.3 Site-wide change and unreliable dates (pure: `idraft/crawl/page_history.py`)
Per page, comparing a crawl with the page's previous check:
- `main_hash` differs: **content change** (snapshot kept).
- `main_hash` same and `full_hash` differs: **template candidate**.
- First check of the page: **first seen** (snapshot kept).
At the end of the links step of ingest, `summarize_run(counts)` sets `site_wide = true` when at least 20 pages were
compared and template candidates are at least 50 % of the compared pages. A site-wide run shows one "Site-wide change"
row on every page that was a template candidate in it, and no edit row. Otherwise a lone template candidate shows nothing
(a changed footer on one page is not an edit of its text). `declared_unreliable = true` when at least 20 pages declare a
date and at least 50 % of them declare the same calendar day (UTC).
A run that did not read a page's HTML (provider gave none) writes no check for it; the page has a gap, not a change.

### 4.4 Change list between two snapshots (pure, `page_history.diff_snapshots(before, after)`)
Ordered: title changed (before, after), description changed (before, after, also added or removed), heading added or removed
(level, text; a heading whose text changed counts as one removed and one added), text grew or shrank (words, only when the
difference is at least 5 % and at least 20 words), internal links added or removed (count difference, editorial counted
separately). A content change with no listed change (text edited in place) reads "Text edited".

## 5. API

`GET /api/v1/projects/{project_id}/internal-links/pages/{url_id}/history` (same router and access as `pages/{url_id}`;
`ReadData`). Response `PageHistoryResponse`:
```
data: {
  readable: bool            # false for a redirect or an error page, with why: "redirect" | "error", status
  first_seen: datetime      # first crawl that held the page (the page's oldest crawl_pages row)
  history_starts: datetime  # the oldest crawl whose check exists (null before any)
  last_change: datetime|null
  changes: int
  declared: {date, source}|null, declared_unreliable: bool
  versions: [ {run_id, date, kind: "content"|"site_wide"|"first", changes: [Change]} ]  # newest first
  google: {crawled_at, behind: bool, coverage_state}|null   # null when the page is not in Monitoring
  tracked: bool
}
```
`Change = {type: title|description|heading_added|heading_removed|words|links, label_key, level?, before?, after?, delta?}`.
Labels are built in the web client from `type` (glossary strings), not sent as prose. `behind` is
`google.crawled_at < last_change`. `first_seen` is the first crawl, `history_starts` the first kept snapshot; they differ
for a page that existed before this feature (the tab says "history starts on ...").

## 6. Google's last crawl

`providers/google/client.py` gains `inspect_url(access_token, site_url, page_url)` (POST
`https://searchconsole.googleapis.com/v1/urlInspection/index:inspect`, `indexStatusResult.lastCrawlTime`,
`coverageState`), using the existing scope (`webmasters.readonly` covers it), retry and quota handling. Quota: 2,000 a day
and 600 a minute per property. `collectors/gsc_inspect.py` takes the pages to read from a `TrackedSource` protocol, spends
at most `INSPECTIONS_PER_DAY = 1_500` per property (headroom for other tools, counted from `inspected_at`), takes one token
per call from the existing `GscLimiter` (`collectors/gsc_limits.py`), reads the oldest-inspected first, and stores into
`seo.page_google_crawl`. Refresh once a day per tracked page, on the Monitoring schedule.
**Blocker, handed over**: the list of pages in Monitoring is `core.tracked_pages`, which exists only on branch
`claude/gsc-page-detail-monitoring-6f43c3`. The module takes the list through the protocol and the schedule wiring
(`gsc_plan`) plus the `tracked` flag of the endpoint are one small commit once that branch is merged. Until then the endpoint
returns `tracked = false` and `google = null`, which is exactly the mock's "read for pages in Monitoring" state.

## 7. Limits, stated in the tab footer and here
- History starts at the first kept snapshot; older changes cannot be known.
- Exactness is the crawl schedule: a change is dated to the crawl that saw it.
- A site that renders its text with JavaScript needs the rendering option of the crawl; without it the HTML holds no text.
- Pages behind a login are not covered.
- A/B tests and rotating blocks (random related posts, a date in the sidebar) can add a change that is not an edit.
- The sitemap date comes from the provider and is unverified (4.1).

## 8. Failure and safety
Pages are untrusted: parsers never raise, cap lengths (headings 60 x 200 chars, title and description 1,000 chars) and
cap input at 2 MB (the Outline limit). An ingest step failure in the history write must not fail the crawl: the history
write is inside the links transaction (so the page and its check are written together) but the pure parse is wrapped so one
bad page writes no check and logs once (class only, never page text). Every statement names the workspace (the worker
bypasses row-level security). No page text is logged.

## 9. Web
`apps/web/src/features/page-history/`: `model/` (pure: grouping, labels, dates), `data/use-page-history.ts` (query on the
generated client; regenerated in its own commit), `history-tab.tsx`, `last-edited-line.tsx` (Overview line). Props only;
the Pages drawer host mounts `<HistoryTab urlId scope run />` in the tab slot "history" and `<LastEditedLine onOpen />` in
Overview. I do not edit the Pages branch files; the slot and the shared `PageDrawerContext` type are requested from the Pages
session by message. Strings go to `messages/en.json` under `pageHistory` and to `docs/glossary/terms.md` first; no dashes.

## 10. Not built (and why)
- Wiring Google refresh to the Monitoring schedule and the `tracked` flag (needs `core.tracked_pages`, section 6).
- Mounting the tab in the drawer (needs the Pages branch).
- A back-fill of history from before this feature (not possible).
