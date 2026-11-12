# C2: prompts summary additions (compare, total, rows, co-mentions, filters, country)

## Status

Published by WP-03 on 2026-11-13. Owner package: [WP-12 summary-lane](../work-packages/WP-12-summary-lane.md)
(MASTER-PLAN 3.6: the summary models `EngineSummary`, `MetricCell`, `WeekCells`, `EntityCells` and
`PromptsSummary` belong to WP-12 until it merges; WP-03 extended them additively under plan decision D4).

`GET {P}/ai/prompts-summary` is a built route. Every addition below is an optional parameter that
answers `501 not_implemented` when used, and an optional response field that is absent from every
response until WP-12 builds it. A request without the new parameters, or with `compare=none`,
`include=series`, `include=entities` or both, answers exactly as before.

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
