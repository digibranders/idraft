# C2: prompts summary additions (compare, total, rows, co-mentions, filters, country)

## Status

Published by WP-03 on 2026-11-13. Owner package: [WP-12 summary-lane](../work-packages/WP-12-summary-lane.md)
(MASTER-PLAN 3.6: the summary models `EngineSummary`, `MetricCell`, `WeekCells`, `EntityCells` and
`PromptsSummary` belong to WP-12 until it merges; WP-03 extended them additively under plan decision D4).

`GET {P}/ai/prompts-summary` is a built route. Every addition below is an optional parameter that
answers `501 not_implemented` when used, and an optional response field that is absent from every
response until WP-12 builds it. A request without the new parameters, or with `compare=none`,
`include=series`, `include=entities` or both, answers exactly as before.

2026-11-13, WP-12 is building the additions, one task at a time, and every addition still answers
`501 not_implemented` until its task lands (nothing is built yet at this date). The change log at the
end of this note fixes the rules before they are built; where it differs from the tables above (for
example `compare=previous_year`, the extra `include=cells`, the point fields and the pooling of weekly
points), the change log wins. The tables are kept as published, and the Open choices keep their history.

## Routes and parameters

| Method | Path | Permission | Success |
|---|---|---|---|
| GET | `{P}/ai/prompts-summary` | `data:read` | `200 PromptsSummaryResponse` |

Built parameters, unchanged: `from`, `to` (project-local days, default the 28 days ending today, at most
92), `filter[engine_code_in]`, `include_branded`, `branded_only`, `filter[country_iso]`, `filter[term]`,
`include` with `series` and `entities`.

### Added query parameters

| Parameter | Type | Bounds | Meaning |
|---|---|---|---|
| `compare` | `none` (default) or `previous_period` | | `previous_period` adds `previous` cells over as many days just before the window. `501` for `previous_period`. |
| `include` | comma list; new values `total`, `co_mentions` (existing `series`, `entities`) | each value from the four | `total` adds the one-row total; `co_mentions` adds the co-mention counts. `501` for the new values. |
| `rows` | `topics` or `none` | | `topics` leaves the prompt rows out; `none` leaves both row lists (with `include=total`). Left out: every row. `501` when used. |
| `filter[outcome]` | `mentioned_and_cited`, `mentioned_only`, `cited_only` or `neither` | one value | Prompt rows by outcome. `501` when used. |
| `filter[opportunity]` | `named_not_cited`, `cited_not_named`, `nobody_named` or `lost_to:<entity_id>` | pattern `^(named_not_cited\|cited_not_named\|nobody_named\|lost_to:<uuid>)$` | Prompt rows by opportunity. `501` when used. |
| `group_by` | `country` | one value | Adds `by_country`. `501` when used. |

`previous_year` and custom compare windows are not in the contract (`compare=previous_year` is a
`422`); WP-12 adds them through the change log.

### New response fields (all optional, absent until built)

| Model | Field | Type | Meaning |
|---|---|---|---|
| `PromptsSummary` | `compare_window` | `MetricWindow` (`from`, `to`, `timezone`) | With `compare=previous_period`: as many days just before `window`. |
| `PromptsSummary` | `previous_answers` | integer | With `compare`: the valid answers in scope in that window; 0 means it has no data. |
| `PromptsSummary` | `total` | `SummaryTotal` | With `include=total`: every prompt in scope as one row, aggregated as a topic row is. |
| `PromptsSummary` | `co_mentions` | `EngineCoMentions[]` | With `include=co_mentions`: one entry per engine. |
| `PromptsSummary` | `by_country` | `CountrySummary[]` | With `group_by=country`: the engine cells per prompt country. |
| `EngineSummary` | `previous` | `EngineCells` | With `compare`: the same cells over `compare_window`; null when the engine had no answer of the row's prompts there (no data is not a rate of 0). |
| `EntityCells` | `previous` | `EntityPreviousCells` | With `compare`: Mentioned and Share of voice over `compare_window`; null when the entity had no answer there; never set inside a week. |
| `WeekCells` | `entities` | `EntityCells[]` | With `include=series,entities`: the week's cells per tracked entity, at most 20, weighted as the week's own. |

New models:

| Model | Fields |
|---|---|
| `EngineCells` | `mentioned`, `cited`, `outcomes`, `share_of_voice` (the cells of `EngineSummary` without `previous`, `series`, `entities`) |
| `EntityPreviousCells` | `mentioned`, `share_of_voice` (`MetricCell`) |
| `SummaryTotal` | `prompt_count`, `last_observed_at` (nullable), `last_valid_at` (nullable), `engines: EngineSummary[]` |
| `EngineCoMentions` | `engine_code`, `answers` (valid answers in scope on the engine: the denominator), `pairs: CoMentionPair[]` |
| `CoMentionPair` | `a`, `b` (tracked entity ids), `answers` (valid answers in scope that name both) |
| `CountrySummary` | `country_iso`, `engines: EngineSummary[]` |

## Error codes

| Status | Code | When |
|---|---|---|
| 401 | `unauthenticated` | No session. |
| 404 | `not_found` | Not a member of the workspace; a project outside the member's scope; a deleted or unknown project once the route reads it (not for a request that uses an unbuilt addition, which answers `501` first). |
| 403 | `forbidden` | The role lacks `data:read`. |
| 422 | `validation_failed` | A value outside the contract: `compare=previous_year`, `rows=all`, `filter[opportunity]=lost_to:nope`, `group_by=language`, `filter[outcome]=lost`, `include=bogus`; `from` after `to` (field code `range_invalid` at `from`). |
| 422 | `window_too_large` | `from` to `to` over 92 days (built; carries `limit_days`). |
| 501 | `not_implemented` | An addition was used; `detail` is `Not built yet: <names>.` in the order `compare`, `include=total`, `include=co_mentions`, `rows`, `filter[outcome]`, `filter[opportunity]`, `group_by`. |

Order: 401, 404, 403, 422 (values), then the `501` of the addition, before the summary service runs.

## Example

Request: this window against the one before, with the total row and co-mentions, by country, and
neither row list.

```http
GET {P}/ai/prompts-summary?from=2026-10-17&to=2026-11-13&compare=previous_period&include=total,co_mentions&rows=none&group_by=country
```

Other additions: `...&filter[outcome]=neither`, `...&filter[opportunity]=named_not_cited`,
`...&filter[opportunity]=lost_to:0000004b-7c1e-4a52-9b3d-00000000004b`.

`200`:

