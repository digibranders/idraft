# C8: AI metric routes (overview, value, series, breakdown)

## Status

Published by WP-32 on 2026-11-13, built by WP-32 on 2026-11-14. Owner package: [WP-32 overview-aggregates](../work-packages/WP-32-overview-aggregates.md)
(MASTER-PLAN 3.6: `api/ai/metrics_routes.py`, `api/ai/metrics.py` and `api/schemas/ai_metrics.py` belong to WP-32).
Plan: [docs/superpowers/plans/2026-11-13-ai-wp-32-overview-aggregates.md](../../superpowers/plans/2026-11-13-ai-wp-32-overview-aggregates.md).

This note is the contract the Overview web packages ([WP-33](../work-packages/WP-33-overview-shell.md) to
[WP-37](../work-packages/WP-37-overview-cards-sources.md)) mock against. Everything below is settled; the
change log at the end holds the rules and the places where this contract differs from docs 16, 19 and 20.
All five routes are built (WP-32, 2026-11-14): each answers its body after the access checks, and a field the
model declares but this package does not return (`ci`, `version_boundaries` and the other members of the change
log C-11) is absent from every response. Before they were built each answered `501 not_implemented` after its
access checks (the stub mechanism of the [README](README.md)); `501` is now answered only for a known registry
key that is not built, or not built for the route (the registry matrix). Every block of the Example section is a
body the Pydantic models write back unchanged (`tests/api/ai/test_metrics_contract.py` validates and re-writes
each one). The rows closed are CF-16, BE-METRICS-08 to 11, BE-METRICS-24 (the card read map, tested by
`tests/api/ai/test_metrics_card_reads.py`) and BE-REPORTS-01. The competitors read is
[c5-competitors.md](c5-competitors.md). The As built notes are in docs 19 and 29.

