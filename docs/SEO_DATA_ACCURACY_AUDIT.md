# SEO data accuracy audit (2026-11-03)

Scope: Google organic rank tracking, keyword metrics and AI Overview data, from the DataForSEO request to the API the web app reads. Backend only. The audit was run against the `develop` checkout; the changes are uncommitted in the working tree.

## A. Executive summary

**What was wrong.** One confirmed defect corrupted ranks, and three more made the dashboard say less than the data supports.

1. The parser renumbered organic results 1..N in the order it kept them (`organic_rank = len(results) + 1`). A result it dropped (a repeat of an earlier URL, or one with no readable address) moved every later result up one rank. A live Mumbai answer for `fynix digital` had one repeated URL: every result after it was reported one place too high. The provider's own `rank_group` was read and then thrown away.
2. A keyword not found was shown as `>100` (the depth asked for) even when Google gave far fewer results. Live, with depth 100 asked: 99, 66, 43, 66, 36, 63, 49 and 98 organic results came back. `>100` was a claim about positions nobody looked at.
3. A project with no own entity that tracks SEO read every check as "not found", with no sign anything was wrong.
4. A keyword that lost its rank at a single check was shown as `>depth` at once, though the system itself treats one reading as unconfirmed (a second check confirms it).

**What was fixed.** Parser version 4 keeps the provider's rank and leaves a gap; results with an unreadable address make an absent own site inconclusive instead of absent; the API now says how far the answer reached (`depth_returned`) and whether a drop is still unconfirmed (`drop_unconfirmed`); checks for a project with no own entity are stored but move no state. No migration is needed.

**What the live checks show about the Fynix complaint.** Two DataForSEO paths were compared with the app's own request settings (India, desktop, depth 100), and the standard queue was read twice, hours apart.

- The **standard queue** (`task_post`, what the scheduler uses) is not stable between readings. For `fynix digital` the 11:54 UTC reading had `www.fynix.digital` as organic result 1, as the owner saw in Google, and the 13:27 UTC reading, with the same request, did not have the site anywhere in 99 results. For `fynix` the 11:50 reading had the site at provider rank 21 and the 13:24 reading at provider rank 19. Neither standard answer hid addresses behind `google.com/goto`.
- The **live endpoint** (what "check now" used) hid the address of 44 to 73 results behind `google.com/goto` links and did not return `fynix.digital` among the organic results in any of five settings. The site appears there only as a source cited by the AI Overview.
- The **renumbering defect is real** (B1): in the 11:50 `fynix` reading the old parser stored 19 where the provider's rank was 21. But the owner's 19 cannot be put down to it, because the provider's own rank was 19 in the later reading.

So the `>100` the owner saw for `fynix digital` is explained by the provider's SERP moving between readings, and possibly by live-endpoint readings; it is not a parsing or matching loss. Because the provider itself varies, a single reading is weak evidence either way, which is what the app's confirmation check (a drop stands only after a second miss) is for; the second pass now routes Check now through the standard queue and keeps live answers from moving state (section J).

**What remains uncertain.** The production database could not be inspected (access refused, see H). The standard-queue path was sampled with two keywords only (see E). Serper is not integrated, so there was no second provider to compare. The separate AI visibility pipeline does not exist in the code yet.

## B. Confirmed root causes

