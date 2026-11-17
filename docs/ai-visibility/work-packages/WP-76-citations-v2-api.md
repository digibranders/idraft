# WP-76: Citations v2 API (cited pages, gap analysis, runs window)

| Field | Value |
|---|---|
| Wave | X: owner change of 2026-11-16 (Citations replaces Sources) |
| Kind | backend |
| Status | new; the coordinator adds it to `docs/ai-visibility/tracker.json` |
| Branch and worktree | `ai/wp-76-citations-v2-api` in `.claude/worktrees/wp-76` (`infra/dev/wp-start WP-76 citations-v2-api`) |
| Depends on (merged on develop first) | WP-14 sources lane (merged), WP-21 and WP-22 (merged) |
| Blocks | [WP-77 citations-v2-web](WP-77-citations-v2-web.md) |
| Owner decisions | D-1 to D-5 in [WP-77 section 2](WP-77-citations-v2-web.md#2-decisions-the-owner-has-not-taken-yet); defaults used |
| Estimate | 10 Sonnet-agent tasks, about 7 hours with one task in flight |
| Detailed plan | [docs/superpowers/plans/2026-11-17-ai-wp-76-citations-v2-api.md](../../superpowers/plans/2026-11-17-ai-wp-76-citations-v2-api.md) (written, full code) |

## Goal

Five `data:read` routes under `{P}/ai` that return what the design preview's Citations page shows, number for number:

| Route | Feeds |
|---|---|
| `GET citation-overview` | The six measures of the strip, the runs window (slot dates for the Runs select, the trend axis, "Updated ... run N") |
| `GET cited-pages` | The Cited pages table: rows with citations, change, prompts and the top ten prompts, engines, trend, last cited; owner counts; offset pages; sort and search on the server |
| `GET cited-pages/{url_id}` | The page drawer: every prompt citing it with cited over answers per engine, the domains cited alongside |
| `GET citation-gaps` | The gap table: per prompt, you and up to five competitors, per engine counts and states, lost on, lost to; gap count |
| `GET citation-gaps/{prompt_id}` | The gap drawer: competitor pages, own pages here, the closest own page, third-party pages |

Shared parameters: `runs` (1, 2 or 4; default 4), `filter[engine_code_in]`, `filter[term]`, `include_branded`, the two flag toggles; `filter[competitor_id_in]` (1 to 5) on the gap routes.

## Read first

- AGENTS.md and CLAUDE.md (develop only, never `main`, checks before handover, working beside other sessions)
- docs/ai-visibility/MASTER-PLAN.md sections 3 to 6
- The detailed plan above, then `apps/web/design-preview/cit-data.js` (the counting the routes reproduce) and `cit-data.check.mjs`
- `backend/src/idraft/api/ai/source_repository.py` (module note, `counted_answers`, `citation_bounds`), `sources.py`, `source_routes.py`
- docs/16 C2 (citation unit), docs/19 sources lane as-built notes

## Files this package owns

- `backend/src/idraft/api/ai/citation_board*.py` (new), `backend/src/idraft/api/schemas/ai_citation_board.py` (new)
- `backend/tests/api/ai/citation_board_support.py`, `test_citation_board_*.py` (new)

## Leases it needs from the coordinator

- `backend/src/idraft/api/resources.py` and `main.py`: one field, one constructor argument, one `include_router`
- `backend/tests/api/test_route_access.py`: five `EXPECTED` entries
- `backend/openapi/v1.json` and `apps/web/src/lib/api/schema.ts`: regeneration only, in the same push

## Acceptance criteria

- Every rule of the plan's "Counting rules" section has a model test with numbers worked out by hand
- The strip's Total citations equals the sum of the own rows of `cited-pages` for the same scope (the preview's self-check, kept as a route test)
- A prompt answered by a manual run only on one engine gets slot 1 on that engine alone; slot numbering never mixes pairs
- A full project (prompt limit, eight weekly runs, three engines, three competitors) answers each route inside the sources timing budget
- `./check.sh` green; OpenAPI regenerated; `pnpm gen:api` committed right after; docs/19 as-built note written

## Review

Per task: a fresh Sonnet reviewer reads the task, the diff and the matching part of `cit-data.js`, runs the task's tests and returns PASS or a numbered fix list. At the end: a second reviewer reads the whole diff against the counting rules.

## Commit and push

One commit per task, `WP-76: <title>`, only this package's files; rebase on `origin/develop` before each push; `git push origin HEAD:develop`. Never push `main`, never run `infra/ship.sh`.
