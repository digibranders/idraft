# Internal links, plan 08: pages the crawler is refused are "blocked", not broken (backend first, then web)

Date: 2026-11-23. Branch: `feat/internal-links-backend`. Raised by the owner after the production crawl of eventussecurity.com (439 pages): 23% of pages answered 403 to the crawler, so the Pages list showed red "403", "Error page" and "Broken outlink" almost everywhere, and the "Broken and redirected links" tile read 816. Customers cannot be asked to change their firewall, so the product must (1) stop calling a refusal an error, (2) say how much of the site it could read, and (3) separately work on being let in by default.

Targeted serial tests only; one builder at a time. `backend/openapi/v1.json` is regenerated in the last backend task and il-web is told.

## What the code does today (verified 2026-11-23)

- The crawler is not ours: it is the DataForSEO On-Page API (`providers/dataforseo/on_page.py`, `CrawlOrder`). We pass `enable_javascript` from the run settings and nothing else about identity. Who the bot "is" to a firewall is DataForSEO's choice, not ours.
- `crawl_ingest.py` already treats 401 and 403 as a refusal in one place only: a start page that answers 403 and fewer than 3 pages served ends the run as `site_blocked`.
- Everywhere else a status of 400 or more means broken: `crawl/graph.py` `Node.is_error` (also feeds `lost_to_errors` in the link-strength calculation), the `broken_outlinks` counter written by the SQL in `crawl_ingest.py` (around line 851), `reads.py` `_flags` (flag `broken`) and the `broken_and_redirected` worklist (`status >= 300`), `page_filter.py` `has_broken_outlinks`.
- Pages reachable only through a refused page get no depth ("Not reachable") and can read as orphans, because the refused page's own links were never read.

## Decisions (proposed, settle before Task 1)

- **D1. What counts as blocked.** Status 401, 403 and 429. Not 5xx (a real server error stays an error) and not 404 or 410 (real broken pages). One set, defined once.
- **D2. No new column for the page.** "Blocked" is derived from `status_code`. Run-level coverage is derived too. Only the stored `broken_outlinks` counter changes meaning (it stops counting blocked targets), and old runs are recomputed (Task 7).
- **D3. A blocked page is "unknown", like a linked URL that was never crawled.** It is not broken, not lost, and its link strength is not counted as lost to errors.
- **D4. Coverage is shown wherever numbers are shown, including the client summary link.** Wording: "Read 394 of 439 pages. 45 pages refused our crawler, so these numbers may be incomplete." Never a request to the customer to change anything; an optional help link may follow later.
- **D5. Orphan, "not reachable" and "deep only" are still computed, but flagged as possibly incomplete when coverage is below 100%.** We do not hide them, we qualify them.

## Tasks