| # | Defect | Where | Evidence | Impact |
|---|---|---|---|---|
| 1 | Organic rank renumbered from the kept list | `providers/dataforseo/serp_parse.py`, `_Builder.finish_organic` (`organic_rank = len(results) + 1`, then `rank_recomputed`) | Standard-queue answer for `fynix` (India desktop): the provider's `rank_group` for `www.fynix.digital` is 21, the old parser stored 19 (two repeated URLs above it dropped). The standard answer for `fynix digital` dropped 10 repeated URLs. Live Mumbai answer for `fynix digital`: 1 repeated URL dropped, `rank_recomputed` raised. Live `seo agency`: 66 raw, 65 parsed. The rewritten gap tests failed against the old code (first failure: `At index 2 diff: 3 != 4`). | Every result after a dropped one was reported one rank better than the provider's position, including the site's own rank and every competitor's. |
| 2 | Organic results with no readable address were dropped and not counted as unknown | same, branch `organic_without_url` | Code path; the rewritten test `test_a_result_without_an_address_leaves_the_rank_after_it_where_it_was`. Not seen in the live answers (0 of 11). | Same shift as 1, and the dropped result could have been the own site, which then read as "absent". |
| 3 | `>depth_requested` shown whatever the answer reached | `api/keywords/rank_views.py` and the web app (`lib/format/rank-display.ts`) use `depth_requested` only | Live: `digital marketing agency` 43 of 100, `seo services` 36, `fynix` 66, `local seo services` 49. | A claim about positions never read. The state stays `beyond_depth` (correct: not among what Google gave); the number shown was wrong. |
| 4 | No own entity means every keyword reads as unranked | `collectors/seo_rank_ingest.py`, `_keep` | Code path; new test `test_a_project_without_a_tracked_own_entity_does_not_report_its_keywords_as_unranked`. Not observed on a real project (database not reachable). | Silent false "not found" for any project whose own entity is missing, removed, or has `track_seo` off. |
| 5 | A single unconfirmed drop shown as final | `api/keywords/rank_views.py` (state already moves at the first miss; the confirmation check runs later) | New tests `test_a_rank_lost_at_one_check_is_flagged_as_not_yet_confirmed` and its negative twin. Doc 09 section 4.1 and finding F100 of the review log already named this gap. | A rank lost to normal SERP variance looked like a loss for up to a day. |
| 6 | Page-one feature horizon assumed 10 kept results | `ranks/resolve.py`, `_page_one_limit` | New test `test_a_gap_before_the_tenth_rank_does_not_turn_the_whole_page_into_page_one`. | Only reachable once ranks have gaps (a consequence of fixing 1), so fixed together. |

**Checked and found correct (no change needed).**

- Domain matching (`extraction/domains.py`, `extraction/urls.py`). Registrable-domain rules cover `fynix.digital`, `www.`, subdomains, http and https, ports, paths, queries and fragments, and Google `/url` and `/goto` wrappers whose destination is in the query. Names that merely contain the domain as text (`fynix.digital.example.com`, `notfynix.digital`, `other.example/fynix.digital`, `fynix.digitalpro.com`, a web.archive.org copy) do not match. New parametrized regression tests: 7 positive and 8 negative forms.
- `google.com/goto?url=<opaque token>` links carry no destination. The parser reads the site back from breadcrumb, site name or platform name (parser versions 2 and 3, earlier work). On the 11 live answers 0 organic results stayed unresolved inside the depth, so no check was inconclusive for that reason.
- Duplicate keyword rows. `seo.tracked_keywords` is unique on project, keyword, engine, location, language and device (`tracked_keyword_identity`, migration 0011), so a desktop and a mobile row, or two locations, are legitimate and distinct. The API already returns `location_id`, `location`, `language_code` and `device` on each row; if the table shows look-alike rows, the web table is not displaying those columns. No code path creates an accidental duplicate. Whether the production table holds rows from before that constraint could not be checked (see H).
- Failed collections do not touch state: a failed task changes only `consecutive_failures` and `is_stale` (`collectors/seo_rank_health.py`); an inconclusive check keeps its snapshot and moves nothing (tests exist and pass).
- Out-of-order checks cannot rewind state (`ranks/state.py`, `apply_check`).

## C. Code changes

Backend (`platform/backend`):

| File | Change |
|---|---|
| `src/idraft/providers/dataforseo/serp_parse.py` | Parser version 3 to 4. Organic rank is `rank_group`, read strictly and never renumbered. New `unreadable_ranks`; `rank_collision` warning; `depth_returned` is the highest rank read. `rank_recomputed` removed. |
| `src/idraft/ranks/resolve.py` | Unreadable ranks within the depth count as unattributed; page-one horizon uses `depth_returned`. |
| `src/idraft/collectors/seo_rank_rows.py` | Snapshot arrays are positional by rank with NULL for empty slots (the columns already allow NULL; only the cardinality is constrained); `depth_returned` is the highest rank; `mark_inconclusive` takes `unattributed` or `reason`. |
| `src/idraft/collectors/seo_rank_ingest.py` | A check with no own entity that tracks SEO is stored as inconclusive with reason `no_own_entity`; no state, no events. |
| `src/idraft/api/ranks/service.py`, `ranks/repository.py` | Snapshot detail skips empty slots; array element types admit NULL. |
| `src/idraft/api/keywords/rank_repository.py`, `rank_views.py`, `schemas/keywords.py` | `RankCell.depth_returned` (joined from the last snapshot); `TrackedKeywordState.drop_unconfirmed`. Both are additive with defaults. |
| `openapi/v1.json` | Regenerated (12 added lines). |