```json
{
  "data": {
    "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"},
    "compare_window": {"from": "2026-09-19", "to": "2026-10-16", "timezone": "Europe/Berlin"},
    "previous_answers": 40,
    "include_branded": false,
    "branded_only": false,
    "engine_codes": ["chatgpt_web"],
    "metric_context": {
      "mentioned": {
        "metric": "ai.mention_rate",
        "prompt_rows": "observation_weighted",
        "topic_rows": "prompt_weighted",
        "method": "Valid answers, counted as in the built summary."
      },
      "cited": {
        "metric": "ai.citation_rate",
        "prompt_rows": "observation_weighted",
        "topic_rows": "prompt_weighted",
        "method": "Valid answers, counted as in the built summary."
      },
      "outcomes": {
        "metric": "ai.outcome_mix",
        "prompt_rows": "observation_weighted",
        "topic_rows": "prompt_weighted",
        "method": "Valid answers, counted as in the built summary."
      },
      "share_of_voice": {
        "metric": "ai.share_of_voice",
        "prompt_rows": "observation_weighted",
        "topic_rows": "observation_weighted",
        "method": "Valid answers, counted as in the built summary."
      }
    },
    "entities": [
      {"entity_id": "0000004a-7c1e-4a52-9b3d-00000000004a", "name": "Acme", "role": "own"},
      {"entity_id": "0000004b-7c1e-4a52-9b3d-00000000004b", "name": "Globex", "role": "competitor"}
    ],
    "entity_config_versions": [3],
    "prompts": [],
    "topics": [],
    "total": {
      "prompt_count": 87,
      "last_observed_at": "2026-11-10T09:12:44Z",
      "last_valid_at": "2026-11-10T09:12:44Z",
      "engines": [
        {
          "engine_code": "chatgpt_web",
          "mentioned": {"value": 0.5, "numerator": 20.0, "denominator": 40, "n_observations": 40, "pooled": null},
          "cited": {"value": 0.3, "numerator": 12.0, "denominator": 40, "n_observations": 40, "pooled": null},
          "outcomes": {
            "mentioned_and_cited": {"value": 0.2, "numerator": 8.0, "denominator": 40, "n_observations": 40, "pooled": null},
            "mentioned_only": {"value": 0.3, "numerator": 12.0, "denominator": 40, "n_observations": 40, "pooled": null},
            "cited_only": {"value": 0.1, "numerator": 4.0, "denominator": 40, "n_observations": 40, "pooled": null},
            "neither": {"value": 0.4, "numerator": 16.0, "denominator": 40, "n_observations": 40, "pooled": null}
          },
          "share_of_voice": {"value": 0.5, "numerator": 15.0, "denominator": 30, "n_observations": 30, "pooled": null},
          "previous": {
            "mentioned": {"value": 0.4, "numerator": 16.0, "denominator": 40, "n_observations": 40, "pooled": null},
            "cited": {"value": 0.2, "numerator": 8.0, "denominator": 40, "n_observations": 40, "pooled": null},
            "outcomes": {
              "mentioned_and_cited": {"value": 0.15, "numerator": 6.0, "denominator": 40, "n_observations": 40, "pooled": null},
              "mentioned_only": {"value": 0.25, "numerator": 10.0, "denominator": 40, "n_observations": 40, "pooled": null},
              "cited_only": {"value": 0.05, "numerator": 2.0, "denominator": 40, "n_observations": 40, "pooled": null},
              "neither": {"value": 0.55, "numerator": 22.0, "denominator": 40, "n_observations": 40, "pooled": null}
            },
            "share_of_voice": {"value": 0.4, "numerator": 12.0, "denominator": 30, "n_observations": 30, "pooled": null}
          }
        }
      ]
    },
    "co_mentions": [
      {
        "engine_code": "chatgpt_web",
        "answers": 40,
        "pairs": [
          {"a": "0000004a-7c1e-4a52-9b3d-00000000004a", "b": "0000004b-7c1e-4a52-9b3d-00000000004b", "answers": 9}
        ]
      }
    ],
    "by_country": [
      {
        "country_iso": "US",
        "engines": [
          {
            "engine_code": "chatgpt_web",
            "mentioned": {"value": 0.5, "numerator": 20.0, "denominator": 40, "n_observations": 40, "pooled": null},
            "cited": {"value": 0.3, "numerator": 12.0, "denominator": 40, "n_observations": 40, "pooled": null},
            "outcomes": {
              "mentioned_and_cited": {"value": 0.2, "numerator": 8.0, "denominator": 40, "n_observations": 40, "pooled": null},
              "mentioned_only": {"value": 0.3, "numerator": 12.0, "denominator": 40, "n_observations": 40, "pooled": null},
              "cited_only": {"value": 0.1, "numerator": 4.0, "denominator": 40, "n_observations": 40, "pooled": null},
              "neither": {"value": 0.4, "numerator": 16.0, "denominator": 40, "n_observations": 40, "pooled": null}
            },
            "share_of_voice": {"value": 0.5, "numerator": 15.0, "denominator": 30, "n_observations": 30, "pooled": null}
          }
        ]
      }
    ]
  }
}
```

## Open choices

Each row can be tightened by WP-12 through the change log.

| Q | Question | Choice | Why |
|---|---|---|---|
| Q9 | Where `compare_window` and `previous_answers` go (N2 says `meta`) | On `PromptsSummary`, as D1 wrote | The summary has no `meta`; C2 says "D1 Task 3 contract as written". |
| Q10 | `previous` on entity cells (CF-01, N2 yes; D1 no) | Optional `EntityCells.previous` | Two sources; an absent optional field costs nothing. |
| Q11 | Name and default of the row selector | `rows` with `topics` or `none`; left out means all rows | N1 and N15 name only those two values. |
| Q12 | Where co-mention counts live | Top level `PromptsSummary.co_mentions`, one entry per engine | "Over the valid answers in scope" is scope wide; per row it would repeat. |
| Q13 | Meaning of `filter[outcome]` on prompt rows | A single value of `Outcome`; WP-12 states the row rule in this note's change log before it builds | N10 names the parameter, not the rule; it answers `501` until then. |
| Q14 | Country breakdown: `group_by=country` or the breakdown route | `group_by=country` with `by_country` | N4 calls it the cheaper option; the breakdown route is WP-32 (wave 3). |

