# Internal links, plan 06: as-of dates, wording, client summary link, full sorting (backend)

Date: 2026-11-23. Branch: `feat/internal-links-backend`. Owner decisions D8 to D16 of the roadmap, as relayed by the research and design session. Targeted serial tests only; Sonnet or Haiku builders, one at a time. `backend/openapi/v1.json` is regenerated in the last task and il-web is told.

## Decisions taken as given (no work, or a check only)

- D8: the extra daily Search Console page call per property stays (`page_totals=True`). Nothing to build.
- D9: alerts are in-app only; email and Slack stay refused with `422 channel_unavailable` until WP-47. Nothing to build.
- D11, D12: as in plan 04. Open point P1 below is settled: the opportunity rule stays editorial-only.

## Tasks

1. **As-of dates (D10).** Add `rank_as_of` and `citations_as_of` (date or null) to the `keywords` and `citations` extras of a page (and to the pages list rows that carry them). Rank and citation numbers stay today's numbers. The date is the day of the newest check that produced the number; null when there is none. Tests: a page with a check three days old returns that date; no data returns null. Files: `api/internal_links/extras.py`, `api/schemas/internal_links.py`.
2. **Wording (D13).** The user-facing name is "Link strength change", in points, never the share. Audit: `equity` appears in 46 source lines and 23 lines of `openapi/v1.json` (`equity_points`, `equity_share`, `source_equity_share`, the `equity_share` sort). Task: put "Link strength" in every description and summary string, and decide P2 (rename the fields or not) before touching names. Test: a contract test that no OpenAPI description or summary contains the word "equity".
3. **Share table and migration 0029 (D15).** `seo.client_summary_shares`: `id`, `workspace_id`, `project_id`, `token_hash` (SHA-256 of a 32-byte random token, unique; the token itself is shown once), `created_by`, `created_at`, `expires_at` (not null), `revoked_at`, row-level security by workspace, grants for the API role. Test: schema, RLS and grants tests (extend `tests/db`).
4. **Create, list, revoke (D15).** `POST /projects/{id}/internal-links/shares` (body: `expires_in_days` in 7, 30 or 90, default 30; never is not offered), `GET` the list (no token, no hash), `DELETE /shares/{share_id}` (sets `revoked_at`). Behind normal auth, CSRF and a permission (P3). Audit log rows for create and revoke (existing `api/audit.py`). Tests: permissions, expiry choices, token shown once, list never holds the token, revoke twice is harmless, cross-tenant 404.
5. **Public read endpoint (D15).** `GET /public/internal-links/summary/{token}`: no session, no cookie, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`. Looks the token up by hash with a constant-time compare; unknown, expired and revoked all answer the same `404`. Returns only the summary payload (P4), built from a dedicated schema that has no crawl page rows, emails, member names or internal ids. Rate limited per IP and per token (P5). Tests: expired, revoked, wrong token, response schema has no forbidden fields, rate limit answers 429.
6. **Full server-side sorting (D16).** Extend `PageSort` with `rank`, `citations`, `anchor` (and any column still not sortable), ascending and descending, in the pages list and its CSV, with the existing keyset cursor and `url_id` as the last tie-break; nulls sort last in both directions (P6). Tests: every sort key pages through a fixture twice without a repeat or a gap; ties break by `url_id`; a cursor from another sort is `400 invalid_cursor`.
7. **Contract.** `uv run python -m idraft.api.openapi` (the project's own export command), commit `backend/openapi/v1.json`, run the OpenAPI snapshot test, tell il-web to run `pnpm gen:api`.

## Open points, to settle before tasks 3 to 6 are built

- **P1 (D12).** Plan 04 D12 and spec 7.10 say a mention stops being an opportunity only when an EDITORIAL link exists (a menu link is not an in-text link). The relayed request asked for "any followed link". SETTLED: D12 stays as planned (editorial only); the "any followed link" idea was a suggestion, not an owner decision, and it contradicts the spec. `opportunities.py` and the enrich skip are not changed.
- **P2 (D13).** Renaming `equity_*` fields breaks the web client and the mock data. Proposal: keep the field names, fix every description, and rename in one later contract change; or rename now together with il-web.
- **P3 (D15).** Which permission creates and revokes a share: `project:update` or a new `project:share`? Proposal: `project:update`.
- **P4 (D15).** What "summary" holds. Proposal: the crawl summary (pages, health counts, tier counts, changes since the last crawl, top lost links by tier, the project name and the crawl date) and nothing at page level. No URLs of other tenants' data can appear; page URLs of the project's own site are a decision (proposal: counts only, no URL list).
- **P5 (D15).** Rate limit numbers. Proposal: 30 requests a minute per IP and 120 an hour per token, stored in Redis as the sign-in limits are.
- **P6 (D16).** What "rank", "citation" and "anchor" mean for a page. Proposal: rank is the best current position among the page's tracked keywords; citations is the total count over engines; anchor is the page's most used editorial anchor text, compared case-insensitively. Nulls last whichever the direction.
- **P7 (D15).** Expired shares: kept for 30 days for the audit trail, then deleted by a daily job, or kept forever? Proposal: keep the row (hash only), no job.

## Built, with notes (2026-11-23)

- Tasks 1 to 7 are built. Sort keys of the Pages list added in task 6 and its follow-up: `rank`, `citations`, `anchor`, `tier`, `clicks`, `title`, `indexable`, `in_sitemap`, each also with a leading `-`. Rank, anchor, tier and title put a page with no value last in both directions; clicks and citations count 0.
- **Anchor sort, 50,000 pages.** The top anchor is worked out per request from the crawl's editorial links (group by target and trimmed text, then the most used per page), so the cost grows with the link count. Timed on the Eventus crawl (15,337 links, 421 pages) the whole ordered query took 2.8 ms, so a site of 50,000 pages and 600,000 links would take roughly 40 times that, about 0.1 to 0.2 seconds: below the 1 second line, nothing built. Not timed on a real 600,000-link crawl. If it is slow there: store the top anchor on `seo.crawl_pages` (a text column `top_anchor_key`, set by `crawl_enrich` in its anchors phase beside `editorial_anchors`, with a worker column grant), sort on that column, and drop the subquery.