Docs: `docs/06-dataforseo-seo-integration.md` section 5.2 steps 3, 6 and 7, `docs/04-data-model.md` (extras comment), this report.

Tests added or changed: `tests/providers/dataforseo/test_serp_parse.py` (gap, collision, strict rank, dropped duplicate, unreadable address; the old renumbering tests were rewritten to the new rule), `tests/ranks/test_resolve.py` (unreadable address inconclusive, rank after a dropped duplicate, page-one with a gap, 7 positive and 8 negative domain forms, goto without destination, AI Overview cited and not cited on a real captured answer), `tests/collectors/test_seo_rank_ingest.py` (gap and positional arrays, no own entity), `tests/api/keywords/test_tracked_keyword_ranks.py` (`depth_returned`, `drop_unconfirmed` both ways). New fixture `tests/fixtures/dataforseo/live/ai_overview_cites_site_not_organic.json`: a trimmed answer captured live on 2026-11-03.

Not changed: the web app. `RankCell.depth_returned` and `drop_unconfirmed` are additive and old clients ignore them; the table should show `>depth_returned` and an "unconfirmed" mark (`apps/web/src/lib/format/rank-display.ts`, `features/rankings/feature-cells.tsx`). That is a small change for the UI session, with its own test run.

## D. Automated test results

Run from `platform/backend` with Colima Docker (Testcontainers) after the last code change:

| Command | Result |
|---|---|
| `uv run pytest -q` (full suite, database-backed) | 3736 passed, 0 failed, 25 min 15 s; coverage 97.71% (gate 90%) |
| `uv run ruff check .` | clean |
| `uv run ruff format --check .` | 415 files already formatted |
| `uv run mypy` | no issues in 410 source files |
| `uv run lint-imports` | 5 contracts kept, 0 broken |

Baseline before the changes: the parser, rank and extraction suites were 508 passed. New or rewritten tests: about 50 (parser gap, collision, strict rank, right column, depth reached, dropped duplicates; resolver unreadable results, domain matching 7 positive and 8 negative forms, goto without destination, AI Overview cited and not cited; ingest gap and no own entity; planner gate; API `depth_returned`, `drop_unconfirmed` both ways, snapshot detail with an empty rank slot). The rewritten gap tests were seen failing against the old parser before the fix (first failure `At index 2 diff: 3 != 4`); not every new test was run against the old code. Unresolved failures: none.

## E. Live ranking validation

Settings for every call: Google, `location_code` 2356 (India) unless noted, `en`, desktop (Windows) unless noted, `depth` 100, `load_async_ai_overview` true, `group_organic_results` true, the live endpoint `serp/google/organic/live/advanced`. Collected 2026-11-03 between about 11:26 and 11:45 UTC. India was chosen because the site's own content places the agency in Mumbai; the owner's actual search location was not known. Raw answers are kept in the session scratchpad, not in the repository.

"Provider rank" is the `rank_group` of the item the provider returned for the domain, where the item's address is readable or can be read back from its breadcrumb. "Our rank" is the output of the fixed parser and resolver with a registrable rule for `fynix.digital`.