1. **One definition.** New `crawl/status.py`: `BLOCKED_STATUSES = frozenset({401, 403, 429})`, `is_blocked(status)`, `is_error(status)` (400 or more and not blocked). Use it in `graph.py` (`Node.is_error`, so blocked targets stop adding to `lost_to_errors`; add `Node.is_blocked`). Tests: every status class, the boundaries, and the equity calculation with one blocked target (not lost) and one 404 (lost).
2. **Ingest counters.** In `crawl_ingest.py` the counter SQL excludes blocked targets from `broken` (keep them out of `redirect` and `non_indexable` too; they are neither). Replace the literal `_REFUSED` with the shared set. Add the run coverage numbers where the run's counts are stored (find the existing counts writer used by `set_counts`; extend it with `pages_blocked`; `pages_total` and pages read already exist or are a count). If the counts live in a table, this needs a small migration (0030); if they are derived at read time, none. Tests: a crawl with a mix of 200, 404, 403, 429 and 500 targets gives `broken_outlinks` that counts only the 404 and the 500.
3. **Read API.** `reads.py`: `_flags` gives `blocked` instead of `broken` for blocked pages; `broken_and_redirected` worklist and `has_broken_outlinks` exclude blocked targets; the status filter and sort keep working on the raw code; add a `blocked` value to the page status filter. Add `coverage` (`pages_total`, `pages_read`, `pages_blocked`, `share_blocked`) to the crawl summary response and to the public client summary (`internal_links_summary.py`). Descriptions say "refused our crawler". Tests: list, filter, worklist counts, summary coverage, public summary has coverage and still no forbidden fields.
4. **Changes and alerts.** Check `changes.py` (already compares only status 200 pages) and the lost-link logic so that a page that was readable last crawl and is blocked now is reported as "now blocked", not as lost links or lost pages. Tests: the same page 200 then 403 produces no lost links, one "now blocked" change.
5. **Qualify the structure flags (D5).** When `share_blocked` is above 0, the summary marks `orphans`, `editorial_orphans` and `deep_only` as `may_be_incomplete: true`. No change to the numbers. Tests: with and without blocked pages.
6. **Contract.** `uv run python -m idraft.api.openapi`, commit `backend/openapi/v1.json`, run `tests/api/test_openapi.py`, tell il-web (`local_fcb74e6c-4bbe-41a9-a8fb-890a1710b05f`) to run `pnpm gen:api`.
7. **Recompute the stored counters of existing runs.** One re-run of the enrich SQL step for the latest finished run of each project (no crawl, no provider cost, no paid calls). Check on the Eventus run: `broken_outlinks` falls to the real 404s and the "Broken and redirected" tile drops from 816 to the real number; record both numbers in this file.
8. **Web (il-web, after Task 6).** Words first in `docs/glossary/terms.md` ("Blocked", "Read x of y pages", the coverage sentence). Status cell: neutral grey "Blocked" chip with a tooltip, never red. Flag "Blocked" replaces "Error page" for these. A coverage banner above the Pages list and in the shared client summary, shown only when pages are blocked. Tiles and counts follow the API. "Not reachable" and orphan tiles show a small "may be incomplete" note when the API says so. No instruction to the customer.

## After this plan (separate plans, each needs an owner go)

- **A. Let the crawler in by default (no customer action).** First read-only check, no spend: what the DataForSEO On-Page task lets us set (crawler name, browser rendering, proxy options) and what their documented bot identity and IP ranges are. Then a decision: keep the provider as the crawler (then verified-bot programs are theirs to apply for, and we can only ask them and use the options they offer) or run our own fetcher for blocked pages (then we apply to Cloudflare Verified Bots, Akamai and others ourselves, publish a bot page and IP ranges, and sign requests with Web Bot Auth). Spoofing a browser, rotating residential proxies and solving challenges are out of scope.
- **B. Fill the gaps with data we already hold.** Pages known from the sitemap and Search Console but not read show as "known, not crawled". Needs a look at what we store from the sitemap today.
- **C. A paid headless-browser retry for pages that answered a JavaScript challenge**, opt-in per project, clearly our own agent.

## Not in this plan

No change to the crawl order, the paid crawl, the release, or the production database by hand. Task 7 runs only the existing enrich step for finished runs and only with the owner's go.

## Built, with notes (2026-11-23)

- Tasks 1 to 7 are built; Task 8 (web) is il-web's. `pages_blocked` is a stored column on `seo.crawl_runs` (migration 0030, null for a crawl not counted), written when ingest finishes. Migration 0031 recounts finished crawls that have refusals (`idraft.db.blocked_recount`); it runs with the next release, no manual database work.
- A status class `blocked` joins `2xx` to `5xx` (4xx no longer holds 401, 403, 429); the row flag `blocked` replaces `broken` for those pages; the `broken_and_redirected` worklist and the edges target filter follow.
- `Worklists.may_be_incomplete` and `SummaryWorklist.may_be_incomplete` (true for under_linked_t1, orphans, editorial_orphans, deep_only_through_auto and weak_outlinks when the crawl has refusals). `ClientSummary.pages_blocked` and `CrawlRun.pages_blocked` carry the coverage; the web builds "read x of y" from `pages_crawled` and `pages_blocked`.
- The crawl diff leaves out the links of a page that refused the crawler in either crawl, so a refusal is no lost or added link and raises no alert. Known gap: a page linked only from a refused page still shows a lower editorial link count in the page-level changes ("moved pages"); not changed.
- Crawls whose links were dropped by retention keep the broken counters they had; flags and filters read the status code, so they are right either way.
- Not done: Task 7's check on the Eventus production crawl (before and after numbers) waits for the release and the owner's go.
