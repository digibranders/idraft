# SEO data accuracy audit (2026-11-03)

Scope: Google organic rank tracking, keyword metrics and AI Overview data, from the DataForSEO request to the API the web app reads. Backend only. The audit was run against the `develop` checkout; the changes are uncommitted in the working tree.

## A. Executive summary

**What was wrong.** One confirmed defect corrupted ranks, and three more made the dashboard say less than the data supports.

1. The parser renumbered organic results 1..N in the order it kept them (`organic_rank = len(results) + 1`). A result it dropped (a repeat of an earlier URL, or one with no readable address) moved every later result up one rank. A live Mumbai answer for `fynix digital` had one repeated URL: every result after it was reported one place too high. The provider's own `rank_group` was read and then thrown away.
2. A keyword not found was shown as `>100` (the depth asked for) even when Google gave far fewer results. Live, with depth 100 asked: 99, 66, 43, 66, 36, 63, 49 and 98 organic results came back. `>100` was a claim about positions nobody looked at.
3. A project with no own entity that tracks SEO read every check as "not found", with no sign anything was wrong.
4. A keyword that lost its rank at a single check was shown as `>depth` at once, though the system itself treats one reading as unconfirmed (a second check confirms it).

**What was fixed.** Parser version 4 keeps the provider's rank and leaves a gap; results with an unreadable address make an absent own site inconclusive instead of absent; the API now says how far the answer reached (`depth_returned`) and whether a drop is still unconfirmed (`drop_unconfirmed`); checks for a project with no own entity are stored but move no state. No migration is needed.

**What the live checks show about the Fynix complaint.** Two different DataForSEO paths were compared with the app's own request settings (India, desktop, depth 100).

- The **standard queue** (`task_post`, what the scheduler uses) returned `www.fynix.digital` as organic result 1 for `fynix digital`, as the owner saw in Google, with no hidden links. For `fynix` it returned the site at provider rank 21; the old parser would have stored 19, because two repeated URLs above it were dropped and the results below them renumbered. The "19" the owner saw was the renumbering defect, not a real position.
- The **live endpoint** (what "check now" uses) hid the address of 44 to 73 results behind `google.com/goto` links and did not return `fynix.digital` among the organic results in any of five settings (India desktop and mobile, Mumbai, US, UK). The site appears there only as a source cited by the AI Overview. A rank of `>100` for `fynix digital` is what that endpoint's answer supports.

So the dashboard's `>100` most likely came from live-endpoint readings; the standard-queue reading agrees with Google. Whether the live endpoint is a lower-quality SERP, or shows a different Google variant, is for DataForSEO to answer; the code cannot tell. This is the main open decision (H2).

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

The same keywords through the live endpoint disagree with these (above): `fynix digital` was not found, `fynix` was at 19 (with hidden links read back). Standard and live answers are different SERPs for identical settings.

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
2. **The live endpoint and the standard queue return different SERPs, and the live one disagrees with Google.** For the same keyword, location, device and depth the standard queue found `www.fynix.digital` at 1; the live endpoint hid most addresses and never returned the site in organic results. "Check now" uses the live endpoint (`collectors/seo_rank.py`, `queue_of`), so a manual check can overwrite a good standard reading with a worse one (the ingest cannot tell them apart beyond `provider_endpoint` on the snapshot). Options for the owner: send "check now" through the standard queue (slower, cheaper), keep live but never let it move state on its own (treat as a preview), or ask DataForSEO why the answers differ. Nothing was changed here because it is a product and cost decision, and the second option needs a migration-free but behavioural change to `apply_check`.
3. **Project primary domain and entity domain rules are separate.** Rank resolution uses only the own entity's domain rules (`api/projects/service.py` writes them from `own_entity.domains` at creation; changing `primary_domain` later touches only the project row). A project whose primary domain is not covered by an own rule would read as unranked. Only the no-own-entity case is guarded. The appendix has a query that finds such projects; a validation on project update is a follow-up.
4. **Existing stored states** were written by parser versions up to 3. Where a snapshot carries the warning `rank_recomputed`, its ranks may be one or more places too good. The history is append-only and is not rewritten.
5. **The web app** still prints `>depth_requested` and does not show `drop_unconfirmed` (see C).
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