| Keyword | Provider rank | Our rank | Verified coverage (returned of 100) | Status |
|---|---|---|---|---|
| fynix digital | none in organic (cited in AI Overview) | not found | 99 | Agree. Site absent from the provider's organic results. 71 hidden links read back, 0 unresolved. |
| fynix | 19 (hidden link, breadcrumb names the domain) | 19 | 66 | Agree. Matches the 19 the owner saw. |
| digital marketing agency | none | not found | 43 | Agree. Coverage 43, so `>43`, not `>100`. |
| seo agency | none | not found | 66 | Agree. One repeated URL dropped; ranks after it unchanged (the old code moved them). |
| seo services | none | not found | 36 | Agree. Coverage 36. |
| digital marketing services | none | not found | 63 | Agree. |
| local seo services | none | not found | 49 | Agree. |
| fynix digital, mobile (India) | none | not found | 98 | Agree. |
| fynix digital, Mumbai city | none | not found | 99 | One repeated URL dropped; fixed code keeps the later ranks. |
| fynix digital, US | none | not found | 99 | Agree. |
| fynix digital, UK | none | not found | 99 | Agree. |

AI Overview in these answers: present for `fynix digital` (all five settings), `fynix`, `digital marketing agency`, `digital marketing services` and `local seo services`; absent for `seo agency` and `seo services`. For `fynix digital`, India desktop, the AI Overview lists `https://www.fynix.digital/` among its links and references; the resolver reports `present_cited` for the own side with no organic rank (test on the captured answer). Every other setting cited others.

Standard queue (the path the scheduler uses: `task_post`, then `task_get/advanced`, same body, fetched 2026-11-03 about 11:50 to 11:55 UTC, 0.0066 and 0.0048 USD):

| Keyword | Provider rank | Our rank (fixed) | Rank the old parser stored | Verified coverage | Status |
|---|---|---|---|---|---|
| fynix digital | 1 (`www.fynix.digital`, address visible) | 1 | 1 | 96 | Agree; matches Google. AI Overview cites the site. 0 hidden links; 10 repeated URLs dropped below rank 1. |
| fynix | 21 | 21 | 19 | 71 | Agree. The old value was two places too good. |

The same keywords through the live endpoint disagree with these (above): `fynix digital` was not found, `fynix` was at 19 (with hidden links read back). A second pair of standard readings, built by the app's own request code about two hours later, is in section J: they differ again.

Serper: not integrated in this codebase (no references in `src`, `tests` or `docs`), so no Serper comparison was made. Google Search Console: not connected to the backend yet (the `gsc_sync` workload name exists with no collector).

Cost of the work: about 0.21 USD in total (eleven live SERP calls 0.19, one Labs call 0.013, two standard tasks 0.011). No batch refresh was run.

## F. Other SEO metric validation

One live Labs `keyword_overview` call (India, `en`, seven keywords, 0.0126 USD) was compared field by field with the parser output (`providers/dataforseo/labs.py`).

| Keyword | Volume | CPC (USD) | Difficulty | Intent | Parsed equals raw |
|---|---|---|---|---|---|
| digital marketing agency | 49,500 | 1.19 | 87 | commercial | yes |
| seo agency | 6,600 | 1.94 | 43 | commercial | yes |
| seo services | 27,100 | 1.71 | 66 | commercial | yes |
| digital marketing services | 14,800 | 1.30 | 40 | commercial | yes |
| local seo services | 1,900 | 1.95 | 21 | commercial | yes |
| fynix digital, fynix | not returned by Labs | not stored | not stored | not stored | yes: left out, not zero |

- Volume, CPC, difficulty and intent come from `keyword_info.search_volume`, `keyword_info.cpc`, `keyword_properties.keyword_difficulty` and `search_intent_info.main_intent`. Out-of-range or missing values become NULL, never 0 (the readers return None). 95 to 104 monthly values were parsed per keyword.
- These are provider estimates for one location and language. The task for each keyword carries its location and language, and the snapshot unique key includes both, so metrics are not mixed across them (migration 0011).
- SERP features: type mapping is a fixed table (`FEATURE_TYPES`) with an `other:<type>` fallback; sources are resolved per owner. No defect found. Features beyond page one no longer count as page one when ranks have gaps (fixed, B6).
- History and rank change: `apply_check` compares within the smaller of the two depths and never imputes a rank beyond it; comparisons with an inconclusive or failed check do not occur because those write no state. Top 3, 10 and 20 counts read the state, one row per tracked keyword and device, so a desktop and a mobile row count separately (by design, they are two tracked keywords).
- Update timestamps: `last_observed_at` is the provider's crawl time when within a week before and one hour after the fetch, else the fetch time. A failed task does not move it.

## G. AI visibility validation

