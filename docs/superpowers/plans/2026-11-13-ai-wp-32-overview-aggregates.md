# WP-32 overview aggregates: task plan

Brief: [docs/ai-visibility/work-packages/WP-32-overview-aggregates.md](../../ai-visibility/work-packages/WP-32-overview-aggregates.md). Contract notes (written by task 1 and 2): `docs/ai-visibility/contracts/c8-metrics.md` and `c5-competitors.md`.
Worktree `.claude/worktrees/ai-prompts-web-8c68b5`, branch `ai/wp-32-overview-aggregates`, cut from `origin/develop` at `ea605e45` (the brief says `.claude/worktrees/wp-32`: report the branch actually used in `wp-status`). Develop already holds WP-12 (summary lane) and WP-14 (sources lane).
Paths: `P` = `/api/v1/workspaces/{workspace_id}/projects/{project_id}`, `B` = `backend/src/idraft`, `BT` = `backend/tests`. Every fact below was read in this worktree at `ea605e45`.
Rows: 12 (2 built and only confirmed, 10 to do). Seven routes. No migration, no new table, no RLS, no grant, no `_TENANT_ROWS` entry: every statement reads existing tenant tables with the workspace and project in its `WHERE`.

## How to read

Section 0 lists what the code showed and what it changes. Section 1 is the rules every implementer gets in its prompt. Section 2 is the contract: every route, parameter and field is settled there, so task 1 and 2 only transcribe it and the later tasks never change it. Section 3 is files and leases, section 4 statement counts, section 5 the eight tasks, section 6 the 12 rows with their proving tests, section 7 pushes and order, section 8 risks.

## 0. Facts found (they change the plan)

| # | Fact | Consequence |
|---|---|---|
| F1 | `B/api/ai/metrics_routes.py` and `competitor_routes.py` hold `router = APIRouter()` and nothing else. `main.py` includes both, but there is no stub, no route, no path in `backend/openapi/v1.json` or `apps/web/src/lib/api/schema.ts`. `schemas/ai_metrics.py` is one docstring. The brief and the coordinator expected existing `501` stubs. | Task 2 creates the seven routes as `@not_built` stubs and the models. The access line, path word and scan entry of every route are new. |
| F2 | The contract pack has `c1-prompts`, `c2-summary`, `c3-collection`, `sources-additions`, `annotations-notes`, `c12a-layouts`. There is no C5 and no C8 note, and `contracts/README.md` indexes six. | Task 1 creates `c8-metrics.md` and `c5-competitors.md` (change log `C-1` onward, as `c2-summary.md`) and adds two index rows. |
| F3 | The summary already returns, per engine: window cells for Mentioned, Cited, the four outcomes and Share of voice (own), `previous` (compare), weekly points with the D-04 pooling (`series`), entity cells and their weekly cells (`entities`), the small cells (`cells`: cited given citations, first mention, fan-out), `total` (every prompt in scope as one topic row), `rows=none`, `by_country`, `co_mentions`, `lost_to` opportunity. Sources has `role_engine_totals` (citation units per engine and role). | Almost every WP-32 number is a relabelling of a summary cell. The metric service calls `SummaryService.summary` once per request and maps its cells: same scope code, same numbers as the Topics & Prompts page (R12), no copy of the scope, pooling or window SQL. Only six reads are new SQL: prompt attributes, entity references, entity citation units, lost counts, prompt cards and top domains. |
| F4 | `collectors/ai_prompt_ingest.py:478` writes `own_recommended=None`: nothing classifies recommendation yet (S2, WP-54). Structured rank, prominence and sentiment are likewise null. | `ai.recommendation_rate` and `ai.recommended_given_mentioned` answer `200` suppressed with `suppressed_reason: not_classified` (never 0). The other registry keys that need S2 or S3 data answer `501` naming the key. |
| F5 | `facts.own_citation_count` and `total_citation_count` count citations without the `engine_internal` and `unresolved_redirect` flags the sources page leaves out. | `ai.citation_share` reads `source_repository.role_engine_totals` with the sources flag default, so the Overview number equals `sources/domains` `meta.by_role` (R12), not the facts column. |
| F6 | SEO share of voice (doc 09 section 7: clicks by a CTR curve over keyword volumes) is built nowhere. `overview/seo` and `overview/changes` are not built either. `ranks` has no SOV. | `GET {P}/overview/competitors` is built for its AI half. The SEO block is declared (optional, absent) so a later package adds it without a second shape. Owner decision D13. |
| F7 | `reject_unknown_query` makes any query parameter a route does not declare `422 extra_forbidden` (`pagination.py`). The doc 19 parameters the summary does not have (`window`, `tz`, `panel_id`, `subject`, `prompt_ids`, the intent, funnel, type, location, language and persona filters, `aggregation`) are therefore refused, not ignored. | The note lists them as not accepted. |
| F8 | `tests/api/test_route_access.py` and `tests/security/test_cross_tenant.py` each have a `WP-32 overview-aggregates` anchor in every table (checked by `test_each_table_has_one_anchor_line_per_package_in_order`). `{metric}` is a new path word: it goes in `PATH_PARAMETERS` (anchor) and in `WORDS` of `test_cross_tenant.py` (NOT under an anchor: lease). `test_no_route_is_hidden_by_an_earlier_one` means `.../ai/metrics/overview` must be declared before `.../ai/metrics/{metric}`. `NOT_BUILT` stubs answer `501` inside the member's scope and drop out of that set the moment `@not_built` is removed. | Task 2 adds the anchors and the lease line; each later task removes its own `@not_built` marks. |
| F9 | Doc 16 section 2.1 lacks `ai.prompts_in_scope` and `ai.valid_answers` (D-17, default Yes). The WP-33 plan (lease L7, task 6) also plans to add both rows and "tell WP-32". | Task 1a adds them first and pushes at once, after `git fetch` and a `git grep` on `origin/develop`; if the rows are there already, skip 1a and say so. Conflict on rebase: keep the develop side. Tell the coordinator both packages hold the lease. |
| F10 | The web is `apps/web/src/features/ai-overview` (not `overview`). `useOverviewPeriods` and `buildAggregates` exist only in the WP-33 plan and branch (`ai/wp-33-overview-shell`), not in this checkout. WP-33 states `OverviewAggregates` is "written to what the metric routes will return (value, numerator, denominator, n per engine and metric)". | The overview body below gives that per engine, plus `last_observed_at` and `last_valid_at` (the header meta line) and `meta.previous_answers`. WP-33 swaps its seam to it after this package is on develop. |
| F11 | `workspace_transaction` runs one `_SET_SCOPE` statement per transaction. A route that calls the summary service (its own transaction) and then reads more in a second transaction costs the summary's statements, plus the extra reads, plus 1. | Statement deltas in section 4 are "extra reads + 1", tested as differences, never absolute. |
| F12 | Hand numbers of the seeded world (`summary_support.seeded`, docstring of the `summary` fixture in `test_prompts_summary.py`, worked in the WP-12 plan section 4): ChatGPT, default scope (providers, pricing, misc): Mentioned numerator 1.4, denominator 3 prompts, `n_observations` 8, `pooled` (3, 7); valid answers 7 of 8 (one refusal); Gemini has one valid answer (g1, providers, both brands named, own cited). `rival` is named in providers p1 (with the own brand) and p4 (alone). Answer p9 is 28 days old (the previous window). | Anchor numbers below come from these. The implementer re-derives each from the fixture docstring before asserting it (the WP-12 caveat: the docstring is the source). |
| F13 | `schemas/ai.py` has the compare machinery: `NOT_ASKED`, `_NotAsked`, `_not_asked`, `MetricCell`, `Pooled`, `PointPool`, `SummaryEntity`, `Aggregation`. `summary.py` imports `_NotAsked` itself. | `schemas/ai_metrics.py` imports them the same way; no edit to `schemas/ai.py`. |
| F14 | `backend/openapi/v1.json` carries route summaries, descriptions and field descriptions. A later edit of any of them changes the document and fails `tests/api/test_openapi.py` and the web `schema.test.ts`. | Task 2 writes the FINAL route and field text. Tasks 3 to 8 end with a document diff check and must leave it empty (section 2.9). |
| F15 | The summary takes a `rows` selector: `rows=none` is the cheapest read (no topic rollup, no names); `rows` left out builds every prompt row, which also gives the ids of the prompts in scope. | Routes that need no prompt ids call the summary with `rows=none`; routes that do (citation share, entity citation units, lost prompts, attribute breakdown) call it with rows left out and take the ids from `prompts[].prompt_id`: the ids the cells counted, from the same snapshot, at the cost of the two topic statements `rows=none` skips. |

## 1. Rules in force for every implementer (copy into every prompt)

- A fresh Sonnet subagent per task (Haiku and Sonnet only, never Opus), ONE subagent at a time. A fresh Sonnet reviewer per task reads the task, this plan and the diff, runs the targeted tests, applies the prove-it-bites list of the task and returns PASS or a numbered list.
- Tests first and a real red run for the right reason (a `404`, `501` or wrong number, never an import error), then code, green, then checks, then ONE commit `WP-32: <task title>` naming only the task's files. No attribution lines. Never `git add -A`.
- Edit files with the file tools only (Read, Edit, Write): no shell heredocs, `sed`, `perl` or replace scripts. Files pure ASCII, no em-dash and no en-dash in any string, comment, doc or test name: `grep -nP '[^\x00-\x7F]' <files>` prints nothing.
- No dev server. No real provider or LLM call: tests seed through the helpers of `tests/api/ai/summary_support.py` and `tests/collectors/ai_support.py` or write rows straight into the tables. No migration against the shared dev DB. Never push `main`, never run `infra/ship.sh`, never touch the main checkout, `.claude/worktrees/release`, Colima's state or the `idraft-dev-*` containers.
- Colima first: `colima status || colima start --cpu 10 --memory 16` (start only when stopped; never restart). Every pytest run exports `DOCKER_HOST=unix://$HOME/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`.
- Targeted tests (medium lane, from the repository root), with the files of the task:

```bash
infra/dev/heavy --lane medium --label wp-32-tN -- bash -c 'cd backend && export DOCKER_HOST=unix://$HOME/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock && uv run pytest tests/api/ai/test_metrics_<name>.py tests/api/ai/test_metrics_contract.py --no-cov -n 2 -q'
```

- Light checks after each task (no lock): `cd backend && uv run ruff check --fix . && uv run ruff format . && uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run lint-imports`.
- Document check, last line of tasks 3 to 8: `cd backend && uv run python -m idraft.api.openapi | diff - openapi/v1.json` prints nothing. If it prints, the task changed a shape or a text of the contract: stop and read section 2.9.
- Full `./check.sh` only in task 8, through `infra/dev/heavy` (heavy lane), with the gate pause OFF (`infra/dev/heavy --status`), memory free at least 40 percent and `load5` at most 14.
- Web files generated by `pnpm gen:api` can leave `apps/web/AGENTS.md` and `apps/web/CLAUDE.md`: delete them before the commit.
- After each reviewed task push the backup branch only: `git push origin ai/wp-32-overview-aggregates` (never develop or main for a backup). The branch is deleted after the final merge: `git push origin --delete ai/wp-32-overview-aggregates`.
- A guard the task adds is proven by the reviewer in a scratch commit never pushed: weaken it, run the named test, see it fail, restore. The list goes into the package report.

## 2. The contract (settled; tasks 1 and 2 transcribe it, nothing later changes it)

### 2.1 Routes

All `GET`, permission `data:read`, success `200`. Order of declaration in `metrics_routes.py`: overview first, `{metric}` after it.

| # | Route | Module | Body | Rows |
|---|---|---|---|---|
| 1 | `{P}/ai/metrics/overview` | metrics_routes | `AiOverviewResponse` | CF-16, BE-METRICS-08 |
| 2 | `{P}/overview/ai` | metrics_routes | `AiOverviewResponse`, the same body as 1 | BE-REPORTS-01 |
| 3 | `{P}/ai/metrics/{metric}` | metrics_routes | `AiMetricResponse` | BE-METRICS-09 |
| 4 | `{P}/ai/metrics/{metric}/series` | metrics_routes | `AiSeriesResponse` | BE-METRICS-10 |
| 5 | `{P}/ai/metrics/{metric}/breakdown` | metrics_routes | `AiBreakdownResponse` | BE-METRICS-11 |
| 6 | `{P}/ai/competitors` | competitor_routes | `AiCompetitorsResponse` | BE-COMPETITORS-03, BE-COMPETITORS-05 |
| 7 | `{P}/overview/competitors` | competitor_routes | `OverviewCompetitorsResponse` | BE-REPORTS-03 |

