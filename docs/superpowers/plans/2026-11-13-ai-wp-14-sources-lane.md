# WP-14 sources-lane: detailed task plan

Brief: [WP-14](../../ai-visibility/work-packages/WP-14-sources-lane.md). Contract:
[sources additions](../../ai-visibility/contracts/sources-additions.md) (published by WP-03). Branch
`ai/wp-14-sources-lane`, worktree `$WT` =
`/Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/ai-wp-01-backend-scaffold-0d8e58` (this
session's worktree; never the main checkout, never `.claude/worktrees/release`).

## Goal

Fill the sources contract WP-03 published and add the reads the Citations page, the prompt Citations
tab, the domain inspector, the fan-out view and the source cards still lack: weekly series (N6),
country scope, `min_support`, new and lost sources over the C5 and C6 rules (`sources/changes`),
source diversity (C3, D-41 backend), domain detail, "cited with", the role split per engine (N7),
prompts that cite no own page, the redirect and engine internal toggles, ads presence, the fan-out
cut measured and narrowed, and fan-out queries by topic. Every aggregate is one grouped statement
with a statement count test; every new block is opt-in; branded prompts stay out by default.

## What exists (checked on this worktree at `fb956fc0`)

| Thing | Where | State |
|---|---|---|
| Built reads `sources/domains`, `sources/pages` (offset), `citations` (keyset), `fanout-queries` (offset) | `backend/src/idraft/api/ai/source_routes.py`, `sources.py`, `source_repository.py`, `schemas/ai_sources.py` | plan D2; each route ends with `refuse_unbuilt({...})` for the WP-03 additions |
| Stub `GET {P}/ai/sources/changes` | `source_routes.py` | `@not_built`, `raise not_built_yet()`; models `SourceChangeRow`, `SourceChangesMeta`, `SourceChangePage` exist |
| Additions answering `501` when used | same | `include` (domains: `series`, `cited_with`, `by_role_by_engine`, at most 3; pages: `series`), `min_support` (1 to 1,000), `filter[country_iso]` (`^[A-Z]{2}$`) on domains, pages, citations, fan-out |
| Optional response fields, never returned | `schemas/ai_sources.py` | `SourceDomainRow.series`, `.cited_with`, `.category`, `.category_source`; `SourcePageRow.series`; `SourcesMeta.series`, `.by_role_by_engine`; all `exclude_if=_absent` |
| Contract tests | `backend/tests/api/ai/test_contract_sources.py` | 501 per addition, 501 for changes, 403 billing and 404 outsider first, 7 bound cases (422), plain rows and meta hold no added key, OpenAPI shape and bounds. Docstring: "WP-14 deletes this file" |
| Built tests that stay | `tests/api/ai/test_sources.py`, `test_sources_compare.py`, `test_fanout_queries.py` | exact values; statement count tests: `test_a_full_project_reads_as_many_statements_as_a_small_one` (domains, fan-out), `test_pages_and_citations_of_a_full_project_are_fast_without_statistics`, `test_compare_adds_two_statements`; 15 s cold limit on the full project |
| Test helpers | `tests/api/ai/sources_support.py` (`make_world`, `answer`, `Cite`, `page_ids`, `topic_of`, `tag`, `statements`, `full_project`, `FULL_ANSWERS`) | not in this package's file list; this plan does not change it (flags are set with an `UPDATE` in the test files) |
| Scope | `source_repository.scope_prompts` (prompt ids first), `counted_answers` (facts, valid, current, not superseded), `citation_bounds`, `_cited`, `unit()`, `page_of` (`count(*) OVER ()`) | the statements are written to plan without statistics; the transaction sets `enable_nestloop = off` |
| Country | `ai.prompts.country_iso` (the summary filters `p.country_iso == country` in `summary_repository`) | not used by the source reads |
| Weeks | `idraft.api.ai.summary.summary_weeks(first, last)` (the Mondays, at most 14 in 92 days); `summary_repository.weekly_counts` computes `date_trunc('week', timezone(zone, observed_at))::date` in a subquery and groups by its column | reused |
| Citation flags | `ai.citations.flags text[]`, from `canonicalize`: `text_fragment_removed`, `redirect_unwrapped`, `unresolved_redirect` (Gemini grounding links `vertexaisearch.cloud.google.com/grounding-api-redirect/...` are always unresolved) | the source reads count every flag; nothing sets `engine_internal` |
| Mentions | `ai.entity_mentions` keyed `(observation_id, observed_at, entity_id, derivation_id)`, `is_current`, `mention_status` (`accepted`, `uncertain`) | for "cited with" |
| Ads | `ai.observations.provider_extras.ads`, a list of `{type, domain, url, title, is_rendered}` written by `ai_parse` for every engine; never read | for ads presence |
| Fan-out cut | `providers/dataforseo/ai_parse.py`: `EXTRAS_MAX_BYTES = 16 * 1024`, `_bounded` halves the list with the most items until the extras fit, sets `truncated`, or stores `{"truncated": true}`; migration 0018 checks `octet_length(provider_extras::text) <= 16384`; `fanout_count` keeps the number issued | the read reports `meta.answers_truncated` (stored list shorter than `fanout_count`) |
| Route access | `tests/api/test_route_access.py` | `sources/changes` is already in `EXPECTED` (WP-03 block); anchors `# WP-14 sources-lane` in `EXPECTED` and `PATH_PARAMETERS` are empty |
| Cross-tenant suite | `tests/security/test_cross_tenant.py` | `NOT_BUILT` read from the mark; `WORDS = {"kind", "engine_code", "screen"}` (no anchor); `QUERIES` has the fan-out line `{"min_support": "1"}` outside the anchors; anchors `# WP-14 sources-lane` in `QUERIES`, `BODIES`, `_tenant`, `_TENANT_ROWS` are empty. The tenant's seeded prompt is `US` (`add_prompt` default), its answer cites one URL as `own` and mentions the tenant's entity, and stores one fan-out query |
| Owner of nearby files | WP-57 owns `ai_parse.py` (retrieval part) and `ai.fanout_queries` (BE-FANOUT-02); WP-60 owns categories (BE-SOURCES-08), `source_intel_routes.py` | WP-14 leaves `category`, `category_source` unreturned |
| Migration head | `0021_layouts.py` | WP-14 needs no migration |

### Measured: what the 16 KB cut does (BE-FANOUT-03)

Run on this worktree with `_bounded` (no database):

| Extras | Kept |
|---|---|
| 400 queries of 60 ASCII characters, nothing else | 200 queries (halving overshoots: about 250 would fit) |
| 30 queries and 60 ads of about 350 bytes | 30 queries, 30 ads (the ads list is the longest, so it is cut) |
| 80 queries and the same 60 ads | 40 queries, 30 ads: the queries are cut first because they are the longest list by count, although the ads hold most of the bytes |

So a list of fan-out queries is cut today in two cases: it has more items than the ads and brand
entities while the extras exceed 16 KB, or it alone exceeds about 16 KB. Typical ChatGPT answers
issue 1 to 10 queries; the share of real answers cut is unknown (no production read in this
package). The production share is already exposed per window as `meta.answers_truncated`; T8 adds
the read-only SQL for the ops session to run once.

## Decisions (one line of reason each)

| # | Decision | Reason |
|---|---|---|
| S1 | Three new routes: `GET {P}/ai/sources/diversity`, `GET {P}/ai/sources/domains/{registrable_domain}`, `GET {P}/ai/sources/prompts`; all `data:read`; published as `501` stubs in T1 with their access lines | doc 19 3.7.7 lists diversity and domain detail; BE-SOURCES-20 has no read; contract first (brief, MASTER-PLAN 3.8; WP-03 plan row "WP-14 publishes the route in its first push") |
| S2 | Domain detail is keyed by `{registrable_domain}` (a word), not doc 19's `{domain_id}` | `core.domains` rows are hosts; as built rows are registrable domains and carry no id (doc 19 as built note) |
| S3 | Everything else is a field or parameter of an existing response: `include=series` (rows and `meta.series`), `include=cited_with`, `include=by_role_by_engine`, `min_support`, `filter[country_iso]`, the two flag toggles, fan-out `include=topics`, diversity `include=series,ads` | handoff rule 5: opt-in blocks; no new route where a block will do |
| S4 | No migration, no new table, no new index | every read is a grouped query over `ai.citations`, `ai.observation_facts`, `ai.observations`, `ai.entity_mentions`, `ai.prompt_terms` bounded to the window's partitions, at the plan D2 volume (3,600 answers per 28 days); the unbounded fan-out list is WP-57's `ai.fanout_queries` (BE-FANOUT-02) |
| S5 | `min_support` on source rows counts citation units in the window (`HAVING units >= min_support`); it narrows rows and `page.total`, never `meta` | contract Q17, doc 16 C5 |
| S6 | `filter[country_iso]` narrows the prompts in `scope_prompts` (`ai.prompts.country_iso = :country`) | same rule as the prompts summary; one place for every read |
| S7 | New (C5): at least `min_support` units in the window and 0 in as many days before. Lost (C6): at least `min_support` units in a support window and 0 in each of the 2 following windows; the answered `meta.window` is those 2 windows (the asked window and as many days before it), `meta.compare_window` the support window before them | doc 16 C6 and doc 14 section 8 (BE-SOURCES-05); the published row and meta shapes hold; the contract note left the rule to WP-14 |
| S8 | `sources/changes` keeps offset pages (Q18, published) | a published shape; at most a few hundred domains |
| S9 | The new list `sources/prompts` pages by keyset `(prompt_id, engine_code)` with a cursor bound to every filter | doc 19 2.4 cursor rule; a stable key needs no `data_version` |
| S10 | Weekly series: a week starts Monday 00:00 in the project zone; one point per Monday of `summary_weeks(first, last)`, zero filled, oldest first; the first and last weeks count only the window's days | doc 19 2.5 granularity `week`, the summary series; counts are never pooled across prompts, so D-04 does not apply |
| S11 | `include=series` on pages fills the row series and `meta.series` as on domains | contract example; `meta.series` holds the weekly denominators of the row shares |
| S12 | Diversity per engine (doc 16 rule 2): `distinct_domains` (registrable domains, roles merged), `effective_sources` a `MetricCell` with value `(sum u)^2 / sum u^2`, numerator `(sum u)^2`, denominator `sum u^2`; `meta.distinct_domains` pooled (a count) and `meta.effective_sources_engine_average` (equal-weight mean of the engines with units) | doc 16 C3 (inverse Herfindahl of `s_d = u_d / sum u`), doc 16 rule 1 (a visible denominator), rule 2 (no pooled metric) |
| S13 | Citations flagged `unresolved_redirect` or `engine_internal` are left out of every aggregate source read by default; `include_unresolved_redirects` and `include_engine_internal` (default false) count them again; the citation list and the fan-out read are unchanged | doc 14 section 9, doc 19 3.7.7 (BE-SOURCES-22); the one deliberate change to answers of old requests (Open question O1) |
| S14 | "Cited with": the tracked entity named (current derivation, `mention_status = 'accepted'`) in the most answers that cite the row; ties by entity id | CF-10, doc 19 `co_mentioned_entities` |
| S15 | Fan-out by topic: `include=topics` adds `topics: [{term_id, observations}]` per row (the topic terms tagged on the prompts whose answers issued it, at most 10); the per topic top list stays `filter[term]` | F4 "per prompt or topic"; one statement for a page; no second row shape |
| S16 | The fan-out cut is narrowed in `ai_parse._bounded`: lists other than `fan_out_queries` are cut first (lease, T8b); the full lift is WP-57's table | the measurement above; no migration, no client change, new answers only |
| S17 | Old requests: every response of a request that uses no addition keeps its keys and values; proved by the unchanged D2 tests, a key set test per route, and unchanged statement counts | contract compatibility; S13 is the only exception and has its own commit |
| S18 | A foreign or deleted project is `404` from `scoped()` before any read, in every new service method | contract README step 3 |
| S19 | Commits `WP-14: <task title>`; `backend/openapi/v1.json` regenerated in every task that changes the API; `apps/web/src/lib/api/schema.ts` regenerated with `pnpm gen:api` in the T1 push (contract first) and in the T10 push | brief, AGENTS.md, WP-11's pattern |

### Does this package change `backend/openapi/v1.json` and `apps/web/src/lib/api/schema.ts`?

Yes, both, by regeneration only. The contract changes (all additive, logged in the contract note):

1. Three new paths with their models (T1): `SourceDiversity`, `SourceDiversityEngine`,
   `SourceDiversityMeta`, `DiversityWeek`, `AdPresence`, `SourceDomainDetail`,
   `SourceDomainDetailData`, `DomainEngineSeries`, `DomainEngineWeek`, `DomainPrompt`,
   `PromptOwnPagesPage`, `PromptOwnPagesRow`, `PromptOwnPagesMeta`, `OwnPage`, `FanoutTopic`.
2. New query parameters (T1): `include_unresolved_redirects`, `include_engine_internal` (domains,
   pages, changes, diversity, detail, prompts), fan-out `include` (`topics`), diversity `include`
   (`series`, `ads`), prompts `filter[own_cited]`.
3. New optional field `FanoutQueryRow.topics` (T1).
4. Descriptions lose "Not built yet" and "Not returned yet" as each part is built (T2 to T8);
   `category` and `category_source` keep "Not returned yet" (WP-60).
5. `sources/changes`: built; its description states the C6 rule and the window it answers (T4).

Nothing is renamed, removed or tightened. Old requests are answered as before except S13.

### Dev database

No migration. Nothing is applied to `idraft-dev-postgres-1`; tests use their own containers. The
status line says `no migration`.

## Open questions (specs disagree or are silent; smallest safe choice taken)

| Q | Question | Choice | Why |
|---|---|---|---|
| O1 | Flagged citations by default: doc 14 9 and doc 19 exclude them, the built reads count them | Exclude by default with the two toggles (S13), in its own commit (T7) so the default flips with one line if the owner says keep | the row is "excluded from shares by default with toggles"; Gemini grounding redirects otherwise rank `google.com` as a source. Needs the owner's yes before T7 merges |
| O2 | C6 lost vs the contract text "units before and none in the window" | C6 with two empty windows (S7) | BE-SOURCES-05, doc 16, doc 14; shapes unchanged; logged |
| O3 | "Full windows": the asked window ends today (a partial day) | The asked window counts as a full window | the house window is local days, today included; a rule over "complete weeks" is not stated anywhere |
| O4 | Lost reads 3 windows: at most 276 days for a 92 day ask | Allowed; one grouped statement; full project test at the default window | the 92 day bound is on the asked window (contract); timed in T4 |
| O5 | `filter[domain_role_in]` on citations (contract note open point) | Kept as built (D2) | already built and tested |
| O6 | `meta.series` on pages | Filled with `include=series` (S11) | contract example shows it |
| O7 | Domain detail when the domain is not cited in scope | `200` with empty lists and the scope's `meta` | `404` must keep meaning "no such project" |
| O8 | Diversity series and ads: needed? | Opt-in `include=series` (CH-26) and `include=ads` (BE-SOURCES-25) on diversity | CH-26 needs weekly effective sources per engine; ads presence is per engine like diversity |
| O9 | Ads in extras cut by the 16 KB bound or extras `{"truncated": true}` | Counted as no ad; described | undercount only; the bound is rare (measurement) |
| O10 | `engine_internal` is never set by ingest | The toggle filters it anyway; ingest marking is a follow-up for the owner of `ai_parse` and extraction | doc 14 9 names the flag; the read is ready when ingest sets it |
| O11 | BE-FANOUT-03 "unbounded" | S16: narrow the cut (fan-out last) under a lease; the unbounded list is BE-FANOUT-02 (WP-57); the read is paged already (offset, at most 200 rows), so a longer stored list never grows a response | no migration in this package; WP-57 owns the table |
| O12 | Is a domain detail row list bounded | At most 10 role rows, 10 pages, 20 prompts, 5 entities, 3 engine series of 14 weeks | house rule: bounded lists |
| O13 | `sources/prompts` rows for an engine with no counted answer | No row | "no own page" needs an answer to judge |

## Leases and files outside the brief's list

| File | Task | Change | Status |
|---|---|---|---|
| `backend/tests/security/test_cross_tenant.py` | T1 | `WORDS["registrable_domain"] = "example.com"` (the `WORDS` line has no anchor) and the fan-out `QUERIES` line outside the anchors (one dict key: a second entry would be a duplicate key) gains `include=topics` and `filter[country_iso]=US`; the rest inside `# WP-14 sources-lane` | lease needed (two lines) |
| `backend/src/idraft/providers/dataforseo/ai_parse.py` | T8b | `_bounded` cuts the other lists before `fan_out_queries` | lease needed; tell WP-57 (it owns the retrieval part of this file) |
| `backend/tests/providers/dataforseo/test_ai_parse.py` | T8b | one test of the order | lease needed with the line above |
| `backend/tests/api/ai/test_contract_sources.py` | T1, T10 | extended in T1, deleted in T9 | handed to WP-14 by its docstring |
| `docs/ai-visibility/contracts/sources-additions.md` | T1, T10 | routes, parameters, change log | the WP-14 contract note |
| `docs/19-api-specification.md`, `docs/29-phase-roadmap.md` | T10 | As built sections, append-only | allowed (MASTER-PLAN 3.6) |
| `backend/openapi/v1.json`, `apps/web/src/lib/api/schema.ts` | every API task; T1 and T10 | regeneration only | allowed by the brief |

Not needed: `schemas/ai.py` (`MetricCell` is reused as is), `main.py`, `resources.py`,
`permissions.py`, `problems.py`, any `db/` file, `tests/api/ai/sources_support.py`.

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | The owner keeps flagged citations in by default (O1) | T7 is its own commit; the default flip is two `= False` to `= True` plus test inversions |
| R2 | The lost read over 3 windows is slow cold | one grouped statement; T4 times the full project (15 s cold limit, as D2) |
| R3 | `include=cited_with` joins mentions per citing answer and gets slow | it reads only the page's domains (`registrable_domain IN (...)`); full project timed |
| R4 | Adding `country` to the citation cursor scope invalidates old cursors | the key is added only when the filter is set, so a cursor of a request without it keeps its hash |
| R5 | WP-57 edits `ai_parse.py` at the same time | T8b is small, last in its lane, and needs the lease; if refused, T8 ships the measure only and BE-FANOUT-03 is recorded as handed to WP-57 |
| R6 | The four shared files are edited by every task | tasks are sequential; only T8b and T10 run beside another task |
| R7 | The cross-tenant scan of the new routes reads data only if the tenant has some | the tenant's prompt is `US`, its answer cites one URL and mentions its entity, so every `include` returns rows; the scan uses every option |

## Lanes, order and parallelism

```text
T1 (contract stubs, access lines, leases)
 |
T2 (series)
 |
T3 (country)
 |
T4 (min_support, changes: new and lost)
 |
T5 (diversity, domain detail)
 |
T6 (cited with on rows, role split per engine)
 |
T7 (prompts with no own page, flag toggles, ads)         T8b (ai_parse cut order, lease) ||
 |
T8 (fan-out: measure, topics)
 |
T9 (statement counts sweep, cross-tenant, delete the contract file)
 |
T10 (As built, contract log, rebase, checks, push)
```

T2 to T9 all edit `source_routes.py`, `sources.py`, `source_repository.py` and
`schemas/ai_sources.py`: one after another. T8b touches only `ai_parse.py` and its test and runs
beside T7 or T8 (two implementers at once at most, MASTER-PLAN 4). T10's docs part can start beside
T9.

Brief steps to tasks:

| Brief step | Task | Rows |
|---|---|---|
| 0 (plan) | this file | process |
| contract first (brief "Contract") | T1 | the contract of S1 to S3 |
| 1 | T2 | CF-07, OV-N6 |
| 2 | T3 | CF-08 |
| 3 | T4 | CF-09, BE-SOURCES-05, BE-SOURCES-06 |
| 4 | T5 | BE-SOURCES-07, BE-SOURCES-11, CF-05 |
| 5 | T6 | CF-10, OV-N7 |
| 6 | T7 | BE-SOURCES-20, BE-SOURCES-22, BE-SOURCES-25 |
| 7 | T8, T8b | BE-FANOUT-03, BE-TOPICS-12 |
| 8 | T9 | BE-SOURCES-01..04, BE-FANOUT-01 (confirmed) |
| 9 | T10 | process |

## Common commands

Light checks (no lock), from `$WT/backend`:

```bash
uv sync --frozen
uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run lint-imports
```

Targeted tests (medium lane; Colima must already run; never restart it; never touch `idraft-dev-*`):

```bash
cd $WT && infra/dev/heavy --lane medium --label wp-14 -- bash -c 'cd backend && DOCKER_HOST=unix://$HOME/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock uv run pytest <paths> --no-cov -n 2 -q'
```

The base set every task runs with its own files: `tests/api/ai/test_sources.py
tests/api/ai/test_sources_compare.py tests/api/ai/test_fanout_queries.py tests/api/test_openapi.py
tests/api/test_route_access.py`. A task that touches the cross-tenant entries adds
`tests/security/test_cross_tenant.py`.

Regenerate the API document (light): `cd $WT/backend && uv run python -m idraft.api.openapi > openapi/v1.json`.

House rules for every task: tests first; edit files with the file tools only (no heredocs, `sed` or
replace scripts; `uv run ruff format <file>` is allowed); ASCII only; no em or en dashes in code,
comments, docs or commit messages; lines up to 100 characters; one commit per task, message
`WP-14: <task title>`, no attribution lines; `git add` names this task's files only. No real
provider or LLM call anywhere.

Shared test vocabulary: every new test file starts from the helpers the D2 tests use:

```python
from tests.api.ai.sources_support import (
    GUIDE, GUIDE_TOP, OWN, OWN_BLOG, RIVAL, WIKI, Cite, World, answer, full_project,
    FULL_ANSWERS, make_world, page_ids, statements, tag, topic_of,
)
from tests.api.auth.support import execute, fetchrow, make_workspace
from tests.api.entities.support import member, problem
from tests.collectors.ai_support import add_prompt

FORBIDDEN = (403, "forbidden")
NOT_FOUND = (404, "not_found")
INVALID = (422, "validation_failed")


@pytest.fixture
async def world(resources: Resources, migrated: PostgresServer) -> World:
    return await make_world(resources, migrated)
```

A citation's flags are set after `answer(...)` with
`await execute(pg, "UPDATE ai.citations SET flags = $2 WHERE observation_id = $1 AND citation_index = $3", observation_id, ["unresolved_redirect"], 1)`.
A mention is written as `seed_extraction` in `tests/collectors/ai_support.py` writes one
(`INSERT INTO ai.entity_mentions (...)` with the world's `derivation_id`); copy that statement into a
local helper `mention(pg, world, observation_id, entity_id, *, current=True)` in the test file that
needs it.

"Statements" means `with statements(resources) as seen:` around one request; "adds N statements"
means `len(with_part) - len(plain) == N` for the same request without the part.

---

## T1: Publish the new routes and parameters (contract first)

Rows: none closed; the contract of S1 to S3. First push of the package.

### Files

- `$WT/backend/src/idraft/api/schemas/ai_sources.py` (new models)
- `$WT/backend/src/idraft/api/ai/source_routes.py` (three stubs, new parameters refused)
- `$WT/backend/tests/api/ai/test_contract_sources.py` (new stub cases)
- `$WT/backend/tests/api/test_route_access.py` (inside `# WP-14 sources-lane` only)
- `$WT/backend/tests/security/test_cross_tenant.py` (lease: `WORDS`, the fan-out `QUERIES` line; the rest inside the anchors)
- `$WT/docs/ai-visibility/contracts/sources-additions.md`
- `$WT/backend/openapi/v1.json`, `$WT/apps/web/src/lib/api/schema.ts` (regenerated)

### Tests first: `test_contract_sources.py` additions

| Test | Act | Assert |
|---|---|---|
| `test_a_new_source_route_answers_501` (parametrize `sources/diversity`, `sources/domains/g2.com`, `sources/prompts`) | viewer `GET` | `problem(...) == (501, "not_implemented")` |
| `test_a_new_source_route_checks_access_first` (same three) | billing; outsider (owner of another workspace) | `FORBIDDEN`; `NOT_FOUND` |
| extend `test_a_source_addition_answers_501` with `("sources/domains", {"include_unresolved_redirects": "true"})`, `("sources/pages", {"include_engine_internal": "true"})`, `("fanout-queries", {"include": "topics"})` | viewer | 501 |
| extend `test_an_addition_out_of_bounds_is_refused` with `("sources/diversity", {"include": "pages"})`, `("sources/diversity", {"include": "series,ads,series"})`, `("fanout-queries", {"include": "series"})`, `("sources/prompts", {"filter[own_cited]": "maybe"})`, `("sources/prompts", {"limit": "201"})` | viewer | `INVALID` |
| `test_a_registrable_domain_longer_than_253_is_refused` | viewer `GET sources/domains/` + `"a" * 250 + ".com"` | `INVALID` |
| extend `test_the_api_document_has_the_source_additions` | `build_openapi()` | the three paths exist; each new model of the list in "Does this package change..." is a component; `FanoutQueryRow.topics` not required and `maxItems == 10`; `SourceDiversity.data` `maxItems == 3`; `SourceDomainDetailData`: `rows` 10, `top_pages` 10, `prompts` 20, `cited_with` 5, `engines` 3; `include` of diversity `maxLength == 2`, of fan-out `maxLength == 1`; `include_unresolved_redirects` and `include_engine_internal` on the six routes with `default: false` |

`test_route_access.py`, inside `# WP-14 sources-lane` of `EXPECTED` (copy the style of the
`sources/changes` line):

```python
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/sources/diversity"): (
        "data:read"
    ),
    (
        "GET",
        "/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/sources/domains/"
        "{registrable_domain}",
    ): "data:read",
    ("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/sources/prompts"): (
        "data:read"
    ),
```

and inside `# WP-14 sources-lane` of `PATH_PARAMETERS`:

```python
    # A registrable domain (`g2.com`), a word and not an id, after `{project_id}`: the service
    # reads its citations within that project.
    "registrable_domain",
```

`test_cross_tenant.py`, the `WORDS` line (lease) in T1:

```python
WORDS = {
    "kind": "gsc",
    "engine_code": "chatgpt_web",
    "screen": "ai_overview",
    "registrable_domain": "example.com",
}
```

and the fan-out line outside the anchors (lease) in T8, once `include=topics` is built:

```python
    ("GET", _W + "/projects/{project_id}/ai/fanout-queries"): {
        "min_support": "1",
        "include": "topics",
        "filter[country_iso]": "US",
    },
```

The `# WP-14 sources-lane` block of `QUERIES` when the package is done (every option, so the
opt-in reads are scanned):

```python
    ("GET", _W + "/projects/{project_id}/ai/sources/domains"): {
        "include": "series,cited_with,by_role_by_engine",
        "min_support": "1",
        "filter[country_iso]": "US",
        "compare": "previous_period",
        "include_unresolved_redirects": "true",
        "include_engine_internal": "true",
    },
    ("GET", _W + "/projects/{project_id}/ai/sources/pages"): {
        "include": "series",
        "min_support": "1",
        "filter[country_iso]": "US",
        "compare": "previous_period",
        "include_unresolved_redirects": "true",
        "include_engine_internal": "true",
    },
    ("GET", _W + "/projects/{project_id}/ai/citations"): {"filter[country_iso]": "US"},
    ("GET", _W + "/projects/{project_id}/ai/sources/changes"): {
        "min_support": "1",
        "filter[country_iso]": "US",
    },
    ("GET", _W + "/projects/{project_id}/ai/sources/diversity"): {
        "include": "series,ads",
        "filter[country_iso]": "US",
    },
    ("GET", _W + "/projects/{project_id}/ai/sources/domains/{registrable_domain}"): {
        "filter[country_iso]": "US",
    },
    ("GET", _W + "/projects/{project_id}/ai/sources/prompts"): {"filter[country_iso]": "US"},
```

The block grows task by task, because a built route that is asked for an unbuilt addition answers
`501`, which the suite accepts only for `NOT_BUILT` routes. T1 adds the lines of the three new
routes (marked, so `501` is expected) without `include` on diversity; T2 adds the domains and pages
lines with `include` (`series` only on domains) and `compare`; T3 adds `filter[country_iso]` to
them and the citations and changes lines; T4 adds `min_support`; T5 adds diversity `include`; T6
widens the domains `include` to all three; T7 adds the toggles; T8 changes the fan-out line.

### Code: `schemas/ai_sources.py`

Add after `SourceChangePage` (constants: `DETAIL_ROWS_MAX = 10`, `DETAIL_PAGES_MAX = 10`,
`DETAIL_PROMPTS_MAX = 20`, `CITED_WITH_MAX = 5`, `TOPICS_MAX = 10`):

```python
DiversityInclude = Literal["series", "ads"]
FanoutInclude = Literal["topics"]


class AdPresence(BaseModel):
    answers_with_ads: MetricCell = Field(
        description="Answers that showed at least one ad, of the valid answers on the engine. "
        "Ads are kept out of answers and citations (docs/07 section 5.4); extras the 16 KB "
        "bound emptied count as no ad."
    )
    ads: int = Field(description="Ads stored with those answers.")


class DiversityWeek(BaseModel):
    week_start: date
    citation_units: int
    distinct_domains: int
    effective_sources: float | None = Field(description="Null when the week has no unit.")


class SourceDiversityEngine(BaseModel):
    engine_code: EngineCode
    answers: int
    answers_citing: int
    citation_units: int
    distinct_domains: int = Field(description="Registrable domains cited, roles merged (C3).")
    effective_sources: MetricCell = Field(
        description="Effective number of sources (docs/16 C3): 1 / sum of squared source "
        "shares, as (sum of units)^2 over the sum of squared units per domain."
    )
    series: list[DiversityWeek] | None = Field(
        default=None, exclude_if=_absent, max_length=SERIES_MAX, description="With `include=series`."
    )
    ads: AdPresence | None = Field(default=None, exclude_if=_absent, description="With `include=ads`.")


class SourceDiversityMeta(BaseModel):
    window: MetricWindow
    include_branded: bool
    engine_codes: list[EngineCode] = Field(max_length=ENGINES_MAX)
    distinct_domains: int = Field(description="Over every engine in scope (a count).")
    effective_sources_engine_average: float | None = Field(
        description="The equal-weight mean of the engines' effective sources, engines with units "
        "only (docs/16 rule 2: never pooled)."
    )


class SourceDiversity(BaseModel):
    data: list[SourceDiversityEngine] = Field(max_length=ENGINES_MAX)
    meta: SourceDiversityMeta


class DomainEngineWeek(BaseModel):
    week_start: date
    citation_units: int
    observations: int
    all_citation_units: int = Field(description="Every unit of the engine that week: the share's denominator.")
    answers: int


class DomainEngineSeries(BaseModel):
    engine_code: EngineCode
    series: list[DomainEngineWeek] = Field(max_length=SERIES_MAX)


class DomainPrompt(BaseModel):
    prompt_id: UUID
    citation_units: int
    observations: int


class SourceDomainDetailData(BaseModel):
    registrable_domain: str = Field(max_length=DOMAIN_MAX)
    rows: list[SourceDomainRow] = Field(max_length=DETAIL_ROWS_MAX)
    engines: list[DomainEngineSeries] = Field(max_length=ENGINES_MAX)
    top_pages: list[SourcePageRow] = Field(max_length=DETAIL_PAGES_MAX)
    prompts: list[DomainPrompt] = Field(max_length=DETAIL_PROMPTS_MAX)
    cited_with: list[CitedWith] = Field(max_length=CITED_WITH_MAX)


class SourceDomainDetail(BaseModel):
    data: SourceDomainDetailData
    meta: SourcesMeta


class OwnPage(BaseModel):
    url_id: int
    url: str


class PromptOwnPagesRow(BaseModel):
    prompt_id: UUID
    engine_code: EngineCode
    answers: int = Field(description="Valid answers of the prompt on the engine in scope.")
    answers_citing_own: int
    own_citation_units: int
    own_pages: int = Field(description="Distinct own pages cited.")
    top_own_page: OwnPage | None = Field(description="The own page with the most units; null if none.")


class PromptOwnPagesMeta(BaseModel):
    window: MetricWindow
    include_branded: bool
    engine_codes: list[EngineCode] = Field(max_length=ENGINES_MAX)


class PromptOwnPagesPage(BaseModel):
    data: list[PromptOwnPagesRow]
    page: CursorPageInfo
    meta: PromptOwnPagesMeta


class FanoutTopic(BaseModel):
    term_id: UUID
    observations: int = Field(description="Answers of the term's prompts that issued the query.")
```

and on `FanoutQueryRow`:

```python
    topics: list[FanoutTopic] | None = Field(
        default=None,
        exclude_if=_absent,
        max_length=TOPICS_MAX,
        description="With `include=topics`: the topic terms tagged on the prompts whose answers "
        "issued it, the most answers first, at most 10. " + _NOT_RETURNED,
    )
```

### Code: `source_routes.py`

A flag dependency used by six routes (its parameters stay in the final shape; T7 builds them):

```python
def flag_toggles(
    include_unresolved_redirects: Annotated[bool, Query(description=_UNRESOLVED)] = False,
    include_engine_internal: Annotated[bool, Query(description=_INTERNAL)] = False,
) -> tuple[str, ...]:
    """The citation flags a read leaves out (docs/14 section 9)."""
    return tuple(
        flag
        for flag, counted in (
            ("engine_internal", include_engine_internal),
            ("unresolved_redirect", include_unresolved_redirects),
        )
        if not counted
    )


Flags = Annotated[tuple[str, ...], Depends(flag_toggles)]
```

T1 adds `flags: Flags` to `source_domains`, `source_pages`, `source_changes` and the three new
routes, and to the `refuse_unbuilt` mapping of domains and pages: `"include_unresolved_redirects":
"unresolved_redirect" not in flags, "include_engine_internal": "engine_internal" not in flags`
(`_UNRESOLVED` and `_INTERNAL` end with `_NOT_BUILT` until T7). Fan-out gains
`include: Annotated[list[FanoutInclude] | None, Commas, Query(max_length=1, ...)] = None` and
`"include": bool(include)` in its `refuse_unbuilt`.

The three stubs (description strings name the rules of S7, S9, S12; each ends with `_NOT_BUILT`):

```python
@router.get("/sources/diversity", summary="Source diversity per engine", description=...)
@not_built
async def source_diversity(
    project_id: UUID,
    access: ReadData,
    scope: AnswerScope,
    flags: Flags,
    include: Annotated[list[DiversityInclude] | None, Commas, Query(max_length=2)] = None,
    country_iso: CountryFilter = None,
) -> SourceDiversity:
    raise not_built_yet()


@router.get("/sources/domains/{registrable_domain}", summary="One cited domain", description=...)
@not_built
async def source_domain(
    project_id: UUID,
    registrable_domain: Annotated[str, Path(min_length=1, max_length=253)],
    access: ReadData,
    scope: AnswerScope,
    flags: Flags,
    country_iso: CountryFilter = None,
) -> SourceDomainDetail:
    raise not_built_yet()


@router.get("/sources/prompts", summary="Each prompt's own pages, per engine", description=...)
@not_built
async def source_prompts(
    project_id: UUID,
    access: ReadData,
    scope: AnswerScope,
    page: Cursor,
    flags: Flags,
    own_cited: Annotated[bool | None, Query(alias="filter[own_cited]")] = None,
    country_iso: CountryFilter = None,
) -> PromptOwnPagesPage:
    raise not_built_yet()
```

Declare these three after `/sources/changes` and keep `/sources/domains/{registrable_domain}`
after `/sources/domains` (no clash: different segment counts). `AnswerScope` is defined further down
in the file today; move its definition up next to `Scope`.

### Code: contract note

Add the three routes, their parameters and response tables, the new parameters of the built
routes and the fan-out `topics` field; Status line "WP-14 published three routes and parameters on
2026-11-13"; change log:

```text
2026-11-13 WP-14: added `GET {P}/ai/sources/diversity`, `GET {P}/ai/sources/domains/{registrable_domain}` and `GET {P}/ai/sources/prompts` (stubs)
2026-11-13 WP-14: added `include_unresolved_redirects` and `include_engine_internal` (default false) to domains, pages, changes and the new routes; fan-out `include=topics` and `FanoutQueryRow.topics`
```

### Run

Targeted: base set plus `tests/api/ai/test_contract_sources.py tests/security/test_cross_tenant.py`.
Regenerate `v1.json`; `cd $WT/apps/web && pnpm gen:api && pnpm typecheck` (medium lane). Light checks.

### Prove it bites

| Weakening | Test expected to fail |
|---|---|
| Drop `ReadData` from `source_diversity` | `tests/api/test_route_access.py` (the diversity line), `test_a_new_source_route_checks_access_first[sources/diversity]` |
| Remove `"registrable_domain"` from `WORDS` | `test_cross_tenant.py::test_a_word_in_a_path_is_never_a_child_and_always_resolves` |
| Remove `@not_built` from `source_prompts` (keep the raise) | `test_cross_tenant.py` (the route answers 501 where 404 is expected for a foreign child) |
| `max_length=253` removed from the path parameter | `test_a_registrable_domain_longer_than_253_is_refused` |

### Commit

`WP-14: publish the new source routes and parameters`, naming the eight files. Push (contract
first): rebase, the targeted set, `git push origin HEAD:develop`, report `building`.

---

## T2: Weekly series on domains and pages (`include=series`)

Rows: CF-07, OV-N6.

### Files

- `$WT/backend/src/idraft/api/ai/source_repository.py`, `sources.py`, `source_routes.py`, `schemas/ai_sources.py`
- `$WT/backend/tests/api/ai/test_sources_series.py` (new)
- `$WT/backend/tests/api/ai/test_contract_sources.py` (drop the `include=series` 501 cases)
- `$WT/backend/tests/security/test_cross_tenant.py` (anchor: domains and pages lines with `include` only, and `compare`)
- `$WT/backend/openapi/v1.json`

### Tests first: `test_sources_series.py`

Scene: project timezone set to `Europe/Berlin`
(`UPDATE core.projects SET timezone = 'Europe/Berlin'`), window `from` and `to` given explicitly
(21 days ending on a known Sunday relative to now: compute `last = today - timedelta(days=today.weekday() + 1)`
so weeks are whole), answers placed with `days_ago` in each week, citing `OWN`, `GUIDE` and `WIKI`.

| Test | Asserts |
|---|---|
| `test_each_domain_row_has_a_point_per_week_oldest_first` | `[p["week_start"] for p in row["series"]] == [w.isoformat() for w in summary_weeks(first, last)]`; units and observations per week equal the hand counts; the sum of `series[].citation_units` equals the row's `citation_units` |
| `test_a_week_without_citations_is_a_zero_point` | a week with no answer has `{"citation_units": 0, "observations": 0}` |
| `test_meta_series_counts_answers_units_and_domains_per_week` | `meta.series[i]` has the hand counted `answers` (citing or not, including an answer with no citation), `citation_units` and `distinct_domains`; sum of `answers` equals `meta.answers` |
| `test_weeks_start_on_monday_in_the_project_zone` | an answer at Sunday 23:30 UTC (Monday 00:30 in Berlin) is in the Monday's week, not the week before |
| `test_the_first_week_counts_only_the_windows_days` | `from` on a Wednesday: the first point's `week_start` is that Monday and holds only answers from Wednesday on |
| `test_page_rows_have_series_and_meta_series_too` | `sources/pages?include=series`: every row has `series`, and `meta.series` equals the domains read's |
| `test_series_with_compare_and_filters_follow_the_scope` | `include=series&compare=previous_period&filter[engine_code_in]=gemini_web`: series counts only Gemini answers; `previous` still present |
| `test_without_include_there_is_no_series` | plain domains and pages: no row has `series`, `meta` has no `series` (keys of row and meta equal the as built sets below) |
| `test_series_adds_two_statements` (domains and pages, parametrized) | adds exactly 2 |
| `test_a_full_project_series_reads_as_many_statements_as_a_small_one` | `full_project`; `include=series` on domains: same count as the small world; sum of every row's series units equals `FULL_ANSWERS * 10` on the first page rows' totals; 15 s cold |
| `test_series_of_another_project_of_the_workspace_count_nothing` | a second project in the same workspace with its own answers citing `GUIDE`: the first project's series are unchanged |

The as built key sets (used here and in T9):

```python
DOMAIN_ROW_KEYS = {"registrable_domain", "domain_role", "role_entity_id", "citation_units",
    "observations", "prompts", "engines", "source_share", "first_seen_at", "last_seen_at"}
PAGE_ROW_KEYS = DOMAIN_ROW_KEYS | {"url_id", "url", "host", "title"}
META_KEYS = {"window", "include_branded", "engine_codes", "answers", "answers_citing",
    "citation_units", "by_role"}
```

### Code: repository

A week column computed in a subquery (the bound zone in a GROUP BY expression would be a second
parameter, see `summary_repository.weekly_counts`):

```python
def week_of(column: Any, timezone: str) -> Any:
    """The Monday of `column`'s week in the project's zone (docs/19 section 2.5)."""
    return cast(func.date_trunc("week", func.timezone(timezone, column)), Date)


async def row_weeks(
    db: AsyncSession,
    scope: SourceScope,
    timezone: str,
    *,
    by_page: bool,
    names: Collection[str] = (),
    url_ids: Collection[int] = (),
) -> dict[tuple[Any, str, UUID | None], dict[date, tuple[int, int]]]:
    """Units and citing answers per week of the page's rows: keyed by (registrable domain or
    url id, role, entity), then by week. One statement."""
    _, source = _cited(scope)
    key = _C.url_id if by_page else _D.registrable_domain
    inner = (
        select(key.label("key"), _C.domain_role, _C.role_entity_id, _C.observation_id,
               _C.url_id, week_of(_C.observed_at, timezone).label("week_start"))
        .select_from(source)
        .where(*citation_bounds(scope),
               _C.url_id.in_(sorted(url_ids)) if by_page else _D.registrable_domain.in_(sorted(names)))
        .subquery("cited_weeks")
    )
    rows = await db.execute(
        select(inner.c.key, inner.c.domain_role, inner.c.role_entity_id, inner.c.week_start,
               func.count(tuple_(inner.c.observation_id, inner.c.url_id).distinct()).label("units"),
               func.count(inner.c.observation_id.distinct()).label("observations"))
        .group_by(inner.c.key, inner.c.domain_role, inner.c.role_entity_id, inner.c.week_start)
    )
    ...
```

Return `{}` without a statement when the page is empty (the T2 statement test uses a world with
rows; the full project test asserts the count only when rows exist).

```python
async def scope_weeks(
    db: AsyncSession, scope: SourceScope, timezone: str
) -> dict[date, tuple[int, int, int]]:
    """Per week: counted answers (citing or not), citation units and distinct registrable
    domains. One statement: the counted answers left joined to their citations."""
```

Shape: `answers = counted_answers(scope)` wrapped in a subquery adding
`week_of(answers.c.observed_at, timezone)`; `outerjoin(ai_citations.join(domains, _D.id == _C.domain_id), and_(_C.observation_id == a.c.observation_id, _C.observed_at == a.c.observed_at, *citation_bounds(scope)))`;
measures `count(a.c.observation_id.distinct())`,
`count(tuple_(_C.observation_id, _C.url_id).distinct()).filter(_C.url_id.is_not(None))`,
`count(_D.registrable_domain.distinct())`; group by the week column.

### Code: service and route

`SourceService.domains` and `.pages` take `include: Collection[str] = ()`. With `"series"`:
`weeks = summary_weeks(now.first, now.last)`; call `row_weeks` for the page's keys and
`scope_weeks`; each row gets
`series=[SourceWeekUnits(week_start=w, citation_units=found.get(w, (0, 0))[0], observations=found.get(w, (0, 0))[1]) for w in weeks]`;
`meta.series=[SourcesWeek(week_start=w, answers=..., citation_units=..., distinct_domains=...) for w in weeks]`.
Without `"series"` both stay `None` (absent). The zone name is `now.window.timezone`.

Route: `refuse_unbuilt` keeps `"include"` only for values other than `series`:
`"include": bool(set(include or ()) - {"series"})` on domains (pages: entry removed);
pass `include=include or ()`. Field and parameter descriptions: drop `_NOT_RETURNED` /
`_NOT_BUILT` from the series fields and say "`series` built; `cited_with` and `by_role_by_engine`
not built yet" on the domains `include`.

### Run

Base set plus `tests/api/ai/test_sources_series.py tests/api/ai/test_contract_sources.py
tests/security/test_cross_tenant.py`. Regenerate `v1.json`. Light checks.

### Prove it bites

| Weakening | Test expected to fail |
|---|---|
| `week_of` uses `_C.observed_at` without `func.timezone` | `test_weeks_start_on_monday_in_the_project_zone` |
| Series computed when `include` is empty | `test_without_include_there_is_no_series`, `test_series_adds_two_statements` |
| `row_weeks` drops the `registrable_domain IN (...)` bound and keys by role only | `test_each_domain_row_has_a_point_per_week_oldest_first` |
| `scope_weeks` uses an inner join (answers without citations lost) | `test_meta_series_counts_answers_units_and_domains_per_week` |
| A per-row loop of `row_weeks` calls | `test_a_full_project_series_reads_as_many_statements_as_a_small_one` |
| `citation_bounds` left out of `row_weeks` | `test_series_of_another_project_of_the_workspace_count_nothing` |

### Commit

`WP-14: weekly series on cited domains and pages`.

---

## T3: Country scope on citations, sources and fan-out

Rows: CF-08.

### Files

- the four shared files
- `$WT/backend/tests/api/ai/test_sources_country.py` (new)
- `$WT/backend/tests/api/ai/test_contract_sources.py` (drop the country 501 cases)
- `$WT/backend/tests/security/test_cross_tenant.py` (anchor: country on domains, pages, citations, changes)
- `$WT/backend/openapi/v1.json`

### Tests first: `test_sources_country.py`

Scene: prompt `us` (`add_prompt(..., country="US")`) and prompt `de` (`country="DE"`), each with
answers citing different domains (`GUIDE` for US, `WIKI` for DE), and a ChatGPT answer each with a
fan-out list.

| Test | Asserts |
|---|---|
| `test_a_country_keeps_the_answers_of_its_prompts` (parametrize domains, pages) | `filter[country_iso]=US`: only `example.org` rows; `meta.answers` is the US answers only; `source_share.denominator` is the US units |
| `test_the_citation_list_keeps_the_countrys_answers` | `citations?filter[country_iso]=DE`: every row's `prompt_id` is the DE prompt |
| `test_fanout_queries_keep_the_countrys_answers` | `fanout-queries?filter[country_iso]=US&min_support=1`: only the US query; `meta.answers` is the US ChatGPT answers |
| `test_a_country_with_no_prompt_answers_empty` | `filter[country_iso]=FR`: `data == []`, `meta.answers == 0`, 200 |
| `test_a_citation_cursor_is_bound_to_its_country` | first page with `limit=1&filter[country_iso]=US`; its cursor with `filter[country_iso]=DE` is `(400, "invalid_cursor")`; without the filter is `400` too |
| `test_a_cursor_without_a_country_keeps_its_hash` | a cursor of a request without the filter decodes with the same scope as before T3: `encode_cursor` of the D2 key set; assert the next page works and `"country" not in` the decoded scope dict built by `_cursor_scope` for `country_iso=None` |
| `test_a_country_and_one_prompt_of_another_country_answer_empty` | `filter[prompt_id]=<de prompt>&filter[country_iso]=US`: `data == []` |
| `test_a_lower_case_country_is_refused` | `filter[country_iso]=us` on the four reads: `INVALID` |
| `test_country_adds_no_statement` | domains with and without the filter: same count |

### Code

- `SourceQuery.country_iso: str | None = None`; the routes `replace(scope, country_iso=country_iso)`.
- `scope_prompts(..., country_iso: str | None)`: `if country_iso is not None: statement = statement.where(p.country_iso == country_iso)`.
- `scoped()` passes `query.country_iso`.
- `_cursor_scope`: `if query.country_iso is not None: bound["country"] = query.country_iso` (R4).
- `refuse_unbuilt` loses `"filter[country_iso]"` on domains, pages, citations and fan-out;
  `CountryFilter` description drops `_NOT_BUILT`.

### Run

Base set plus `tests/api/ai/test_sources_country.py tests/api/ai/test_contract_sources.py
tests/security/test_cross_tenant.py`. Regenerate `v1.json`. Light checks.

### Prove it bites

| Weakening | Test expected to fail |
|---|---|
| Drop the `p.country_iso == country_iso` condition | `test_a_country_keeps_the_answers_of_its_prompts`, `test_fanout_queries_keep_the_countrys_answers` |
| Drop `bound["country"]` | `test_a_citation_cursor_is_bound_to_its_country` |
| Always write `bound["country"]` (also `None`) | `test_a_cursor_without_a_country_keeps_its_hash` |
| Apply the country only when `prompt_id` is not set | `test_a_country_and_one_prompt_of_another_country_answer_empty` |

### Commit

`WP-14: country scope on the source and fan-out reads`.

---

## T4: `min_support`, new and lost sources (`sources/changes`)

Rows: CF-09, BE-SOURCES-05, BE-SOURCES-06.

### Files

- the four shared files
- `$WT/backend/tests/api/ai/test_sources_changes.py` (new)
- `$WT/backend/tests/api/ai/test_contract_sources.py` (drop the `min_support` and changes 501 cases; keep the bound cases)
- `$WT/backend/tests/security/test_cross_tenant.py` (anchor: `min_support` on domains and pages; the changes line)
- `$WT/backend/openapi/v1.json`

### Tests first: `test_sources_changes.py`

Windows: `to = today`, `from = today - 6` (L = 7). W = days 0 to 6 ago, W-1 = 7 to 13, W-2 = 14 to
20. Answers in the middle of each window (`days_ago` 3, 10, 17).

| Test | Setup | Asserts |
|---|---|---|
| `test_min_support_leaves_out_rarer_domains` (domains, pages) | `GUIDE` 3 units, `WIKI` 1 | `min_support=2`: only `example.org`; `page.total == 1`; `meta` unchanged against the plain read |
| `test_min_support_counts_units_not_answers` | one answer citing `GUIDE` and `GUIDE_TOP` (2 units, 1 answer) | `min_support=2` keeps `example.org` |
| `test_a_new_source_has_min_support_now_and_none_before` | `GUIDE` 2 units in W, 0 in W-1; `WIKI` 2 in W and 1 in W-1; `OWN` 1 in W | `kind=new`: rows `[example.org]`; `current_units == 2`, `previous_units == 0`, `first_seen_at`/`last_seen_at` the W answers' times; `meta.window == W`, `meta.compare_window == W-1`, `meta.kind == "new"`, `meta.min_support == 2` |
| `test_a_lost_source_had_min_support_and_then_two_empty_windows` | `GUIDE` 3 units in W-2, none after | `kind=lost&min_support=3`: row `example.org`, `current_units == 0`, `previous_units == 3`, `first_seen_at is None`, `last_seen_at is None`; `meta.window == {from: W-1 start, to: W end}`, `meta.compare_window == W-2` |
| `test_a_source_cited_in_the_window_before_is_not_lost_yet` | `WIKI` 3 units in W-1, none in W | `kind=lost`: `wikipedia.org` absent (one empty window is not two) |
| `test_a_lost_source_below_min_support_is_not_listed` | `GUIDE` 1 unit in W-2 | `kind=lost&min_support=2`: empty |
| `test_changes_keep_roles_apart` | `OWN` cited as own 2 units in W, nothing before | `kind=new`: row `domain_role == "own"`, `role_entity_id == world.own` |
| `test_changes_follow_the_scope` | branded prompt citing `RIVAL` new in W; engine filter | default: no `rival` row; `include_branded=true`: present; `filter[engine_code_in]=gemini_web`: only Gemini units |
| `test_changes_page_by_offset_most_units_first` | three new domains with 4, 3, 2 units | `limit=2`: first two by units; `offset=2`: the third; `page.total == 3` |
| `test_a_window_over_92_days_is_refused` | `from` 100 days before `to` | `(422, "window_too_large")` |
| `test_changes_of_a_deleted_project_are_not_found` | `UPDATE core.projects SET deleted_at = now()` | `NOT_FOUND` |
| `test_changes_count_nothing_of_another_project` | another project of the workspace with `GUIDE` new | first project's list unchanged |
| `test_changes_are_one_statement_whatever_the_size` | small world and `full_project`, `kind=new` and `kind=lost` | the same count for both sizes; the read of each kind adds exactly 1 statement over `scoped()` (compare with `sources/domains?limit=0` style: assert `len(seen)` small equals large); full lost read under 15 s cold |
| `test_min_support_adds_no_statement` | domains with and without | same count |

### Code: repository

```python
async def changes(
    db: AsyncSession,
    scope: SourceScope,
    *,
    split: datetime,
    kind: str,
    min_support: int,
    offset: int,
    limit: int,
) -> tuple[list[ChangeCount], int]:
    """New or lost sources in one grouped statement: `scope` spans the compared window and the
    window answered; `split` is where the answered window starts. Units before `split` are the
    previous units, units from it the current ones."""
    answers, source = _cited(scope)
    keys = (_D.registrable_domain, _C.domain_role, _C.role_entity_id)
    current = func.count(unit()).filter(_C.observed_at >= split)
    previous = func.count(unit()).filter(_C.observed_at < split)
    grouped = (
        select(*keys, current.label("current_units"), previous.label("previous_units"),
               func.min(_C.observed_at).filter(_C.observed_at >= split).label("first_seen_at"),
               func.max(_C.observed_at).filter(_C.observed_at >= split).label("last_seen_at"))
        .select_from(source)
        .where(*citation_bounds(scope))
        .group_by(*keys)
        .having(and_(current >= min_support, previous == 0) if kind == "new"
                else and_(previous >= min_support, current == 0))
    )
    order = desc(literal_column("current_units" if kind == "new" else "previous_units"))
    rows, total = await page_of(db, grouped, [order, *keys[:2], _C.role_entity_id.asc().nulls_first()], offset=offset, limit=limit)
```

(`page_of` appends `count(*) OVER ()`; the ordering column names are labels.)

`domain_counts` and `page_counts` take `min_support: int | None` and add
`grouped = grouped.having(func.count(unit()) >= min_support)` when set.

### Code: service

```python
async def changes(self, access, project_id, query, *, kind, min_support, page) -> SourceChangePage:
    engines = shown_engines(query.engine_codes)
    async with self._transaction(access) as db:
        now = await scoped(db, access, project_id, query, engines)
        if kind == "new":
            answered, support = now, before(now)
        else:
            gap = before(now)
            answered = Scoped(scope=replace(now.scope, since=gap.scope.since), window=MetricWindow(from_=gap.window.from_, to=now.window.to, timezone=now.window.timezone), first=gap.first, last=now.last, zone=now.zone)
            support = before(gap)
        span = replace(now.scope, since=support.scope.since, until=answered.scope.until)
        rows, total = await repository.changes(db, span, split=answered.scope.since, kind=kind, min_support=min_support, offset=page.offset, limit=page.limit)
    return SourceChangePage(data=[SourceChangeRow(...)], page=OffsetPageInfo(...), meta=SourceChangesMeta(window=answered.window, compare_window=support.window, include_branded=..., engine_codes=..., kind=kind, min_support=min_support))
```

`MetricWindow` takes `from_` by its field name (check `schemas/metrics.py`; it is built that way in
`scoped()`).

### Code: route

`source_changes` loses `@not_built` and the raise, takes `sources: Sources`, passes
`flags` (used from T7) and calls `sources.changes(...)`. Description: the C5 and C6 rules, the
windows answered (`meta.window` is the two empty windows for `lost`), `min_support` counts units,
offset pages. `MinSupport` description drops `_NOT_BUILT`; domains and pages pass `min_support`.

### Run

Base set plus `tests/api/ai/test_sources_changes.py tests/api/ai/test_contract_sources.py
tests/security/test_cross_tenant.py`. Regenerate `v1.json`. Light checks.

### Prove it bites

| Weakening | Test expected to fail |
|---|---|
| Lost uses `answered = now` (one empty window) | `test_a_source_cited_in_the_window_before_is_not_lost_yet` |
| `previous >= min_support` replaced by `previous >= 1` | `test_a_lost_source_below_min_support_is_not_listed` |
| `previous == 0` dropped for `new` | `test_a_new_source_has_min_support_now_and_none_before` (`wikipedia.org` appears) |
| `HAVING units >= min_support` dropped on domains | `test_min_support_leaves_out_rarer_domains` |
| `min_support` counted as answers (`count(observation_id.distinct())`) | `test_min_support_counts_units_not_answers` |
| `citation_bounds` not applied | `test_changes_count_nothing_of_another_project` |

### Commit

`WP-14: min_support and new and lost sources`.

---

## T5: Source diversity and domain detail

Rows: BE-SOURCES-07, BE-SOURCES-11, CF-05 (D-41: backend).

### Files

- the four shared files
- `$WT/backend/tests/api/ai/test_sources_diversity.py` (new)
- `$WT/backend/tests/api/ai/test_sources_detail.py` (new)
- `$WT/backend/tests/api/ai/test_contract_sources.py` (drop the two stub 501 cases for these routes; keep access cases)
- `$WT/backend/openapi/v1.json`

### Tests first: `test_sources_diversity.py`

Scene: ChatGPT answers citing domain units 6 (`example.org` over `GUIDE` and `GUIDE_TOP`), 3
(`wikipedia.org`), 1 (`OWN`); Gemini answers citing one domain only.

| Test | Asserts |
|---|---|
| `test_effective_sources_is_the_inverse_herfindahl` | ChatGPT entry: `distinct_domains == 3`, `citation_units == 10`, `effective_sources == {"value": 100 / 46, "numerator": 100.0, "denominator": 46, "n_observations": <answers>, ...}` (`pytest.approx` on value) |
| `test_one_domain_is_one_effective_source` | Gemini: `effective_sources.value == 1.0` |
| `test_an_engine_without_citations_has_no_value` | AI Mode with answers and no citation: `citation_units == 0`, `effective_sources.value is None`, `answers > 0` |
| `test_a_domain_in_two_roles_is_one_domain` | `OWN` cited as own and as third party: `distinct_domains` counts it once |
| `test_the_meta_pools_counts_only` | `meta.distinct_domains` is the distinct count over both engines; `meta.effective_sources_engine_average` is the mean of the ChatGPT and Gemini values (AI Mode left out) |
| `test_diversity_series_per_week` | `include=series`: per engine a point per `summary_weeks` Monday, units, distinct domains and effective sources per week by hand; an empty week has `effective_sources is None` |
| `test_ads_presence_per_engine` | ChatGPT answers: one with `extras={"ads": [{"type": "chat_gpt_ad", ...}, {...}], "fan_out_queries": []}`, one with `extras={"ads": []}`, one with `extras={"truncated": True}`, one with no extras: `include=ads`: `ads.answers_with_ads == {"value": 0.25, "numerator": 1.0, "denominator": 4, ...}`, `ads.ads == 2` |
| `test_without_include_there_is_no_series_or_ads` | keys of each entry are exactly the plain set |
| `test_diversity_follows_the_scope_and_the_flags` | branded excluded by default; a citation flagged `unresolved_redirect` counted only with `include_unresolved_redirects=true` (the flag part is built in T7: in T5 assert only scope; T7 adds this test) |
| `test_diversity_is_one_statement_and_each_include_one_more` | plain: small and full counts equal; `include=series` adds 1; `include=ads` adds 1 |
| `test_diversity_of_a_deleted_project_is_not_found` | `NOT_FOUND` |

### Tests first: `test_sources_detail.py`

| Test | Asserts |
|---|---|
| `test_a_domain_detail_has_its_rows_pages_prompts_and_engines` | `GET sources/domains/example.org`: `rows` equals the two rows of `sources/domains?filter`ed by hand (role split kept), `top_pages` the `example.org` pages by units (at most 10), `prompts` its prompts with units and answers by units then prompt id, `engines` one series per `meta.engine_codes` engine |
| `test_the_engine_series_holds_the_share_denominator` | per engine and week: `citation_units` of the domain and `all_citation_units` of every domain that week on that engine, `answers` the counted answers |
| `test_the_detail_cites_with_entities` | mentions of `world.rival` in 2 answers citing `example.org`, `world.own` in 1: `cited_with == [{"entity_id": rival, "observations": 2}, {"entity_id": own, "observations": 1}]` |
| `test_a_mention_of_an_old_extraction_does_not_count` | the rival mention written with `is_current = false`: not in `cited_with` |
| `test_a_domain_not_cited_answers_empty_lists` | `GET sources/domains/nowhere.example`: 200, every list empty, `meta.answers` the scope's |
| `test_the_detail_of_www_and_bare_host_is_one_domain` | `GUIDE_TOP` (`www.example.org`) and `GUIDE` (`guide.example.org`) both under `example.org` |
| `test_the_detail_is_a_fixed_number_of_statements` | small and `full_project`: same count |
| `test_a_detail_of_another_project_is_not_found` | the same path with a project of another workspace (as its owner) is `NOT_FOUND`; a deleted project is `NOT_FOUND` |
| `test_the_detail_lists_are_bounded` | 12 pages of one domain cited: `len(top_pages) == 10`; 25 prompts: `len(prompts) == 20` |

### Code: repository

```python
async def diversity(db, scope) -> dict[str, DiversityCount]:
    """Per engine: answers, citing answers, units, distinct registrable domains and the sums for
    the effective number of sources. One statement: units per (engine, domain) first."""
```

Shape: `per_domain = select(answers.c.engine_code, _D.registrable_domain, func.count(unit()).label("u")).select_from(source).where(*citation_bounds(scope)).group_by(answers.c.engine_code, _D.registrable_domain).subquery()`;
outer per engine `count(*)` (domains), `sum(u)`, `sum(u * u)`; answers and citing answers come from
a second subquery of `counted_answers(scope)` grouped by engine, joined to the outer by engine with
a full outer join (an engine with answers and no citation), all in one `select`. The service
computes `value = units**2 / squares if units else None`.

`diversity_weeks(db, scope, timezone)`: the same with `week_of` added to the inner grouping
(per engine, week, domain), one statement.

`ads_presence(db, scope)`: counted answers joined to `ai.observations` exactly as
`_answers_with_queries` does (on `id`, `observed_at`, `workspace_id`, bounded `project_id`,
`observed_at`, `observed_date`), with
`ads = case((func.jsonb_typeof(_O.provider_extras["ads"]) == "array", func.jsonb_array_length(_O.provider_extras["ads"])), else_=0)`;
per engine `count(*)`, `count(*).filter(ads > 0)`, `sum(ads)`. One statement.

Detail: reuse `domain_counts(..., registrable_domain=name, limit=DETAIL_ROWS_MAX)` (add the
`registrable_domain` filter parameter as `page_counts` has it), `page_counts(..., registrable_domain=name, limit=DETAIL_PAGES_MAX)`, `totals`, and add:

- `domain_prompts(db, scope, name, *, top)`: `answers.c.prompt_id`, units and citing answers
  grouped by prompt, `registrable_domain == name`, order units desc then prompt id, limit `top`.
- `domain_engine_weeks(db, scope, name, timezone)`: counted answers with their week left joined to
  their citations and domains (as `scope_weeks`), grouped by (engine, week):
  `count(unit()).filter(_D.registrable_domain == name)`,
  `count(_C.observation_id.distinct()).filter(_D.registrable_domain == name)`,
  `count(unit()).filter(_C.url_id.is_not(None))` (all units), `count(answers.observation_id.distinct())`.
  One statement.
- `cited_with(db, scope, names, *, top) -> dict[tuple[str, str, UUID | None], list[tuple[UUID, int]]]`
  (also used by T6): `cites` = distinct `(observation_id, observed_at, derivation_id, registrable_domain, domain_role, role_entity_id)` of the counted answers' citations with `registrable_domain IN names`;
  join `ai.entity_mentions m` on `m.observation_id == cites.observation_id`, `m.observed_at == cites.observed_at`,
  `m.derivation_id == cites.derivation_id`, `m.workspace_id == scope.workspace_id`, with `m.project_id == scope.project_id`,
  `m.is_current`, `m.mention_status == "accepted"`, `m.observed_at` within the window; group by
  the row key and `m.entity_id` counting `cites.observation_id.distinct()`; `row_number()` over the
  row key ordered by that count desc then entity id; keep `place <= top`. One statement.
  `counted_answers` gains the column `_F.derivation_id` (no other query reads it; harmless).

For the detail, `cited_with` is keyed by the domain alone: group by `registrable_domain` only
(a `by_row: bool` flag, `False` for the detail, `True` for T6).

### Code: service

`SourceService.diversity(access, project_id, query, *, include)` and
`SourceService.domain(access, project_id, query, registrable_domain)`; both start with `scoped()`
(S18). Detail statements: rows, totals (2), top pages, prompts, engine weeks, cited with: a fixed
number. The detail rows carry no `previous` and no `series` (absent).

### Code: route

Drop `@not_built` and the raise from `source_diversity` and `source_domain`; take `sources:
Sources`; `replace(scope, country_iso=country_iso)`; pass `include`. Descriptions without
`_NOT_BUILT`.

### Run

Base set plus `tests/api/ai/test_sources_diversity.py tests/api/ai/test_sources_detail.py
tests/api/ai/test_contract_sources.py tests/security/test_cross_tenant.py`. Regenerate `v1.json`.
Light checks.

### Prove it bites

| Weakening | Test expected to fail |
|---|---|
| `effective = distinct_domains` | `test_effective_sources_is_the_inverse_herfindahl` |
| Group the inner diversity query by `(engine, registrable_domain, domain_role)` | `test_a_domain_in_two_roles_is_one_domain` |
| Average over every engine, AI Mode included | `test_the_meta_pools_counts_only` |
| Drop `m.is_current` | `test_a_mention_of_an_old_extraction_does_not_count` |
| Drop `m.derivation_id == cites.derivation_id` (a second derivation's current mention seeded) | `test_the_detail_cites_with_entities` (counts double) |
| `top_pages` without the `registrable_domain` filter | `test_a_domain_detail_has_its_rows_pages_prompts_and_engines` |
| `ads_presence` reads `fan_out_queries` instead of `ads` | `test_ads_presence_per_engine` |
| Call `scoped()` after the reads (no 404) | `test_a_detail_of_another_project_is_not_found` (deleted project case) |

### Commit

`WP-14: source diversity and domain detail`.

---

## T6: Cited with on domain rows, role split per engine

Rows: CF-10, OV-N7.

### Files

- the four shared files
- `$WT/backend/tests/api/ai/test_sources_cited_with.py` (new)
- `$WT/backend/tests/api/ai/test_contract_sources.py` (drop the last `include` 501 cases)
- `$WT/backend/tests/security/test_cross_tenant.py` (anchor: domains `include` with all three values)
- `$WT/backend/openapi/v1.json`

### Tests first

| Test | Asserts |
|---|---|
| `test_each_domain_row_names_the_entity_most_named_with_it` | `include=cited_with`: `example.org` row `cited_with == {"entity_id": str(rival), "observations": 2}`; a row whose answers name nobody has no `cited_with` key (absent, not null) |
| `test_cited_with_ties_are_broken_by_entity_id` | two entities with 1 answer each: the smaller UUID |
| `test_cited_with_keeps_roles_apart` | `OWN` as own and as third party, each cited by different answers naming different entities: each row its own entity |
| `test_cited_with_adds_one_statement` | adds exactly 1 |
| `test_the_role_split_per_engine_adds_up_to_by_role` | `include=by_role_by_engine`: one entry per `meta.engine_codes` engine in that order, each with `own`, `competitor`, `third_party` `{citation_units, answers_citing}`; for each role the sum of `citation_units` over engines equals `meta.by_role`'s units |
| `test_an_engine_with_no_citations_is_zeros` | AI Mode: every role `{0, 0}` |
| `test_the_role_split_ignores_the_role_filter` | `filter[domain_role_in]=own` with the include: the split still has all three roles (it is meta, like `by_role`) |
| `test_by_role_by_engine_adds_one_statement` | adds exactly 1 |
| `test_every_include_together_adds_four_statements` | `include=series,cited_with,by_role_by_engine` adds 4 over plain |
| `test_a_full_project_with_every_include_reads_as_many_statements_as_a_small_one` | equal counts, 15 s cold |

### Code

- `role_engine_totals(db, scope) -> dict[tuple[str, str], tuple[int, int]]`: grouped by
  `(answers.c.engine_code, _C.domain_role)`: `count(unit())`, `count(_C.observation_id.distinct())`
  over `_cited(scope)` with `citation_bounds`; no role filter. One statement.
- The service maps every engine of `engines` and every role of `ROLES`, zero when missing.
- `cited_with(..., by_row=True, top=1)` for the page's domain names; row `cited_with` set only when
  found.
- Route: domains `refuse_unbuilt` loses `"include"` (every value built); descriptions updated.

### Prove it bites

| Weakening | Test expected to fail |
|---|---|
| `role_engine_totals` grouped by role only and copied to every engine | `test_the_role_split_per_engine_adds_up_to_by_role` |
| The role filter applied to `role_engine_totals` | `test_the_role_split_ignores_the_role_filter` |
| `cited_with` written as `null` when not found (no `exclude_if`) | `test_each_domain_row_names_the_entity_most_named_with_it` |
| `cited_with` grouped by domain only for rows | `test_cited_with_keeps_roles_apart` |

### Commit

`WP-14: cited with and the role split per engine`.

---

## T7: Prompts with no own page, the flag toggles, ads presence confirmed

Rows: BE-SOURCES-20, BE-SOURCES-22, BE-SOURCES-25 (ads built in T5; confirmed here with the flags).
Needs the owner's answer to O1 before merge (the commit can be written first).

### Files

- the four shared files
- `$WT/backend/tests/api/ai/test_sources_prompts.py` (new)
- `$WT/backend/tests/api/ai/test_sources_flags.py` (new)
- `$WT/backend/tests/api/ai/test_contract_sources.py` (drop the toggle and `sources/prompts` 501 cases)
- `$WT/backend/tests/security/test_cross_tenant.py` (anchor: toggles on domains and pages)
- `$WT/backend/openapi/v1.json`

### Tests first: `test_sources_prompts.py`

Scene: prompt A with 2 ChatGPT answers citing `OWN` (twice in one answer) and `OWN_BLOG`; prompt B
with answers citing only `GUIDE`; prompt C with a Gemini answer citing nothing.

| Test | Asserts |
|---|---|
| `test_each_prompt_and_engine_says_which_own_pages_it_cites` | row (A, chatgpt_web): `answers == 2`, `answers_citing_own == 2`, `own_citation_units == 3`, `own_pages == 2`, `top_own_page == {"url_id": <OWN id>, "url": OWN}` |
| `test_a_prompt_citing_no_own_page_is_listed_with_zeros` | (B, chatgpt_web): `answers_citing_own == 0`, `top_own_page is None`; (C, gemini_web) too |
| `test_filter_own_cited_false_keeps_the_prompts_with_no_own_page` | `filter[own_cited]=false`: rows B and C only; `true`: A only |
| `test_rows_come_in_prompt_then_engine_order` | rows sorted by `(prompt_id, engine_code)` |
| `test_prompt_pages_hold_every_row_once` | `limit=1` walked to the end: every row once, `has_more` false on the last, `next_cursor is None` |
| `test_a_prompts_cursor_is_bound_to_its_filters` | a cursor of `filter[own_cited]=false` used with `true`, or with another `from`, or with `filter[country_iso]=US`: `(400, "invalid_cursor")` |
| `test_a_forged_prompts_cursor_is_refused` | `forged_cursor(cursor, ["not-a-uuid", "chatgpt_web"])` and `[str(uuid4()), 5]`: `400`, never `500` |
| `test_branded_prompts_are_left_out_by_default` | a branded prompt: absent; with `include_branded=true`: present |
| `test_prompts_of_another_project_are_not_listed` | a prompt of another project of the workspace: absent |
| `test_the_prompts_read_is_one_statement` | small and `full_project`: same count; full under 15 s cold |
| `test_prompts_of_a_deleted_project_are_not_found` | `NOT_FOUND` |

### Tests first: `test_sources_flags.py`

| Test | Asserts |
|---|---|
| `test_an_unresolved_redirect_is_left_out_by_default` (parametrize domains, pages, changes, diversity, detail, prompts) | an answer citing `https://vertexaisearch.cloud.google.com/grounding-api-redirect/x` flagged `unresolved_redirect`: no `google.com` row, `meta.citation_units` excludes it |
| `test_the_toggle_counts_it_again` | `include_unresolved_redirects=true`: the row is back and `meta.citation_units` includes it |
| `test_an_engine_internal_link_is_left_out_unless_asked` | a citation flagged `engine_internal`: same pair of checks with `include_engine_internal` |
| `test_a_citation_with_another_flag_still_counts` | `redirect_unwrapped`: counted by default |
| `test_the_citation_list_and_fanout_keep_every_citation` | `citations` lists the flagged citation; `fanout-queries` `cited_domains` unchanged |
| `test_the_toggles_add_no_statement` | same count with and without |
| `test_plain_requests_answer_as_before_without_flagged_citations` | a scene without flags: domains, pages, citations and fan-out bodies equal the bodies with `include_unresolved_redirects=true&include_engine_internal=true` (domains, pages) |

### Code

- `SourceScope.excluded_flags: tuple[str, ...] = ()`; `SourceQuery.excluded_flags` likewise;
  `scoped()` copies it.
- `citation_bounds(scope)` adds, when `scope.excluded_flags` is not empty:
  `~_C.flags.overlap(cast(array(list(scope.excluded_flags)), ARRAY(Text)))`
  (`from sqlalchemy.dialects.postgresql import ARRAY, array`).
- Routes: domains, pages, changes, diversity, detail, prompts set
  `replace(scope, excluded_flags=flags)`; citations and fan-out never set it (S13).
- Prompts read:

```python
async def prompt_own_pages(
    db: AsyncSession,
    scope: SourceScope,
    *,
    own_cited: bool | None,
    after: tuple[UUID, str] | None,
    limit: int,
) -> list[Any]:
    """Per (prompt, engine) of the counted answers: answers, answers citing an own page, own
    units, own pages and the own page with the most units (ties: the lowest url id). Keyset
    `(prompt_id, engine_code)`. One statement."""
```

Shape: `answers = counted_answers(scope)`; `own = select(_C.observation_id, _C.observed_at, _C.url_id).where(*citation_bounds(scope), _C.domain_role == "own").distinct().subquery()`;
`joined = answers.outerjoin(own, and_(own.c.observation_id == answers.c.observation_id, own.c.observed_at == answers.c.observed_at))`;
group by `answers.c.prompt_id, answers.c.engine_code`:
`count(answers.c.observation_id.distinct())`,
`count(answers.c.observation_id.distinct()).filter(own.c.url_id.is_not(None))`,
`count(own.c.url_id)`, `count(own.c.url_id.distinct())`,
`func.mode().within_group(own.c.url_id).filter(own.c.url_id.is_not(None)).label("top_url_id")`;
`having` `answers_citing_own == 0` (false) or `> 0` (true) when `own_cited` is set; the keyset
`tuple_(prompt_id, engine_code) > tuple_(key...)` in a wrapping select over the grouped subquery,
which also left joins `core.urls` on `top_url_id` for the canonical URL; order by both keys; limit.

- Service: cursor scope `{"project_id", "from", "to", "engines", "prompt", "term", "branded",
  "own_cited", "flags": sorted(flags)}` plus `"country"` only when set; `_prompt_after(cursor,
  bound)` validates the key as `[uuid string, engine code in EngineCode]` (`UUID(...)` in a
  `try`, else `invalid_cursor()`); `limit + 1` rows; `encode_cursor([str(prompt_id), engine_code], scope=bound)`.
- Route: drop `@not_built` and the raise from `source_prompts`; `refuse_unbuilt` loses the toggle
  entries; `_UNRESOLVED` and `_INTERNAL` descriptions drop `_NOT_BUILT`.

### Prove it bites

| Weakening | Test expected to fail |
|---|---|
| Drop the `overlap` condition | `test_an_unresolved_redirect_is_left_out_by_default` |
| `flag_toggles` ignores `include_unresolved_redirects` | `test_the_toggle_counts_it_again` |
| Exclusion applied to the citation list | `test_the_citation_list_and_fanout_keep_every_citation` |
| Drop the keyset condition | `test_prompt_pages_hold_every_row_once` |
| Drop `own_cited` from the cursor scope | `test_a_prompts_cursor_is_bound_to_its_filters` |
| Drop the UUID check of the key | `test_a_forged_prompts_cursor_is_refused` (500) |
| Inner join of `own` | `test_a_prompt_citing_no_own_page_is_listed_with_zeros` |

### Commit

`WP-14: prompts with no own page and the citation flag toggles`.

---

## T8: Fan-out: the cut measured, queries by topic

Rows: BE-FANOUT-03 (measure; the narrowing is T8b), BE-TOPICS-12.

### Files

- the four shared files
- `$WT/backend/tests/api/ai/test_fanout_topics.py` (new)
- `$WT/backend/tests/api/ai/test_fanout_bound.py` (new, no database)
- `$WT/backend/tests/api/ai/test_contract_sources.py` (drop the fan-out `include` 501 case)
- `$WT/backend/tests/security/test_cross_tenant.py` (lease: the fan-out `QUERIES` line, T1's text)
- `$WT/backend/openapi/v1.json`

### Tests first: `test_fanout_bound.py` (pure, imports `_bounded`, `EXTRAS_MAX_BYTES`)

| Test | Asserts |
|---|---|
| `test_a_typical_answer_keeps_every_query` | 10 queries of 60 characters, 20 brand entities, 2 ads: `"truncated" not in _bounded(...)`, 10 queries kept |
| `test_a_list_of_queries_alone_is_kept_up_to_the_bound` | 120 queries of 60 ASCII characters (about 7.7 KB): all kept |
| `test_halving_keeps_a_prefix_of_the_queries` | 400 queries: the kept list is the first `len(kept)` of the input and `len(kept) >= 200` |
| `test_the_stored_extras_never_exceed_the_bound` | for the cases above and 1,000 accented queries: `len(json.dumps(kept, ensure_ascii=False).encode()) <= EXTRAS_MAX_BYTES` |

These record what the bound does (the measurement above) and stay valid after T8b (T8b adds the
order test).

### Tests first: `test_fanout_topics.py`

Scene: topic terms `pricing` and `security` (`topic_of`), prompt P1 tagged `pricing`, P2 tagged
both, P3 untagged; ChatGPT answers of each issue `soc pricing`.

| Test | Asserts |
|---|---|
| `test_each_query_names_the_topics_of_the_prompts_that_issued_it` | `include=topics&min_support=1`: `soc pricing` row `topics == [{"term_id": pricing, "observations": 2}, {"term_id": security, "observations": 1}]` (P1 and P2 answers for pricing), most answers first, then term id |
| `test_a_term_of_another_vocabulary_kind_is_not_a_topic` | a term of a `market` vocabulary on P1: not listed |
| `test_a_query_of_untagged_prompts_has_an_empty_topic_list` | a query only P3 issued: `topics == []` |
| `test_topics_are_bounded_to_ten` | 12 topics on one prompt: `len(topics) == 10` |
| `test_without_include_there_are_no_topics` | plain: no row has `topics` |
| `test_topics_add_one_statement` | adds exactly 1; full project with fan-out equal counts |
| `test_topics_of_another_projects_terms_are_never_read` | a `topic` vocabulary of another project of the same workspace, its term tagged on P1 (the tag table does not check the project): not listed. Other workspaces are covered by row security and the cross-tenant scan with `include=topics` |

### Code

- `fanout_topics(db, scope, texts, *, top) -> dict[tuple[str, str], list[tuple[UUID, int]]]`:
  `issued` filtered to the page's texts (as `fanout_cited`), distinct `(observation_id, prompt_id, normalized_text, engine_code)`;
  join `ai.prompt_terms pt` on `pt.prompt_id == issued.prompt_id` and `pt.workspace_id == scope.workspace_id`;
  join `core.taxonomy_terms t` on `t.id == pt.term_id` and `core.taxonomy_vocabularies v` on
  `v.id == t.vocabulary_id` with `v.kind == "topic"` and `v.project_id == scope.project_id`
  (check the column names in `db/tables.py`: `taxonomy_terms`, `taxonomy_vocabularies`); group by
  `(normalized_text, engine_code, pt.term_id)` counting `observation_id.distinct()`; `row_number`
  per (text, engine) by count desc then term id; `place <= top`. One statement.
- Service `fanout(..., include)`: with `"topics"`, each row gets `topics=[FanoutTopic(...)]` (an
  empty list when none). Route: fan-out `refuse_unbuilt` removed entirely; `topics` description
  drops `_NOT_RETURNED`. Route description: add "`include=topics` adds the topic terms of the
  prompts that issued each query".

### The production share (for the package report, not a test)

The ops session (or the owner) runs once, read-only, on production:

```sql
SELECT count(*) FILTER (WHERE jsonb_typeof(provider_extras->'fan_out_queries') = 'array'
                          AND jsonb_array_length(provider_extras->'fan_out_queries') < fanout_count)
         AS cut,
       count(*) FILTER (WHERE fanout_count > 0) AS with_fanout
FROM ai.observations
WHERE engine_code = 'chatgpt_web' AND observed_at >= now() - interval '28 days';
```

WP-14 never runs it (no access to production or to the shared dev database); the report asks the
coordinator to forward it.

### Prove it bites

| Weakening | Test expected to fail |
|---|---|
| Drop `v.kind == "topic"` | `test_a_term_of_another_vocabulary_kind_is_not_a_topic` |
| Drop `v.project_id == scope.project_id` | `test_topics_of_another_projects_terms_are_never_read` (the other project's term appears) |
| Count rows instead of distinct answers | `test_each_query_names_the_topics_of_the_prompts_that_issued_it` |
| Topics read without `include` | `test_without_include_there_are_no_topics` |

### Commit

`WP-14: fan-out topics and the 16 KB cut measured`.

---

## T8b: Cut the other lists before the fan-out queries (lease)

Rows: BE-FANOUT-03 (narrowing). Beside T7 or T8; only after the lease is granted and WP-57 is told.

### Files

- `$WT/backend/src/idraft/providers/dataforseo/ai_parse.py` (`_bounded`)
- `$WT/backend/tests/providers/dataforseo/test_ai_parse.py` (one test)

### Tests first

`test_the_bound_cuts_the_ads_and_brand_entities_before_the_queries`: 80 queries of 60 characters and
60 ads of about 350 bytes (the measured case): every query kept, ads cut, `truncated` set; and with
500 queries and no other list, the queries are cut (a prefix) and the extras fit.

Run also `tests/api/ai/test_fanout_queries.py::test_a_list_cut_by_the_16_kb_bound_is_counted_as_cut`
and `tests/api/ai/test_fanout_bound.py`: they must stay green (the first builds its cut through the
real parser; if it relied on the queries being cut first, adjust its input so the queries alone
exceed the bound, in this commit, and say so).

### Code

```python
def _bounded(payload: dict[str, Any]) -> dict[str, Any]:
    """The extras with their longest list halved until they fit, the fan-out queries last (the
    fan-out read counts them; the ads and brand entities are only kept for reference);
    `{"truncated": true}` when that is not enough."""
    ...
    while not _fits(kept):
        others = [name for name in lists if name != "fan_out_queries" and kept[name]]
        longest = max(others or lists, key=lambda name: len(kept[name]), default=None)
        ...
```

### Prove it bites

| Weakening | Test expected to fail |
|---|---|
| `others` ignored (the old rule) | `test_the_bound_cuts_the_ads_and_brand_entities_before_the_queries` |

### Commit

`WP-14: the extras bound cuts the fan-out queries last`, naming the two files.

---

## T9: Statement counts, cross-tenant, the contract tests replaced

Rows: BE-SOURCES-01, 02, 03, 04, BE-FANOUT-01 (confirmed, not rebuilt).

### Files

- `$WT/backend/tests/api/ai/test_sources_contract_kept.py` (new: the guards of the WP-03 file that are still true)
- `$WT/backend/tests/api/ai/test_contract_sources.py` (deleted)
- `$WT/backend/tests/security/test_cross_tenant.py` (anchor lines checked complete)

### Tests: carry over every guard of `test_contract_sources.py`

| Old guard | New home |
|---|---|
| 501 per addition | gone (built); each task's tests prove the addition works |
| changes 501 | gone; `test_sources_changes.py` |
| billing 403 and outsider 404 on changes and `include=series` | `test_every_source_read_checks_access_first` here, parametrized over all nine source routes (domains, pages, citations, fan-out, changes, diversity, detail, prompts) with every option of the `QUERIES` entry |
| the seven out-of-bounds cases | `test_an_addition_out_of_bounds_is_refused` here, the same seven plus T1's five |
| plain reads have no `series` / `by_role_by_engine` in meta | `test_plain_reads_keep_the_as_built_keys` here: domains, pages (row and meta key sets of T2), citations row keys, fan-out row and meta keys equal the D2 sets |
| OpenAPI shape and bounds | `test_the_api_document_has_the_source_additions` here, as extended in T1, plus: no description of a built parameter or field contains `Not built yet` or `Not returned yet` except `category` and `category_source` |

Confirm rows: `test_sources.py` (BE-SOURCES-01..03), `test_sources_compare.py` (04),
`test_fanout_queries.py` (BE-FANOUT-01) are unchanged and green; their statement count tests stand.

Add `test_the_whole_package_is_a_fixed_number_of_statements` here: for each route and each include,
small world and `full_project(fan_out=True)` give equal counts (a parametrized table of
`(path, params)`), so a per-row query anywhere fails.

### Run

Base set plus `tests/api/ai/ tests/security/test_cross_tenant.py` (the AI folder, `-n 2`).

### Prove it bites

| Weakening | Test expected to fail |
|---|---|
| Any one of T2 to T8's grouped reads turned into a loop over rows | `test_the_whole_package_is_a_fixed_number_of_statements` |
| A new route without `ReadData` | `test_every_source_read_checks_access_first` |

### Commit

`WP-14: the source contract tests replaced by real ones`.

---

## T10: As built notes, contract log, rebase, final checks, push

Rows: process.

### Files

- `$WT/docs/19-api-specification.md` (append after the D2 As built paragraphs of 3.7.7)
- `$WT/docs/29-phase-roadmap.md` (append after the latest WP entry)
- `$WT/docs/ai-visibility/contracts/sources-additions.md` (Status, change log)
- `$WT/backend/openapi/v1.json`, `$WT/apps/web/src/lib/api/schema.ts` (regenerated)

### Content

Doc 19: `**As built (AI visibility WP-14, 2026-11-13): sources lane.**` stating: `include=series`
(Mondays in the project zone, zero filled, at most 14, rows and `meta.series`), `cited_with`,
`by_role_by_engine`, `min_support` (units), `filter[country_iso]` (the prompts' market) on domains,
pages, citations, fan-out and the new routes; the citation cursor binds the country only when set;
`sources/changes` (C5 new, C6 lost with the windows answered, offset pages); `sources/diversity`
(per engine, C3 formula, pooled count and equal-weight average, `include=series,ads`);
`sources/domains/{registrable_domain}` (rows, engine weekly series with denominators, 10 pages, 20
prompts, 5 entities, `200` with empty lists when not cited); `sources/prompts` (keyset
`(prompt_id, engine_code)`, `filter[own_cited]`); flagged citations excluded by default with the
two toggles (aggregates only; citations and fan-out unchanged); fan-out `include=topics`; the 16 KB
bound cuts the queries last (if T8b merged); not built: `-trend`, categories (WP-60), the unbounded
fan-out table (WP-57), `engine_internal` marking at ingest.

Doc 29: one entry naming WP-14, no migration, the rows built and confirmed.

Contract note change log:

```text
2026-11-13 WP-14: built every addition; `sources/changes` built
2026-11-13 WP-14: `kind=lost` follows docs/16 C6: `min_support` units in the support window (`meta.compare_window`) and none in the two following windows (`meta.window`, the asked window and as many days before it)
2026-11-13 WP-14: `include=series` on pages fills `meta.series` too
2026-11-13 WP-14: flagged citations (`unresolved_redirect`, `engine_internal`) left out of aggregate reads by default; toggles count them again (docs/14 section 9)
2026-11-13 WP-14: `sources/diversity`, `sources/domains/{registrable_domain}`, `sources/prompts` built as published; fan-out `include=topics` built
```

### Steps

1. `git fetch origin && git rebase origin/develop`; resolve `v1.json` and `schema.ts` by
   regeneration, anchor blocks by keeping both sides.
2. Regenerate `v1.json` (commit `WP-14: regenerated api document` only if it changed).
3. `cd apps/web && pnpm gen:api`; commit `WP-14: regenerated web client` (only `schema.ts`).
4. Backend full checks through the heavy lane:
   `infra/dev/heavy --label wp-14-check -- bash -c 'export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock" TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock; cd backend && uv sync --frozen && ./check.sh'`.
5. Web (medium lane each): `pnpm typecheck`, `pnpm vitest run src/lib/api/schema.test.ts`,
   `pnpm format:check`.
6. `grep -nP '[\x{2013}\x{2014}]|[^\x00-\x7F]'` on every changed file prints nothing.
7. `git push origin HEAD:develop` (fast-forward only; if refused, back to 1).
8. `infra/dev/wp-status WP-14 merged "..."` and the same line to the coordinator:

```text
WP-14 merged | branch ai/wp-14-sources-lane @ <short sha> | rows done 21/21 | steps 10/10 | blockers: none | next: WP-21, WP-22, WP-24, WP-37, WP-61 run pnpm gen:api; no migration; production fan-out cut SQL for the ops session in the plan (T8)
```

Never push `main`, never run `infra/ship.sh`, never deploy.

## Row coverage

| Row | Task | How it is closed |
|---|---|---|
| BE-SOURCES-01 | T9 | confirmed (D2 tests unchanged); country added in T3 |
| BE-SOURCES-02 | T9 | confirmed |
| BE-SOURCES-03 | T9 | confirmed |
| BE-SOURCES-04 | T9 | confirmed (`test_compare_adds_two_statements` stands) |
| BE-SOURCES-05 | T4 | C6 lost over two windows |
| BE-SOURCES-06 | T4 | `sources/changes` built |
| BE-SOURCES-07 | T5 | `sources/diversity` |
| BE-SOURCES-11 | T5 | `sources/domains/{registrable_domain}` |
| BE-SOURCES-20 | T7 | `sources/prompts` with `filter[own_cited]` |
| BE-SOURCES-22 | T7 | flagged citations excluded by default, toggles (O1 needs the owner) |
| BE-SOURCES-25 | T5, T7 | diversity `include=ads` |
| BE-FANOUT-01 | T9 | confirmed |
| BE-FANOUT-03 | T8, T8b | measured; cut narrowed (lease); unbounded storage is WP-57 BE-FANOUT-02 |
| BE-TOPICS-12 | T8 | fan-out `include=topics` |
| CF-05 | T5 | `meta` of domains plus diversity (D-41 backend) |
| CF-07 | T2 | row series |
| CF-08 | T3 | country on every read |
| CF-09 | T4 | `min_support` and lost after two windows |
| CF-10 | T5, T6 | `cited_with` on rows and detail (category stays WP-60) |
| OV-N6 | T2 | rows and `meta.series` |
| OV-N7 | T6 | `meta.by_role_by_engine` |