- The code defines the task workloads `ai_prompt`, `ai_mode_keyword` and `ai_benchmark`, but there is no collector, provider adapter or parser for them (`src/idraft/collectors` holds only `seo_rank`, `keyword_metrics` and the shared plumbing). There is nothing to validate or fix for standalone AI answers (brand mentions, citations, visibility scores). Not built is reported as not built.
- Google AI Overview inside the SERP is built and was validated: `present`, `present_async_loaded`, `present_not_loaded` and `absent` are distinct states; citations keep their order and are split into reference cards and inline links; the own side is `present_cited` or `present_not_cited` by resolving each citation URL. Live evidence above (fynix.digital cited by the AI Overview of `fynix digital`, India desktop, while absent from organic results).
- Absence is per observation: each check stores what that response showed, and a later check replaces the keyword's current AI Overview state. Nothing treats one absent response as proof that a keyword never triggers one. A repeat-consistency measure does not exist; the sample here is one response per setting.
- The AI Overview slot is loaded asynchronously (`load_async_ai_overview`), which adds a surcharge per task; `present_not_loaded` is kept apart from `absent`.

## H. Remaining issues

1. **Production database not inspected.** An SSH read of the production database (to look at the Fynix project, its entity and domain rules, tracked keyword rows, snapshots and provider task ids) was refused by the permission layer and was not retried. The read-only queries in the appendix are ready to run by the owner.
2. **The provider's SERP moves between readings, on both paths, and the live endpoint differs from the standard queue.** The same request through the standard queue found `www.fynix.digital` at 1 at 11:54 UTC and did not have it at 13:27 UTC; `fynix` came back at 21 and then 19. The live endpoint hid most addresses and never returned the site organically. Second pass (section J): Check now now uses the standard queue and live answers never move state. What remains is the variance itself: one reading can be wrong either way, the confirmation check mitigates it for drops only, and a rise or a first find from a single reading is taken at face value. A consensus rule (for example the best of two readings a few hours apart) would need an owner decision and is not built. DataForSEO should be asked why identical standard requests differ.
3. **Project primary domain and entity domain rules are separate.** Rank resolution uses only the own entity's domain rules (`api/projects/service.py` writes them from `own_entity.domains` at creation; changing `primary_domain` later touches only the project row). A project whose primary domain is not covered by an own rule would read as unranked. Only the no-own-entity case is guarded. The appendix has a query that finds such projects; a validation on project update is a follow-up.
4. **Existing stored states** were written by parser versions up to 3. Where a snapshot carries the warning `rank_recomputed`, its ranks may be one or more places too good. The history is append-only and is not rewritten.
5. **The web app** shows `depth_returned`, `drop_unconfirmed` and the check state since the second pass (section J); its visual regression baselines were not regenerated (they need the pinned Playwright image).
6. **`depth` above 200.** DataForSEO's live SERP page documents a maximum depth of 200; the request model accepts up to 700. Nothing sends more than 100 today (profiles top out at 100, check now at 100, confirmation at 100). A future profile above 200 should be checked against the provider first.
7. **Hidden results above a found own rank** can hide a better own page; the rank is then an upper bound (review log F103, unchanged).
8. **No Serper or GSC comparison** (see E).
9. **A rank_group that is missing or outside 1 to 700 fails the whole task** (payload kept, no retry). That is deliberate (a rank must come from the provider, not be invented) but one odd item costs the check.
10. **Page-one horizon with a dropped tenth result** uses the absolute rank of the last kept result in the first ten, so a feature between it and the dropped rank can read as off page one. Small and rare.
11. **Web client types** (`apps/web/src/lib/api/schema.ts`, generated from `openapi/v1.json`) lack the two new fields until `pnpm gen:api` is run by the UI session.

An independent review (Sonnet) of the first version of the diff found: a stale `openapi/v1.json` (regenerated), a right-column item that could take a left result's rank (left column now processed first; test added), `drop_unconfirmed` promising a check the planner might not queue (description reworded), duplicate `unreadable_ranks` entries and a depth that ignored a dropped last result (both fixed, tests added), a planner that kept paying for projects with no own entity (now gated, test added), the `states_of` join missing `workspace_id` (added), and doc lines still describing renumbering (docs 12, 25 and 26 updated). It confirmed no other consumer assumes dense ranks or non-null array slots and that no migration is needed.