Every number comes from the prompts summary ([c2-summary.md](c2-summary.md)): each route reads
`GET {P}/ai/prompts-summary` once for the same scope and relabels its cells, so a figure is the same on the
Overview, on the Topics & Prompts page and in a topic row (rule R12 of
[overview-and-charts.md](../inventory/overview-and-charts.md) section 2). The only reads that are not the
summary's are the prompt attributes of the breakdown (which also give the `country` rows), the citation units of
the sources lane (the citation share) and the day each entity configuration first derived an answer
(`version_starts`, in every route's meta).

## Routes and parameters

`{P}` is `/api/v1/workspaces/{workspace_id}/projects/{project_id}`. All routes are `GET`, need `data:read` and
answer `200` on success.

| # | Path | Body | Rows |
|---|---|---|---|
| 1 | `{P}/ai/metrics/overview` | `AiOverviewResponse` | CF-16, BE-METRICS-08 |
| 2 | `{P}/overview/ai` | `AiOverviewResponse`, the same body as 1 | BE-REPORTS-01 |
| 3 | `{P}/ai/metrics/{metric}` | `AiMetricResponse` | BE-METRICS-09 |
| 4 | `{P}/ai/metrics/{metric}/series` | `AiSeriesResponse` | BE-METRICS-10 |
| 5 | `{P}/ai/metrics/{metric}/breakdown` | `AiBreakdownResponse` | BE-METRICS-11 |

Routes 1 and 2 are declared before route 3, so that `overview` is a route and never a metric key. The competitor
routes (`{P}/ai/competitors` and `{P}/overview/competitors`) are in [c5-competitors.md](c5-competitors.md) and take
the same scope and compare parameters.

### Scope parameters (all five routes)

The scope is the summary's, with its meaning and errors.

| Parameter | Type | Bounds | Meaning |
|---|---|---|---|
| `from`, `to` | date | project-local days both included; default the 28 days ending today; at most 92 days | The window. More than 92 days is `422 window_too_large` (carries `limit_days`); `from` after `to` is `422 range_invalid` at `from`; a date outside the calendar is `422 out_of_range`. |
| `filter[engine_code_in]` | list of engine code | `chatgpt_web`, `gemini_web`, `google_ai_mode`; at most 3; comma list or repeated | The engines shown. Default: every engine of the project that is enabled or has an answer in the window. A code outside the three is `422` (these routes are stricter than the summary here: `EngineCode`, as the sources routes). A listed engine that is neither enabled nor answering is left out of `engines` and of `meta.engine_codes`: no data is not an error. |
| `include_branded` | boolean | default `false` | Counts the branded prompts too. |
| `branded_only` | boolean | default `false` | Counts the branded prompts alone; wins over `include_branded`. |
| `filter[country_iso]` | text | `^[A-Z]{2}$` | The prompts of one market (the prompt's, not the answer's location). |
| `filter[term]` | UUID | | The prompts given the term or a term below it. |

### Compare parameters (routes 1, 2 and 3 only)

| Parameter | Type | Bounds | Meaning |
|---|---|---|---|
| `compare` | `none` (default), `previous_period`, `previous_year` | | The window to compare with: as many days just before the window, or the same dates one year earlier (29 February becomes the 28th). |
| `compare_from`, `compare_to` | date | both or neither (one alone is `422` at the missing one); at most 92 days; any position | A compare window of the caller's own. Wins over `compare`. |

The rules are C2 change log C-1 and C-2 unchanged. Routes 4 and 5 have no compare: a series is the time axis,
and a movers view is two reads or WP-58. A previous window drawn over a series (the dashed line of CH-01) is a
second read of the same route with `from` and `to` shifted. Sending `compare`, `compare_from` or `compare_to` to them is
`422 extra_forbidden`.

### Route specific parameters

| Route | Parameter | Type and bounds | Meaning |
|---|---|---|---|
| 3 and 4 | `entity_ids` | comma list of UUID, at most 20 | One value or series per listed tracked entity and engine, in place of the engine's own cells. Only for `ai.mention_rate` and `ai.share_of_voice`; any other key is `422` at `entity_ids`. An id that is not a tracked entity of the project (own or competitor, tracked in AI answers, not removed) is left out and the answer is `200`, never `404`. |
| 4 | `granularity` | `week` (default and the only value) | `day` and `month` are `422` with the field code `not_built` (no card reads them; precedent: `group_by=language`, C2 C-19). |
| 5 | `dimension` | required; `topic`, `intent`, `funnel_stage`, `engine`, `country`, `language`, `persona`, `prompt_type` | What the rows are. |
| 3, 4, 5 | path `{metric}` | `^[a-z][a-z0-9_.]{0,63}$` | A registry key of doc 16 section 2.1 (the matrix below). |

### Parameters that are not accepted

Any other query parameter is `422 extra_forbidden` (the summary's rule). Doc 19 3.7.9 names more, and none is
accepted: `window`, `tz`, `panel_id`, `subject`, `prompt_ids`, `filter[intent_in]`, `filter[funnel_stage_in]`,
`filter[prompt_type_in]`, `filter[location_id]`, `filter[language_code]`, `filter[persona_term_id]`,
`aggregation`, `entity_id`, `engine_codes` and `engines` (doc 20 5.2), and `vocabulary_id` and `depth` of the
breakdown. A client uses `from`, `to` and `filter[engine_code_in]`. Panel membership belongs to WP-42.

## The value model

`AiMetricValue` is doc 16 section 2 `MetricValue` for AI, as a model of its own (it is not a subclass of the SEO
side's `MetricValue`, which carries `n_keywords` and `source`). An optional member is left out of the JSON when
it is not set; the other members are always written, as `null` when they have no value.

| Field | Type | Meaning |
|---|---|---|
| `metric` | text | The registry key; `<key>.engine_average` for an average of engines. |
| `value` | number or null | `numerator / denominator`; null when the denominator is 0 or the metric is suppressed. Never 0 for an empty denominator, never `NaN`. |
| `numerator` | number or null | A count of answers, or the sum of the prompts' rates for a prompt weighted rate. |
| `denominator` | number or null | Answers, or prompts with a valid answer for a prompt weighted rate; for `ai.fanout_mean_queries`, the valid answers that have fan-out queries. Null on `ai.valid_answers` and `ai.prompts_in_scope` (plain counts) and when suppressed. `value = numerator / denominator` holds exactly otherwise. |
| `unit` | `ratio` or `count` | Rates and shares are ratios in 0 to 1. `ai.valid_answers`, `ai.prompts_in_scope` and `ai.fanout_mean_queries` are counts. |
| `n_observations` | integer | Every answer behind the value, valid or not. Two keys carry the engine's valid answers instead: `ai.citation_share` and `ai.recommendation_rate`, so their tiles read lower than the others (8 beside 10 in the overview example). |
| `n_prompts` | integer, optional | Prompt weighted values only: the prompts with a valid answer (equal to `denominator`). |
| `aggregation` | `prompt_weighted` or `observation_weighted`, optional | Absent on counts (`ai.valid_answers`, `ai.prompts_in_scope`) and on the suppressed keys; an engine average has its inputs' weighting. |
| `window` | `{from, to, timezone}` | The response's window. |
| `filters` | object | The resolved scope, nulls written out: `include_branded`, `branded_only`, `country_iso`, `term_id`. |
| `observation_class` | `consumer_ui`, `serp_ai` or `official_api`, optional | Of the one engine. Absent on an average and on `ai.prompts_in_scope`. |
| `engine_code` | text, optional | Set when the value is for exactly one engine. |
| `entity_id` | UUID, optional | Set when the value is about one tracked entity. |
| `engines` | list of engine code, optional | `engine_average` only: the engines averaged. |
| `is_estimate` | boolean | Always `false` here. |
| `method` | text | A short human description. |
| `method_version` | integer | 1 for every key now; a formula change raises it (doc 16 rule 7). |
| `suppressed_reason` | optional | `insufficient_data`, `no_surface`, `not_classified` or `below_min_impressions`. This package returns `not_classified` alone (the recommendation keys). The other three are declared by doc 16 section 2 and never returned here: a rate over a small denominator comes back as its value with its counts, and the web applies the 4 answer floor (R2). |
| `pooled` | `{successes, trials}`, optional | The answers behind a prompt weighted rate: "4 of 8 answers". Absent on share of voice, shares of units and counts. The headline `value` is never `successes / trials` when `pooled` is set: it is the prompt weighted mean (see the breakdown example, 1.4 of 3 prompts beside 3 of 7 answers), so a client shows `value` and uses `pooled` only for the sample size and the interval. |
| `previous` | cell or null, optional | The same value over `meta.compare_window`. See below. |
| `ci` | `{low, high, level, method}`, optional | Declared and never returned here: the interval stays on the client (Wilson, R8) until WP-58. `level` is 0.95; `method` is `wilson`, `bootstrap_cluster` or `normal_fixed_panel` (docs/16 section 2, docs/19 section 2.6). |

Not declared at all, and added later as optional members: `version_boundaries` (WP-38), `MetricComparison` and
`delta` (doc 19 2.6; WP-58; the web computes the detectable change from the counts, R5).

### Mapping from a summary cell

`value`, `numerator`, `denominator`, `n_observations` and `pooled` are copied from the summary's cell.
`n_prompts` is the denominator of a prompt weighted cell. `aggregation` follows the key (matrix below).

An engine with no answer in scope has `value` null and zero counts, never a rate of 0.

Counts: `ai.valid_answers` is `value` = `numerator` = every valid answer in scope (the trials of the engine's
Mentioned cell), `denominator` null, `n_observations` every answer; "7 of 8 answers, 1 not valid" is `value` 7
and `n_observations - value` 1. `ai.prompts_in_scope` is `value` = `numerator` = the prompts counted once whether
they have a valid answer or not, with no engine; its `n_observations` is the answers of all engines shown.

### `previous`

`previous` is a summary cell (`value`, `numerator`, `denominator`, `n_observations`, `pooled`: C2 `MetricCell`),
set beside the current value for the keys that compare (matrix below). It follows C2 C-2:

| Case | What the member is |
|---|---|
| Compare was not asked | Absent. |
| Asked, and the engine had no answer of any status for the scope in the compare window | `null` (no data is not a rate of 0). |
| Asked, answers but none valid | A cell with denominator 0 and `value` null. |
| Asked, answers | A cell. An entity not named in valid answers is 0 of N, a real rate. |

`meta.compare_window` is the window it covers and `meta.previous_answers` the valid answers in scope there
(0 means it has no data). The keys that do not compare have no `previous` at all.

### Engine average

An entry with `metric` suffixed `.engine_average` (doc 19 2.6 rule 5, doc 17 4.4): `numerator` the sum of the
engine values, `denominator` the number of engines that have a value, `value = numerator / denominator`,
`engines` the codes averaged, `n_observations` the sum of the engines', `method` "Equal-weight average of
per-engine values", `aggregation` as its inputs. It has no `engine_code`, no `observation_class`, no `pooled`
and no `previous`. It is present only when two or more engines have a value; an engine whose value is null is
left out of it. Engines are never pooled in any other way, and there is no pooled option. The keys that have an
average are the five of the overview list (below), on routes 1, 2 and 3. With `entity_ids` on route 3 there is
one average entry per listed entity (`entity_id` set).

## Response bodies

### `AiMetricMeta` (every body)

| Field | Type | Meaning |
|---|---|---|
| `window` | `{from, to, timezone}` | The window; project-local days. |
| `compare_window` | same, optional | With a compare window: the days compared with. |
| `previous_answers` | integer, optional | With a compare window: the valid answers in scope there, on the engines shown (C2 C-2). |
| `include_branded`, `branded_only` | boolean | The scope as counted. |
| `engine_codes` | list of engine code | The engines shown, sorted: enabled or answering, after the filter. |
| `entities` | list of `{entity_id, name, role}` | The tracked set share of voice is computed over now (the own brand and the competitors tracked in AI answers; watched entities are not in it) (R9). All of them, as the summary lists them: competitors by name, then the own entities, so read `role` and do not assume the own brand is first. |
| `entity_config_versions` | list of integer | More than one means the entity set changed inside the window and older answers keep their set. |
| `entity_config_changes` | list of `{version, from}`, optional | When more than one version is listed: the project-local day each version first derived an answer (`from`; the earliest `ai.derivations.created_at` under the version, not the day the configuration was edited; it can precede the window), oldest first, so a chart can mark where share of voice changes basis. Left out when the window holds one version. |
| `notes` | list of text | `[]` unless a route has something to say. |

### Overview (routes 1 and 2)

`AiOverviewResponse` is `{data: AiOverview, meta: AiMetricMeta}`.

| Model | Field | Meaning |
|---|---|---|
| `AiOverview` | `engines` | `AiOverviewEngine[]`, one per engine shown, sorted by `engine_code`. |
| | `engine_average` | `AiMetricValue[]`: the five averages below; `[]` under two engines with a value. |
| | `prompts_in_scope` | One `AiMetricValue` (`ai.prompts_in_scope`). |
| | `last_observed_at` | The newest counted answer, any status (the header "AI updated"); null when none. |
| | `last_valid_at` | The newest valid answer; null when none. |
| | `topics_in_scope` | Optional: the topics that have a prompt in scope (the topic rows of the prompts summary without the row of prompts that have no topic): the "in 13 topics" context of the numbers strip. Left out when not known. |
| `AiOverviewEngine` | `engine_code`, `observation_class` | The engine. |
| | `tiles` | `AiMetricValue[]` in the order below. |

Tiles per engine, in this order:

1. `ai.valid_answers`
2. `ai.mention_rate`
3. `ai.citation_rate`
4. `ai.mention_and_citation_rate`
5. `ai.outcome_mix.mentioned_and_cited`
6. `ai.outcome_mix.mentioned_only`
7. `ai.outcome_mix.cited_only`
8. `ai.outcome_mix.neither`
9. `ai.recommendation_rate` (suppressed `not_classified`)
10. `ai.share_of_voice`
11. `ai.citation_share`
12. `ai.citation_rate_given_citations`
13. `ai.first_mention_rate`
14. `ai.fanout_presence_rate` and 15. `ai.fanout_mean_queries`, only on an engine that exposes fan-out
    (today `chatgpt_web`). An engine that does not has no such tile: "not exposed", never 0.

`engine_average` keys, in this order: `ai.mention_rate`, `ai.citation_rate`, `ai.mention_and_citation_rate`,
`ai.share_of_voice`, `ai.citation_share`. Doc 19's tiles A9 (top 3) and A11 (prominence) are not returned: they
need structured extraction (S2, WP-54).

`previous` is on tiles 2 to 8 and 10 (mention, citation, named and cited, the four outcomes, share of voice) when
compare was asked, and nowhere else.

### One metric (route 3)

`AiMetricResponse` is `{data: AiMetricValue[], meta: AiMetricMeta}`: one value per engine, engines sorted by
`engine_code`; with `entity_ids`, one value per listed entity and engine, the entities in the order the tracked
set gives (the own entities first, then competitors by name); then the `engine_average` entries when the key has
them and two engines have a value. `ai.outcome_mix` gives four values per engine
(`ai.outcome_mix.mentioned_and_cited`, `.mentioned_only`, `.cited_only`, `.neither`; they add up to the whole and
share one denominator); a sub key such as `ai.outcome_mix.neither` gives its one value per engine. A fan-out key
leaves out an engine that does not expose fan-out; `ai.prompts_in_scope` is one value with no engine.

### Series (route 4)

`AiSeriesResponse` is `{data: AiMetricSeries[], meta: AiMetricMeta}`: one series per engine, and with
`entity_ids` one per listed entity and engine.

| Model | Field | Meaning |
|---|---|---|
| `AiMetricSeries` | `metric`, `unit`, `aggregation`, `engine_code` | The key, its unit and weighting, and the engine. |
| | `entity_id` | Optional: set on an entity series. |
| | `window`, `filters`, `is_estimate`, `method`, `method_version` | As `AiMetricValue`. |
| | `granularity` | `week`. |
| | `points` | `AiMetricPoint[]`, oldest first, at most 14 (92 days touch at most 14 weeks); a week without answers has counts of 0 and `value` null. |
| `AiMetricPoint` | `t` | The Monday the week starts on, project zone. |
| | `value`, `numerator`, `denominator`, `n_observations` | As the value model; `value` is null when the denominator is 0. |
| | `n_prompts` | The prompts with a valid answer in that week itself, whether the point is pooled or not. |
| | `is_partial` | The week is cut by a window bound (`t` before `window.from`, or the Sunday after `window.to`), or holds today. |
| | `is_pooled` | The cells hold the trailing weeks (C2 C-11), not the week alone. |
| | `pool` | Optional, present exactly when `is_pooled`: `{weeks, window, reason, below_prompts}` (C2 `PointPool`). |
| | `pooled` | Optional: the answers behind a prompt weighted point. Absent on share of voice. |

The points are the weekly points of the summary's `total` row (every prompt in scope as one row), mapped, with C2
C-10 and C-11 unchanged: a point pools the trailing 4 weeks (inside the window, so the first points hold fewer)
when fewer than 10 prompts answered that week (`reason` `few_prompts`, `below_prompts` 10), so a project with
fewer than 10 prompts has every point pooled. Tooltip sentence (C2 C-18): "A weekly point with fewer than 10
prompts answering that week shows the last 4 weeks together (clipped to the window)."

### Breakdown (route 5)

`AiBreakdownResponse` is `{data: AiBreakdownRow[], meta: AiBreakdownMeta}`.

| Model | Field | Meaning |
|---|---|---|
| `AiBreakdownRow` | `dimension` | `{type, id, label}`: the dimension asked for; `id` and `label` are null for the group of prompts with no value. |
| | `prompts` | The prompts of the row. |
| | `values` | `AiMetricValue[]`, one per engine, no averages (`ai.outcome_mix`: four per engine). With `dimension=engine` the row is one engine and `values` holds its value. |
| `AiBreakdownMeta` | the fields of `AiMetricMeta` | |
| | `rows_total` | The rows before the cap. |
| | `truncated` | True when `rows_total` is over 300. |

Dimension ids and labels: `topic` and `persona` have the term id and name; `country` and `language` the code for
both; `engine` the engine code and its label (for example "ChatGPT"); `intent`, `funnel_stage` and `prompt_type`
the stored value for both (the web translates). Rows are sorted by `prompts` descending, then label, at most 300.
Prompts without a value (for example no persona) form one row with `id` and `label` null. A prompt in two topics
counts in each, so topic values do not add up to the total; `meta.notes` then holds "A prompt in two topics
counts in each; topic values do not add up to the total.". The attribute dimensions group the same prompt rows
the summary counts and reduce each group's per-prompt cells with the summary's own rule, so a group of the prompts
of a topic gives that topic's row exactly.

As built (C-29 and C-30): `topic` maps the summary's topic rows; `engine` maps the summary's total row, one row per
engine with the prompts in scope as `prompts` and the one value of that engine in `values` (none for a fan-out key
on an engine that does not expose fan-out: the row is kept with `values` empty); `intent`, `funnel_stage`,
`prompt_type`, `language`, `country` and `persona` group the summary's prompt rows by the attribute of the prompt
(one statement, `prompt_attributes`) and reduce each group with `reduce_cells`. `country` is the prompt's own market,
as the summary's `by_country` (the group of one market equals its `by_country` entry), and a prompt with no market
is a row with `id` null. With no prompt in scope the rows are empty (`rows_total` 0). A key that is not a cell of a
prompt's row (`ai.prompts_in_scope`, `ai.valid_answers`, `ai.citation_share`, the recommendation keys) answers
`501` naming the key and `breakdown`.

## Registry matrix

The keys are doc 16 section 2.1 (the D-17 keys `ai.prompts_in_scope` and `ai.valid_answers` are in its table).
"Weighting" is the summary's `metric_context`: a prompt weighted value is the sum of each prompt's rate over the
prompts with a valid answer (with `pooled` the answers), and share of voice is one answer one weight.

| Key | Weighting | Source | Overview tile | `{metric}` | Series | Breakdown | `entity_ids` | `previous` |
|---|---|---|---|---|---|---|---|---|
| `ai.prompts_in_scope` | count | the prompts in scope | own member | yes (one value, no engine) | 501 | 501 | no | no |
| `ai.valid_answers` | count | the valid answers of the engine | yes | yes | 501 | 501 | no | no (`meta.previous_answers`) |
| `ai.mention_rate` | prompt weighted | Mentioned | yes | yes | yes | yes | yes | yes |
| `ai.citation_rate` | prompt weighted | Cited | yes | yes | yes | yes | no | yes |
| `ai.mention_and_citation_rate` | prompt weighted | outcome mentioned and cited | yes | yes | 501 | yes | no | yes |
| `ai.outcome_mix` and its four `.x` keys | prompt weighted | the four outcomes | yes (four tiles) | yes (four values, add to the whole) | 501 | yes | no | yes |
| `ai.share_of_voice` | observation weighted | share of voice, entity cells | yes | yes | yes | yes | yes | yes |
| `ai.citation_rate_given_citations` | prompt weighted | the small cells (`include=cells`) | yes | yes | 501 | yes | no | no |
| `ai.first_mention_rate` | prompt weighted | the small cells | yes | yes | 501 | yes | no | no |
| `ai.fanout_presence_rate`, `ai.fanout_mean_queries` | prompt weighted, observation weighted | the small cells; an engine without fan-out has no value | yes | yes | 501 | yes | no | no |
| `ai.citation_share` | observation weighted (units) | the sources lane, citation units by role and engine, flagged citations left out | yes | yes | 501 | 501 | no | no |
| `ai.recommendation_rate`, `ai.recommended_given_mentioned` | n/a | none: suppressed `not_classified`, `value`, `numerator` and `denominator` null, `n_observations` the valid answers | recommendation only | yes (suppressed) | 501 | 501 | no | no |

"501" means `501 not_implemented`, `Not built yet: <key> on <route>.`, for a key that is built but not for that
route. Known registry keys that are not built in this package answer `501` naming the key (`Not built yet: <key>.`):
`ai.mention_count_share`, `ai.structured_top3_rate`, `ai.structured_top5_rate`, `ai.ranked_list_presence_rate`,
`ai.structured_rank`, `ai.prominence`, `ai.sentiment` and its four `.x` keys, `ai.competitor_gap`,
`ai.source_share`, `ai.source_diversity`, `ai.surface_presence_rate`, `ai.fanout_keyword_coverage`,
`ai.fanout_own_top10_share`, `ai.flip_rate`, `ai.citation_jaccard_distance`, `ai.within_run_disagreement`. Any other
key, including every `seo.*` and `fp.*` key, is `404 unknown_metric`.

Recommendation is `200` and suppressed, never 0: nothing classifies a recommendation yet (S2, WP-54), so the
Overview "AI by engine" table has its column and shows "not classified".

## Card read map (BE-METRICS-24)

Every card of the Overview has a read. The catalog keys are those of the Overview layout. `{P}` is the project
path and `{W}` is `/api/v1/workspaces/{workspace_id}`. Each request is written as the card sends it, in code
(`GET {P}/...`), so the table is machine readable: `tests/api/ai/test_metrics_card_reads.py` parses it, sends
every request of every row against the seeded world and checks the fields the card shows. A row added here
without a test fails it.

| Card or number (layout catalog key) | Read |
|---|---|
| numbers strip: `ai.prompts_in_scope`, `ai.valid_answers`, mention, citation, named and cited, SOV, own citation share, fan-out presence | `GET {P}/ai/metrics/overview` or `GET {P}/overview/ai` |
| `ai.by_engine`, `ai.outcome_mix`, `ai.answer_funnel`, `ai.sample_coverage` (coverage also needs prompt rows) | `GET {P}/ai/metrics/overview`: the same overview |
| `ai.mention_trend`, `ai.rate_trend_by_engine` (CH-01) | `GET {P}/ai/metrics/ai.mention_rate/series`, and for the rate trend `GET {P}/ai/metrics/ai.citation_rate/series` and `GET {P}/ai/metrics/ai.share_of_voice/series` |
| `ai.competitor_trend` (CH-06), `ai.sov_over_time` (CH-19) | `GET {P}/ai/metrics/ai.mention_rate/series?entity_ids=` and `GET {P}/ai/metrics/ai.share_of_voice/series?entity_ids=` |
| `ai.share_of_voice` (CH-02), `ai.competitor_table`, `competitors.share_of_voice`, `competitors.summary` | `GET {P}/ai/competitors`, or `GET {P}/overview/competitors` for the SOV columns |
| `ai.lost_to_competitor` (CH-05) | `GET {P}/ai/competitors?include=lost_prompts` |
| `ai.country_breakdown` (CH-23) | `GET {P}/ai/metrics/ai.mention_rate/breakdown?dimension=country` |
| `ai.topic_heatmap` and the topic family, `ai.topic_trends` | `GET {P}/ai/prompts-summary?rows=topics&include=series`: unchanged, WP-12; `GET {P}/ai/metrics/ai.mention_rate/breakdown?dimension=topic` is the same numbers |
| `ai.co_mentions` | `GET {P}/ai/prompts-summary?include=co_mentions` (WP-12) |
| `sources.top_domains`, `sources.own_pages`, `ai.citation_share_by_domain_type`, `sources.new_lost`, `sources.diversity`, `ai.fanout_top` | `GET {P}/ai/sources/domains`, `GET {P}/ai/sources/pages`, `GET {P}/ai/sources/changes`, `GET {P}/ai/sources/diversity` and `GET {P}/ai/fanout-queries` (WP-14); categories on rows wait for WP-60 |
| `activity.collection_status`, `ops.answer_calendar`, `ops.answer_status`, `ops.engines`, `ops.ai_spend` | `GET {P}/runs`, `GET {P}/engines` and `GET {W}/budgets/status` (built); `GET {P}/ai/collection/daily` (WP-30: a `501 not_implemented` stub until WP-30 builds it, so the card reads the run list meanwhile) |
| `activity.key_changes` | not built: overview changes need STATS-06 (WP-58) |

## Statement counts

Each metric route costs the statements of the summary request it makes plus a fixed number of extra reads, all in
one second transaction (one scope statement, so extras are "reads + 1"). The tests assert the differences, never
absolute counts, and that doubling the data changes nothing. `S(...)` is the summary request. `rows left out`
means the `rows` parameter is not sent, which builds the prompt rows (and reads the topic rollup and names): it is
how a route gets the ids of the prompts in scope. Routes 1 to 5 are measured (marked "measured" below; the test
is the contract); the competitor rows are in [c5-competitors.md](c5-competitors.md). `compare` adds the summary's own read of the window compared
with (+1), and one more with `entity_ids` (the entities' previous cells, +2 in all); a series has no compare.

| Request | Summary request | Extra statements | Extra reads |
|---|---|---|---|
| `ai/metrics/overview`, `overview/ai` | `S(rows left out, include=total,cells)` | +3 (measured) | transaction scope, `role_engine_totals`, `version_starts` |
| overview with `compare` | same | `compare` +1 (the summary's own), extras unchanged | |
| `{metric}` for `ai.mention_rate`, `ai.citation_rate`, outcomes, `ai.share_of_voice`, `ai.valid_answers`, the recommendation keys | `S(rows=none, include=total)` (`entity_ids`: plus `include=entities`) | +2 (measured) | transaction scope, `version_starts` |
| `{metric}` for the small-cell keys | `S(rows=none, include=total,cells)` | +2 (measured) | transaction scope, `version_starts` |
| `{metric}` for `ai.prompts_in_scope` | `S(rows=none, include=total)` | +2 (measured) | transaction scope, `version_starts` |
| `{metric}` for `ai.citation_share` | `S(rows left out, include=total)` | +3 (measured) | transaction scope, `role_engine_totals`, `version_starts` (the overview's own reads) |
| series | `S(rows=none, include=total,series)` (`entity_ids`: plus `entities`) | +2 (measured) | transaction scope, `version_starts` |
| breakdown `topic` | `S(rows=topics, include=total)` (`include=total,cells` for the small-cell keys) | +2 (measured) | transaction scope, `version_starts` |
| breakdown `engine` | `S(rows=none, include=total)` | +2 (measured) | transaction scope, `version_starts` |
| breakdown `intent`, `funnel_stage`, `prompt_type`, `language`, `country`, `persona` | `S(rows left out, include=total)` | +3 (measured) | transaction scope, `prompt_attributes` (the persona's name is joined), `version_starts` |

The two transactions (the summary's and the extra reads) are not one snapshot: an answer ingested between them
can make a citation share denominator differ by one answer from the valid answers beside it.

`version_starts` is read whatever the data holds (also with a single entity configuration version), so the count
never depends on the data; with no prompt in scope the extra reads are 0. Measured by the reviewer on the full
project (150 prompts, 3,600 answers): the Overview 195 ms, its summary request alone 178 ms.

## Error codes

| Status | Code | When |
|---|---|---|
| 401 | `unauthenticated` | No session. |
| 404 | `not_found` | Not a member of the workspace; a project outside the member's scope; a deleted or unknown project (never `200` with empty data). |
| 403 | `forbidden` | The role lacks `data:read`. |
| 422 | `validation_failed` | A value outside its bounds: `compare=previous_decade`, `dimension=bogus` or missing, `granularity=day` or `month` (field code `not_built`), `entity_ids` over 20 or on a key that does not take it (field code `not_supported`; an empty `entity_ids=` is no `entity_ids`), `{metric}` of the wrong form (`AI.Mention`, over 64 characters), an engine code outside the three, `extra_forbidden` for any other parameter; `from` after `to` (`range_invalid`); `compare_from` or `compare_to` alone; a date outside the calendar (`out_of_range`). |
| 404 | `unknown_metric` | A key outside the AI keys of doc 16 section 2.1 (`seo.top3_count`, `ai.nope`). A request with a bad key and a missing project answers `unknown_metric`: the key is checked in the route body, before any read. |
| 501 | `not_implemented` | A known key not built (`ai.sentiment`) or not built for that route (series of `ai.first_mention_rate`), naming the key. Raised in the route body with the key check, before any read: a deleted project and a known unbuilt key answer `501`, not `404 not_found`. |
| 422 | `window_too_large` | `from` to `to`, or `compare_from` to `compare_to`, over 92 days (carries `limit_days`). |
| 503 | `query_timeout` | The house statement timeout. |

Order, as built: for an authenticated caller `422 extra_forbidden` (an unknown query parameter) comes first of
all, because it is raised in the session dependency (`api/auth/dependencies.py`) before the membership and
permission checks, and says nothing to an anonymous caller. Then 401 (no session), 404 `not_found`, 403, then
the 422 of a value outside its bounds, of a lone `compare_from` or `compare_to`, and of an explicit window
(`from` with `to`, `compare_from` with `compare_to`): `range_invalid` and `window_too_large` are checked with
the other values, so they come before `404 unknown_metric`, which is raised in the route body. The key check
(`resolve()`: `404 unknown_metric` for an unknown key, `501` for a known key not built on the route, `422` at
`entity_ids` for a key that does not take it) reads nothing and runs in the route body before the service, so
`501` for a known unbuilt key comes before the project `404`: a deleted project with `ai.sentiment` answers
`501 not_implemented`, with `ai.nope` `404 unknown_metric`. Then the service (`404 not_found` for a deleted or
unknown project, `422 window_too_large` of a window with `from` or `to` left out, `503`). Not used: `422 engine_not_enabled`
(a listed engine that is neither enabled nor answering is left out of the engines shown: no data is not an
error; a code outside the three engines is `422`, as on the sources routes) and
`422 observation_classes_not_poolable` (no pooling option exists).

## Example

Each example is its own made-up world (ids, names and numbers are not carried from one example to the next,
except that the overview and `ai.share_of_voice` agree). The project's timezone is `Europe/Berlin`, the window is
2026-10-17 to 2026-11-13 (28 days), tracked entities are Acme (own) and Globex (competitor).

### Overview with compare (routes 1 and 2)

```http
GET {P}/ai/metrics/overview?from=2026-10-17&to=2026-11-13&compare=previous_period
```

ChatGPT: 10 answers, 8 valid, 4 prompts. Gemini: 5 answers, 4 valid, 3 of the 4 prompts have a valid answer, and
no answer in the compare window, so its `previous` is null. The fan-out tiles exist for ChatGPT only. The average
entries have no `previous`.

Model: `AiOverviewResponse`.

```json
{
  "data": {
    "engines": [
      {
        "engine_code": "chatgpt_web",
        "observation_class": "consumer_ui",
        "tiles": [
          {"metric": "ai.valid_answers", "value": 8.0, "numerator": 8.0, "denominator": null, "unit": "count", "n_observations": 10, "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "observation_class": "consumer_ui", "engine_code": "chatgpt_web", "is_estimate": false, "method": "Valid, current answers in scope; n_observations counts every answer.", "method_version": 1},
          {"metric": "ai.mention_rate", "value": 0.5, "numerator": 2.0, "denominator": 4.0, "unit": "ratio", "n_observations": 10, "n_prompts": 4, "aggregation": "prompt_weighted", "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "observation_class": "consumer_ui", "engine_code": "chatgpt_web", "is_estimate": false, "method": "Valid answers that name the own brand, prompt weighted.", "method_version": 1, "pooled": {"successes": 4, "trials": 8}, "previous": {"value": 0.375, "numerator": 1.5, "denominator": 4, "n_observations": 9, "pooled": {"successes": 3, "trials": 8}}},
          {"metric": "ai.citation_rate", "value": 0.25, "numerator": 1.0, "denominator": 4.0, "unit": "ratio", "n_observations": 10, "n_prompts": 4, "aggregation": "prompt_weighted", "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "observation_class": "consumer_ui", "engine_code": "chatgpt_web", "is_estimate": false, "method": "Valid answers that cite the own domain, prompt weighted.", "method_version": 1, "pooled": {"successes": 2, "trials": 8}, "previous": {"value": 0.125, "numerator": 0.5, "denominator": 4, "n_observations": 9, "pooled": {"successes": 1, "trials": 8}}},
          {"metric": "ai.mention_and_citation_rate", "value": 0.25, "numerator": 1.0, "denominator": 4.0, "unit": "ratio", "n_observations": 10, "n_prompts": 4, "aggregation": "prompt_weighted", "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "observation_class": "consumer_ui", "engine_code": "chatgpt_web", "is_estimate": false, "method": "Valid answers that name the own brand and cite the own domain, prompt weighted.", "method_version": 1, "pooled": {"successes": 2, "trials": 8}, "previous": {"value": 0.125, "numerator": 0.5, "denominator": 4, "n_observations": 9, "pooled": {"successes": 1, "trials": 8}}},
          {"metric": "ai.outcome_mix.mentioned_and_cited", "value": 0.25, "numerator": 1.0, "denominator": 4.0, "unit": "ratio", "n_observations": 10, "n_prompts": 4, "aggregation": "prompt_weighted", "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "observation_class": "consumer_ui", "engine_code": "chatgpt_web", "is_estimate": false, "method": "Valid answers with this outcome, prompt weighted; the four outcomes add up to the whole.", "method_version": 1, "pooled": {"successes": 2, "trials": 8}, "previous": {"value": 0.125, "numerator": 0.5, "denominator": 4, "n_observations": 9, "pooled": {"successes": 1, "trials": 8}}},
          {"metric": "ai.outcome_mix.mentioned_only", "value": 0.25, "numerator": 1.0, "denominator": 4.0, "unit": "ratio", "n_observations": 10, "n_prompts": 4, "aggregation": "prompt_weighted", "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "observation_class": "consumer_ui", "engine_code": "chatgpt_web", "is_estimate": false, "method": "Valid answers with this outcome, prompt weighted; the four outcomes add up to the whole.", "method_version": 1, "pooled": {"successes": 2, "trials": 8}, "previous": {"value": 0.25, "numerator": 1.0, "denominator": 4, "n_observations": 9, "pooled": {"successes": 2, "trials": 8}}},
          {"metric": "ai.outcome_mix.cited_only", "value": 0.0, "numerator": 0.0, "denominator": 4.0, "unit": "ratio", "n_observations": 10, "n_prompts": 4, "aggregation": "prompt_weighted", "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "observation_class": "consumer_ui", "engine_code": "chatgpt_web", "is_estimate": false, "method": "Valid answers with this outcome, prompt weighted; the four outcomes add up to the whole.", "method_version": 1, "pooled": {"successes": 0, "trials": 8}, "previous": {"value": 0.0, "numerator": 0.0, "denominator": 4, "n_observations": 9, "pooled": {"successes": 0, "trials": 8}}},
          {"metric": "ai.outcome_mix.neither", "value": 0.5, "numerator": 2.0, "denominator": 4.0, "unit": "ratio", "n_observations": 10, "n_prompts": 4, "aggregation": "prompt_weighted", "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "observation_class": "consumer_ui", "engine_code": "chatgpt_web", "is_estimate": false, "method": "Valid answers with this outcome, prompt weighted; the four outcomes add up to the whole.", "method_version": 1, "pooled": {"successes": 4, "trials": 8}, "previous": {"value": 0.625, "numerator": 2.5, "denominator": 4, "n_observations": 9, "pooled": {"successes": 5, "trials": 8}}},
          {"metric": "ai.recommendation_rate", "value": null, "numerator": null, "denominator": null, "unit": "ratio", "n_observations": 8, "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "observation_class": "consumer_ui", "engine_code": "chatgpt_web", "is_estimate": false, "method": "Not classified yet: no answer carries a recommendation label.", "method_version": 1, "suppressed_reason": "not_classified"},
          {"metric": "ai.share_of_voice", "value": 0.5, "numerator": 3.0, "denominator": 6.0, "unit": "ratio", "n_observations": 10, "aggregation": "observation_weighted", "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "observation_class": "consumer_ui", "engine_code": "chatgpt_web", "is_estimate": false, "method": "The own share of the tracked entities each answer names, summed over the answers that name one.", "method_version": 1, "previous": {"value": 0.375, "numerator": 1.5, "denominator": 4, "n_observations": 9, "pooled": null}},
          {"metric": "ai.citation_share", "value": 0.25, "numerator": 6.0, "denominator": 24.0, "unit": "ratio", "n_observations": 8, "aggregation": "observation_weighted", "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "observation_class": "consumer_ui", "engine_code": "chatgpt_web", "is_estimate": false, "method": "Own citation units over all citation units of the engine; each unit is a distinct canonical URL of an answer.", "method_version": 1},
          {"metric": "ai.citation_rate_given_citations", "value": 0.5, "numerator": 1.5, "denominator": 3.0, "unit": "ratio", "n_observations": 10, "n_prompts": 3, "aggregation": "prompt_weighted", "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "observation_class": "consumer_ui", "engine_code": "chatgpt_web", "is_estimate": false, "method": "Valid answers that cite the own domain, of the valid answers with a citation, prompt weighted.", "method_version": 1, "pooled": {"successes": 2, "trials": 4}},
          {"metric": "ai.first_mention_rate", "value": 0.5, "numerator": 1.5, "denominator": 3.0, "unit": "ratio", "n_observations": 10, "n_prompts": 3, "aggregation": "prompt_weighted", "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "observation_class": "consumer_ui", "engine_code": "chatgpt_web", "is_estimate": false, "method": "The own brand named before any other tracked entity, of the valid answers that name it, prompt weighted.", "method_version": 1, "pooled": {"successes": 2, "trials": 4}},
          {"metric": "ai.fanout_presence_rate", "value": 0.75, "numerator": 3.0, "denominator": 4.0, "unit": "ratio", "n_observations": 10, "n_prompts": 4, "aggregation": "prompt_weighted", "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "observation_class": "consumer_ui", "engine_code": "chatgpt_web", "is_estimate": false, "method": "Valid answers with at least one fan-out query, prompt weighted.", "method_version": 1, "pooled": {"successes": 6, "trials": 8}},
          {"metric": "ai.fanout_mean_queries", "value": 3.0, "numerator": 18.0, "denominator": 6.0, "unit": "count", "n_observations": 10, "aggregation": "observation_weighted", "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "observation_class": "consumer_ui", "engine_code": "chatgpt_web", "is_estimate": false, "method": "Fan-out queries per valid answer that has some.", "method_version": 1}
        ]
      },
      {
        "engine_code": "gemini_web",
        "observation_class": "consumer_ui",
        "tiles": [
          {"metric": "ai.valid_answers", "value": 4.0, "numerator": 4.0, "denominator": null, "unit": "count", "n_observations": 5, "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "observation_class": "consumer_ui", "engine_code": "gemini_web", "is_estimate": false, "method": "Valid, current answers in scope; n_observations counts every answer.", "method_version": 1},
          {"metric": "ai.mention_rate", "value": 0.5, "numerator": 1.5, "denominator": 3.0, "unit": "ratio", "n_observations": 5, "n_prompts": 3, "aggregation": "prompt_weighted", "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "observation_class": "consumer_ui", "engine_code": "gemini_web", "is_estimate": false, "method": "Valid answers that name the own brand, prompt weighted.", "method_version": 1, "pooled": {"successes": 2, "trials": 4}, "previous": null},
          {"metric": "ai.citation_rate", "value": 0.5, "numerator": 1.5, "denominator": 3.0, "unit": "ratio", "n_observations": 5, "n_prompts": 3, "aggregation": "prompt_weighted", "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "observation_class": "consumer_ui", "engine_code": "gemini_web", "is_estimate": false, "method": "Valid answers that cite the own domain, prompt weighted.", "method_version": 1, "pooled": {"successes": 2, "trials": 4}, "previous": null},
          {"metric": "ai.mention_and_citation_rate", "value": 0.5, "numerator": 1.5, "denominator": 3.0, "unit": "ratio", "n_observations": 5, "n_prompts": 3, "aggregation": "prompt_weighted", "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "observation_class": "consumer_ui", "engine_code": "gemini_web", "is_estimate": false, "method": "Valid answers that name the own brand and cite the own domain, prompt weighted.", "method_version": 1, "pooled": {"successes": 2, "trials": 4}, "previous": null},
          {"metric": "ai.outcome_mix.mentioned_and_cited", "value": 0.5, "numerator": 1.5, "denominator": 3.0, "unit": "ratio", "n_observations": 5, "n_prompts": 3, "aggregation": "prompt_weighted", "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "observation_class": "consumer_ui", "engine_code": "gemini_web", "is_estimate": false, "method": "Valid answers with this outcome, prompt weighted; the four outcomes add up to the whole.", "method_version": 1, "pooled": {"successes": 2, "trials": 4}, "previous": null},
          {"metric": "ai.outcome_mix.mentioned_only", "value": 0.0, "numerator": 0.0, "denominator": 3.0, "unit": "ratio", "n_observations": 5, "n_prompts": 3, "aggregation": "prompt_weighted", "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "observation_class": "consumer_ui", "engine_code": "gemini_web", "is_estimate": false, "method": "Valid answers with this outcome, prompt weighted; the four outcomes add up to the whole.", "method_version": 1, "pooled": {"successes": 0, "trials": 4}, "previous": null},
          {"metric": "ai.outcome_mix.cited_only", "value": 0.0, "numerator": 0.0, "denominator": 3.0, "unit": "ratio", "n_observations": 5, "n_prompts": 3, "aggregation": "prompt_weighted", "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "observation_class": "consumer_ui", "engine_code": "gemini_web", "is_estimate": false, "method": "Valid answers with this outcome, prompt weighted; the four outcomes add up to the whole.", "method_version": 1, "pooled": {"successes": 0, "trials": 4}, "previous": null},
          {"metric": "ai.outcome_mix.neither", "value": 0.5, "numerator": 1.5, "denominator": 3.0, "unit": "ratio", "n_observations": 5, "n_prompts": 3, "aggregation": "prompt_weighted", "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "observation_class": "consumer_ui", "engine_code": "gemini_web", "is_estimate": false, "method": "Valid answers with this outcome, prompt weighted; the four outcomes add up to the whole.", "method_version": 1, "pooled": {"successes": 2, "trials": 4}, "previous": null},
          {"metric": "ai.recommendation_rate", "value": null, "numerator": null, "denominator": null, "unit": "ratio", "n_observations": 4, "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "observation_class": "consumer_ui", "engine_code": "gemini_web", "is_estimate": false, "method": "Not classified yet: no answer carries a recommendation label.", "method_version": 1, "suppressed_reason": "not_classified"},
          {"metric": "ai.share_of_voice", "value": 0.5, "numerator": 1.5, "denominator": 3.0, "unit": "ratio", "n_observations": 5, "aggregation": "observation_weighted", "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "observation_class": "consumer_ui", "engine_code": "gemini_web", "is_estimate": false, "method": "The own share of the tracked entities each answer names, summed over the answers that name one.", "method_version": 1, "previous": null},
          {"metric": "ai.citation_share", "value": 0.25, "numerator": 3.0, "denominator": 12.0, "unit": "ratio", "n_observations": 4, "aggregation": "observation_weighted", "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "observation_class": "consumer_ui", "engine_code": "gemini_web", "is_estimate": false, "method": "Own citation units over all citation units of the engine; each unit is a distinct canonical URL of an answer.", "method_version": 1},
          {"metric": "ai.citation_rate_given_citations", "value": 0.5, "numerator": 1.5, "denominator": 3.0, "unit": "ratio", "n_observations": 5, "n_prompts": 3, "aggregation": "prompt_weighted", "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "observation_class": "consumer_ui", "engine_code": "gemini_web", "is_estimate": false, "method": "Valid answers that cite the own domain, of the valid answers with a citation, prompt weighted.", "method_version": 1, "pooled": {"successes": 2, "trials": 4}},
          {"metric": "ai.first_mention_rate", "value": 0.25, "numerator": 0.5, "denominator": 2.0, "unit": "ratio", "n_observations": 5, "n_prompts": 2, "aggregation": "prompt_weighted", "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "observation_class": "consumer_ui", "engine_code": "gemini_web", "is_estimate": false, "method": "The own brand named before any other tracked entity, of the valid answers that name it, prompt weighted.", "method_version": 1, "pooled": {"successes": 1, "trials": 2}}
        ]
      }
    ],
    "engine_average": [
      {"metric": "ai.mention_rate.engine_average", "value": 0.5, "numerator": 1.0, "denominator": 2.0, "unit": "ratio", "n_observations": 15, "aggregation": "prompt_weighted", "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "engines": ["chatgpt_web", "gemini_web"], "is_estimate": false, "method": "Equal-weight average of per-engine values.", "method_version": 1},
      {"metric": "ai.citation_rate.engine_average", "value": 0.375, "numerator": 0.75, "denominator": 2.0, "unit": "ratio", "n_observations": 15, "aggregation": "prompt_weighted", "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "engines": ["chatgpt_web", "gemini_web"], "is_estimate": false, "method": "Equal-weight average of per-engine values.", "method_version": 1},
      {"metric": "ai.mention_and_citation_rate.engine_average", "value": 0.375, "numerator": 0.75, "denominator": 2.0, "unit": "ratio", "n_observations": 15, "aggregation": "prompt_weighted", "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "engines": ["chatgpt_web", "gemini_web"], "is_estimate": false, "method": "Equal-weight average of per-engine values.", "method_version": 1},
      {"metric": "ai.share_of_voice.engine_average", "value": 0.5, "numerator": 1.0, "denominator": 2.0, "unit": "ratio", "n_observations": 15, "aggregation": "observation_weighted", "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "engines": ["chatgpt_web", "gemini_web"], "is_estimate": false, "method": "Equal-weight average of per-engine values.", "method_version": 1},
      {"metric": "ai.citation_share.engine_average", "value": 0.25, "numerator": 0.5, "denominator": 2.0, "unit": "ratio", "n_observations": 12, "aggregation": "observation_weighted", "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "engines": ["chatgpt_web", "gemini_web"], "is_estimate": false, "method": "Equal-weight average of per-engine values.", "method_version": 1}
    ],
    "prompts_in_scope": {"metric": "ai.prompts_in_scope", "value": 4.0, "numerator": 4.0, "denominator": null, "unit": "count", "n_observations": 15, "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "is_estimate": false, "method": "Prompts counted once, with a valid answer or not.", "method_version": 1},
    "last_observed_at": "2026-11-12T09:12:44Z",
    "last_valid_at": "2026-11-12T09:12:44Z",
    "topics_in_scope": 3
  },
  "meta": {
    "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"},
    "compare_window": {"from": "2026-09-19", "to": "2026-10-16", "timezone": "Europe/Berlin"},
    "previous_answers": 8,
    "include_branded": false,
    "branded_only": false,
    "engine_codes": ["chatgpt_web", "gemini_web"],
    "entities": [
      {"entity_id": "0000004b-7c1e-4a52-9b3d-00000000004b", "name": "Globex", "role": "competitor"},
      {"entity_id": "0000004a-7c1e-4a52-9b3d-00000000004a", "name": "Acme", "role": "own"}
    ],
    "entity_config_versions": [2, 3],
    "entity_config_changes": [
      {"version": 2, "from": "2026-09-20"},
      {"version": 3, "from": "2026-10-28"}
    ],
    "notes": []
  }
}
```

### One metric, per entity, with compare (route 3)

```http
GET {P}/ai/metrics/ai.share_of_voice?from=2026-10-17&to=2026-11-13&filter[engine_code_in]=chatgpt_web&entity_ids=0000004a-7c1e-4a52-9b3d-00000000004a,0000004b-7c1e-4a52-9b3d-00000000004b&compare=previous_period
```

One value per listed entity on the one engine shown, the own entity first. With one engine there is no average.
Over the answers that name a tracked entity the shares add up to the whole (3.0 and 3.0 of 6).

Model: `AiMetricResponse`.

```json
{
  "data": [
    {"metric": "ai.share_of_voice", "value": 0.5, "numerator": 3.0, "denominator": 6.0, "unit": "ratio", "n_observations": 10, "aggregation": "observation_weighted", "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "observation_class": "consumer_ui", "engine_code": "chatgpt_web", "entity_id": "0000004a-7c1e-4a52-9b3d-00000000004a", "is_estimate": false, "method": "The entity's share of the tracked entities each answer names, summed over the answers that name one.", "method_version": 1, "previous": {"value": 0.375, "numerator": 1.5, "denominator": 4, "n_observations": 9, "pooled": null}},
    {"metric": "ai.share_of_voice", "value": 0.5, "numerator": 3.0, "denominator": 6.0, "unit": "ratio", "n_observations": 10, "aggregation": "observation_weighted", "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "observation_class": "consumer_ui", "engine_code": "chatgpt_web", "entity_id": "0000004b-7c1e-4a52-9b3d-00000000004b", "is_estimate": false, "method": "The entity's share of the tracked entities each answer names, summed over the answers that name one.", "method_version": 1, "previous": {"value": 0.625, "numerator": 2.5, "denominator": 4, "n_observations": 9, "pooled": null}}
  ],
  "meta": {
    "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"},
    "compare_window": {"from": "2026-09-19", "to": "2026-10-16", "timezone": "Europe/Berlin"},
    "previous_answers": 8,
    "include_branded": false,
    "branded_only": false,
    "engine_codes": ["chatgpt_web"],
    "entities": [
      {"entity_id": "0000004b-7c1e-4a52-9b3d-00000000004b", "name": "Globex", "role": "competitor"},
      {"entity_id": "0000004a-7c1e-4a52-9b3d-00000000004a", "name": "Acme", "role": "own"}
    ],
    "entity_config_versions": [3],
    "notes": []
  }
}
```

### Series with pooled points (route 4)

```http
GET {P}/ai/metrics/ai.mention_rate/series?from=2026-10-17&to=2026-11-13&filter[engine_code_in]=chatgpt_web
```

Four prompts, so every point is pooled (fewer than 10 prompts answered that week). The first week starts before
`window.from`; the last holds today (Friday 2026-11-13). `n_prompts` is the prompts that answered in the week
itself; `denominator` is the prompts with a valid answer in the pool. The first points hold fewer than 4 weeks
because a pool never reaches before the window.

Model: `AiSeriesResponse`.

```json
{
  "data": [
    {
      "metric": "ai.mention_rate",
      "unit": "ratio",
      "aggregation": "prompt_weighted",
      "engine_code": "chatgpt_web",
      "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"},
      "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null},
      "is_estimate": false,
      "method": "Valid answers that name the own brand, prompt weighted.",
      "method_version": 1,
      "granularity": "week",
      "points": [
        {"t": "2026-10-12", "value": 0.5, "numerator": 1.0, "denominator": 2.0, "n_observations": 2, "n_prompts": 2, "is_partial": true, "is_pooled": true, "pool": {"weeks": 1, "window": {"from": "2026-10-17", "to": "2026-10-18", "timezone": "Europe/Berlin"}, "reason": "few_prompts", "below_prompts": 10}, "pooled": {"successes": 1, "trials": 2}},
        {"t": "2026-10-19", "value": 0.625, "numerator": 2.5, "denominator": 4.0, "n_observations": 6, "n_prompts": 4, "is_partial": false, "is_pooled": true, "pool": {"weeks": 2, "window": {"from": "2026-10-17", "to": "2026-10-25", "timezone": "Europe/Berlin"}, "reason": "few_prompts", "below_prompts": 10}, "pooled": {"successes": 3, "trials": 6}},
        {"t": "2026-10-26", "value": 0.375, "numerator": 1.5, "denominator": 4.0, "n_observations": 9, "n_prompts": 4, "is_partial": false, "is_pooled": true, "pool": {"weeks": 3, "window": {"from": "2026-10-17", "to": "2026-11-01", "timezone": "Europe/Berlin"}, "reason": "few_prompts", "below_prompts": 10}, "pooled": {"successes": 3, "trials": 9}},
        {"t": "2026-11-02", "value": 0.5, "numerator": 2.0, "denominator": 4.0, "n_observations": 13, "n_prompts": 4, "is_partial": false, "is_pooled": true, "pool": {"weeks": 4, "window": {"from": "2026-10-17", "to": "2026-11-08", "timezone": "Europe/Berlin"}, "reason": "few_prompts", "below_prompts": 10}, "pooled": {"successes": 6, "trials": 12}},
        {"t": "2026-11-09", "value": 0.625, "numerator": 2.5, "denominator": 4.0, "n_observations": 9, "n_prompts": 3, "is_partial": true, "is_pooled": true, "pool": {"weeks": 4, "window": {"from": "2026-10-19", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "reason": "few_prompts", "below_prompts": 10}, "pooled": {"successes": 5, "trials": 8}}
      ]
    }
  ],
  "meta": {
    "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"},
    "include_branded": false,
    "branded_only": false,
    "engine_codes": ["chatgpt_web"],
    "entities": [
      {"entity_id": "0000004b-7c1e-4a52-9b3d-00000000004b", "name": "Globex", "role": "competitor"},
      {"entity_id": "0000004a-7c1e-4a52-9b3d-00000000004a", "name": "Acme", "role": "own"}
    ],
    "entity_config_versions": [3],
    "notes": []
  }
}
```

With `entity_ids`, each listed entity has a series of the same shape with `entity_id` set.

### Breakdown by topic (route 5)

```http
GET {P}/ai/metrics/ai.mention_rate/breakdown?dimension=topic&from=2026-10-17&to=2026-11-13&filter[engine_code_in]=chatgpt_web
```

Rows by `prompts` descending. The last row is the prompts with no topic (`id` and `label` null). The prompt counts add
up to more than the prompts in scope when a prompt has two topics. The first row shows the two weightings
apart: `value` is 1.4 of 3 prompts (the mean of the prompts' rates), while `pooled` says 3 of 7 answers.

Model: `AiBreakdownResponse`.

```json
{
  "data": [
    {
      "dimension": {"type": "topic", "id": "0000005a-7c1e-4a52-9b3d-00000000005a", "label": "CRM software"},
      "prompts": 3,
      "values": [
        {"metric": "ai.mention_rate", "value": 0.4666666666666667, "numerator": 1.4, "denominator": 3.0, "unit": "ratio", "n_observations": 8, "n_prompts": 3, "aggregation": "prompt_weighted", "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "observation_class": "consumer_ui", "engine_code": "chatgpt_web", "is_estimate": false, "method": "Valid answers that name the own brand, prompt weighted.", "method_version": 1, "pooled": {"successes": 3, "trials": 7}}
      ]
    },
    {
      "dimension": {"type": "topic", "id": "0000005b-7c1e-4a52-9b3d-00000000005b", "label": "Pricing"},
      "prompts": 2,
      "values": [
        {"metric": "ai.mention_rate", "value": 0.75, "numerator": 1.5, "denominator": 2.0, "unit": "ratio", "n_observations": 4, "n_prompts": 2, "aggregation": "prompt_weighted", "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "observation_class": "consumer_ui", "engine_code": "chatgpt_web", "is_estimate": false, "method": "Valid answers that name the own brand, prompt weighted.", "method_version": 1, "pooled": {"successes": 3, "trials": 4}}
      ]
    },
    {
      "dimension": {"type": "topic", "id": null, "label": null},
      "prompts": 1,
      "values": [
        {"metric": "ai.mention_rate", "value": 0.0, "numerator": 0.0, "denominator": 1.0, "unit": "ratio", "n_observations": 2, "n_prompts": 1, "aggregation": "prompt_weighted", "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "observation_class": "consumer_ui", "engine_code": "chatgpt_web", "is_estimate": false, "method": "Valid answers that name the own brand, prompt weighted.", "method_version": 1, "pooled": {"successes": 0, "trials": 2}}
      ]
    }
  ],
  "meta": {
    "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"},
    "include_branded": false,
    "branded_only": false,
    "engine_codes": ["chatgpt_web"],
    "entities": [
      {"entity_id": "0000004b-7c1e-4a52-9b3d-00000000004b", "name": "Globex", "role": "competitor"},
      {"entity_id": "0000004a-7c1e-4a52-9b3d-00000000004a", "name": "Acme", "role": "own"}
    ],
    "entity_config_versions": [3],
    "notes": ["A prompt in two topics counts in each; topic values do not add up to the total."],
    "rows_total": 3,
    "truncated": false
  }
}
```

## Open choices

Each row can be tightened by WP-32 through the change log. The rows Q8 to Q10 are in
[c5-competitors.md](c5-competitors.md).

| Q | Question | Choice | Why |
|---|---|---|---|
| Q1 | New aggregation SQL or the summary's cells (D1, D9) | Thin adapters: each route calls the summary once and relabels its cells; series pooling is the summary's (C2 C-11) | One scope implementation, so every Overview number equals the Topics & Prompts number (R12); no new aggregation SQL for overview, value, series and the topic and engine breakdown. The reads that are new are the citation units of the citation share, the prompt attributes of the attribute breakdowns (country included: it is grouped from the prompt rows by the prompt's market, C-30) and `version_starts`. |
| Q2 | Model and comparison shape (D2, D3) | `AiMetricValue` is a model of its own; `previous` beside the current value, no `delta`, no `ci` | `MetricValue` of `schemas/metrics.py` is the SEO side's and shared. The web computes the detectable change from the counts (R5) and the Wilson interval (R8) until WP-58 adds both additively. |
| Q3 | Series granularity (D4) | `week` only; `day` and `month` are `422 not_built` | No card reads them; collection per day is `ai/collection/daily` (WP-30). |
| Q4 | Unknown, unbuilt and suppressed keys; new keys (D5, D12) | Known keys not built answer `501`, unknown keys `404 unknown_metric`, recommendation answers `200` suppressed; `ai.prompts_in_scope` and `ai.valid_answers` are registered (D-17) | Honest and uniform; the Overview "AI by engine" table needs the recommendation column to exist. |
| Q5 | Overview parameter names and the other doc 19 scope (D6, D7) | `overview/ai` is the same body as `ai/metrics/overview` and takes `filter[engine_code_in]`, not `engines=`; the scope parameters are the summary's and doc 19's other ones are `422` | Every built AI read uses `filter[engine_code_in]`; one name, one body. Panel membership is WP-42; the attribute filters are in no built read. |
| Q6 | Window cap and citation share source (D8, D10) | 92 days, not doc 19 2.5's 400 days and 25 months; `ai.citation_share` reads the sources lane with its flag default | Same cap as every built AI read (a full project is 3,600 answers a month); one number across the Overview and the Sources page (R12). |
| Q7 | Breakdown dimensions (D14) | All eight of doc 19 | Six of them (`intent`, `funnel_stage`, `prompt_type`, `language`, `country`, `persona`) are one attribute statement and one reduce function; `topic` and `engine` map the summary's rows. |

## How the owner package fills it

1. Task 2 (schemas): `api/schemas/ai_metrics.py` with every model above and its final field text, the five route
   stubs in `api/ai/metrics_routes.py` (`@not_built`, final parameters and descriptions, `overview` declared before
   `{metric}`), the access lines and the cross-tenant entries (the new path word `metric`), the contract tests, the
   Example blocks printed from the models, `backend/openapi/v1.json`, then `pnpm gen:api` in `apps/web`. First
   push. Nothing after it changes a shape or a text (a later change adds a change log line first and regenerates
   both files in its own commit).
2. Task 3 (overview): `api/ai/metrics.py` with the registry, the mapping and `MetricsService.overview`;
   routes 1 and 2 drop `@not_built`. One summary read, then the sources lane's role totals for citation share.
3. Task 4 (value and series): `resolve(key, route)` in the route body (`404 unknown_metric` and `501` for a key not
   built, both before any read and so before the project `404`); `MetricsService.metric` and `series`; routes 3 and 4 drop `@not_built`.
4. Task 5 (breakdown): `api/ai/metrics_repository.py` (`prompt_attributes`), `reduce_cells`,
   `MetricsService.breakdown`, `BREAKDOWN_MAX = 300`; route 5 drops `@not_built`. Second push: the five routes built.
5. Task 8 (done): the card read test over the map above (`test_metrics_card_reads.py`), the scope guards of all
   seven routes (`test_metrics_scope_guards.py`), the statement table measured, this note's status "built by WP-32",
   the measured payload sizes and timings in the change log (C-31), and the As built paragraphs of docs 19 and 29.
6. House rules: aggregates in the summary's grouped queries with a statement count test, an absent block when it
   was not asked for, branded prompts excluded by default, a foreign or deleted project is `404`.

## Change log

Newest last; one line per change, in the form `date package: change`.

2026-11-13 WP-32: contract published
2026-11-13 WP-32: C-1 scope: the five metric routes take the summary's scope (`from`, `to`, `filter[engine_code_in]`, `include_branded`, `branded_only`, `filter[country_iso]`, `filter[term]`) with its window rules and errors (C2 C-1 and C-2); routes 3, 1 and 2 also take `compare`, `compare_from`, `compare_to`; series and breakdown have no compare; every other doc 19 3.7.9 scope parameter is `422 extra_forbidden`.
2026-11-13 WP-32: C-2 one number: each route reads `GET {P}/ai/prompts-summary` once for the same scope and relabels its cells, so a figure is the same here, on the Topics & Prompts page and in a topic row (R12). Cells are `MetricCell` counts mapped to `AiMetricValue`: `numerator`, `denominator`, `n_observations`, `pooled` copied; `n_prompts` is the denominator of a prompt weighted cell.
2026-11-13 WP-32: C-3 value model: `AiMetricValue` fields and rules (the value model above); optional members absent when unset; `ci` declared and never returned here; `version_boundaries` and `MetricComparison` not declared.
2026-11-13 WP-32: C-4 registry: built, suppressed and unbuilt keys (the registry matrix); D-17 keys; `404 unknown_metric` for any key outside doc 16 section 2.1 AI keys; `501` for a known key not built on the route, naming the key.
2026-11-13 WP-32: C-5 compare: `previous` is a `MetricCell` for mention, citation, outcomes and share of voice (also per entity), `null` when the engine had no answer of the scope in the compare window, absent without compare and for the keys that do not compare (the registry matrix). `meta.compare_window` and `meta.previous_answers` as C2 C-2.
2026-11-13 WP-32: C-6 engine average: equal-weight mean of the engine values, `numerator` the sum, `denominator` the number of engines with a value, `engines` lists them; present with two or more engines with a value; never a pooled value.
2026-11-13 WP-32: C-7 overview body: tiles per engine in the order above; fan-out tiles only on an engine that exposes fan-out; recommendation tile suppressed `not_classified`; `prompts_in_scope`, `last_observed_at`, `last_valid_at` beside `engines`; `overview/ai` is the same body (doc 20 5.2 named `engines=`: superseded by `filter[engine_code_in]`).
2026-11-13 WP-32: C-8 series: weekly points of the summary's `total` row with C2 C-10 and C-11 unchanged (pooling in the API); `is_partial` marks a week cut by a window bound or holding today; `entity_ids` gives a series per listed tracked entity; `granularity=day` and `month` are `422` with field code `not_built`.
2026-11-13 WP-32: C-9 breakdown: eight dimensions; rows sorted by `prompts` descending then label, at most 300 (`rows_total`, `truncated`); prompts with no value form a row with `dimension.id` null; topic values do not add up to the total (`meta.notes`); values per engine, no averages.
2026-11-13 WP-32: C-10 citation share: `numerator` own citation units, `denominator` all citation units of the engine, from the sources read with the sources flag default (`engine_internal` and `unresolved_redirect` left out), so it equals `sources/domains` `meta.by_role` (R12). `n_observations` is the engine's valid answers. It is read in a second transaction after the summary, so it is not one snapshot with the valid answers beside it (a difference of one answer is possible if an answer is ingested between the two).
2026-11-13 WP-32: C-11 not returned: `ci`, `delta`, `MetricComparison`, `version_boundaries`, `granularity` day and month, `vocabulary_id`, `depth`; the topic count is returned as `AiOverview.topics_in_scope` (C-20); each with its owner (WP-58 for `ci`, `delta` and `MetricComparison`; WP-38 for `version_boundaries`; none yet for the rest: they are not in any card read).
2026-11-13 WP-32: C-12 errors and order: the error table above (401, 404 `not_found`, 403, 422, `404 unknown_metric` in the route body, then the service); as built, `extra_forbidden` comes first for an authenticated caller and explicit-window errors come before `unknown_metric` (C-17).
2026-11-13 WP-32: C-13 statement counts: the statement table above. The Overview is measured at its summary request plus 3 (transaction scope, `role_engine_totals`, `version_starts`; `compare` adds the summary's own 1 and nothing else), the same on a 14 answer world and on the full project; `ai.citation_share` on route 3 reuses the same reads, so it is +3 too. The other rows were design figures when this line was written; C-26 and C-29 give their measured counts, and the statement table above holds them.
2026-11-13 WP-32: C-14 card reads: the card read map above (BE-METRICS-24). Remainders named: categories on source rows (WP-60) and `activity.key_changes` (WP-58).
2026-11-13 WP-32: C-15 differences from the specs, written once: doc 19 3.7.9 and 2.6 `MetricComparison` with `delta` and `ci` is replaced by `previous` beside the value (Q2); `granularity` is `week` only against doc 19's day, week and month (Q3); the overview takes `filter[engine_code_in]` against doc 19's `engine_codes` and doc 20 5.2's `engines=` (Q5); the scope has no `window`, `panel_id`, `subject`, `prompt_ids`, attribute filters, `aggregation` or `entity_id`, and no `vocabulary_id` or `depth` (Q5); the cap is 92 days against doc 19 2.5's 400 days and 25 months (Q6); the overview tiles A9 and A11 of doc 19 are not returned (S2, WP-54); `422 engine_not_enabled` and `422 observation_classes_not_poolable` are not used; doc 16 A5 counts a not mentioned answer as not recommended, but nothing classifies a recommendation yet, so the recommendation keys are suppressed `not_classified` rather than a rate that would read 0.
2026-11-13 WP-32: C-16 reading of the contract where the plan was silent: `engine_average` exists only for the five overview keys, on routes 1, 2 and 3, and with `entity_ids` one entry per listed entity; `meta.entities` lists the whole tracked set in the summary's order (competitors by name, then the own entities) while the values and rows follow the cell order (own first); `ai.fanout_mean_queries` has `unit` `count`; the labels of `intent`, `funnel_stage` and `prompt_type` rows equal their ids; `is_partial` is true for a week cut by a window bound and for the week that holds today (the plan's mapping formula names the window bound alone; the field text of the contract wins).
2026-11-13 WP-32: C-17 reading of the contract at the first push: `unit` is the literal `ratio` or `count` (this note wins over the plan's `MetricUnit`, which also lists rank, score, usd and clicks; the S2 keys `ai.structured_rank` and `ai.prominence` will need the type widened, which is one more regeneration of the API document and the web client); `ci` is `{low, high, level, method}` as docs/16 section 2 and docs/19 section 2.6 write it (`level` 0.95; `method` `wilson`, `bootstrap_cluster` or `normal_fixed_panel`), declared and never returned; a window of two explicit dates (`from` with `to`, `compare_from` with `compare_to`) and a lone `compare_from` or `compare_to` are checked with the other values, before `404 unknown_metric`, so `422 window_too_large` and `range_invalid` of an explicit window come first (a window with `from` or `to` left out is checked by the service); for an authenticated caller `422 extra_forbidden` comes before 404 and 403 (it is raised in the session dependency); the Error codes order paragraph says it as built.
2026-11-13 WP-32: C-18 value text: `denominator` is null on `ai.valid_answers`, `ai.prompts_in_scope` and when suppressed, and is the valid answers that have fan-out queries for `ai.fanout_mean_queries`; `n_observations` is the engine's valid answers (not every answer) on `ai.citation_share` and `ai.recommendation_rate`; the point `value` is null when its denominator is 0.
2026-11-13 WP-32: C-19 pooled and value: the headline `value` of a prompt weighted rate is never `pooled.successes / pooled.trials`; it is the mean of the prompts' rates. The breakdown example shows 1.4 of 3 prompts beside 3 of 7 answers.
2026-11-13 WP-32: C-20 `AiOverview.topics_in_scope` (optional integer, absent when not known): the topics that have a prompt in scope, for the "in 13 topics" context of the numbers strip. It replaces "topic count in no card read" of C-11.
2026-11-13 WP-32: C-21 `meta.entity_config_changes` (optional list of `{version, from}`, absent when the window holds one version): the project-local day each entity configuration version first derived an answer (C-25), so share of voice and series can mark where the basis changes (WB-CMP-10, WP-35). `entity_config_versions` is unchanged.
2026-11-13 WP-32: C-22 series compare overlay: a previous window drawn over a series (CH-01, dashed) is a second read of the series route with `from` and `to` shifted; the series routes take no compare parameters.
2026-11-13 WP-32: C-23 engine filter: these routes are stricter than the summary: a code outside `chatgpt_web`, `gemini_web` and `google_ai_mode` is `422` (`EngineCode`, as the sources routes); a listed engine that is neither enabled nor answering is left out of `engines` and `meta.engine_codes`.
2026-11-13 WP-32: C-24 recorded, not built: strip deltas for `ai.citation_share`, `ai.fanout_presence_rate` and the valid answers per engine, and a `previous` on `engine_average`: WP-58, additive later.
2026-11-13 WP-32: C-25 `meta.entity_config_changes[].from` as built: the project-local day of the earliest `ai.derivations.created_at` under the version, that is the day the version first derived an answer, not the day the configuration was edited (nothing stores that moment). It is read in the project's timezone, for every request with a prompt in scope, whatever the number of versions (so the statement count does not depend on the data). `aggregation` of an engine average is its inputs' (the value model table says so as the engine average section does).
2026-11-14 WP-32: C-26 value and series built (routes 3 and 4): measured statements are the summary request plus 2 (transaction scope, `version_starts`: the meta names the day each entity configuration first derived an answer on these routes too, C-21), `ai.citation_share` plus 3; none when no prompt is in scope; the same on 14 answers and on the full project. `compare` adds the summary's own read (+1, and +1 more with `entity_ids`, for the entities' previous cells). The table above had 0 for the value and series rows.
2026-11-14 WP-32: C-27 reading of the contract where the note was silent: with `entity_ids` the values (and series) are per engine in code order and, within an engine, the entities in the summary's cell order (own first), in place of the engine's own cells, then one `engine_average` per entity in that order (value route only); the entity values say "the entity" in `method`; an empty `entity_ids` is no `entity_ids`. A series point is `is_partial` for a week cut by a window bound or holding today in the project's zone. The four `ai.sentiment` sub keys are `positive`, `neutral`, `negative` and `mixed` (doc 19 names them; this note said "four `.x` keys"). The detail of `501` for a key that is built but not for the series route is `Not built yet: <key> on series.`; a known key that is not built is `Not built yet: <key>.`. `entity_ids` on a key that does not take it is `422` at `entity_ids` with code `not_supported`.
2026-11-14 WP-32: C-28 order of the key checks: `resolve()` runs in the route body, before any read, and raises `404 unknown_metric` for an unknown key, `501` naming the key for a known key not built (on the route), and `422` at `entity_ids` for a key that does not take it, in that order. So `501` for a known unbuilt key comes before the project `404 not_found` (a deleted project with `ai.sentiment` answers `501 not_implemented`; with `ai.nope`, `404 unknown_metric`); the service's `404 not_found` follows. An empty `entity_ids=` is no `entity_ids`: `200` with the engines' own values, also on a key that does not take `entity_ids`.
2026-11-14 WP-32: C-29 breakdown built (route 5): measured statements are the summary request plus 2 for `topic` and `engine` (transaction scope, `version_starts`: the meta names the day each entity configuration first derived an answer here too, C-21) and plus 3 for `intent`, `funnel_stage`, `prompt_type`, `language`, `country` and `persona` (transaction scope, `prompt_attributes`, `version_starts`); none when no prompt is in scope; the same on 14 answers and on the full project, with or without a persona. The table above had 0 for `topic`, `country` and `engine`, and 3 for `persona` (`topic_names`): the persona's name is now joined in `prompt_attributes`, so it costs what the other attributes cost. The summary request is `S(rows=topics, include=total)`, `S(rows=none, include=total)` or, for an attribute, `S(rows left out, include=total)`; `include=cells` is added for the small-cell keys.
2026-11-14 WP-32: C-30 reading of the contract where the note was silent: the `country` rows are grouped from the summary's prompt rows by the prompt's market (one reduce for every attribute) rather than read from `by_country`, because the row needs its prompt count and a prompt with no market is a row with `id` null; the market group equals the `by_country` entry (tested). The `engine` row holds the prompts in scope as `prompts`, and is kept with `values` empty for a fan-out key on an engine that does not expose fan-out (not exposed is not 0). With no prompt in scope no row is returned, whatever the dimension. A key built for other routes (`ai.prompts_in_scope`, `ai.valid_answers`, `ai.citation_share`, the two recommendation keys) is `501`, `Not built yet: <key> on breakdown.`, and never `422`. A prompt archived or deleted between the summary read and the attribute read is left out of every group. `reduce_cells` takes the prompts' cells (counts of answers) and a weighting: prompt weighted is the sum of each prompt's rate over the prompts with a valid answer, over their number, `pooled` the answers behind them; observation weighted is the sum over the sum; `n_observations` is every answer of every prompt.
2026-11-14 WP-32: C-31 built, card reads and measures: all five routes are built and the status says so. The card read map (C-14) is written as `GET` requests and tested row by row (`tests/api/ai/test_metrics_card_reads.py` sends every request of every row against the seeded world and checks the members the card draws; a row added to the map without a check fails it). Two corrections to C-14: `GET {P}/ai/collection/daily` is a `501 not_implemented` stub until WP-30 builds it (the map said "built"; the card reads `GET {P}/runs` meanwhile), and the budgets read is `GET {W}/budgets/status`. Q1 and Q7 now name the reads that are new (the country rows come from `prompt_attributes`, six dimensions are attribute groups). Measured on the full project (150 prompts, 3,600 answers; single warm local runs on a loaded Mac, so a guide and not a limit): overview 25,183 B in 151 to 165 ms (with `compare` 25,662 B in 193 to 244 ms), `{metric}` 2,392 B in 31 ms, series 4,619 B in 54 to 57 ms (with `entity_ids` 4,715 B in 62 to 66 ms), breakdown 2,041 to 2,250 B in 32 to 48 ms. The statement counts of the table above are the ones `test_metrics_statements.py` asserts.