D-04 (10 prompts) is WP-12's pooling threshold for small topic rows and adds no field.

Decided by WP-12 on 2026-11-13 (the rows above stay as published; the change log has the rules):

| Q | Decision | Change log |
|---|---|---|
| Q11 | Decided as chosen: `rows` with `topics` or `none`, left out means all rows. The aggregates do not depend on `rows`. | C-3 |
| Q12 | Decided as chosen: top level `PromptsSummary.co_mentions`, one entry per engine. The pair definition and order are fixed. | C-8 |
| Q13 | Decided: the row rule is written. `filter[outcome]=O` keeps a prompt row when at least one of its valid answers in the window, on the engines shown, had outcome O, and narrows `prompts` only. | C-5 |
| Q14 | Decided as chosen: `group_by=country` with `by_country`. `group_by=language` stays `422`. | C-7 |
| Q15 | Compare windows: `previous_year` and custom `compare_from` and `compare_to` are added to the contract. | C-1 |
| Q16 | Where the previous cells are null and where they are cells with denominator 0. This also states `EntityCells.previous` (Q10) exactly: it is null when its engine's `previous` is null, not per entity. | C-2 |
| Q17 | The small cells are an `include=cells` value, with the block `EngineSummary.detail` (current window only). | C-9 |
| Q18 | Weekly points carry `prompts`, `is_pooled` and `pool`. | C-10 |
| Q19 | D-04 now pools in the API (not on the web): `POOL_BELOW_PROMPTS = 10` and `POOL_WEEKS = 4`, so the note above that D-04 adds no field no longer holds: it adds the point fields of C-10. | C-11 |

## How the owner package fills it

1. In `prompts_summary` (`api/ai/summary_routes.py`) remove the entries of the `refuse_unbuilt` call one
   by one as each addition is built, and pass the new options to `SummaryQuery`. Remove the `Not built
   yet` sentences of the route and parameter descriptions and the `Not returned yet` text of the new
   fields.
2. Write the `filter[outcome]` row rule (which prompt rows an outcome keeps, and the answers it counts)
   in the change log before building it (Q13).
3. Keep the house rules of the summary: aggregates in one grouped query with a statement count test, an
   absent block when it was not asked for, branded prompts excluded by default.
4. Replace `tests/api/ai/test_contract_summary.py` with real tests; the existing tests of
   `tests/api/ai/test_prompts_summary.py` and `test_summary_windows.py` stay.
5. A foreign or nonexistent project answers `404` through the service; with an unbuilt addition the
   route answered `501` first.
6. Regenerate `backend/openapi/v1.json`, then `pnpm gen:api` in `apps/web`.

## Change log

Newest last; one line per change, in the form `date package: change`.