## I. Production readiness

- **Ready to deploy after review of the working tree**, once the full test run in D is green and the changes are committed to `develop` and released by pull request as the branch rule requires. Nothing was committed or pushed in this audit.
- **Database changes: none.** The snapshot array columns already allow NULL elements; the new API fields are computed from existing columns; `extras` is JSON.
- **Reprocessing: not required, and not offered as an automatic backfill.** New checks write correct rows under parser version 4. To refresh stale-looking keywords safely: find affected keywords with the first appendix query (read-only), then run a normal check of just those keywords (a standard-queue task is about 0.0066 USD for depth 100 with the AI Overview). History stays as it was, so the procedure is reversible by simply not using the new rows. Do not run a project-wide refresh without the owner's go.
- **Rollout order.** Backend first (the API fields are additive), web app afterwards.

## J. Second pass: one collection path, honest progress, the web app (2026-11-03, evening)

Scope: Check now through the standard queue, asynchronous states, live answers kept from moving state, the web app, regenerated types, tests, a fresh standard-queue check of `fynix digital` and `fynix`, and what stays pending in production. Nothing was committed, pushed or deployed, and production data was not touched.

### J1. What changed

Backend (`platform/backend`):

| Change | Where |
|---|---|
| Check now sends tasks through the standard queue: its run's selector no longer carries `live`, so the planner picks `serp/google/organic` like a schedule does | `api/operations/runs.py` (`check_now`), unchanged planner (`collectors/seo_rank.py`, `queue_of`) |
| Every keyword reports where its latest check stands: `state.check` = `idle`, `queued`, `processing`, `completed`, `inconclusive` or `failed`, with `requested_at`, `finished_at` and `reason`. Derived from the task ledger and the snapshot the task made, so a scheduled and a manual check read the same | new `api/keywords/check_status.py`, `api/schemas/keywords.py` (`KeywordCheck`), `api/keywords/rank_views.py`, `service.py`, `routes.py` |
| A second paid request is refused: `409 check_pending` with the keyword ids while any named keyword is queued or being answered, checked under the project's manual-run lock. A scheduled task that is not due yet does not count | `api/operations/runs.py`, `api/problems.py` (`CheckPendingError`) |
| The monthly quota counts manual checks (tasks of runs that name their keywords, whichever queue, plus any live task, plus keywords of runs not yet planned) | `api/operations/runs_repository.py` (`manual_serp_checks_since`) |
| A live-endpoint answer is stored as a snapshot marked `live_diagnostic` and writes no observation, state, current results or event | `collectors/seo_rank_ingest.py` |
| Route text and docs say standard queue, minutes not seconds | `run_routes.py`, `schemas/ranks.py`, docs 06, 19, 21 |

Web app (`platform/apps/web`):

| Change | Where |
|---|---|
| A rank not found shows how far the answer reached: `>66`, not `>100`; the tooltip says "Google returned 66 of the 100 results asked for" | `lib/format/rank-display.ts`, `features/rankings/rank-cells.tsx` |
| `drop_unconfirmed` shows a mark and a sentence in the tooltip; a queued or processing check shows a mark ("check in progress"); an inconclusive latest check shows a mark | same files, strings in `messages/en.json` |
| Check now is disabled for a selection that holds a keyword with a check on its way, and a `409 check_pending` shows its own message | `check-now/check-now-model.ts`, `use-check-now.tsx`, `rankings-screen.tsx` |
| The keyword list is read again every 20 seconds while any row has a check queued or processing | `rankings-queries.ts` |
| New column "Tracked as" (device, location, language) after the ranking URL, so look-alike rows differ | `keyword-columns.tsx` |
| Types regenerated with the project's own `pnpm gen:api` from the regenerated `backend/openapi/v1.json` | `src/lib/api/schema.ts`, `types.ts` |
| Mocks and test shapes carry the new fields; the quota text says manual checks | `src/mocks`, `src/test/api-shapes.ts` |

### J2. Fixture tests and live validation, kept apart

**Fixture tests** (no provider call; deterministic):

