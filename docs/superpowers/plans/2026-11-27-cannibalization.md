# Cannibalization: build plan

Spec: [docs/33](../../33-cannibalization-and-switching.md) (served as the spec; section 3.1 records what the real tables hold). Design is decided by the owner; mock in `apps/web/design-preview` (`canni.js`, `canni-data.js`, `canni-inspector.js`), read only. Zero provider spend: everything is derived from `seo.domain_rank_observations`.

Rules for this plan: tests first, targeted serial checks only, one subagent at a time, each task ends with an independent review, sentence case, no em or en dashes, glossary first.

## Scope

In: rules module, read model, API (keywords, pairs, switches, per-keyword history, per-page conflict counts), web page `/seo/cannibalization` with both tabs, strip, tables, weekly chart, inspector.
Out (stated in the final report): CSV export (doc 33 section 7.5 lists it as later), alerts, Search Console clicks, `historical_serps` backfill, the `seo.url_switches` table and nightly task (switches are derived on read, so no migration), setting a target page from the drawer.

## Tasks

### T1 Rules module (backend)
`backend/src/idraft/ranks/cannibalization.py`, pure, no I/O. Types: `Check(day, readable, pages)` where `pages` is the own `(url_id, rank)` pairs of one check; `analyse(checks) -> Analysis` with verdict (`likely`, `co_ranking`, `unstable`, `none`, `unranked`, `insufficient`), ranked checks, per-page stats (ranked, times best, median, best ever, last), primary page (best median rank when ranking page on 3 or more checks), rank gap, switch rate, co-ranking rate, confirmed switches (debounced, flip-flop within 14 days), flickers, longest hold, held now, strip. Constants `MIN_CHECKS = 10`, `FLIP_DAYS = 14`. `checks_from_observation(...)` turns the stored arrays into `Check` (merge entities, grouped rule, readable rule of section 3.1).
Tests first in `backend/tests/ranks/test_cannibalization.py`, the cases of `canni-data.check.mjs`: a flicker is not a switch, a return within 14 days is a flip-flop, a grouped sub-result is not co-ranking, the gap is never negative, 9 ranked checks is `insufficient`, no ranked check is `unranked`, likely, co-ranking and unstable each on a frozen fixture, primary is best median not most frequent.

### T2 Read model, API, per-page counts (backend)
`backend/src/idraft/api/cannibalization/` (repository, service, routes) and `api/schemas/cannibalization.py`, wired in `api/main.py` and `Resources` like `LinkReadService`. Permission `data:read` (the permission the Keywords reads use; confirm in code). Routes under `/api/v1/workspaces/{workspace_id}/projects/{project_id}`:
- `GET /cannibalization`: keyword rows (verdict, pages with letter order, rank, gap, switches, together rate, volume, strip, on-target flag), headline numbers with previous-period values, filters `device`, `group_id`, `verdict`, `days` (14, 30, 90), paging.
- `GET /cannibalization/pairs`: page pairs.
- `GET /cannibalization/switches`: switch events, the Switching headline, weekly buckets (improved, same, dropped), filters as above plus `kind` (flip_flop, improved, dropped, left_target).
- `GET /tracked-keywords/{id}/url-history`: per check page and rank for the drawer.
- Python function `conflicts_by_page(session, project_id, device, days) -> dict[url_id, PageConflicts{keywords, likely, co_ranking, unstable}]` for Monitoring and Issues.
Integration test with the DB fixtures of `tests/api/keywords`. `backend/openapi/v1.json` regenerated in the same commit.

### T3 Web client regeneration (own commit)
`pnpm gen:api` in `apps/web`, committed alone.

### T4 Words, route, navigation
New strings in `docs/glossary/terms.md` first, then `messages/en.json`; item "Cannibalization" in the SEO group of `apps/web/src/lib/navigation/registry.ts` after Keywords; route files `/seo/cannibalization` and `/seo/cannibalization/switching`.

### T5 Web page
Feature folder `apps/web/src/features/cannibalization/`: hooks over the generated client, scope toolbar (Device, Group, Period, Reset), tabs, strip, By keyword and By page pair tables, Switching tab with weekly chart (existing chart components) and Changes and By keyword tables, history strip, address-held filters, empty and "Not enough checks" states. Table first at 1280 by 720.

### T6 Inspector
The keyword inspector (Evidence, Timeline, Pages) on the shared overlay `Inspector` from `claude/shared-drawer-121ede` (read with git; if not merged, build against its API). `inspect=cann-keyword:<id>`.

### T7 Verify and report
Targeted lint, typecheck, tests, format, build; page in a browser at 1280 by 720 against the dev stack if it can run; final report with the Monitoring join and the Issues seam documented, migration note (none used), branch name.

## Review gate
After each task one independent review subagent reads the diff against this plan and doc 33 and writes findings to the shared notes folder; real findings are fixed before the next task.