`metrics_routes.py` has no router prefix (`router = APIRouter(tags=["ai"])`, full paths), because routes 1 to 5 live under both `ai/` and `overview/`.

### 2.2 Query parameters

Scope, on all seven (the summary's, with its meaning and errors; `SummaryQuery` is built from them): `from`, `to` (project-local days, default the 28 days ending today, at most 92: `422 window_too_large`; `from` after `to` is `422 range_invalid`; a date outside the calendar `422 out_of_range`), `filter[engine_code_in]` (list of `EngineCode`, at most 3), `include_branded` (false), `branded_only` (false, wins over `include_branded`), `filter[country_iso]` (`^[A-Z]{2}$`), `filter[term]` (UUID: the term and its subtree).

Compare, on routes 1, 2, 3, 6, 7 only: `compare` (`none` default, `previous_period`, `previous_year`), `compare_from`, `compare_to` (both or neither, at most 92 days, win over `compare`): C2 change log C-1 and C-2 unchanged, because the summary computes them. Routes 4 and 5 have no compare (a series is the time axis; a movers view is two reads or WP-58).

Route specific:

| Route | Parameter | Meaning |
|---|---|---|
| 3 and 4 | `entity_ids` (comma list of UUID, at most 20) | One value or series per listed tracked entity and engine, in place of the engine's own cells. Allowed only for `ai.mention_rate` and `ai.share_of_voice` (any other key: `422` at `entity_ids`). An id that is not a tracked entity of the project (own or competitor, `track_ai`, not removed) is left out and is `200`, never `404`. |
| 4 | `granularity` | `week` (default and the only value). `day` and `month` are `422` with the field code `not_built` (no card reads them; precedent: `group_by=language`, C2 C-19). |
| 5 | `dimension` (required) | `topic`, `intent`, `funnel_stage`, `engine`, `country`, `language`, `persona`, `prompt_type`. |
| 6 | `include` (comma list) | `lost_prompts`, `top_sources`. Absent unless asked. |
| 6 | `entity_ids` | Narrows the rows to those tracked entities. |
| 6 | `lost_limit` (1 to 10, default 5) | Rows of `lost_prompts` per entity and engine. |
| 6 | `sources_limit` (1 to 5, default 3) | Rows of `top_sources` per entity. |
| 3, 4, 5 | path `metric` (`^[a-z][a-z0-9_.]{0,63}$`) | A registry key of doc 16 section 2.1. |

Anything else is `422 extra_forbidden`.

### 2.3 The value model

`AiMetricValue` is a standalone model in `schemas/ai_metrics.py` (not a subclass of `schemas/metrics.MetricValue`: that one is the SEO side's and carries `n_keywords` and `source`). It is doc 16 section 2 `MetricValue` for AI, reusing `MetricWindow`, `MetricUnit`, `Pooled`, `PointPool`, `MetricCell`, `Aggregation`, `SummaryEntity`, `ObservationClass`.

```python
class AiFilters(BaseModel):          # the resolved scope, nulls written out
    include_branded: bool; branded_only: bool; country_iso: str | None; term_id: UUID | None

class AiMetricValue(BaseModel):
    metric: str                      # registry key; "<key>.engine_average" for an average
    value: float | None              # null when the denominator is 0 or the metric is suppressed
    numerator: float | None
    denominator: float | None        # null for a count; value = numerator / denominator holds exactly otherwise
    unit: MetricUnit                 # "ratio" or "count" in this package
    n_observations: int              # every answer behind it, valid or not
    n_prompts: int | None            # absent unless prompt weighted: prompts with a valid answer (= denominator)
    aggregation: Aggregation | None  # absent for counts and averages of engines
    window: MetricWindow
    filters: AiFilters
    observation_class: ObservationClass | None   # of the one engine; absent on an average and on prompts_in_scope
    engine_code: str | None          # set when the value is for exactly one engine
    entity_id: UUID | None           # set when the value is about one tracked entity
    engines: list[str] | None        # engine_average only: the engines averaged
    is_estimate: bool                # always false here
    method: str
    method_version: int              # 1 for every key now; a formula change raises it (doc 16 rule 7)
    suppressed_reason: Literal["insufficient_data", "no_surface", "not_classified", "below_min_impressions"] | None
    pooled: Pooled | None            # raw counts behind a prompt weighted rate ("3 of 7 answers")
    previous: MetricCell | None | NOT_ASKED   # see 2.5; absent unless compare was asked and the key compares
    ci: AiCi | None                  # declared, never returned here (S3, WP-58): Wilson stays on the client (R8)
```

Every optional member is left out of the JSON when it is not set (`exclude_if=_absent`), except `previous`, which follows the summary's `NOT_ASKED` rule (C2 C-2): absent when compare was not asked; `null` when it was asked and the engine had no answer of the scope in the compare window; a cell otherwise (an entity not named in valid answers is `0` of N, a real rate). The previous window is `meta.compare_window`. Not declared at all, added later as additive members: `version_boundaries` (WP-38 feeds it), `MetricComparison` and `delta` (doc 19 2.6; WP-58; the web computes a detectable change from the counts, R5).

Mapping from a summary cell (`MetricCell`): `value`, `numerator`, `denominator`, `n_observations`, `pooled` copy; `n_prompts = denominator` when `pooled` is set; `aggregation` from the key's weighting (2.5). Counts: `ai.valid_answers` is `value = numerator = pooled.trials` of the total Mentioned cell (every valid answer in scope), `denominator` null, `n_observations` every answer, so "7 of 8 answers, 1 not valid" is `n_observations - value`. `ai.prompts_in_scope` is `value = numerator = total.prompt_count`, `n_observations` the answers of all engines shown.

`engine_average` entry (doc 19 2.6 rule 5, doc 17 4.4): `metric` suffixed `.engine_average`, `numerator` the sum of the engine values, `denominator` the number of engines with a value, `value = numerator / denominator`, `engines` the codes averaged, `n_observations` the sum, `method` says "equal-weight average of per-engine values", `aggregation` as its inputs, no `engine_code`, no `previous`. Present only when two or more engines have a value. Engines are never pooled otherwise; there is no pooled option.

### 2.4 Response bodies

```python
class AiMetricMeta(BaseModel):                 # on every body
    window: MetricWindow
    compare_window: MetricWindow | None        # absent unless compare was asked
    previous_answers: int | None               # absent unless compare was asked: valid answers in scope there (C2 C-2)
    include_branded: bool; branded_only: bool
    engine_codes: list[str]                    # the engines shown (enabled or answering, after the filter)
    entities: list[SummaryEntity]              # the tracked set SOV is computed over (R9)
    entity_config_versions: list[int]          # more than one: the set changed inside the window
    notes: list[str]                           # [] unless a route has something to say

# Route 1 and 2
class AiOverviewEngine(BaseModel): engine_code: str; observation_class: ObservationClass; tiles: list[AiMetricValue]
class AiOverview(BaseModel):
    engines: list[AiOverviewEngine]            # one per engine shown, sorted by code
    engine_average: list[AiMetricValue]        # see tiles; [] under two engines
    prompts_in_scope: AiMetricValue
    last_observed_at: datetime | None          # newest counted answer, any status (the header "AI updated")
    last_valid_at: datetime | None
class AiOverviewResponse(BaseModel): data: AiOverview; meta: AiMetricMeta

# Route 3: one value per engine (and per listed entity), engines sorted by code, entities as the tracked set orders them (own first),
# then the engine_average entries. An outcome_mix key gives four values per engine.
class AiMetricResponse(BaseModel): data: list[AiMetricValue]; meta: AiMetricMeta

# Route 4: one series per engine (and per listed entity)
class AiMetricPoint(BaseModel):
    t: date                    # the Monday the week starts on, project zone
    value: float | None; numerator: float | None; denominator: float | None
    n_observations: int
    n_prompts: int             # prompts with a valid answer in that week itself (WeekCells.prompts)
    is_partial: bool           # the week is cut by a window bound, or holds today
    is_pooled: bool            # WeekCells.is_pooled: the cells hold the trailing weeks, C2 C-11
    pool: PointPool | None     # absent unless is_pooled
    pooled: Pooled | None
class AiMetricSeries(BaseModel):
    metric: str; unit: MetricUnit; aggregation: Aggregation; engine_code: str; entity_id: UUID | None
    window: MetricWindow; filters: AiFilters; is_estimate: bool; method: str; method_version: int
    granularity: Literal["week"]; points: list[AiMetricPoint]     # at most 14, oldest first
class AiSeriesResponse(BaseModel): data: list[AiMetricSeries]; meta: AiMetricMeta

# Route 5
class AiDimension(BaseModel): type: BreakdownDimension; id: str | None; label: str | None   # id null: the "none" group
class AiBreakdownRow(BaseModel): dimension: AiDimension; prompts: int; values: list[AiMetricValue]   # one per engine, no averages
class AiBreakdownMeta(AiMetricMeta): rows_total: int; truncated: bool
class AiBreakdownResponse(BaseModel): data: list[AiBreakdownRow]; meta: AiBreakdownMeta

# Route 6
class LostPrompt(BaseModel): prompt_id: UUID; text: str; importance: int; lost: MetricCell
class CompetitorSource(BaseModel): registrable_domain: str; citation_units: int; answers: int
class AiCompetitorEngine(BaseModel):
    engine_code: str
    mention_rate: AiMetricValue; recommendation_rate: AiMetricValue
    citation_share: AiMetricValue; share_of_voice: AiMetricValue
    is_top_competitor: bool
    lost_prompts: list[LostPrompt] | None        # include=lost_prompts, competitors only, else absent
class AiCompetitor(BaseModel): entity: EntityRef; by_engine: list[AiCompetitorEngine]; top_sources: list[CompetitorSource] | None
class AiCompetitorsResponse(BaseModel): data: list[AiCompetitor]; meta: AiMetricMeta

# Route 7 (the AI half; the SEO members are declared and never returned in this package)
class OverviewCompetitorEngine(BaseModel): engine_code: str; share_of_voice: AiMetricValue; mention_rate: AiMetricValue
class OverviewSeoCells(BaseModel): share_of_voice: MetricValue; visibility: MetricValue     # schemas.metrics.MetricValue, provisional
class OverviewCompetitorRow(BaseModel): entity: EntityRef; ai: list[OverviewCompetitorEngine]; seo: OverviewSeoCells | None
class OverviewCompetitors(BaseModel): rows: list[OverviewCompetitorRow]; seo_other_domains: MetricValue | None
class OverviewCompetitorsResponse(BaseModel): data: OverviewCompetitors; meta: AiMetricMeta
```

`EntityRef` is the existing model of `schemas/entities.py` (`entity_id`, `canonical_name`, `entity_type`, `role`, `color_index`).

Overview tiles, per engine, in this order: `ai.valid_answers`, `ai.mention_rate`, `ai.citation_rate`, `ai.mention_and_citation_rate`, `ai.outcome_mix.mentioned_and_cited`, `ai.outcome_mix.mentioned_only`, `ai.outcome_mix.cited_only`, `ai.outcome_mix.neither`, `ai.recommendation_rate` (suppressed), `ai.share_of_voice`, `ai.citation_share`, `ai.citation_rate_given_citations`, `ai.first_mention_rate`, and, only on an engine that exposes fan-out, `ai.fanout_presence_rate` and `ai.fanout_mean_queries` (an engine that does not has no such tile: "not exposed", never 0). `engine_average` keys: `ai.mention_rate`, `ai.citation_rate`, `ai.mention_and_citation_rate`, `ai.share_of_voice`, `ai.citation_share`. Doc 19's A9 (top 3) and A11 (prominence) tiles are not returned (S2).

### 2.5 Registry keys and what each route does with them

D-17 meanings (doc 16 section 2.1 rows, task 1a): `ai.prompts_in_scope` is the prompts counted once whether they have a valid answer or not (branded left out unless asked); `ai.valid_answers` is the valid, current answers, with `n_observations` holding every answer.

| Key | Weighting | Source | Overview tile | `{metric}` | Series | Breakdown | `entity_ids` | `previous` |
|---|---|---|---|---|---|---|---|---|
| `ai.prompts_in_scope` | count | `total.prompt_count` | own member | yes (one value, no engine) | 501 | 501 | no | no |
| `ai.valid_answers` | count | `total` Mentioned `pooled.trials` | yes | yes | 501 | 501 | no | no (`meta.previous_answers`) |
| `ai.mention_rate` | prompt weighted | `mentioned` | yes | yes | yes | yes | yes | yes |
| `ai.citation_rate` | prompt weighted | `cited` | yes | yes | yes | yes | no | yes |
| `ai.mention_and_citation_rate` | prompt weighted | `outcomes.mentioned_and_cited` | yes | yes | 501 | yes | no | yes |
| `ai.outcome_mix` and its four `.x` keys | prompt weighted | `outcomes` | yes (four tiles) | yes (four values, add to the whole) | 501 | yes | no | yes |
| `ai.share_of_voice` | observation weighted | `share_of_voice`, entity cells | yes | yes | yes | yes | yes | yes |
| `ai.citation_rate_given_citations` | prompt weighted | `detail` (`include=cells`) | yes | yes | 501 | yes | no | no |
| `ai.first_mention_rate` | prompt weighted | `detail` | yes | yes | 501 | yes | no | no |
| `ai.fanout_presence_rate`, `ai.fanout_mean_queries` | prompt weighted, observation weighted | `detail`; engines without fan-out have no value | yes | yes | 501 | yes | no | no |
| `ai.citation_share` | observation weighted (units) | `role_engine_totals`, sources flag default | yes | yes | 501 | 501 | no | no |
| `ai.recommendation_rate`, `ai.recommended_given_mentioned` | n/a | none: suppressed `not_classified`, value, numerator and denominator null, `n_observations` the valid answers | recommendation only | yes (suppressed) | 501 | 501 | no | no |

Known registry keys not built here answer `501 not_implemented` (`Not built yet: <key>.`, from `not_built_yet`): `ai.mention_count_share`, `ai.structured_top3_rate`, `ai.structured_top5_rate`, `ai.ranked_list_presence_rate`, `ai.structured_rank`, `ai.prominence`, `ai.sentiment` and its four `.x` keys, `ai.competitor_gap`, `ai.source_share`, `ai.source_diversity`, `ai.surface_presence_rate`, `ai.fanout_keyword_coverage`, `ai.fanout_own_top10_share`, `ai.flip_rate`, `ai.citation_jaccard_distance`, `ai.within_run_disagreement`. A key that is built but not for that route (a `501` cell above) answers the same `501`, naming the key and the route. Any other key, including `seo.*` and `fp.*`, is `404 unknown_metric`.

Weighting follows the summary's `metric_context`: a prompt weighted value is the sum of each prompt's rate over the prompts with a valid answer, with `pooled` the answers; Share of voice is one answer one weight (sum of shares over answers that name a tracked entity).

Series pooling is the summary's, unchanged (C2 C-10 and C-11, `POOL_BELOW_PROMPTS = 10`, `POOL_WEEKS = 4`): the points of routes 4 are the weekly points of the summary's `total` row (a topic-like row of every prompt in scope), mapped. No new constant, no new SQL.

Breakdown by `topic`, `country`, `engine` reads the summary's `topics`, `by_country` and `total` rows (cells already weighted); by `intent`, `funnel_stage`, `prompt_type`, `language`, `persona` it groups the summary's prompt rows by the prompt's attribute (one statement `prompt_attributes`; `persona` also reads the term names with `summary_repository.topic_names`) and reduces each group's per-prompt cells with the same rule (`reduce_cells` in `metrics.py`, tested equal to a topic row on the same prompts). Prompts without a value (no persona) form one row with `dimension.id` null. Rows are sorted by `prompts` descending, then label, at most `BREAKDOWN_MAX = 300` (`meta.truncated`, `meta.rows_total`). `meta.notes` has "A prompt in two topics counts in each; topic values do not add up to the total." for `topic`. No `vocabulary_id` or `depth` (the topic vocabulary is the project's, as in the summary).

### 2.6 Competitors

The rows are the tracked set of the summary: the own entities, then competitors by name, with `track_ai` and not removed, at most 20 (`entity_cell_ids`). Watch entities and removed roles are not rows. `entity` comes from one statement over `project_entities` and `entities` for those ids and this project (`entity_refs`).

| Member | Source |
|---|---|
| `mention_rate` | the entity cell `mentioned` of the summary's `total` row (prompt weighted), `entity_id` set |
| `share_of_voice` | the entity cell `share_of_voice`, `entity_id` set; both carry `previous` with `compare` |
| `citation_share` | the entity's citation units on the engine over all citation units on the engine (`entity_units`: `ai.citations.role_entity_id`, the sources flag default, the same prompts and window); `numerator` units, `denominator` all units, `n_observations` the engine's valid answers; no `previous` |
| `recommendation_rate` | suppressed `not_classified` for every entity (F4) |
| `is_top_competitor` | true for exactly the competitor with the largest `share_of_voice.numerator` on that engine, ties by larger `mention_rate.numerator`, then name, then id; the own entity is never top; false for all when no competitor has a numerator above 0 |
| `lost_prompts` (opt-in) | competitors only: prompts where the competitor is named and the own brand is not (C2 C-6), per engine, sorted by `importance` descending, then lost answers descending, then text, then id, at most `lost_limit`; `lost` is lost answers of the prompt's valid answers on that engine (`n_observations` all its answers) |
| `top_sources` (opt-in) | domains cited with `role_entity_id` = the entity, by citation units descending, then domain, at most `sources_limit`, over all engines |

`overview/competitors` rows have `ai` per engine: `share_of_voice` and `mention_rate` as above (no citation share, no lost, no sources); the `seo` member and `seo_other_domains` stay absent (D13).

### 2.7 Errors and their order

`401 unauthenticated`, `404 not_found` (not a member, a project outside the member's scope), `403 forbidden` (no `data:read`), `422 validation_failed` (a value outside its bounds, `extra_forbidden`, `not_built` for `granularity=day|month`), then in the route body before any read `404 unknown_metric` (new `UnknownMetricError(ProblemError)` in `B/api/ai/metrics.py`: 404, code `unknown_metric`, title "Unknown metric"; a request with a bad key and a missing project answers `unknown_metric`) and, in the same `resolve()` before any read, `501 not_implemented` for a known key not built on the route (so a deleted project with a known unbuilt key answers `501`, before the project `404`) and `422` at `entity_ids` for a key that does not take it (field code `not_supported`), then the service: `404 not_found` for a deleted or unknown project (never `200` with empty data), `422 window_too_large` (limit 92 days), `503 query_timeout` (house). Not used: `422 engine_not_enabled` (the summary's engine filter semantics apply), `422 observation_classes_not_poolable` (no pooling option exists).

### 2.8 What is not in this contract (named, with owner)

`ci` (WP-58 stats), `version_boundaries` and annotations (WP-38), `MetricComparison` and `delta` (WP-58), the doc 19 scope parameters of F7, `granularity=day|month`, `vocabulary_id` and `depth`, the SEO half of `overview/competitors` (needs SEO share of voice, D13), recommendation, structured rank, prominence and sentiment values (S2, WP-54), categories on top sources (WP-60), `activity.key_changes` (REPORTS-02 with STATS-06, WP-58).

### 2.9 Regenerations

Exactly one: task 2 regenerates `backend/openapi/v1.json` (commit 2a) and `apps/web/src/lib/api/schema.ts` (commit 2b), the first push, so WP-33 to 37 can mock the final shape. Tasks 3 to 8 fill the bodies without changing a route decorator, parameter text, model or field description: each ends with the document check of section 1 and it must print nothing. If a later task must change a shape or a text, it first adds a change log line to the note, then regenerates both files in its own commit `WP-32: Regenerate the API document and web client`, and the implementer tells the coordinator (WP-33 to 37 mock the published shape). The plan avoids it by publishing the optional members now (`ci`, `seo`, `seo_other_domains`, `lost_prompts`, `top_sources`, `previous`) and by writing final text. Rebase regenerations are never hand merged: `git checkout origin/develop -- backend/openapi/v1.json apps/web/src/lib/api/schema.ts`, then `cd backend && uv run python -m idraft.api.openapi > openapi/v1.json`, then `cd apps/web && pnpm gen:api` (delete a generated `apps/web/AGENTS.md` and `CLAUDE.md`).

### 2.10 Decisions assumed (owner decides; the default is what the plan builds)

| # | Decision | Default and reason |
|---|---|---|
| D1 | The metric routes are thin adapters over the summary service | Yes. One scope implementation, so every Overview number equals the Topics & Prompts number (R12); zero new aggregation SQL for overview, value, series, topic, country and engine breakdown. |
| D2 | `AiMetricValue` is a standalone model | Yes. `schemas/metrics.MetricValue` is the SEO side's and shared. |
| D3 | `previous` beside `current` instead of doc 19's `MetricComparison`; no `delta`, no `ci` | Yes. The web computes the detectable change from the counts (R5) and the Wilson interval (R8) until WP-58 adds both additively. |
| D4 | `granularity=week` only | Yes. No card reads day or month series (collection per day is `ai/collection/daily`, WP-30); `day` and `month` answer `422 not_built`. |
| D5 | Known keys not built answer `501`, unknown keys `404 unknown_metric`, recommendation answers `200` suppressed | Yes. Honest and uniform (F4); the Overview "AI by engine" table needs the recommendation column to exist. |
| D6 | `overview/ai` is the same body as `ai/metrics/overview` and takes `filter[engine_code_in]`, not doc 20's `engines=` | Yes. Every built AI read uses `filter[engine_code_in]`; one name, one body. |
| D7 | Scope parameters are the summary's; doc 19's `window`, `tz`, `panel_id`, `subject`, `prompt_ids`, attribute filters and `aggregation` are `422` | Yes (F7). Panel membership is WP-42; the attribute filters are not in any built read. |
| D8 | The 92 day cap, not doc 19 2.5's 400 days and 25 months | Yes. Same cap as every built AI read, and a full project is 3,600 answers a month. |
| D9 | Series pooling is the summary's (C-11), nothing new | Yes. Same points as the Topics & Prompts page. |
| D10 | `ai.citation_share` reads sources, with the sources flag default | Yes. One number across the Overview and the Sources page (R12). |
| D11 | The top competitor rule and `include=lost_prompts,top_sources` caps | Yes as 2.6. Never name a top competitor that was never named. |
| D12 | New keys `ai.prompts_in_scope` and `ai.valid_answers` | Yes (D-17 default), definitions in 2.5. |
| D13 | `overview/competitors` built for AI; SEO block declared and absent | Yes. SEO share of voice needs the CTR model and volumes (doc 09 section 7), built nowhere. BE-REPORTS-03 closes with its remainder named, as WP-12 closed BE-METRICS-22. Owner: say if SEO SOV is wanted in this wave; it is its own package. |
| D14 | Breakdown dimensions: all eight of doc 19 (`topic`, `intent`, `funnel_stage`, `engine`, `country`, `language`, `persona`, `prompt_type`) | Yes. Five of them are one `prompt_attributes` statement and one reduce function. |

## 3. Files, leases, order

| File | Tasks | Status |
|---|---|---|
| `B/api/ai/metrics_routes.py`, `competitor_routes.py` | 2 (stubs), then 3 to 5 and 6, 7 | owned |
| `B/api/schemas/ai_metrics.py` | 2 only | owned |
| `B/api/ai/metrics.py` (new: registry, mapping, `reduce_cells`, `MetricsService`, `UnknownMetricError`) | 3 to 5 | owned by the brief |
| `B/api/ai/metrics_repository.py` (new: `prompt_attributes`) | 5 | new file, tell the coordinator |
| `B/api/ai/competitors.py` (new: `CompetitorService`), `competitor_repository.py` (new: `entity_refs`, `entity_units`, `lost_counts`, `prompt_cards`, `top_sources`) | 6, 7 | new files, tell the coordinator |
| `BT/api/ai/metrics_support.py` (new helpers) and `test_metrics_contract.py`, `test_metrics_registry.py`, `test_metrics_overview.py`, `test_metrics_value.py`, `test_metrics_series.py`, `test_metrics_breakdown.py`, `test_metrics_reduce.py`, `test_metrics_statements.py`, `test_metrics_cards.py`, `test_metrics_scope.py`; `test_competitors_contract.py`, `test_competitors_core.py`, `test_competitors_top.py`, `test_competitors_lost.py`, `test_competitors_sources.py`, `test_competitors_overview.py`, `test_competitors_statements.py` | one per task | owned (glob) or new support file |
| `BT/api/test_route_access.py` | 2 | the seven `EXPECTED` lines under `# WP-32 overview-aggregates` and `metric` in `PATH_PARAMETERS` under the same anchor: no lease |
| `BT/security/test_cross_tenant.py` | 2 | `QUERIES` and seed entries under the WP-32 anchors: no lease. LEASE L2: the `WORDS` dict (one line, `"metric": "ai.mention_rate"`), which is outside the anchors |
| `docs/16-metrics-methodology.md` section 2.1 | 1a | LEASE L1: two table rows (D-17). WP-33 plan lease L7 asks for the same rows: first one wins, the other rebases (see F9) |
| `docs/ai-visibility/contracts/README.md` | 1b | LEASE L3: two index rows and one `Update` line |
| `docs/ai-visibility/contracts/c8-metrics.md`, `c5-competitors.md` (new) | 1b, 2, 8 | new files |
| `docs/19-api-specification.md`, `docs/29-phase-roadmap.md` | 8 | append-only As built sections, no lease (as WP-12) |
| `backend/openapi/v1.json`, `apps/web/src/lib/api/schema.ts` | 2 only | regeneration, never hand edited |
| `B/api/ai/summary.py`, `summary_repository.py`, `source_repository.py`, `sources.py`, `B/api/schemas/ai.py`, `schemas/metrics.py`, `schemas/entities.py`, `B/domain/ai_engines.py` | never edited | read only; only public names are imported (`SummaryService`, `SummaryQuery`, `entity_cell_ids`, `ENTITY_CELLS_MAX`, `counts_by_prompt`, `topic_names`, `SourceScope`, `role_engine_totals`, `counted_answers`, `citation_bounds`, `unit`, `MetricCell`, `Pooled`, `PointPool`, `NOT_ASKED`, `_NotAsked` as `summary.py` imports it) |
| `B/api/main.py`, `permissions.py`, `problems.py`, `resources.py`, `stubs.py`, `tables.py` | never | not touched; the services are built in the route modules from `Resources.sessions` and `Resources.ai_summary` |

Sequence: tasks 1 to 8 strictly one after another, one implementer at a time. A reviewer of task N may run while the implementer of task N+1 writes tests only (disjoint files); the reviewer's scratch edits stay in a scratch commit never pushed.

## 4. Statement counts (the contract of the statement tests)

Each metric route is the statement count of its summary request plus a fixed number of extra reads, all in one second transaction (one `_SET_SCOPE`, F11). Tests assert differences on `_full_project` (3,600 facts, 150 prompts) after one warm read, never absolute counts, and assert that doubling the data changes nothing. `S(...)` is the summary request the route makes.

| Request | Summary request | Extra statements | Extra reads |
|---|---|---|---|
| `ai/metrics/overview`, `overview/ai` | `S(rows left out, include=total,cells)` | +3 (measured) | transaction scope, `role_engine_totals`, `version_starts` |
| overview with `compare` | same | `compare` +1 (the summary's own), extras unchanged | |
| `{metric}` for `ai.mention_rate`, `ai.citation_rate`, outcomes, `ai.share_of_voice`, `ai.valid_answers`, the recommendation keys | `S(rows=none, include=total)` (`entity_ids`: plus `include=entities`) | +2 (measured) | transaction scope, `version_starts` |
| `{metric}` for the `detail` keys | `S(rows=none, include=total,cells)` | +2 (measured) | transaction scope, `version_starts` |
| `{metric}` for `ai.prompts_in_scope` | `S(rows=none, include=total)` | +2 (measured) | transaction scope, `version_starts` |
| `{metric}` for `ai.citation_share` | `S(rows left out, include=total)` | +3 (measured) | transaction scope, `role_engine_totals`, `version_starts` |
| series | `S(rows=none, include=total,series)` (`entity_ids`: plus `entities`) | +2 (measured) | transaction scope, `version_starts` |
| breakdown `topic` | `S(rows=topics)` | 0 | none |
| breakdown `country` | `S(rows=none, group_by=country)` | 0 | none |
| breakdown `engine` | `S(rows=none, include=total)` | 0 | none |
| breakdown `intent`, `funnel_stage`, `prompt_type`, `language` | `S(rows left out)` | +2 | `prompt_attributes`, transaction scope |
| breakdown `persona` | same | +3 | adds `topic_names` |
| `ai/competitors` | `S(rows left out, include=total,entities)` | +4 (measured) | transaction scope, `entity_refs`, `entity_units`, `version_starts` |
| with `include=lost_prompts` | | +1 more (measured in task 7; the plan had +3) | `lost_counts` (importance joined; valid answers and text come from the summary prompt rows) |
| with `include=top_sources` | | +1 more (measured) | `top_sources` |
| `overview/competitors` | `S(rows=none, include=total,entities)` | +3 (measured; the plan had +2) | transaction scope, `entity_refs`, `version_starts` |

`rows left out` means the `rows` parameter is not set, which builds the prompt rows (and reads the topic rollup and names): it is how the route gets the ids of the prompts in scope (F15). These are design figures until each task measures them; the test is the contract after that.

## 5. Tasks

### Task 1: contract notes and registry keys (docs only, two commits)

Rows: CF-16 (the contract half).

**1a `WP-32: Metric registry keys`.** `git fetch origin`; `git grep -n "ai.prompts_in_scope" origin/develop -- docs/16-metrics-methodology.md`. If found: skip 1a, say so in the report. Else edit `docs/16-metrics-methodology.md` section 2.1 (lease L1): add two rows to the table after the "AI surface presence" row: "Prompts in scope (the prompts counted once, with a valid answer or not; branded prompts only when asked)" key `ai.prompts_in_scope`, and "Valid answers (the valid, current answers; `n_observations` counts every answer, so the difference is the answers that are not valid)" key `ai.valid_answers`. Rebase on conflict and keep the develop side. Push at once, alone: `git fetch origin && git rebase origin/develop && git push origin HEAD:develop`.

**1b `WP-32: Contract notes`.**
- Files (new): `docs/ai-visibility/contracts/c8-metrics.md` (routes 1 to 5) and `c5-competitors.md` (routes 6 and 7); edit `docs/ai-visibility/contracts/README.md` (lease L3: two index rows with owner package WP-32, and the line "14 new routes" counts left as written plus one `Update 2026-11-13 (WP-32)` line naming the seven routes).
- Structure of each note, as `c2-summary.md`: Status (published by WP-32 on 2026-11-13; every route answers `501` after its access checks until built; fields not yet returned are absent), Routes and parameters (the tables of 2.1 and 2.2), Response fields (the models of 2.3 and 2.4 as tables, not code), Error codes (2.7 with the order), Open choices (rows Q1 to Q10 from D1 to D14 grouped, each with choice and why), How the owner package fills it (the steps of tasks 3 to 8), Change log. The Example sections are added in task 2 (the README rule: examples are printed from the Pydantic models, which do not exist yet).
- `c8-metrics.md` also holds: the registry matrix of 2.5; the card read map (below); the statement count table of section 4 (C-13). `c5-competitors.md` holds the tracked set, the member sources and the top competitor rule of 2.6.
- Change log, newest last, one line each, `2026-11-13 WP-32: C-n title: text` (write these lines as is):
  - C8 C-1 scope: the five metric routes take the summary's scope (`from`, `to`, `filter[engine_code_in]`, `include_branded`, `branded_only`, `filter[country_iso]`, `filter[term]`) with its window rules and errors (C2 C-1 and C-2); routes 3, 1 and 2 also take `compare`, `compare_from`, `compare_to`; series and breakdown have no compare; every other doc 19 3.7.9 scope parameter is `422 extra_forbidden`.
  - C8 C-2 one number: each route reads `GET {P}/ai/prompts-summary` once for the same scope and relabels its cells, so a figure is the same here, on the Topics & Prompts page and in a topic row (R12). Cells are `MetricCell` counts mapped to `AiMetricValue`: `numerator`, `denominator`, `n_observations`, `pooled` copied; `n_prompts` is the denominator of a prompt weighted cell.
  - C8 C-3 value model: `AiMetricValue` fields and rules (2.3); optional members absent when unset; `ci` declared and never returned here; `version_boundaries` and `MetricComparison` not declared.
  - C8 C-4 registry: built, suppressed and unbuilt keys (2.5); D-17 keys; `404 unknown_metric` for any key outside doc 16 section 2.1 AI keys; `501` for a known key not built on the route, naming the key.
  - C8 C-5 compare: `previous` is a `MetricCell` for mention, citation, outcomes and share of voice (also per entity), `null` when the engine had no answer of the scope in the compare window, absent without compare and for the keys that do not compare (2.5). `meta.compare_window` and `meta.previous_answers` as C2 C-2.
  - C8 C-6 engine average: equal-weight mean of the engine values, `numerator` the sum, `denominator` the number of engines with a value, `engines` lists them; present with two or more engines with a value; never a pooled value.
  - C8 C-7 overview body: tiles per engine in the order of 2.4; fan-out tiles only on an engine that exposes fan-out; recommendation tile suppressed `not_classified`; `prompts_in_scope`, `last_observed_at`, `last_valid_at` beside `engines`; `overview/ai` is the same body (doc 20 5.2 named `engines=`: superseded by `filter[engine_code_in]`).
  - C8 C-8 series: weekly points of the summary's `total` row with C2 C-10 and C-11 unchanged (pooling in the API); `is_partial` marks a week cut by a window bound or holding today; `entity_ids` gives a series per listed tracked entity; `granularity=day` and `month` are `422` with field code `not_built`.
  - C8 C-9 breakdown: eight dimensions; rows sorted by `prompts` descending then label, at most 300 (`rows_total`, `truncated`); prompts with no value form a row with `dimension.id` null; topic values do not add up to the total (`meta.notes`); values per engine, no averages.
  - C8 C-10 citation share: `numerator` own citation units, `denominator` all citation units of the engine, from the sources read with the sources flag default (`engine_internal` and `unresolved_redirect` left out), so it equals `sources/domains` `meta.by_role` (R12).
  - C8 C-11 not returned: `ci`, `delta`, `MetricComparison`, `version_boundaries`, `granularity` day and month, `vocabulary_id`, `depth`, topic count; each with its owner (2.8).
  - C8 C-12 errors and order: 2.7.
  - C8 C-13 statement counts: section 4 as a table.
  - C8 C-14 card reads: the table below.
  - C5 C-1 rows: tracked set and order (2.6); at most 20; `entity_ids` narrows; foreign or untracked ids are left out and `200`.
  - C5 C-2 members: sources of `mention_rate`, `share_of_voice`, `citation_share`; `previous` only on the first two; recommendation suppressed for every entity.
  - C5 C-3 top competitor: the rule of 2.6 per engine; none when no competitor was named.
  - C5 C-4 lost prompts: `include=lost_prompts`, rule, sort, `lost_limit`; the same prompts `filter[opportunity]=lost_to:<id>` keeps on the summary.
  - C5 C-5 top sources: `include=top_sources`, `sources_limit`, over all engines, sources flag default.
  - C5 C-6 overview competitors: AI half; `seo` and `seo_other_domains` declared and absent (D13).
  - C5 C-7 statement counts: section 4 rows.
  - C5 C-8 errors: 2.7.
- Card read map (BE-METRICS-24), written into C8 C-14 and tested in task 8:

| Card or number (layout catalog key) | Read |
|---|---|
| numbers strip: `ai.prompts_in_scope`, `ai.valid_answers`, mention, citation, named and cited, SOV, own citation share, fan-out presence | `GET {P}/ai/metrics/overview` (or `{P}/overview/ai`) |
| `ai.by_engine`, `ai.outcome_mix`, `ai.answer_funnel`, `ai.sample_coverage` (coverage also needs prompt rows) | the same overview |
| `ai.mention_trend`, `ai.rate_trend_by_engine` (CH-01) | `GET {P}/ai/metrics/ai.mention_rate/series` (also `ai.citation_rate`, `ai.share_of_voice`) |
| `ai.competitor_trend` (CH-06), `ai.sov_over_time` (CH-19) | `GET {P}/ai/metrics/ai.mention_rate/series?entity_ids=` and `.../ai.share_of_voice/series?entity_ids=` |
| `ai.share_of_voice` (CH-02), `ai.competitor_table`, `competitors.share_of_voice`, `competitors.summary` | `GET {P}/ai/competitors` (or `{P}/overview/competitors` for the SOV columns) |
| `ai.lost_to_competitor` (CH-05) | `GET {P}/ai/competitors?include=lost_prompts` |
| `ai.country_breakdown` (CH-23) | `GET {P}/ai/metrics/ai.mention_rate/breakdown?dimension=country` |
| `ai.topic_heatmap` and the topic family, `ai.topic_trends` | the summary (`rows=topics`, `include=series`): unchanged, WP-12; `breakdown?dimension=topic` is the same numbers |
| `ai.co_mentions` | the summary `include=co_mentions` (WP-12) |
| `sources.top_domains`, `sources.own_pages`, `ai.citation_share_by_domain_type`, `sources.new_lost`, `sources.diversity`, `ai.fanout_top` | the sources and fan-out reads (WP-14); categories on rows wait for WP-60 |
| `activity.collection_status`, `ops.answer_calendar`, `ops.answer_status`, `ops.engines`, `ops.ai_spend` | `GET {P}/runs`, `GET {P}/ai/collection/daily`, `GET {P}/engines`, budgets (WP-30, built) |
| `activity.key_changes` | not built: overview changes need STATS-06 (WP-58) |

- Tests: none (docs). Checks: `grep -nP '[^\x00-\x7F]'` on the three files prints nothing; every table row has the same number of cells; every relative link resolves (`ls` the target).
- Commit: 1b alone (1a, when needed, is its own commit pushed earlier). Backup push of the branch after the reviewer's PASS.

### Task 2: schemas, stubs, access, contract tests, regeneration (the contract half of every route row). Two commits. First push.

Rows: CF-16 (contract), the contract half of every route row.

**2a `WP-32: Contract schemas and route stubs`.**
- Files: `B/api/schemas/ai_metrics.py` (every model of 2.3 and 2.4, with FINAL field descriptions; a model name that already exists in the OpenAPI document, such as `LostPrompt` or `CompetitorSource`, is renamed with an `Ai` prefix, and `test_the_api_document_has_the_seven_routes` fails on a duplicate), `B/api/ai/metrics_routes.py` (five stubs), `B/api/ai/competitor_routes.py` (two stubs), `BT/api/test_route_access.py` (anchor lines), `BT/security/test_cross_tenant.py` (QUERIES under the anchor, `WORDS` line under lease L2), `BT/api/ai/test_metrics_contract.py`, `test_competitors_contract.py`, `metrics_support.py`, the two notes (Example sections), `backend/openapi/v1.json`.
- Routes: each stub declares its final parameters (shared dependencies `metric_scope` and `compare_scope` in `metrics_routes.py`, imported by `competitor_routes.py`; `Commas` lists; `EngineCode`; the `granularity` value type is `Annotated[Literal["week"], BeforeValidator(...)]` that refuses `day` and `month` with a `PydanticCustomError("not_built", ...)` as `SummaryGroupBy` does), `@not_built`, body `raise not_built_yet()`, FINAL `summary` and `description` text (describe the built behaviour in the words of 2.3 to 2.6; no sentence about `501`). The path parameter `metric` has `pattern`. The `{metric}` stub is declared after the `overview` stub. Models carry `exclude_if=_absent` on every optional member and `Field(description=...)` on every member.
- Access lines: seven `("GET", ...): "data:read"` entries under `# WP-32 overview-aggregates` in `EXPECTED`; `"metric"` in `PATH_PARAMETERS` under the same anchor with the comment "A registry key (`ai.mention_rate`), a word and not an id, after `{project_id}`."
- Cross tenant: `QUERIES` entries under the WP-32 anchor: `breakdown` `{"dimension": "topic"}`; overview, `{metric}`, `ai/competitors` and `overview/competitors` `{"compare": "previous_period"}`; series `{"filter[country_iso]": "US"}`. Task 7 adds `"include": "lost_prompts,top_sources"` to the `ai/competitors` entry (an `include` value answers `501` until then, and a built route must answer below 300 in the scan). If the `tenants` fixture lacks an entity role, a citation with `role_entity_id` or a competitor mention for the scanned tenant, add the seed under the WP-32 seed anchor so the scan has data to leak.
- Tests first (red because the routes do not exist: `404` or `405`, not import errors), `test_metrics_contract.py` and `test_competitors_contract.py`:
  - `test_every_route_checks_access_in_order` (parametrized over the seven: anonymous `401`, member of another workspace `404`, billing role `403`, viewer with `compare=previous_decade` `422`, viewer valid `501`);
  - `test_an_unknown_query_parameter_is_422` (`window`, `panel_id`, `tz` on each route), `test_compare_is_not_accepted_by_series_and_breakdown`;
  - `test_granularity_day_and_month_are_422_with_the_field_code_not_built`, `test_the_breakdown_needs_a_dimension_of_the_eight`, `test_a_metric_key_of_the_wrong_form_is_422` (`AI.Mention`, 65 characters), `test_entity_ids_over_twenty_are_422`, `test_lost_limit_and_sources_limit_bounds`;
  - `test_the_api_document_has_the_seven_routes` (paths, methods, parameter names, the `dimension` enum of eight, `include` enum of two, `granularity` enum of one, the optional members `previous`, `ci`, `pool`, `lost_prompts`, `top_sources`, `seo`, `seo_other_domains` are not in any `required` list, `AiMetricValue.metric` is), `test_the_metric_models_describe_every_field` (no field without a description, no description with a non-ASCII character);
  - `test_the_examples_in_the_notes_validate_against_the_models` (every json block of `c8-metrics.md` and `c5-competitors.md` is `model_validate`d by the model named in the line above it);
  - `test_the_overview_route_is_declared_before_the_metric_route` (also covered by `test_no_route_is_hidden_by_an_earlier_one`).
- Examples: print one instance of each response model from a throwaway script in the scratchpad (never committed): overview with two engines and `compare`, `{metric}` with an engine average and an entity, series with a pooled point, breakdown by topic, competitors with `lost_prompts` and `top_sources`, overview competitors. Paste them under `## Example` of each note. Ids and numbers made up.
- Regenerate `backend/openapi/v1.json` (`cd backend && uv run python -m idraft.api.openapi > openapi/v1.json`) in this commit.
- Prove it bites: (a) `exclude_if=_absent` removed on `AiMetricValue.ci` or on `AiCompetitorEngine.lost_prompts`: the example validation or the optional-member assertions of `test_the_api_document_has_the_seven_routes` fail; (b) `{metric}` declared before `overview`: `test_no_route_is_hidden_by_an_earlier_one` fails; (c) `WORDS` line removed: `test_a_word_in_a_path_is_never_a_child_and_always_resolves` fails; (d) `@not_built` removed from a stub: the cross-tenant `501` assertions fail.
- Checks: targeted `test_metrics_contract.py`, `test_competitors_contract.py`, `tests/api/test_openapi.py`, `tests/api/test_route_access.py`, `tests/security/test_cross_tenant.py -k "metric or competitors or overview or words or anchors"`; light checks.

**2b `WP-32: Regenerate the web client`.** `cd apps/web && pnpm gen:api` after 2a (delete a generated `apps/web/AGENTS.md` and `CLAUDE.md`). Checks, medium lane: `cd apps/web && pnpm typecheck`; `pnpm vitest run src/lib/api --maxWorkers=2` (`schema.test.ts` freshness). The new types exist: `components["schemas"]["AiOverviewResponse"]` and the six others.

**First push (after task 2 only, then the coordinator is told WP-33 to 37 can mock):** `git fetch origin && git rebase origin/develop` (generated files by regeneration, F14 and 2.9), re-run the targeted checks, `git push origin HEAD:develop`, `infra/dev/wp-status WP-32 building "contract pushed"`. Pushes with 1a (earlier) and the plan commit already on the branch.

### Task 3: overview (CF-16, BE-METRICS-08, BE-REPORTS-01)

- Files: `B/api/ai/metrics.py` (new: `METRICS` registry table keyed by registry key with label, unit, weighting, method, `METHOD_VERSION = 1`; the sets of built, suppressed and unbuilt keys; `from_cell`, `count_value`, `suppressed_value`, `engine_average`; `MetricsService.overview`; `UnknownMetricError`), `B/api/ai/metrics_routes.py` (fill routes 1 and 2: `get_metrics_service` from `Resources.sessions` and `Resources.ai_summary`, remove the two `@not_built` marks and raises), `BT/api/ai/test_metrics_registry.py`, `test_metrics_overview.py`, `test_metrics_statements.py` (new), `metrics_support.py`, `test_metrics_contract.py` (drop the `501` cases of routes 1 and 2). No schema change.
- Query design: `data = await summaries.summary(access, project_id, replace(query, rows=None, include={"total","cells"}, group_by=None, outcome=None, opportunity=None))`; `ids = [row.prompt_id for row in data.prompts]`; one second transaction (`workspace_transaction(sessions, access.workspace_id, user_id=access.user_id)`) runs `source_repository.role_engine_totals(db, SourceScope(workspace_id, project_id, since, until, engine_codes=tuple(shown), prompt_ids=tuple(ids), excluded_flags=EXCLUDED_FLAGS))` where `since, until` come from `instants(first, last, zone)` over `data.window` and `EXCLUDED_FLAGS = ("engine_internal", "unresolved_redirect")` (a test equals it to the sources route default); no read when `ids` or the engines are empty (cells with a null value and zero counts). Tiles are built per engine from `data.total.engines[i]`: Mentioned, Cited, outcomes, Share of voice from the cells and `previous`; `detail` cells for the small ones; fan-out tiles only for `code in exposes_fanout engines` (the `ENGINES` map); `ai.valid_answers` from `mentioned.pooled.trials`; citation share from the role totals (`own` units over the sum of all roles' units); recommendation via `suppressed_value`. `engine_average` over the five keys with two or more engines having a value. `prompts_in_scope` from `total.prompt_count`. Meta from the summary (`window`, `compare_window`, `previous_answers`, `engine_codes`, `entities`, `entity_config_versions`). Route 2 calls the same service method. Time a read on `_full_project`; if it passes 300 ms, switch to `rows=none` plus `summary_repository.summary_prompts` for the ids and record why.
- Tests first (hand numbers from F12, re-derived):
  - registry (pure): `test_the_built_keys_are_the_keys_of_the_note`, `test_no_key_is_built_and_unbuilt_at_once`, `test_a_cell_becomes_a_value_with_its_counts_and_value_is_numerator_over_denominator`, `test_a_count_has_no_denominator`, `test_a_suppressed_value_has_null_value_and_counts_and_a_reason`, `test_an_engine_average_is_the_equal_weight_mean_and_needs_two_engines` (value 0.3 and 0.5 give 0.4 with numerator 0.8 and denominator 2; one engine gives none; an engine with value null is left out), `test_engines_are_never_pooled` (no `pooled` key on an average).
  - overview: `test_the_overview_has_the_tiles_of_the_note_in_order_for_each_engine`, `test_the_overview_numbers_are_the_summary_total_cells` (mention, cited, four outcomes, share of voice equal field by field to `include=total&rows=none` of the same scope), `test_chatgpt_mention_rate_anchor` (value 1.4/3, numerator 1.4, denominator 3, `n_observations` 8, `n_prompts` 3, `pooled` (3, 7)), `test_valid_answers_counts_valid_and_n_observations_every_answer` (7 and 8; Gemini 1 and 1), `test_prompts_in_scope_counts_each_prompt_once` (3; with `include_branded` 4; with `branded_only` 1), `test_an_engine_with_no_answer_has_null_values_and_zero_counts_not_zero_rates` (a third engine enabled), `test_an_engine_without_fanout_has_no_fanout_tile`, `test_recommendation_is_suppressed_not_zero`, `test_citation_share_equals_the_sources_page_by_role_for_the_engine` (own units over `citation_units` of `sources/domains` `meta` with `filter[engine_code_in]` for the same scope, seeded with an own citation, a competitor citation and a flagged one), `test_citation_share_ignores_flagged_citations_like_the_sources_page`, `test_the_small_cells_equal_the_summary_detail_cells`.
  - scope and compare: `test_branded_prompts_are_left_out_by_default_and_counted_when_asked`, `test_the_term_subtree_scopes_every_tile` (tiles and citation share), `test_the_country_and_engine_filters_scope_every_tile`, `test_compare_puts_previous_beside_the_comparable_tiles` (ChatGPT `previous` for Mentioned (1.0, 1, 1) pooled (1, 1) from answer p9; Gemini `previous` null; the window-only tiles have no `previous`), `test_previous_is_absent_without_compare`, `test_meta_has_window_compare_window_previous_answers_entities_and_versions`, `test_last_observed_and_last_valid_are_the_newest_answers`.
  - route 2: `test_overview_ai_answers_the_body_of_the_metrics_overview` (equal JSON), `test_overview_ai_takes_filter_engine_code_in_and_refuses_engines` (`engines=` is `422 extra_forbidden`).
  - safety: `test_another_projects_answers_are_not_counted` (other project and other workspace answered: tiles and citation share unchanged), `test_a_deleted_project_is_not_found`, `test_the_overview_checks_access_before_a_value`.
  - statements (`test_metrics_statements.py`, created here): overview is `S(rows left out, include=total,cells)` plus 3; `compare` adds 1; doubling the prompts changes nothing.
- Prove it bites: (a) citation share given all active prompt ids (branded included): `test_branded_prompts_are_left_out_by_default_and_counted_when_asked` and the term test fail; (b) `project_id` dropped from the `SourceScope`: `test_another_projects_answers_are_not_counted` fails; (c) `ai.valid_answers` numerator from the denominator of the cell: `test_valid_answers_counts_valid_and_n_observations_every_answer` and the anchor fail; (d) `previous` always set: `test_previous_is_absent_without_compare` fails; (e) an engine with no value counted in the average: `test_an_engine_average_is_the_equal_weight_mean_and_needs_two_engines` fails; (f) `EXCLUDED_FLAGS` emptied: `test_citation_share_ignores_flagged_citations_like_the_sources_page` fails; (g) pooled engines (a sum across engines in `engine_average` `pooled`): `test_engines_are_never_pooled` fails.
- Removes: `@not_built` and the raise of routes 1 and 2. Checks: targeted `test_metrics_registry.py`, `test_metrics_overview.py`, `test_metrics_statements.py`, `test_metrics_contract.py`; cross-tenant `-k "metrics/overview or overview/ai"` (both now answer `200` inside the scope); light checks; document check.

### Task 4: metric value and series (BE-METRICS-09, BE-METRICS-10)

- Files: `B/api/ai/metrics.py` (`MetricsService.metric`, `MetricsService.series`, the key resolution `resolve(key, route)` raising `UnknownMetricError` or `not_built_yet`, the per-entity value builders), `B/api/ai/metrics_routes.py` (fill routes 3 and 4), `BT/api/ai/test_metrics_value.py`, `test_metrics_series.py`, `test_metrics_statements.py` (extend), `test_metrics_contract.py` (drop their `501` cases). No schema change.
- Query design: `resolve` runs in the route body, before the service (2.7). `metric`: the summary request is the one the key needs (section 4: `rows=none`, `include=total`, plus `entities` when `entity_ids` is given, plus `cells` for the detail keys; `rows` left out only for `ai.citation_share`, which then runs the overview's role totals read). `ai.prompts_in_scope` is `total.prompt_count` and needs no extra read. Values: one per engine sorted by code, per listed entity in the tracked set's order, then the `engine_average` entries; an outcome key gives four values per engine; a fan-out key skips an engine that does not expose fan-out. `entity_ids` other than `ai.mention_rate` and `ai.share_of_voice` is `RequestValidationError` at `entity_ids`. `series`: `S(rows=none, include=total,series)`, plus `entities` with `entity_ids`; each engine's `total.engines[i].series` (and `series[j].entities[k]` for a listed entity) is mapped point by point: `t = week_start`, cells copied, `n_prompts = point.prompts`, `is_pooled`, `pool`, `pooled` copied, `is_partial = week_start < window.from or week_start + 6 days > window.to`; `AiMetricSeries` per engine and per entity, `method` and `aggregation` from the registry.
- Tests first:
  - value: `test_a_key_gives_one_value_per_engine_and_an_average_with_two` (order: engines by code, then `.engine_average`), `test_the_outcome_mix_has_four_values_per_engine_that_add_up_to_the_whole` (values sum to 1, denominators equal), `test_a_sub_key_of_the_outcome_mix_gives_its_one_value`, `test_share_of_voice_per_entity_equals_the_summary_entity_cells` (own and rival; rival ChatGPT mention rate numerator 0.4, denominator 3, `pooled` (2, 7)), `test_entity_ids_give_values_for_those_entities_in_tracked_order`, `test_entity_ids_are_for_mention_rate_and_share_of_voice_only` (`422` at `entity_ids` for `ai.citation_rate`), `test_an_entity_that_is_not_tracked_is_left_out_and_is_200` (a watched entity, a removed one, another project's), `test_an_unknown_key_is_404_unknown_metric`, `test_a_key_outside_the_ai_registry_is_404` (`seo.top3_count`), `test_a_known_unbuilt_key_is_501_naming_it` (`ai.sentiment`), `test_a_built_key_not_built_for_the_route_is_501` (series of `ai.first_mention_rate`), `test_the_two_new_keys_answer` (`ai.prompts_in_scope` one value without an engine; `ai.valid_answers` per engine), `test_recommendation_is_200_and_suppressed`, `test_the_detail_keys_equal_the_summary_detail_cells`, `test_fanout_keys_leave_out_an_engine_without_fanout`, `test_citation_share_key_equals_the_overview_tile`, `test_compare_on_a_metric` (previous on mention and share of voice, also per entity; absent on the others), `test_a_bad_key_and_a_missing_project_answers_unknown_metric`, `test_a_deleted_project_is_not_found_for_a_known_key`.
  - series: `test_a_series_has_a_point_per_week_oldest_first_for_each_engine`, `test_the_points_are_the_summary_total_points` (numerators, denominators, `n_prompts`, `is_pooled`, `pool.weeks` equal to `include=series&include=total` of the same scope), `test_a_week_with_fewer_than_ten_prompts_is_pooled_and_says_so` (the C2 C-11 case, through the route), `test_the_first_and_last_points_are_partial` (window from a Wednesday to a Tuesday), `test_a_series_per_listed_entity_and_engine` (`entity_ids=rival`: `entity_id` set; the own entity listed too), `test_granularity_week_is_the_default_and_day_is_422_not_built`, `test_series_follows_the_branded_term_country_and_engine_scope`, `test_a_series_key_without_weekly_data_is_501` (outcomes), `test_series_points_are_at_most_fourteen`.
  - statements (measured; the meta names the days each entity configuration took effect, so the second transaction reads `version_starts` too): value routes add +2 over their summary request (`ai.citation_share`: +3); series adds +2, with `entity_ids` still +2 over `S(...,series,entities)`; 0 with no prompt in scope; `compare` on a value route adds the summary's own read (+1, +2 with `entity_ids`); all independent of the data size.
- Prove it bites: (a) the key check after the service: `test_a_bad_key_and_a_missing_project_answers_unknown_metric` fails; (b) `is_pooled` or `pool` dropped from the mapping: `test_the_points_are_the_summary_total_points` fails; (c) `is_partial` off by a day: `test_the_first_and_last_points_are_partial` fails; (d) `entity_ids` read over all entities, own not first: the order test fails; (e) an entity of another project let through: `test_an_entity_that_is_not_tracked_is_left_out_and_is_200` fails; (f) outcome values built with different denominators: the whole-sums test fails.
- Removes: `@not_built` and the raise of routes 3 and 4. Checks: targeted `test_metrics_value.py`, `test_metrics_series.py`, `test_metrics_statements.py`, `test_metrics_overview.py`; cross-tenant `-k metrics`; light checks; document check.

### Task 5: breakdown (BE-METRICS-11)

- Files: `B/api/ai/metrics_repository.py` (new: `prompt_attributes(db, workspace_id, project_id, prompt_ids) -> dict[UUID, PromptAttributes]` one statement: `intent`, `funnel_stage`, `prompt_type`, `language_code`, `persona_term_id`; empty input reads nothing), `B/api/ai/metrics.py` (`reduce_cells`, `MetricsService.breakdown`, `BREAKDOWN_MAX = 300`), `B/api/ai/metrics_routes.py` (fill route 5), `BT/api/ai/test_metrics_reduce.py`, `test_metrics_breakdown.py`, `test_metrics_statements.py` (extend), `test_metrics_contract.py`. No schema change.
- Query design: `reduce_cells(parts, weighting)` turns per-prompt `(numerator, denominator)` pairs of one metric into one `MetricCell` (prompt weighted: the sum of each prompt's `k / n` over prompts with `n > 0` as numerator, their number as denominator, `pooled` the sums; observation weighted: sum over sums) and is the only reduce in the package. `topic`: `S(rows=topics)`; each topic row's cells map straight (sorted by `prompt_count` descending, then name; the untopiced row has `dimension.id` null; `prompts = prompt_count`). `country`: `S(rows=none, group_by=country)`, one row per market; label the ISO code. `engine`: `S(rows=none, include=total)`, one row per engine with that engine's values; label the engine's `label`. `intent`, `funnel_stage`, `prompt_type`, `language`: `S(rows left out, include=cells when the key needs it)`, `prompt_attributes` in the second transaction, prompts grouped by the attribute, each group reduced from its prompt rows' cells (outcomes, Share of voice from `numerator` and `denominator` of the prompt cell, the small cells from `detail`). `persona`: also `summary_repository.topic_names` for the labels; no persona is the null row. Per engine values only, no averages; `meta.rows_total` and `truncated` when over `BREAKDOWN_MAX`; `meta.notes` for `topic`.
- Tests first:
  - pure: `test_reduce_prompt_weights_each_prompt_once` (two prompts with 1 of 2 and 3 of 3: numerator 1.5, denominator 2, `pooled` (4, 5)), `test_reduce_leaves_out_prompts_with_no_valid_answer`, `test_reduce_sums_over_sums_for_share_of_voice`, `test_reduce_over_the_prompts_of_a_topic_equals_the_topic_row` (the consistency guard: the same prompts through the summary's topic row and through `reduce_cells` give equal cells).
  - route: `test_the_topic_breakdown_equals_the_summary_topic_rows`, `test_a_prompt_in_two_topics_counts_in_each_and_the_notes_say_so`, `test_the_prompts_without_a_topic_are_a_row_with_a_null_id`, `test_the_country_breakdown_has_a_row_per_market_of_the_prompts`, `test_the_engine_breakdown_is_a_row_per_engine`, `test_the_intent_breakdown_groups_by_intent_and_equals_a_hand_reduce` (set intents by SQL: two intents over the seeded prompts; numbers worked by hand from F12), `test_funnel_stage_prompt_type_and_language_group_the_same_way`, `test_every_prompt_is_in_exactly_one_row_of_a_single_valued_dimension` (the `prompts` of the intent rows add up to `ai.prompts_in_scope`), `test_the_persona_breakdown_labels_the_term_and_has_a_null_row`, `test_an_unbuilt_key_is_501_for_a_breakdown` (`ai.citation_share`, `ai.valid_answers`), `test_the_dimension_value_must_be_one_of_the_eight` (`422`), `test_breakdown_rows_stop_at_the_cap_and_say_so` (monkeypatch `BREAKDOWN_MAX` to 2 with three topics: `truncated` true, `rows_total` 3), `test_a_breakdown_follows_the_branded_term_country_and_engine_scope`, `test_the_prompt_attributes_read_stays_in_the_project` (the repository function given another project's prompt id returns nothing), `test_another_projects_answers_are_not_counted_in_any_dimension`.
  - statements: topic, country and engine 0 over their summary request; attribute dimensions +2; persona +3.
- Prove it bites: (a) `prompt_attributes` without `project_id` or `workspace_id`: the project test fails; (b) groups built over all active prompts rather than the summary's prompt rows: `test_a_breakdown_follows_the_branded_term_country_and_engine_scope` fails; (c) a prompt weighted metric reduced as sums over sums: `test_reduce_prompt_weights_each_prompt_once` and the consistency test fail; (d) the null group dropped: `test_the_prompts_without_a_topic_are_a_row_with_a_null_id` and the cover test fail; (e) cap off: the cap test fails.
- Removes: `@not_built` and the raise of route 5. Checks: targeted `test_metrics_reduce.py`, `test_metrics_breakdown.py`, `test_metrics_statements.py`, `test_metrics_value.py`; cross-tenant `-k metrics`; light checks; document check. After task 5 all five metric routes are built: the second push to develop (tasks 3 to 5) happens here, once the reviewer passes.

### Task 6: the competitors read (BE-COMPETITORS-03; confirms BE-COMPETITORS-01 and 02)

- Files: `B/api/ai/competitor_repository.py` (new: `entity_refs(db, workspace_id, project_id, entity_ids)`: the `EntityRef` data of those ids joined to `project_entities` of this project, with the live role, `color_index`, `entity_type`, one statement; `entity_units(db, scope)`: `(engine_code, role_entity_id) -> citation units`, one statement over `counted_answers(scope)` joined to `ai_citations` with `citation_bounds(scope)` and `unit()`, grouped by engine and `role_entity_id` (null kept: the rows with no entity make up the rest of the engine's units, so one statement gives the entity units and the all-units denominator)), `B/api/ai/competitors.py` (new: `CompetitorService.competitors`, `top_competitors(rows)`, ties rule), `B/api/ai/competitor_routes.py` (fill route 6 without the two `include` values), `BT/api/ai/test_competitors_core.py`, `test_competitors_top.py`, `test_competitors_statements.py`, `test_competitors_contract.py`. No schema change.
- Query design: `data = await summaries.summary(access, project_id, replace(query, rows=None, include={"total","entities"} (plus compare via the query), group_by=None, outcome=None, opportunity=None))`; the entity ids are those of `data.total.engines[i].entities` in order (the first 20 of the tracked set); ids for the scope from the prompt rows; one second transaction runs `entity_refs` and `entity_units` (the same `SourceScope` and `EXCLUDED_FLAGS` as task 3). Rows: the own entities first then competitors by name; `entity_ids` narrows (an id outside the set is left out). `AiCompetitorEngine` per engine shown: `mention_rate` and `share_of_voice` from the entity cells with `entity_id` and `previous`; `citation_share` from the units; `recommendation_rate` via `suppressed_value`; `is_top_competitor` from `top_competitors` (pure, tested alone). `lost_prompts` and `top_sources` stay absent (`include` accepted, built in task 7: until then the route answers `501` for `include`, named, so a client cannot mistake an unbuilt block for an empty one).
- Tests first:
  - pure: `test_the_top_competitor_has_the_largest_share_of_voice_numerator`, `test_ties_go_to_the_larger_mention_numerator_then_name_then_id`, `test_the_own_entity_is_never_the_top_competitor`, `test_no_top_competitor_when_no_competitor_has_a_numerator_above_zero`.
  - route: `test_the_rows_are_the_tracked_entities_of_the_project_own_first` (equals `meta.entities` order; a watched entity, an entity with `track_ai` false and a removed role are not rows; confirms BE-COMPETITORS-01 beside `test_roles_are_listed_own_then_competitors_then_watched_each_by_name`), `test_each_entity_has_a_row_per_engine_with_the_four_metrics`, `test_mention_rate_and_share_of_voice_are_the_summary_entity_cells` (equal to `include=entities&include=total` of the same scope; rival ChatGPT mention rate numerator 0.4, denominator 3, `pooled` (2, 7); confirms BE-COMPETITORS-02 beside `test_entity_cells_split_each_answer_among_the_entities_it_names`), `test_the_share_of_voice_of_the_tracked_entities_adds_up_to_the_whole_on_an_engine` (sum of `numerator` over rows over a common denominator), `test_citation_share_is_the_entity_units_over_all_units_of_the_engine` (seed three citations: own, rival, third party: 1 of 3 each side), `test_the_own_citation_share_equals_the_overview_tile`, `test_flagged_citations_are_left_out_of_every_unit`, `test_recommendation_is_suppressed_for_every_entity`, `test_previous_is_on_mention_rate_and_share_of_voice_only`, `test_the_top_competitor_flag_is_per_engine` (rival on ChatGPT; none on an engine where nobody was named), `test_entity_ids_narrow_the_rows_and_a_foreign_id_is_left_out_and_is_200`, `test_at_most_twenty_entities_own_first`, `test_branded_prompts_are_left_out_by_default_and_counted_when_asked`, `test_the_term_subtree_and_the_country_filter_scope_every_member`, `test_another_projects_citations_are_not_counted` (seed a citation of another project of the workspace with the same `role_entity_id`), `test_another_workspaces_entity_is_not_a_row`, `test_a_deleted_project_is_not_found`, `test_include_is_501_until_task_7` (removed in task 7).
  - statements: `ai/competitors` is `S(rows left out, include=total,entities)` plus 4.
- Prove it bites: (a) `project_id` dropped from `entity_units` (or `citation_bounds` skipped): `test_another_projects_citations_are_not_counted` fails; (b) `track_ai` or `removed_at` filter dropped in the rows: the tracked-set test fails; (c) own allowed as top: `test_the_own_entity_is_never_the_top_competitor` fails; (d) top named with a zero numerator: `test_no_top_competitor_when_...` fails; (e) citation share denominator over the entity's own units instead of all units: the 1 of 3 test fails; (f) `previous` given to citation share: `test_previous_is_on_mention_rate_and_share_of_voice_only` fails.
- Removes: `@not_built` and the raise of route 6. Checks: targeted `test_competitors_*.py`, `test_metrics_overview.py`; cross-tenant `-k competitors`; light checks; document check.

### Task 7: lost prompts, top sources, overview competitors (BE-COMPETITORS-05, BE-REPORTS-03)

- Files: `B/api/ai/competitor_repository.py` (add `lost_counts(db, scope)`: `(prompt, engine, entity) -> lost answers` in one statement: the public `source_repository.counted_answers(scope)` (valid, current, not superseded, the workspace, project, window, engines and prompts of the scope, the same answers the summary counts) joined to `ai_observation_facts` on `(observation_id, observed_at, derivation_id)`, keeping `NOT own_mentioned`, a lateral `func.unnest(competitor_mentions).table_valued("entity_id")`, grouped by prompt, engine and entity; the summary's private `_window` is not imported; `prompt_cards(db, workspace_id, project_id, prompt_ids)`: text (current version) and `importance` for the surfaced ids; `top_sources(db, scope, entity_ids, limit)`: per entity the top domains by units, with a `row_number()` window per entity), `B/api/ai/competitors.py` (lost and sources blocks, `CompetitorService.overview`), `B/api/ai/competitor_routes.py` (`include`, `lost_limit`, `sources_limit` live; fill route 7), `BT/security/test_cross_tenant.py` (the `include` value in the `ai/competitors` `QUERIES` entry, under the anchor), `BT/api/ai/test_competitors_lost.py`, `test_competitors_sources.py`, `test_competitors_overview.py`, `test_competitors_statements.py` (extend), `test_competitors_contract.py` (drop the 501 `include` case and route 7's). No schema change.
- Query design: `lost_prompts` (competitors only): `counts_by_prompt` (public) for each prompt's valid and all answers per engine, `lost_counts` for lost answers per competitor, then in Python per (entity, engine): rank by importance descending, lost descending, text, id, cut at `lost_limit`; `prompt_cards` only for the surviving ids; `lost` is a `MetricCell`: `numerator` lost answers, `denominator` valid answers, `n_observations` all answers, `value` null when the denominator is 0 (a prompt with lost answers always has valid answers). `top_sources`: `top_sources` statement. `overview`: `S(rows=none, include=total,entities)`, `entity_refs` in the second transaction; rows with `ai` per engine from the entity cells, `seo` and `seo_other_domains` absent.
- Tests first (hand numbers from F12; rival ChatGPT: providers p4 names the rival alone, p1 names both):
  - lost: `test_a_prompt_where_the_competitor_is_named_and_the_own_brand_is_not_is_lost` (providers, `lost` 1 of 5 valid, `n_observations` 6), `test_a_prompt_naming_both_is_not_lost` (p1 alone: nothing), `test_lost_prompts_follow_the_summary_lost_to_filter` (the prompt ids of the list equal the prompt rows `filter[opportunity]=lost_to:<rival>` keeps on the summary for the same scope and engine: the strong consistency guard), `test_lost_prompts_are_sorted_by_importance_then_lost_answers_then_text` (importance set by SQL), `test_lost_limit_caps_each_entity_and_engine`, `test_a_refusal_is_not_a_lost_answer`, `test_the_own_entity_has_no_lost_prompts`, `test_lost_prompts_follow_branded_term_country_and_engine_scope`, `test_lost_prompts_are_absent_unless_asked`, `test_another_projects_lost_answers_are_not_counted`, `test_a_prompt_card_names_the_current_text`.
  - sources: `test_top_sources_are_the_domains_cited_for_the_entity_by_units`, `test_sources_limit_caps_each_entity`, `test_top_sources_are_absent_unless_asked`, `test_top_sources_leave_out_flagged_citations`, `test_another_projects_citations_are_not_top_sources`, `test_top_sources_follow_branded_and_term_scope`.
  - overview competitors: `test_one_row_per_tracked_entity_with_share_of_voice_and_mention_per_engine`, `test_the_values_equal_the_ai_competitors_read`, `test_the_seo_block_is_absent`, `test_overview_competitors_follow_scope_and_compare`, `test_overview_competitors_has_no_lost_prompts_and_no_sources`, `test_another_projects_answers_are_not_counted`, `test_a_deleted_project_is_not_found`.
  - statements (measured in task 7, see c5 C-19): `include=lost_prompts` adds 1, `include=top_sources` adds 1, both add 2 over the plain competitors read; overview competitors is `S(rows=none, include=total,entities)` plus 3.
- Prove it bites: (a) `lost_counts` over `own_mentioned` instead of `NOT own_mentioned`: `test_a_prompt_naming_both_is_not_lost` and the summary filter test fail; (b) `project_id` dropped from `lost_counts` or `top_sources`: the other-project tests fail; (c) the sort key importance ascending: the sort test fails; (d) `is_valid` dropped: `test_a_refusal_is_not_a_lost_answer` fails; (e) the cap per entity only (not per engine): `test_lost_limit_caps_each_entity_and_engine` fails; (f) a flag filter dropped from `top_sources`: the flagged test fails; (g) `seo` filled with a placeholder: `test_the_seo_block_is_absent` fails.
- Removes: `@not_built` and the raise of route 7; the `include` refusal of task 6. Checks: targeted `test_competitors_*.py`; cross-tenant `-k "competitors or overview"`; light checks; document check.

### Task 8: card reads, scope guards, As built, final checks, push (BE-METRICS-24; confirms the rest)

- Files: `BT/api/ai/test_metrics_cards.py`, `test_metrics_scope.py`, `test_metrics_statements.py` and `test_competitors_statements.py` (final form), `docs/ai-visibility/contracts/c8-metrics.md` and `c5-competitors.md` (status "built by WP-32", final change log lines for what changed while building, answered Q rows, the measured payload sizes and timings), `docs/19-api-specification.md` (append "As built (AI visibility WP-32, 2026-11-13): overview aggregates and competitors": the seven routes, the rules C-1 to C-14, the statement table, the not built list of 2.8, the `unknown_metric` code; replace nothing above it), `docs/29-phase-roadmap.md` (one As built paragraph).
- Tests first: `test_every_overview_card_has_a_read_that_answers_with_the_fields_it_needs` (parametrized over `CARD_READS`, a table in the test: card key, request, the members the card reads; each answers `200` on the seeded world and has them; the keys are the Overview card keys of the note's table), `test_the_card_read_table_of_the_note_is_the_test_table` (the note's table parses to the same keys and requests), `test_a_card_with_no_read_is_named_in_the_note_as_not_built` (key changes); `test_branded_prompts_are_left_out_of_every_route_by_default` (all seven, branded answers seeded: bodies equal the same request over a world without them), `test_the_term_subtree_scopes_every_route`, `test_another_projects_and_workspaces_answers_are_not_counted_on_every_route`, `test_a_foreign_or_deleted_project_is_not_found_on_every_route` (404, never `200` with empty data), `test_error_order_is_401_404_403_422_then_the_service` (no `501` left on a built key; `501` only for the named unbuilt keys), `test_every_optional_block_is_absent_unless_asked` (`previous`, `lost_prompts`, `top_sources`, `pool`, `ci`, `seo`), `test_every_statement_count_in_the_note_holds` (reads the two count tables of the notes and compares them to the measured deltas), `test_the_published_document_is_unchanged_since_the_contract_push` (the document check as a test: `build_openapi()` equals the file; also in `test_openapi.py`).
- Steps: (1) `git fetch origin && git rebase origin/develop`; conflicts: generated files by regeneration (2.9), docs 19 and 29 keep both sides (append-only), `test_cross_tenant.py` and `test_route_access.py` keep both anchors. (2) As built notes and the measured figures (payload size and time of overview, series, breakdown and competitors on `_full_project`; the `rows left out` read time of F15). (3) Light checks, targeted tests of every `test_metrics_*.py`, `test_competitors_*.py`, `tests/api/test_openapi.py`, `tests/api/test_route_access.py`, `tests/security/test_cross_tenant.py`, then web `pnpm typecheck` and `pnpm vitest run src/lib/api src/mocks --maxWorkers=2` (medium lane). (4) The full backend check, once, heavy lane, gate pause OFF, memory free at least 40 percent, load5 at most 14:

```bash
infra/dev/heavy --label wp-32-final -- bash -c 'cd backend && export DOCKER_HOST=unix://$HOME/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock && uv sync --frozen && ./check.sh -n 4'
```

  (5) A second fresh Sonnet reviewer reads the whole diff against the brief's acceptance criteria and the 12 rows (no UI in this package: no page opened). (6) `git push origin HEAD:develop` (fast forward; on rejection rebase and regenerate), `infra/dev/wp-status WP-32 merged "..." --rows 12/12 --tasks 8/8`, delete the backup branch, report to the coordinator with the guard list and failing test names, the decisions D1 to D14, the named remainders of 2.8 and the BE-METRICS-24 remainders.
- Prove it bites (whole package, by the package reviewer in scratch commits never pushed; each must make the named test fail, then be restored):

| Guard | Weakening | Failing test |
|---|---|---|
| Branded exclusion | summary scope or any extra read given all active prompts | `test_branded_prompts_are_left_out_of_every_route_by_default` |
| Term subtree | extra reads (role totals, units, lost, attributes) given every prompt | `test_the_term_subtree_scopes_every_route` |
| Project and workspace keys on new statements | drop `project_id` or `workspace_id` in `entity_units`, `lost_counts`, `top_sources`, `prompt_attributes`, `SourceScope` | `test_another_projects_and_workspaces_answers_are_not_counted_on_every_route` and each task's own test |
| Denominators | valid answers from the wrong cell; `value` 0 for an empty denominator; citation share over the entity's units | the overview anchor, `test_a_suppressed_value_has_null_value_and_counts_and_a_reason`, the 1 of 3 citation test |
| Engines never pooled | a pooled count in `engine_average` | `test_engines_are_never_pooled` |
| One number across pages | `ai.citation_share` from the facts column | `test_citation_share_equals_the_sources_page_by_role_for_the_engine` |
| Absent unless asked | drop `exclude_if=_absent` or build `lost_prompts` always | `test_every_optional_block_is_absent_unless_asked` |
| Fixed statement counts | a loop per prompt, week or entity | the statement tests |
| Unknown vs unbuilt | `404` for an unbuilt key, `501` for an unknown one | `test_a_known_unbuilt_key_is_501_naming_it`, `test_an_unknown_key_is_404_unknown_metric` |
| Error order | the key check before access | `test_error_order_is_401_404_403_422_then_the_service` |
| Top competitor | own allowed, zero numerator named | `test_the_own_entity_is_never_the_top_competitor`, `test_no_top_competitor_when_...` |
| Contract frozen | any description or shape edit after task 2 | the document check, `test_the_published_document_is_unchanged_since_the_contract_push` |

## 6. Rows closed (12 rows, each with its task and proving test)

| Row | Status at start | Task | Proving test |
|---|---|---|---|
| CF-16 | SPEC | 2 (contract), 3 (built) | `test_the_overview_numbers_are_the_summary_total_cells`, `test_the_api_document_has_the_seven_routes` |
| BE-METRICS-08 | NOT BUILT | 3 | `test_the_overview_has_the_tiles_of_the_note_in_order_for_each_engine`, `test_chatgpt_mention_rate_anchor` |
| BE-METRICS-09 | NOT BUILT | 4 | `test_a_key_gives_one_value_per_engine_and_an_average_with_two`, `test_an_unknown_key_is_404_unknown_metric` |
| BE-METRICS-10 | NOT BUILT | 4 | `test_the_points_are_the_summary_total_points`, `test_granularity_week_is_the_default_and_day_is_422_not_built` |
| BE-METRICS-11 | NOT BUILT | 5 | `test_the_topic_breakdown_equals_the_summary_topic_rows`, `test_the_intent_breakdown_groups_by_intent_and_equals_a_hand_reduce` |
| BE-METRICS-24 | PARTIAL | 1 (map), 8 (test) | `test_every_overview_card_has_a_read_that_answers_with_the_fields_it_needs`; remainders named: categories (WP-60), key changes (WP-58) |
| BE-REPORTS-01 | NOT BUILT | 3 | `test_overview_ai_answers_the_body_of_the_metrics_overview` |
| BE-COMPETITORS-01 | BUILT | 6 (confirmed) | `test_the_rows_are_the_tracked_entities_of_the_project_own_first` beside `tests/api/entities/test_project_entities.py::test_roles_are_listed_own_then_competitors_then_watched_each_by_name` |
| BE-COMPETITORS-02 | BUILT | 6 (confirmed) | `test_mention_rate_and_share_of_voice_are_the_summary_entity_cells` beside `tests/api/ai/test_prompts_summary.py::test_entity_cells_split_each_answer_among_the_entities_it_names` |
| BE-COMPETITORS-03 | NOT BUILT | 6 | `test_each_entity_has_a_row_per_engine_with_the_four_metrics`, `test_the_top_competitor_flag_is_per_engine` |
| BE-COMPETITORS-05 | PARTIAL | 7 | `test_lost_prompts_follow_the_summary_lost_to_filter`, `test_lost_prompts_are_sorted_by_importance_then_lost_answers_then_text` |
| BE-REPORTS-03 | NOT BUILT | 7 | `test_one_row_per_tracked_entity_with_share_of_voice_and_mention_per_engine`; remainder named: the SEO half (D13) |

Task 1 and 8 close no row alone (notes, map, As built).

## 7. Pushes and order

Order: 1a (pushed at once) then 1b, 2a, 2b, then the first push (the contract: WP-33 to 37 can mock). Then 3, 4, 5 with a second push after task 5 (the five metric routes built). Then 6, 7, 8 with the final push after task 8. In between, after each reviewed task only `git push origin ai/wp-32-overview-aggregates`. Each develop push is `git fetch origin && git rebase origin/develop`, the targeted checks again, `git push origin HEAD:develop`, and a `wp-status` line (`building` after the plan, `building` after each push, `review` at task 8's second review, `merged` at the end). The plan commit is `WP-32: task plan` and is already on the branch before task 1.

| Task | Commit title | Rows | Develop push |
|---|---|---|---|
| 1 | `WP-32: Metric registry keys` (1a, only if develop lacks the rows), `WP-32: Contract notes` | CF-16 (contract) | 1a at once |
| 2 | `WP-32: Contract schemas and route stubs`, `WP-32: Regenerate the web client` | contract half of all | first push |
| 3 | `WP-32: Overview metrics` | CF-16, BE-METRICS-08, BE-REPORTS-01 | |
| 4 | `WP-32: Metric value and series` | BE-METRICS-09, 10 | |
| 5 | `WP-32: Metric breakdown` | BE-METRICS-11 | second push |
| 6 | `WP-32: Competitors read` | BE-COMPETITORS-01 to 03 | |
| 7 | `WP-32: Lost prompts, top sources and overview competitors` | BE-COMPETITORS-05, BE-REPORTS-03 | |
| 8 | `WP-32: Card reads, scope guards and As built notes` | BE-METRICS-24 | final push |

Estimates: tasks 1 about 40 minutes; 2 about 90; 3 to 7 about 80 to 90 each; 8 about 80 plus the gate wait. If task 2 runs past 90 minutes, cut it at the commit boundary: 2a schemas and examples first, route stubs and access lines as a further commit, then 2b.

## 8. Risks and what is not verified

| # | Item | Plan |
|---|---|---|
| R1 | Two transactions per request (the summary's and the extra reads): not one snapshot. An answer ingested between them can make a citation share denominator differ by one answer from the valid answers beside it. | Accepted and written in the note (C-10). Using `REPEATABLE READ` would need the summary service to take a session: not done, it is not our file. |
| R2 | Calling the summary with the prompt rows built (F15) for routes that need ids costs Python time at 150 prompts and three engines. | Task 3 times it on `_full_project`; over 300 ms, switch those routes to `rows=none` and `summary_repository.summary_prompts` for the ids (the same statement count) and record why. |
| R3 | D-17 rows are wanted by WP-33 (L7) and by this package. | Task 1a checks develop first; whoever pushes second rebases and keeps one copy. Tell the coordinator. |
| R4 | `openapi/v1.json` and `schema.ts` conflict with other packages' regenerations at every rebase. | Regenerate, never merge (2.9). |
| R5 | `lost_counts` gets its scope from `source_repository.counted_answers`, not from the summary's private `_window`. A drift between the two (they were built by two packages) would show as a different lost list from the summary's `lost_to` filter. | `test_lost_prompts_follow_the_summary_lost_to_filter` is the guard. If the two cannot be aligned, ask the coordinator for a lease to make `_window` public (one rename). |
| R6 | The cross-tenant scan may be weak if the `tenants` fixture has no citation with `role_entity_id` or no competitor mention for the new reads. | Task 2 checks the fixture and adds the seed under the WP-32 seed anchor. |
| R7 | Statement counts in section 4 are design figures; the first plain read (9 statements on the summary) was read from the code, not run. | Each task measures; the statement tests are the contract after that. |
| R8 | Hand numbers rest on the `summary` fixture docstring (F12). | The implementer re-derives each from the fixture; where a number differs, the fixture wins and the plan's figure is a typo. |
| R9 | `ai.citation_share` and the small cells (`detail`, facts based) can differ for one scope. Both are labelled in `method`. | The citation share key never reads `detail`; the note says which source each key has. |
| R10 | D13 leaves the SEO half unbuilt: the Overview competitors table card has no SEO columns until a later package. | Declared in the shape (optional), so no second regeneration of the contract when it comes. |

Not verified: nothing here was run (the planner only reads); every statement count, payload size and hand number above is a design figure until its task measures it.