2026-11-13 WP-03: contract published
2026-11-13 WP-12: C-1 compare: `compare` gains `previous_year` (the same dates one year earlier; 29 February becomes 28 February). `compare_from` and `compare_to` (dates, both or neither: one alone is `422` at the missing one) override `compare` whatever its value; at most 92 days (`422 window_too_large`), `from` after `to` is `422 range_invalid`; any position and length; `compare_window` echoes the window. A date outside the calendar is `422 out_of_range`.
2026-11-13 WP-12: C-2 previous null: `EngineSummary.previous` is null when none of the row's prompts has a fact row (any status) on that engine in the compare window; with fact rows but no valid answer it holds cells with denominator 0 and `value` null. `EntityCells.previous` is null exactly when its engine's `previous` is null, else cells (an entity not named in valid answers is 0 of N, a real rate). `previous_answers` = valid answers in scope in the compare window, over the engines shown.
2026-11-13 WP-12: C-3 rows (Q11): `rows=topics`: `prompts` is `[]`. `rows=none`: `prompts` and `topics` are `[]`. Left out: both lists. The aggregates (`total`, `by_country`, `co_mentions`) do not depend on `rows`.
2026-11-13 WP-12: C-4 total: `total.engines` are built as a topic row of every prompt in scope (prompt weighted Mentioned, Cited and outcomes with `pooled`; Share of voice per answer) and carry the same blocks the rows carry when asked: `previous`, `series`, `entities`, `detail`. `prompt_count` and the last times are over the prompts in scope.
2026-11-13 WP-12: C-5 outcome (Q13): `filter[outcome]=O` keeps a PROMPT ROW when at least one of its valid answers in the window, on the engines shown, had outcome O. It narrows `prompts` only. Cells, topic rows, `total`, `by_country`, `co_mentions` and `prompt_count` still count every prompt in scope.
2026-11-13 WP-12: C-6 opportunity: same "at least one valid answer in the window on the engines shown" and same scope as C-5. `named_not_cited`: outcome `mentioned_only`. `cited_not_named`: outcome `cited_only`. `nobody_named`: no tracked entity named in it (`tracked_entities_mentioned = 0`). `lost_to:<entity_id>`: the competitor is named and the own brand is not. An id that is not a competitor of the project (own, unknown, foreign) keeps no row and is `200`, never `404`.
2026-11-13 WP-12: C-7 country (Q14): `by_country` has one entry per `country_iso` of the prompts in scope (the prompt's market, not the answer's location), sorted by code, engines built as a topic row of those prompts. A prompt without a country is in no entry. `filter[country_iso]` leaves that one entry. `group_by=language` stays `422` (BE-METRICS-22 language half: not built, named reason).
2026-11-13 WP-12: C-8 co-mentions (Q12): `answers` = valid answers in scope on the engine (all of them, naming anyone or not). A pair is two entities of the tracked set (own first then competitors by name, at most 20, as the entity cells) named with a `mention_order` in the same valid answer; `a < b` by id, no self pair, only pairs with `answers >= 1`, sorted by `answers` descending then `a`, `b`. One entry per engine shown, `pairs: []` when none.
2026-11-13 WP-12: C-9 cells: `include=cells` adds `EngineSummary.detail` (`EngineDetailCells`): `cited_given_citations` (A2 variant: valid answers citing the own domain over valid answers with `total_citation_count > 0`), `citation_share` (A8: own citation units over all units of valid answers), `first_mention` (A12: `own_mention_order = 1` over valid answers naming the own brand), `fanout_presence` (F1: valid answers with at least one fan-out query over valid answers) and `fanout_mean` (F2: fan-out queries over answers with some). The two fan-out cells are null on an engine that does not expose fan-out (never 0). Current window only: not in `previous`, not in a week. Topic, total and country rows: the three rate cells are prompt weighted, `citation_share` and `fanout_mean` observation weighted (sums over sums). `metric_context.detail` says it once.
2026-11-13 WP-12: C-10 point fields: `WeekCells` gains `prompts` (int, always present: the row's prompts with a valid answer on that engine in that week itself), `is_pooled` (bool, always present) and `pool` (`PointPool`, absent when `is_pooled` is false): `weeks` (1 to 4, weeks pooled), `window` (`MetricWindow`: first and last day the pool covers, project timezone), `reason` (`prompt_point` or `few_prompts`), `below_prompts` (10). Series exist only with `include=series`, so a default response is unchanged.
2026-11-13 WP-12: C-11 pooling (D-04, R7): a point is pooled when its row is a prompt row (always, `prompt_point`), or when its row is a topic, `total` or `by_country` row and `prompts < POOL_BELOW_PROMPTS = 10` (`few_prompts`; 0 counts). A pooled point holds `mentioned`, `cited`, `share_of_voice` and `entities` over the trailing `POOL_WEEKS = 4` weeks to that week, never before the first day of `window` and never after its last (a window starting mid-week or in the first weeks gives a pool of fewer than 4 weeks, `pool.weeks` says how many; the API reads nothing outside the window). The pooled cell is the row's cell over the summed counts: a prompt cell is answers over answers (`pooled` null); a topic, total or country cell sums each prompt's counts over the pooled weeks first, then is prompt weighted as the window row is (`pooled` set, `denominator` = prompts with a valid answer in the pool). An unpooled topic point is the week's own cells as today. `previous`, `detail` and window rows are never pooled. On a prompt row the points therefore no longer add up to the window cell.
