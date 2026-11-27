# Page history: implementation plan

Spec: `docs/superpowers/specs/2026-11-27-page-history-design.md`. Branch `claude/page-history-4fc06d` (worktree). One task at
a time, tests first, targeted serial checks only (`uv run pytest -n 0 --no-cov <path>`, `ruff`, `mypy` on touched files),
each task ends with an independent review and one commit. Sonnet, medium effort. No full suites.

## Task 1: pure modules (no database)
Files: `backend/src/idraft/crawl/declared_dates.py`, `page_text.py`, `page_history.py`; tests in `backend/tests/crawl/`
(`test_declared_dates.py`, `test_page_text.py`, `test_page_history.py`).
- `declared_of`, `read_page_text` (+ `PageText`, `Heading`), `content_hash`, `classify_change`, `diff_snapshots`,
  `summarize_run` as in spec 4.1 to 4.4.
- Tests first: JSON-LD in `@graph`, meta fallbacks, future and malformed dates, no zone; Cloudflare-obfuscated email
  gives equal full hash; script and comment changes give equal hashes; nav text change leaves main hash equal; an
  auto-generated link's text is left out of main; `diff_snapshots` for each change type and the 5 % / 20 words rule;
  `summarize_run` thresholds (19 pages is never site-wide) and unreliable dates (same day, different minutes).
Done: tests pass, `ruff check`, `ruff format --check`, `mypy` clean on the three modules.

## Task 2: schema
Files: `db/migrations/versions/0042_page_history.py`, `db/tables.py` (Table objects for the five tables and the
`crawl_pages.sitemap_lastmod` column), `tests/db/test_page_history_schema.py`, `tests/db/test_tables.py` and
`test_grants.py` entries as the neighbours do.
Done: migration up and down on the test database, tenant isolation test (a second workspace sees nothing), grants test.

## Task 3: ingest
Files: `providers/dataforseo/on_page.py` (`PageItem.sitemap_lastmod`, defensive), `collectors/crawl_ingest.py`
(`_PageLinks.history`, `_read_page`, the write in `_links`, `summarize_run` at the end of the links step, `_page_values`
for `sitemap_lastmod`), `collectors/page_history_store.py` (writes: previous checks for a batch, `ON CONFLICT DO NOTHING`
for re-ingest), tests in `tests/collectors/`.
Done: a two-crawl test (unchanged page keeps one snapshot and two checks; edited page adds a snapshot; a footer change on
every page marks the run site-wide; a page with no HTML writes no check; re-ingest is idempotent; a parse failure does not
fail the crawl).

## Task 4: history endpoint
Files: `api/internal_links/page_history.py` (read model), a route in `read_routes.py`, schema in
`api/schemas/`, tests in `tests/api/` (cross-tenant case added to `tests/security/test_cross_tenant.py`), `backend/openapi/v1.json`.
Done: tests for versions newest first, `first_seen` against `history_starts`, redirect and error pages, unknown URL id 404,
declared hidden when the run is unreliable, `google` null when not tracked.

## Task 5: Google last crawl
Files: `providers/google/client.py` (`inspect_url`), `collectors/gsc_inspect.py`, tests in `tests/providers/google/` and
`tests/collectors/`.
Done: fake Google test for the happy path, a quota error (slows the property bucket), the daily cap, no token spent beyond
the cap; the endpoint reads `seo.page_google_crawl` when a row exists.

## Task 6: web client
`pnpm gen:api` in `apps/web` in its own commit.

## Task 7: web tab
Files under `apps/web/src/features/page-history/` (section 9 of the spec), strings in `messages/en.json` and
`docs/glossary/terms.md` first, tests next to each file. Done: `pnpm lint`, `typecheck`, the feature's tests, and `pnpm build`
once at the end.

## Task 8: wrap-up
Docs: `docs/19-api-specification.md` (endpoint), `docs/04-data-model.md` (tables). Final report.