- Backend: the planner builds standard tasks for a Check now selector; the worker end to end sends a Check now run through the standard queue (one post, one fetch, no live call, rank 3 stored, one raw payload) and keeps a live diagnostic run as a snapshot with no state; a manual and a scheduled check of the same answer give the same state, snapshot arrays and observations; a later check, a live diagnostic and an inconclusive check leave every earlier snapshot and observation byte for byte as it was; the API reports each ledger status as the right progress and refuses a second check without writing a second run.
- Real captured answers used as fixtures (trimmed, in `backend/tests/fixtures/dataforseo/live/`): four standard-queue answers for `fynix digital` and `fynix` taken today. Ingested through the real pipeline into a test database and read through the real API.
- Web: the cells, tooltips, check marks, the "Tracked as" column, the Check now model and the pending refusal, and the states the API returned for the Fynix readings.

**Live DataForSEO validation** (real calls, standard queue, request body built by the app's own `SerpOrganicParams` and `task_body`; India, desktop, depth 100; about 0.025 USD in this pass):

| Keyword | Reading (UTC) | Provider rank | Our rank | Coverage (returned of 100) | Old parser would store |
|---|---|---|---|---|---|
| fynix digital | 11:54 | 1 | 1 | 96 | 1 |
| fynix digital | 13:27 | not in the results | not found | 99 | none |
| fynix | 11:50 | 21 | 21 | 71 | 19 |
| fynix | 13:24 | 19 | 19 | 73 | 19 |

Through the API (test database, real pipeline): `fynix digital` reads `ranked` at 1 with `depth_returned` 96 and the AI Overview `present_cited`; after the 13:27 reading it reads `beyond_depth` with `depth_returned` 99, `drop_unconfirmed` true, change `lost` from 1, check `completed`, the earlier snapshot still there and unchanged. `fynix` reads 21, then 19. The snapshot detail lists results at the provider's ranks, with the repeated URLs as empty slots.

What this does and does not show: the pipeline now stores and displays exactly what the provider returned, and the same request returns different SERPs hours apart (also on the standard queue). It does not show which reading matches Google at a given moment.

Dashboard display: shown by web tests that render the cells from the states above (`standard-queue-display.test.tsx`), not by a live browser session against a real backend. The Playwright Rankings flow ran against the mock API: 16 of 19 passed, including the Check now and rank features flow. Three fail, and fail the same way on the committed code without these changes (their expectations of which columns hide below 1680 px predate the owner's 2026-10-30 rule that every column shows at every width). The visual regression baselines were not run or updated (they need the pinned Playwright image); the new column changes them.

### J3. Historical data

No migration, no backfill. The new code only inserts and updates the keyword state it always updated; a test shows an earlier snapshot, its observations and events unchanged after a later check, a live diagnostic and an inconclusive check. Rows written by parser versions up to 3 still read through the API (dense arrays with no empty slots). They are not corrected: the appendix query finds the snapshots that carry `rank_recomputed`, and a normal check of those keywords writes correct rows beside them.

### J4. AI Overview, independent of organic rank

Kept working and tested: on the real answers the site is cited by the AI Overview (`present_cited`) in the 11:54 reading whether or not it is among the organic results, and the 13:27 reading is `present_not_cited` with no organic rank. The AI Overview state is stored per check and shown in its own column. Standalone AI visibility tracking (AI answers from other platforms, brand mentions, visibility scores) is still not implemented and is not claimed.

### J5. Production configuration still pending (nothing was changed or checked on the server)

From the live setup notes of 2026-10-31 and this work:

1. First operator account (`python -m idraft.cli create-operator`, typed by the person).
2. A monthly DataForSEO spending cap (suggested 15 USD) and the workspace's `max_serp_checks_per_month` (default 200000), now a limit on manual checks.
3. One real rank check proving the path on the server, now through the standard queue and taking minutes.
4. Deploy order: backend and worker first (parser version 4, the new API fields, the standard-queue Check now), then the web app. The worker must be restarted to pick up the parser; the API and web build need the regenerated types.
5. The audit's read-only queries (appendix), which were refused when attempted through SSH.
6. Ask DataForSEO why identical standard requests return different SERPs hours apart, and whether the live endpoint is expected to differ.

### J6. Still open

- A single reading can be wrong in either direction. The confirmation check covers drops; a first find or a rise from one reading is taken as it comes. A rule such as "keep the better of two readings a few hours apart" needs an owner decision.
- Search Console is not configured here (no credentials file), so no performance data was used.
- The keyword list polls only in the mode that holds the whole list; very large lists (server mode) refresh at their usual times.
- Five unit tests and three Playwright tests fail on the committed code too (J7), and the visual baselines are not regenerated.

### J7. Test results of the second pass

Backend (`platform/backend`, Colima Docker for the database tests):

| Command | Result |
|---|---|
| `uv run pytest -q` (full suite) | 3745 passed, 1 failed, 22 min; coverage 97.72% |
| `uv run ruff check .`, `uv run ruff format --check .`, `uv run mypy`, `uv run lint-imports` | clean (416 files formatted, 411 source files typed, 5 import contracts kept) |

The one failure, `tests/api/auth/test_sessions.py::test_sliding_extends_the_idle_lifetime_to_seven_days`, asserted that a session's idle lifetime is at most 7 days and measured 7 days and 3.4 ms: a clock race in a test unrelated to this work. It passed three times run alone, and in the two earlier full runs of this pass that included it. An earlier full run of this pass failed on a stale OpenAPI file and on the old live Check now end-to-end test; both were fixed and the suites rerun.

Web (`platform/apps/web`):

| Command | Result |
|---|---|
| `pnpm lint` | clean |
| `pnpm typecheck` | clean |
| `pnpm format:check` | clean |
| `pnpm build` | succeeds |
| `pnpm test` (vitest, whole suite) | 3038 passed, 11 failed |
| `pnpm e2e e2e/flows/rankings.spec.ts` (mock API, after installing Playwright's Chromium, 94 MiB, into the user cache) | 16 passed, 3 failed |

The 11 vitest failures: five fail on the committed code as well (costs budgets, invite password reason, rank trend sparkline, two rank strip tests), checked by running them on a stash of the web changes; six are timeouts that appear only when the whole suite runs in parallel here (add keywords, bulk actions twice, manage groups, the inspector focus test, the refresh dialog) and pass when run alone (224 tests). The 3 Playwright failures (rankings.spec.ts lines 305, 345, 664) fail identically on the committed code.

## Appendix: read-only queries for the owner

Run each inside `BEGIN READ ONLY;`. They change nothing.

```sql
-- Snapshots written by the renumbering parser where it actually moved ranks.
SELECT tracked_keyword_id, count(*) AS snapshots, max(observed_at) AS latest
FROM seo.serp_snapshots
WHERE extras -> 'warnings' ? 'rank_recomputed'
GROUP BY 1 ORDER BY latest DESC;

-- Projects whose primary domain is not covered by an own entity rule.
SELECT p.id, p.name, d.host AS primary_host
FROM core.projects p
JOIN core.domains d ON d.id = p.primary_domain_id
WHERE p.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM core.project_entities pe
    JOIN core.entity_domains ed ON ed.entity_id = pe.entity_id
    JOIN core.domains rd ON rd.id = ed.domain_id
    WHERE pe.project_id = p.id AND pe.role = 'own' AND pe.removed_at IS NULL
      AND (rd.registrable_domain = d.registrable_domain));

-- Projects with no own entity that tracks SEO.
SELECT p.id, p.name
FROM core.projects p
WHERE p.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM core.project_entities pe
    WHERE pe.project_id = p.id AND pe.role = 'own' AND pe.track_seo AND pe.removed_at IS NULL);

-- Tracked keyword rows that look alike: same keyword, different configuration.
SELECT k.text, tk.device, tk.os, tk.language_code, tk.location_id, tk.search_engine, tk.is_active
FROM seo.tracked_keywords tk
JOIN seo.keywords k ON k.id = tk.keyword_id
WHERE tk.deleted_at IS NULL
  AND (tk.project_id, tk.keyword_id) IN (
    SELECT project_id, keyword_id FROM seo.tracked_keywords
    WHERE deleted_at IS NULL GROUP BY 1, 2 HAVING count(*) > 1)
ORDER BY k.text;
```
