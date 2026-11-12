# AI prompts, plan D: backend handoff for the web parity work

> **For the backend session.** This is a handoff, not a task by task plan. You write your own detailed plans from it: D1 already exists ([2026-11-12-ai-prompts-d1-summary-additions.md](2026-11-12-ai-prompts-d1-summary-additions.md)); D2 (runs and sources: B6, B7, B19) is the next one to write. Do not duplicate D1 here: this document covers what D1 does not.

**Goal:** Give the web session the data the Topics & Prompts page, the prompt inspector, the Citations page and the competitor views need, in the order that unblocks the most web work for the least backend work.

Sources: [parity spec](../specs/2026-11-12-topics-prompts-preview-parity.md) (gap ids G, items B1 to B18 as numbered in the earlier gap analysis), [competitor study](../specs/2026-11-12-ai-visibility-competitor-study.md) (data point ids), [web plan](2026-11-12-ai-prompts-w2-web-parity.md) (tasks W1 to W16), [slice 1 spec](../specs/2026-11-11-ai-prompt-tracking-slice-1-design.md), [doc 19](../../19-api-specification.md) section 3.7. Paths: `B` is `backend/src/idraft`, `BT` is `backend/tests`, `{P}` is `/api/v1/workspaces/{workspace_id}/projects/{project_id}`.

## 1. Status of each item

| Item | Purpose | Status | Plan |
|---|---|---|---|
| B1 `last_observed_at`, `last_valid_at` on summary rows | header meta, Updated column, stale badge | **BUILT** on `origin/develop` (`6d681a5`); the web needs `pnpm gen:api` | D1 Task 1 |
| B2 scope params `filter[country_iso]`, `filter[term]`, `branded_only` | country and Branded Only on Topics and the strip | not built | **D1 Task 2** |
| B3 weekly series (`include=series`) | sparklines and topic trend | not built | **D1 Task 4** |
| B4 previous period (`compare=previous_period`) | deltas from one read | not built | **D1 Task 3** |
| B5 per entity cells (`include=entities`) | competitor views | not built | **D1 Task 5** |
| B6 citations aggregate | Citations tab and page | not built | D2 (below) |
| B7 bulk run and bulk archive | bulk bar | not built | D2 (below) |
| B19 fan-out exposure | fan-out view | not built | D2 (below) |
| B8, B9 split, B10 to B18 | see sections 3 and 4 | not built | later plans |

D1 opt-in parameters the web can mock now: `include=series,entities` and `compare=previous_period` (blocks are absent unless asked), `filter[country_iso]` (`^[A-Z]{2}$`), `filter[term]` (term or below), `branded_only`. Weeks start Monday in the project timezone. The owner decided on 2026-11-12 the questions that were open here (section 5), except items 8 and 9, which are still open. D1's "Decisions" and "Open points" sections stay the contract; this handoff does not restate them.

## 2. Rules every backend plan follows

1. **Checks** (AGENTS.md): `colima status || colima start --cpu 10 --memory 16`, the Docker variables exported, then `cd backend && uv sync --frozen && ./check.sh` (ruff, ruff format, mypy, import contracts, pytest on 4 workers). A partial test run takes `--no-cov`. Never restart Colima or stop `idraft-dev-*` containers.
2. **OpenAPI.** Every task that changes the API regenerates `backend/openapi/v1.json` in its own commit (`BT/api/test_openapi.py` fails on a stale file).
3. **Web client.** (Decided 2026-11-12, decision 7.) A backend commit that changes the API updates `backend/openapi/v1.json` only. The web session runs `pnpm gen:api` in `apps/web` in its own commit right after, and the CI-free checks stay green on both sides. Two sessions never edit `apps/web/src/lib/api/schema.ts` at once. This matches AGENTS.md as amended.
4. **Cross-tenant tests** for every new route and table: add them to `BT/security/test_cross_tenant.py` (the new route is scanned with every option); row-level security and grants on every new table (`workspace_id`).
5. **Opt-in blocks.** New expensive parts are opt-in (`include=`, a parameter) and absent from the JSON unless asked, as D1 does, so a caller that does not ask pays nothing.
6. **No N+1.** Aggregate in one grouped query; assert the statement count in a test as D1 does.
7. **Branded prompts** are excluded from rates unless included (doc 16 rule 4); new aggregates take `include_branded` with the same default as the summary.
8. **Files are pure ASCII**; edit with the file tools only; commit messages carry no attribution lines and no dashes; name the files of every commit; never stage another session's files.
9. **As built notes** in doc 19 and the phase roadmap ([29](../../29-phase-roadmap.md)) in the plan's last task, as D1 Task 6 does.
10. **No push to `main`.** Work lands in `develop`; `main` only through `infra/ship.sh` when the owner says to release.

## 3. Items D1 does not cover

### B6. Citations aggregate

| Field | Value |
|---|---|
| Purpose | Which domains and pages the engines cite, per prompt, topic and engine, with role and share (CI-01 to CI-16, PR-23, PR-51, M-02, FO-13) |
| Web task unblocked | W7 (prompt Citations tab and Citations page), W13 (Overview), the "cited instead" popover (U-15) |
| Where the data is | `ai.citations` (columns: `observation_id`, `observed_at`, `engine_code`, `url_id`, `domain_id`, `raw_url`, `title`, `domain_role`, `role_entity_id`, `citation_kind`, `occurrences`; indexes `citations_project_domain_observed`, `citations_url_observed`; migration 0018), joined to `ai.observations` for `prompt_id` and to `ai.observation_facts` (current, valid) for the answer count. No new table. `CitationOut` already exists in `B/api/schemas/ai.py` for the per answer list |
| Contract | Three routes, permission `data:read`, all with `from`, `to` (default the last 28 days, at most 92: `422 window_too_large`), `filter[engine_code_in]`, `filter[prompt_id]`, `filter[term]`, `filter[domain_role_in]`, `include_branded` (default false) and cursor pages (doc 19 section 2.5) |
| | `GET {P}/ai/citations`: doc 19 line 1245 as written. Row `CitationRow`: `observation_id` (string), `observed_at`, `prompt_id`, `engine_code`, `citation_index`, `url`, `host`, `title`, `domain_id`, `url_id`, `domain_role`, `role_entity_id`, `citation_kind`. Keyset `(observed_at DESC, observation_id DESC, citation_index)` |
| | `GET {P}/ai/sources/domains`: one row per domain: `domain_id`, `host`, `domain_role`, `citation_units` (distinct URL per answer, doc 16 C2), `observations` (distinct answers), `prompts` (distinct prompts), `engines: [{engine_code, citation_units}]`, `source_share: MetricCell` (numerator the domain's units, denominator all units in scope). `sort` `-citation_units` (default), `-observations`, `-prompts`. Computed by a direct query over `ai.citations`; `ai.daily_domain_citations` (doc 19 line 1246 reads from it) is not built, and at 3,900 answers a month a query is enough. State that in the route description |
| | `GET {P}/ai/sources/pages`: as domains plus `filter[domain_id]`; row `url_id`, `url`, `title`, `host`, `domain_role`, same counts |
| | Errors: `422 validation_failed`, `422 window_too_large`, `404` for an unknown project; no `raw:read` needed (no raw payload) |
| | Optional second step, `include=previous` (same pattern as D1): `previous` counts of the preceding equal window per row, for the New and Lost markers (U-16). Skip if the first step is already large |
| Not in this item | `filter[category_in]` (no domain category data yet), `filter[matched]`, publishers, co-mentioned entities (doc 14, Ph 13) |
| OpenAPI and client | New schemas `CitationRow`, `SourceDomainRow`, `SourcePageRow`; `pnpm gen:api` by the web task W7 |
| Tests | Counts match a seeded set of citations across roles and engines; a repeated URL in one answer is one unit; `occurrences` does not inflate units; branded prompts are left out by default; window and cap errors; cross-tenant; statement count; the top 5 per prompt equals a hand count; a citation of an invalid answer is left out |
| Size | M to L |
| Dependency | none (D1 Task 2 only for `filter[term]`, which can use the same `term_subtree` helper) |

### B7. Bulk run and bulk archive

| Field | Value |
|---|---|
| Purpose | Run now for many prompts as one manual run; archive many prompts in one call |
| Web task unblocked | W10, and it lifts the 20 a day cap that W5 applies in the browser |
| Where it is | Run now is `POST {P}/prompts/{id}/run-now` (`B/api/ai/prompt_routes.py`, `runs.ai_run_now` in `B/api/operations/runs.py`, which counts `MANUAL_RUNS_PER_DAY = 20` per UTC day, `429 manual_run_limit` with `limit`, and `422 quota_exceeded` with `limit`, `used`, `requested`, `quota`). Prompt archive is `DELETE prompts/{id}` |
| Contract | `POST {P}/ai/runs`, `runs:trigger`, body `{ prompt_ids: uuid[] (1 to 150), engine_codes?: string[] }`, `202 One<Run>`. It counts as ONE manual run against the daily limit and each task against `max_ai_observations_per_month`. Anything the planner would skip (engine not enabled, location not enabled, prompt too long, price unavailable, a check already pending) is refused per prompt and engine and returned in `meta.skipped: [{prompt_id, engine_code, reason}]`; the run still starts for the rest; if nothing is left, `422 nothing_to_run`. Whole request errors: `429 manual_run_limit`, `422 quota_exceeded`, `409 check_pending` only when every item is pending |
| | `POST {P}/prompts/bulk-archive`, `prompts:write`, body `{ ids?: uuid[], filter?: object, archive: boolean }` (exactly one of `ids` and `filter`, at most 1,000 matched), response `{ data: { matched, updated } }`. Doc 19 line 1093. Unarchive is checked against `max_active_prompts` (`422 quota_exceeded`). `panel_locked` does not apply until panels exist |
| OpenAPI and client | `RunBulk` body, `PromptBulkArchive`; `pnpm gen:api` by W10 |
| Tests | One manual run counted for 30 prompts; the 21st manual run of a UTC day is refused; skipped items listed with reasons; budget block shows its estimate; bulk-archive matched vs updated; unarchive over quota; cross-tenant; audit entries |
| Size | M |
| Dependency | none |

### B19. Expose the ChatGPT fan-out lists already stored (slice 2 pre-work)

| Field | Value |
|---|---|
| Purpose | Show which sub-queries ChatGPT issued while answering a prompt, how often, and who was cited in those answers (FO-01 to FO-17, M-20; adopt U-07) |
| Web task unblocked | W9; the interim FO-14 and FO-16 (mean fan-out per answer) already work from `fanout_count` |
| Where the data is | `ai.observations.provider_extras` (jsonb) keys written by `B/providers/dataforseo/ai_parse.py` (line 177): `fan_out_queries` (list of strings, only for engines with `exposes_fanout`, ChatGPT), `search_results` (a count). `ai.observations.fanout_count` (smallint) is the true length of the list before bounding (`fan_out_count=len(fan_out)`). `ai.engines.exposes_fanout` says which engines have it |
| The 16 KB bound (check it) | Migration 0018 caps `octet_length(provider_extras::text) <= 16384`. `_bounded` in `ai_parse.py` halves the longest list until it fits and sets `"truncated": true`, or stores only `{"truncated": true}`. So a list is complete exactly when `truncated` is absent; an answer with `truncated` has fewer queries than `fanout_count`. B19 must report it, never present a cut list as complete. Add a test that builds an extras value at the bound |
| Contract | `GET {P}/ai/fanout-queries`, `data:read`, `from`, `to` (92 days), `filter[engine_code_in]` (an engine with no fan-out: `422 engine_has_no_fanout`), `filter[prompt_id]`, `filter[term]`, `min_support` (default 2, at least 1), `include_branded`, cursor page sorted `-observations`. Row: `query_text` (most common surface form), `normalized_text` (lower case, trimmed, whitespace collapsed: the grouping key, doc 16 F4), `observations` (answers issuing it), `prompts` (distinct), `engine_code`, `first_seen_at`, `last_seen_at`, `cited_domains: [{domain_id, host, domain_role, citations}]` (top 5, from the citations of those answers, an association not a link: the query to source linkage `fanout_seq` is nullable and not stored). Response `meta`: `answers_total` (valid fan-out capable answers in scope, the denominator of F4), `answers_truncated` (answers whose list was cut), `engines_without_fanout` (so Gemini and AI Mode read "not exposed", never zero) |
| Not in this item | `matched_keyword` and `own_rank` (doc 19: F5, Ph 15), own domain retrieved vs cited (needs `ai.retrieval_results`, S2) |
| OpenAPI and client | `FanoutQueryRow`; `pnpm gen:api` by W9 |
| Tests | Grouping by normalised text; `min_support`; a truncated extras value counted in `answers_truncated`; an engine without fan-out is refused; `cited_domains` equals a hand count; branded scope; cross-tenant; one statement (a `jsonb_array_elements_text` unnest bounded by the window, partition pruned on `observed_at`) |
| Size | M |
| Dependency | none |

### B8. Saved views (platform item)

`GET/POST/PATCH/DELETE {P}/saved-views` (doc 19 lines 1675 to 1678, permission `views:write`), table `core.saved_views` (doc 04 11.6, migration not written: raw SQL with row-level security). Screen key `ai.prompts`; `query_string`, `columns`, `sort`, `visibility`, `is_pinned`. Shared with Rankings, so it is a platform plan, not a prompts plan. Unblocks persistence for G02 (W5 ships presets without it). Tests: duplicate name `409`, workspace visibility needs editor, cross-tenant. Size M to L. Dependency: none.

### B9. SEO per topic (split in two)

| Part | What | Backend |
|---|---|---|
| B9a | Tracked keyword count and Top 10 count per topic | None: web reads `GET {P}/tracked-keywords` with `filter[term]`, `filter[rank_lte]=10` and `page.total` (the way `rankings/strip/strip-queries.ts` counts). Needs the check that keyword topics and prompt topics share one vocabulary |
| B9b | Volume weighted SEO visibility per topic | `GET {P}/seo/metrics/breakdown?dimension=term&metrics=seo.keywords_tracked,seo.keywords_checked,seo.top10_count,seo.visibility_volume` (doc 19 line 1060, `data:read`, `{ data: Array<{ dimension: { type, id, label }, values: MetricValue[] }> }`, topic rows do not sum to the total, stated in `meta.notes`). CTR curve and volume weighting per doc 09. Size M |

Unblocks W16. Do B9b last of the near term items.

### B10 to B18 (later, each its own plan)

| Item | Purpose and web task | Contract in one line | Data and dependency | Size |
|---|---|---|---|---|
| B10 Panels | G60 to G66, G09, G81; W14 | tables `ai.prompt_panels`, `ai.panel_memberships` (doc 04 lines 1056, 1069), a locked core panel per project seeded with every active prompt from its creation date; routes `{P}/panels`, `.../memberships`, `.../memberships/remove` (reason required on locked, `panels:core:modify`, `meta.churn_90d`, `churn_warning` above 10%), `.../sizing`, `.../promotion-candidates`; `filter[panel]` on prompts | slice 4; **unblocked** (decision 1: twice a week, Monday and Thursday, for every prompt; weekly may become a per panel option later; the core panel seed keeps the existing two schedules) | L |
| B11 Versions and restore | G67 to G70; W14 | `GET/POST {P}/prompts/{id}/versions` (`If-Match`, `change_kind`, `change_reason`), `POST .../versions/{vid}/restore`, `GET .../timeline` (doc 19 3.7.1); `prompt_versions` already has `change_reason`, `created_by` | slice 4; **unblocked** (decision 2: a restore is not a `change_kind`; it re-points `current_version_id` and writes an audit entry; `change_kind` is `initial`, `wording`, `typo`, `context`) | L |
| B12 Project wide version feed | G67 | `GET {P}/prompt-versions?filter[change_kind_in]&from&to`, cursor, newest first: `{prompt_id, prompt_text, version_no, change_kind, change_reason, created_by, created_at}` (new route; doc 19 has per prompt versions only) | after B11 | S to M |
| B13 AI Overview | G120; W13 later | engine seed `google_ai_overview` (not in code), `core.keyword_prompt_links` (not created), summary cell fed from rank checks with `source_state` of `no_linked_keyword`, `not_tracked`, `no_surface`, `ok` and `checks` beside `n` (ADR-DS-022 consequences); rank data is the data DataForSEO has issues with | slice 2; depends on keyword links | L |
| B14 Recommendation, prominence, sentiment | G42, G121, DB-09, M-07 | fill `own_recommended`, `own_prominence`, `own_structured_rank`, `own_sentiment` in `ai.observation_facts`; expose a `recommended` cell and `outcomes` in the summary | slice 2; extractor work (doc 13) | L |
| B15 Intervals, flip rate, replicates | G48, G65, M-01 | `ci` on `MetricCell`, `GET {P}/ai/stats/volatility`, `ai.flip_rate`, paired verdict (`is_detectable`) on `compare` | slice 3 | L |
| B16 Prompt type | G10 | the source is decided (decision 3 below): a server rule at create plus a person override in the Add dialog and `PATCH`, no LLM; `GET {P}/prompts` gains `filter[prompt_type_in]`; `PATCH` already takes `prompt_type` | **unblocked** | S to M |
| B17 Lint rules | G83 | extend `POST {P}/prompts/lint` with `word_count` (5 to 60), `multiple_questions`, `leading_wording`, `language_mismatch`, `contains_competitor_alias` (doc 11 section 4, doc 19 `LintWarning.rule`); today only `contains_brand_alias` and `engine_limit` | natural home slice 4 | M |
| B18 Generate from keywords, candidates inbox | G03, W12 | `POST {P}/prompts/from-keywords/preview`, `{P}/prompt-candidates` routes, `ai.prompt_candidates` (doc 11 5.2, doc 19 3.7.1, 3.7.3, doc 20 5.13) | slice 4, Ph 11 | L |

## 4. Recommended start order

Once the owner says go. D1 tasks keep their own numbering; this is the order of execution across D1 and D2.

| Step | Item | Plan | Why here | Unblocks |
|---|---|---|---|---|
| 1 | **B2** scope params (and the `gen:api` for the built B1) | D1 Task 2 | Small. Every later aggregate reuses its `filter[term]` and scope helpers. Unblocks the header meta, stale badge, country and Branded Only on Topics | W6 |
| 2 | **B6** citations aggregate (slice 2 pre-work, decision 4) | D2 | Highest value, no new table, no migration; the Citations tab is the single biggest hole in the inspector (G97) and the page the SEO team asked for first | W7, W13 partly |
| 3 | **B5** per entity cells | D1 Task 5 | Largest item and the one that unblocks the competitor views the SEO team wants most (share of voice against named competitors, top competitor, drawer Competitors tab). Slice 2 pre-work, built now (decision 4). Doing it right after B6 lets W7 and W8 run in parallel on the web side | W8, W11 entity lines |
| 4 | **B19** fan-out exposure | D2 | The data is already stored; it is the cheapest route that shows an advantage over the studied tool's best page (N2). Check the 16 KB bound as part of it | W9 |
| 5 | **B7** bulk run and bulk archive | D2 | Small and self contained; lifts the browser side 20 a day cap. Placed after B5 and B19 because the web already ships a capped version in W5 | W10 |
| 6 | **B4** previous period, then **B3** weekly series (`include=series` on the summary, decision 5) | D1 Tasks 3 and 4 | The web works today with two reads (W3) and a client side window (W11 can start from a second read), so these are optimisations and shape fixes, not blockers | W3 switch to one read, W11 |
| 7 | **B9b** SEO visibility per topic | later plan | Counts and Top 10 are web only; only the volume weighted visibility needs the route | W16 |
| Later | B8, B10 to B18 | one plan each | Slice 4 and slice 2 and 3 work; none blocks a slice 1 web task | W12, W14 |

API compression is an ops task (ops session), outside the backend plans; the web asks for `include=series` and `include=entities` only with a `filter[term]` or a small page until it is in place.

Order check: B2 before B5 because both change `summary_repository.py` and B5 reuses B2's `summary_prompts`; B6 before B5 because B6 touches different modules (no summary conflicts) and ships sooner; each step is one commit series with its own `backend/openapi/v1.json` update (the web session regenerates the client in its own commit, decision 7).

## 5. Owner decisions (decided 2026-11-12)

The owner decided 1 to 7 on 2026-11-12 through the question dialog. Nothing in 1 to 7 is open. Items 8 and 9 are not decided: they go to a separate session, and the current default stays meanwhile.

| # | Decision | What was decided | What it unblocks |
|---|---|---|---|
| 1 | Panel cadence | Twice a week (Monday and Thursday) for every prompt. Weekly may become a per panel option later. Doc 11 section 8 is corrected to say twice a week | B10 Panels can be planned; the core panel seed keeps the existing two schedules; the web keeps "twice a week" copy; W14 no longer waits on a decision |
| 2 | Restore | A restore is not a `change_kind`. It re-points `current_version_id` and writes an audit entry. `restore` is removed from the `PromptVersion.change_kind` union in doc 19 | B11 (and B12 after it) can be planned; the web Restore button is allowed once the routes exist |
| 3 | Where `prompt_type` comes from | A server rule at create plus a person override in the Add dialog and `PATCH`, no LLM. Rule: " vs " or "versus" gives `comparison`, "how to" gives `how_to`, a leading interrogative gives `question`. `GET {P}/prompts` gains `filter[prompt_type_in]` | B16 starts; the web Type filter and badge (D-8) follow it |
| 4 | Slice owners | B5 (per entity cells, D1 Task 5) and B6 (citations aggregate) are slice 2 pre-work, built now | D1 Task 5 stays in D1; the competitor and Citations views (W7, W8) proceed |
| 5 | Weekly series path | `include=series` on the summary (D1 Task 4). The generic metrics routes (`{P}/ai/metrics/{metric}/series`, `.../breakdown`) come later, when the Overview page (W13) needs them. Doc 19 carries the note | D1 Task 4 proceeds as written; W11 builds to it |
| 6 | gzip for the API (moved to ops) | API compression (gzip) and every other operations or infrastructure task belong to a separate ops session, not the backend session. No gzip item in the backend plans | Nothing in the backend plans; the web asks for `include=series` and `include=entities` only with a `filter[term]` or a small page until compression is in place |
| 7 | Web client regeneration | Keep the split. Backend commits update `backend/openapi/v1.json` only; the web session runs `pnpm gen:api` in its own commit right after. AGENTS.md is amended to say so | No shared edits of `schema.ts`; rule 3 of section 2 |
| 8 | Bulk Run cap (D-5) | To be discussed in a separate session, no decision yet; keep the current default meanwhile (20 manual runs a day, `429 manual_run_limit`) | B7 and the browser cap in W5 and W10 stay as they are |
| 9 | Page level AI readiness (W15) | To be discussed in a separate session, no decision yet; keep the current default meanwhile (not in scope) | W15 stays unstarted |

One further decision belongs to the web side and is recorded in the parity spec section 4 (D-3): the Topics tab shows an indented tree.

## 6. Test expectations common to B6, B7 and B19

Each plan lists, per task: the failing tests first (route tests through the existing client fixtures in `BT/api/ai`), the cross-tenant scan, a statement count assertion, the OpenAPI regeneration, the permission matrix (`data:read`, `runs:trigger`, `prompts:write`), and one end to end test from a stored answer to the new route (see `BT/collectors/test_ai_end_to_end.py`). The coverage gate applies to the full run.

## 7. Not verified

The 16 KB bound was read in migration 0018 and `ai_parse.py` but not tested against real answers; the share of answers that hit it is unknown. Whether the provider payload carries a quote per citation (CI-11) was not checked. `ai.daily_domain_citations` is not in migration 0018; the volume at which a direct query over `ai.citations` stops being enough is not measured.
