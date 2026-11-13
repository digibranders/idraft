# C5: AI competitors (the competitors read and the Overview competitor table)

## Status

Published by WP-32 on 2026-11-13. Owner package: [WP-32 overview-aggregates](../work-packages/WP-32-overview-aggregates.md)
(MASTER-PLAN 3.6: `api/ai/competitor_routes.py`, `api/ai/competitors.py` and `api/schemas/ai_metrics.py` belong to
WP-32). Plan: [docs/superpowers/plans/2026-11-13-ai-wp-32-overview-aggregates.md](../../superpowers/plans/2026-11-13-ai-wp-32-overview-aggregates.md).

This note is the contract the Competitors page and the Overview competitor card ([WP-35](../work-packages/WP-35-overview-cards-competitors.md))
mock against. The metric routes (overview, value, series, breakdown) are in [c8-metrics.md](c8-metrics.md); this
note reuses its value model (`AiMetricValue`), its `AiMetricMeta`, its scope and compare parameters and its
rules (engine values never pooled, `previous`, absent optional members), and does not repeat them. Until WP-32
builds them both routes answer `501 not_implemented` after their access checks (the stub mechanism of the
[README](README.md)), and a field the model declares but this package does not return is absent from every
response. Every block of the Example section is a body the Pydantic models write back unchanged
(`tests/api/ai/test_metrics_contract.py` validates and re-writes each one). The rows closed are BE-COMPETITORS-03,
BE-COMPETITORS-05 and BE-REPORTS-03, and the two built rows BE-COMPETITORS-01 and 02 are confirmed by tests.

Every number comes from the prompts summary ([c2-summary.md](c2-summary.md)) with `include=entities`: the entity
cells of its `total` row. The reads that are not the summary's are the entity references, the citation units by
entity (the sources lane's scope and flag default), the lost-answer counts, the prompt cards and the top domains.

## Routes and parameters

`{P}` is `/api/v1/workspaces/{workspace_id}/projects/{project_id}`. Both routes are `GET`, need `data:read` and
answer `200` on success.

| # | Path | Body | Rows |
|---|---|---|---|
| 6 | `{P}/ai/competitors` | `AiCompetitorsResponse` | BE-COMPETITORS-03, BE-COMPETITORS-05 |
| 7 | `{P}/overview/competitors` | `OverviewCompetitorsResponse` | BE-REPORTS-03 |

Scope parameters, as in [c8-metrics.md](c8-metrics.md): `from`, `to` (default the 28 days ending today, at most 92:
`422 window_too_large`; `from` after `to` is `422 range_invalid`; a date outside the calendar `422 out_of_range`),
`filter[engine_code_in]` (list of engine code, at most 3), `include_branded` (false), `branded_only` (false, wins
over `include_branded`), `filter[country_iso]` (`^[A-Z]{2}$`), `filter[term]` (UUID: the term and its subtree).
Compare parameters, as in c8: `compare` (`none` default, `previous_period`, `previous_year`), `compare_from` and
`compare_to` (both or neither, at most 92 days, win over `compare`).

Route specific, route 6 only:

| Parameter | Type and bounds | Meaning |
|---|---|---|
| `entity_ids` | comma list of UUID, at most 20 | Narrows the rows to those tracked entities. An id that is not a tracked entity of the project (a watched one, one not tracked in AI answers, a removed one, another project's or workspace's) is left out and the answer is `200`, never `404`. |
| `include` | comma list: `lost_prompts`, `top_sources` | Adds those blocks. Each is absent unless asked for. Any other value is `422`. |
| `lost_limit` | integer, 1 to 10, default 5 | Rows of `lost_prompts` per entity and engine. |
| `sources_limit` | integer, 1 to 5, default 3 | Rows of `top_sources` per entity. |

Route 7 takes the scope and compare parameters alone. Any other query parameter is `422 extra_forbidden`, as on
every metric route (the doc 19 scope parameters that are not accepted are listed in c8).

## The tracked set

The rows are the tracked set of the summary: the own entities first, then the competitors by name, those tracked
in AI answers and not removed, at most 20 (`ENTITY_CELLS_MAX`, so the cut keeps the own entities). Watched
entities and removed ones are not rows. Share of voice is computed over the whole tracked set (R9), which
`meta.entities` lists once: all of it, in the summary's order (competitors by name, then the own entities), so a
client reads `role`. `entity` of a row is the existing `EntityRef` (`entity_id`, `canonical_name`, `entity_type`,
`role`, `color_index`) from the project's entity table, with the live role.

## Response bodies

### `{P}/ai/competitors`

`AiCompetitorsResponse` is `{data: AiCompetitor[], meta: AiMetricMeta}`.

| Model | Field | Meaning |
|---|---|---|
| `AiCompetitor` | `entity` | `EntityRef` of the row. |
| | `by_engine` | `AiCompetitorEngine[]`, one per engine shown, sorted by `engine_code`. |
| | `top_sources` | Optional: with `include=top_sources`, `CompetitorSource[]` (`[]` when the entity has none); absent otherwise. |
| `AiCompetitorEngine` | `engine_code` | The engine. |
| | `mention_rate` | `AiMetricValue` (`ai.mention_rate`) with `entity_id` set. |
| | `recommendation_rate` | `AiMetricValue` (`ai.recommendation_rate`), suppressed `not_classified`. |
| | `citation_share` | `AiMetricValue` (`ai.citation_share`) with `entity_id` set. |
| | `share_of_voice` | `AiMetricValue` (`ai.share_of_voice`) with `entity_id` set. |
| | `is_top_competitor` | True on exactly one competitor of the engine (rule below). |
| | `lost_prompts` | Optional: with `include=lost_prompts`, `LostPrompt[]` for a competitor row; absent on an own row and when not asked. `[]` when nothing was lost. |
| | `lost_prompts_total` | Optional, present and absent exactly as `lost_prompts`: every prompt lost to the competitor on the engine, before the `lost_limit` cap. |
| | `lost_prompts_with_min_answers` | Optional, present and absent exactly as `lost_prompts`: the prompts in scope with at least 4 answers on the engine, the "of N prompts" beside `lost_prompts_total`. |
| `LostPrompt` | `prompt_id`, `text`, `importance` | The prompt, its current text and its importance (1 to 5). |
| | `lost` | A summary cell: `numerator` the answers on that engine that name the competitor and not the own brand, `denominator` the prompt's valid answers on the engine, `n_observations` all its answers, `value` null when the denominator is 0. |
| `CompetitorSource` | `registrable_domain` | A domain cited for the entity. |
| | `citation_units` | Its citation units (distinct canonical URLs per answer). |
| | `answers` | The answers that cite it for the entity. |

Where each member comes from:

| Member | Source |
|---|---|
| `mention_rate` | The entity cell `mentioned` of the summary's `total` row (prompt weighted: `n_prompts`, `pooled`). With compare it carries `previous`. |
| `share_of_voice` | The entity cell `share_of_voice` (observation weighted). With compare it carries `previous`. |
| `citation_share` | The entity's citation units on the engine over all the citation units on the engine, from the sources lane's rows with `role_entity_id` set to the entity, the same prompts and window, and with its flag default (`engine_internal` and `unresolved_redirect` left out). `numerator` the entity's units, `denominator` all units of the engine (every role), `n_observations` the engine's valid answers. No `previous`. |
| `recommendation_rate` | Suppressed `not_classified` for every entity: `value`, `numerator` and `denominator` null, `n_observations` the engine's valid answers. Nothing classifies a recommendation yet (S2, WP-54). |
| `is_top_competitor` | The rule below. |
| `lost_prompts` | Opt-in. The rule below. |
| `top_sources` | Opt-in. The rule below. |

`previous` is on `mention_rate` and `share_of_voice` only, as in c8 (`null` when the engine had no answer of the
scope in the compare window; absent without compare). An engine with no answer has null values and zero counts.

### Top competitor

`is_top_competitor` is true, per engine, for exactly the competitor with the largest `share_of_voice.numerator`
on that engine. Ties go to the larger `mention_rate.numerator`, then to the name, then to the id. The own entity
is never the top competitor. It is false for every row when no competitor has a numerator above 0: the product
never names a top competitor that was never named. The flag is per engine, so a different competitor can lead on
each engine.

### Lost prompts

With `include=lost_prompts`, a competitor row's engine entry lists the prompts where that competitor is named and
the own brand is not (the rule of C2 C-6, `lost_to`), counted over the valid, current answers on that engine. They
are sorted by `importance` descending, then lost answers descending, then text, then id, at most `lost_limit`
per entity and engine. They are the same prompts `filter[opportunity]=lost_to:<id>` keeps on the summary for the
same scope and engine. A refusal or an invalid answer is not a lost answer. `lost_prompts_total` counts every
such prompt, before the cap, and `lost_prompts_with_min_answers` the prompts in scope with at least 4 answers on
the engine, so the card can say "3 of 12 prompts".

### Top sources

With `include=top_sources`, each row (the own entities too) lists the registrable domains cited with the entity as
the role entity of the domain, by `citation_units` descending, then domain, at most `sources_limit`, over all the
engines shown, with the sources lane's flag default. Categories of the domains wait for WP-60.

### `{P}/overview/competitors`

`OverviewCompetitorsResponse` is `{data: OverviewCompetitors, meta: AiMetricMeta}`: the AI half of the Overview
competitor card.

| Model | Field | Meaning |
|---|---|---|
| `OverviewCompetitors` | `rows` | `OverviewCompetitorRow[]`, the tracked set in the order above. |
| | `seo_other_domains` | Declared, optional, never returned in this package: the SEO "other domains" remainder. |
| `OverviewCompetitorRow` | `entity` | `EntityRef`. |
| | `ai` | `OverviewCompetitorEngine[]`, one per engine shown, sorted by code. |
| | `seo` | Declared, optional, never returned in this package: `OverviewSeoCells` (`share_of_voice` and `visibility`, each a `MetricValue` of the SEO side). |
| `OverviewCompetitorEngine` | `engine_code`, `share_of_voice`, `mention_rate` | The same values as in `ai/competitors` (no citation share, no lost prompts, no sources). |

The SEO half is not built: SEO share of voice needs the CTR model and the keyword volumes (doc 09 section 7),
which no package builds yet, and `overview/seo` and `overview/changes` are not built either. It is declared
optional in the shape so that a later package adds it without a second shape (decision D13).

## Statement counts

As in c8: each route costs the statements of its summary request plus a fixed number of extra reads in one second
transaction (one scope statement), asserted as differences on a full project, and independent of the data size.
Design figures until measured, then the test.

| Request | Summary request | Extra statements | Extra reads |
|---|---|---|---|
| `ai/competitors` | `S(rows left out, include=total,entities)` | +3 | `entity_refs`, `entity_units`, transaction scope |
| with `include=lost_prompts` | | +3 more | `counts_by_prompt`, `lost_counts`, `prompt_cards` |
| with `include=top_sources` | | +1 more | `top_sources` |
| `overview/competitors` | `S(rows=none, include=total,entities)` | +2 | `entity_refs`, transaction scope |

`rows left out` builds the prompt rows, which is how the route gets the ids of the prompts in scope for the
sources and lost reads. `compare` adds 1 (the summary's own).

## Error codes

| Status | Code | When |
|---|---|---|
| 401 | `unauthenticated` | No session. |
| 404 | `not_found` | Not a member of the workspace; a project outside the member's scope; a deleted or unknown project (never `200` with empty data). |
| 403 | `forbidden` | The role lacks `data:read`. |
| 422 | `validation_failed` | A value outside its bounds: `compare=previous_decade`, `entity_ids` over 20, `lost_limit` outside 1 to 10, `sources_limit` outside 1 to 5, `include=bogus`, an engine code outside the three, `extra_forbidden` for any other parameter (on route 7 also `entity_ids`, `include`, `lost_limit`, `sources_limit`); `from` after `to` (`range_invalid`); `compare_from` or `compare_to` alone; a date outside the calendar (`out_of_range`). |
| 422 | `window_too_large` | `from` to `to`, or `compare_from` to `compare_to`, over 92 days (carries `limit_days`). |
| 503 | `query_timeout` | The house statement timeout. |

Order, as built: for an authenticated caller `422 extra_forbidden` (an unknown query parameter) comes first, because
the session dependency raises it before the membership and permission checks; then 401, 404, 403, the 422 of a value
outside its bounds, of a lone `compare_from` or `compare_to` and of an explicit window (`range_invalid`,
`window_too_large`), then the service. A code outside the three engines is `422` (stricter than the summary, as c8
C-23). There is no `501` once the routes are built (while a route
is a stub every request that passes the access checks and the 422 checks answers `501`).

## Example

Made-up world, the same as the overview example of [c8-metrics.md](c8-metrics.md): ChatGPT has 10 answers, 8 valid,
4 prompts; Acme (own) and Globex (competitor) are the tracked set; the window is 2026-10-17 to 2026-11-13 and the
project's timezone is `Europe/Berlin`. Over the answers that name a tracked entity the shares of Acme and Globex
add up to the whole (3.0 and 3.0 of 6). Globex is the top competitor and the only prompt it wins is "best CRM for
small agencies" (2 of its 2 valid answers, 3 answers in all). The 4 prompts have 4, 3, 2 and 1 answers on the
engine, so one prompt has the 4 answers `lost_prompts_with_min_answers` asks for.

### Competitors with lost prompts and top sources (route 6)

```http
GET {P}/ai/competitors?from=2026-10-17&to=2026-11-13&filter[engine_code_in]=chatgpt_web&include=lost_prompts,top_sources
```

Model: `AiCompetitorsResponse`.

```json
{
  "data": [
    {
      "entity": {"entity_id": "0000004a-7c1e-4a52-9b3d-00000000004a", "canonical_name": "Acme", "entity_type": "brand", "role": "own", "color_index": 1},
      "by_engine": [
        {
          "engine_code": "chatgpt_web",
          "mention_rate": {"metric": "ai.mention_rate", "value": 0.5, "numerator": 2.0, "denominator": 4.0, "unit": "ratio", "n_observations": 10, "n_prompts": 4, "aggregation": "prompt_weighted", "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "observation_class": "consumer_ui", "engine_code": "chatgpt_web", "entity_id": "0000004a-7c1e-4a52-9b3d-00000000004a", "is_estimate": false, "method": "Valid answers that name the entity, prompt weighted.", "method_version": 1, "pooled": {"successes": 4, "trials": 8}},
          "recommendation_rate": {"metric": "ai.recommendation_rate", "value": null, "numerator": null, "denominator": null, "unit": "ratio", "n_observations": 8, "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "observation_class": "consumer_ui", "engine_code": "chatgpt_web", "entity_id": "0000004a-7c1e-4a52-9b3d-00000000004a", "is_estimate": false, "method": "Not classified yet: no answer carries a recommendation label.", "method_version": 1, "suppressed_reason": "not_classified"},
          "citation_share": {"metric": "ai.citation_share", "value": 0.25, "numerator": 6.0, "denominator": 24.0, "unit": "ratio", "n_observations": 8, "aggregation": "observation_weighted", "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "observation_class": "consumer_ui", "engine_code": "chatgpt_web", "entity_id": "0000004a-7c1e-4a52-9b3d-00000000004a", "is_estimate": false, "method": "The entity's citation units over all citation units of the engine; each unit is a distinct canonical URL of an answer.", "method_version": 1},
          "share_of_voice": {"metric": "ai.share_of_voice", "value": 0.5, "numerator": 3.0, "denominator": 6.0, "unit": "ratio", "n_observations": 10, "aggregation": "observation_weighted", "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "observation_class": "consumer_ui", "engine_code": "chatgpt_web", "entity_id": "0000004a-7c1e-4a52-9b3d-00000000004a", "is_estimate": false, "method": "The entity's share of the tracked entities each answer names, summed over the answers that name one.", "method_version": 1},
          "is_top_competitor": false
        }
      ],
      "top_sources": [
        {"registrable_domain": "acme.com", "citation_units": 5, "answers": 4},
        {"registrable_domain": "acme-blog.com", "citation_units": 1, "answers": 1}
      ]
    },
    {
      "entity": {"entity_id": "0000004b-7c1e-4a52-9b3d-00000000004b", "canonical_name": "Globex", "entity_type": "brand", "role": "competitor", "color_index": 2},
      "by_engine": [
        {
          "engine_code": "chatgpt_web",
          "mention_rate": {"metric": "ai.mention_rate", "value": 0.5, "numerator": 2.0, "denominator": 4.0, "unit": "ratio", "n_observations": 10, "n_prompts": 4, "aggregation": "prompt_weighted", "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "observation_class": "consumer_ui", "engine_code": "chatgpt_web", "entity_id": "0000004b-7c1e-4a52-9b3d-00000000004b", "is_estimate": false, "method": "Valid answers that name the entity, prompt weighted.", "method_version": 1, "pooled": {"successes": 4, "trials": 8}},
          "recommendation_rate": {"metric": "ai.recommendation_rate", "value": null, "numerator": null, "denominator": null, "unit": "ratio", "n_observations": 8, "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "observation_class": "consumer_ui", "engine_code": "chatgpt_web", "entity_id": "0000004b-7c1e-4a52-9b3d-00000000004b", "is_estimate": false, "method": "Not classified yet: no answer carries a recommendation label.", "method_version": 1, "suppressed_reason": "not_classified"},
          "citation_share": {"metric": "ai.citation_share", "value": 0.375, "numerator": 9.0, "denominator": 24.0, "unit": "ratio", "n_observations": 8, "aggregation": "observation_weighted", "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "observation_class": "consumer_ui", "engine_code": "chatgpt_web", "entity_id": "0000004b-7c1e-4a52-9b3d-00000000004b", "is_estimate": false, "method": "The entity's citation units over all citation units of the engine; each unit is a distinct canonical URL of an answer.", "method_version": 1},
          "share_of_voice": {"metric": "ai.share_of_voice", "value": 0.5, "numerator": 3.0, "denominator": 6.0, "unit": "ratio", "n_observations": 10, "aggregation": "observation_weighted", "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "observation_class": "consumer_ui", "engine_code": "chatgpt_web", "entity_id": "0000004b-7c1e-4a52-9b3d-00000000004b", "is_estimate": false, "method": "The entity's share of the tracked entities each answer names, summed over the answers that name one.", "method_version": 1},
          "is_top_competitor": true,
          "lost_prompts": [
            {"prompt_id": "0191a7c2-7c1e-4a52-9b3d-0000000000c4", "text": "best CRM for small agencies", "importance": 4, "lost": {"value": 1.0, "numerator": 2.0, "denominator": 2, "n_observations": 3, "pooled": null}}
          ],
          "lost_prompts_total": 1,
          "lost_prompts_with_min_answers": 1
        }
      ],
      "top_sources": [
        {"registrable_domain": "globex.com", "citation_units": 7, "answers": 4},
        {"registrable_domain": "globex.io", "citation_units": 2, "answers": 2}
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

With `compare=previous_period`, `mention_rate` and `share_of_voice` of each engine entry also hold `previous`, and
`meta` holds `compare_window` and `previous_answers`, exactly as in c8.

### Overview competitors (route 7)

```http
GET {P}/overview/competitors?from=2026-10-17&to=2026-11-13&filter[engine_code_in]=chatgpt_web
```

The AI half only: no `seo` member on a row and no `seo_other_domains`.

Model: `OverviewCompetitorsResponse`.

```json
{
  "data": {
    "rows": [
      {
        "entity": {"entity_id": "0000004a-7c1e-4a52-9b3d-00000000004a", "canonical_name": "Acme", "entity_type": "brand", "role": "own", "color_index": 1},
        "ai": [
          {
            "engine_code": "chatgpt_web",
            "share_of_voice": {"metric": "ai.share_of_voice", "value": 0.5, "numerator": 3.0, "denominator": 6.0, "unit": "ratio", "n_observations": 10, "aggregation": "observation_weighted", "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "observation_class": "consumer_ui", "engine_code": "chatgpt_web", "entity_id": "0000004a-7c1e-4a52-9b3d-00000000004a", "is_estimate": false, "method": "The entity's share of the tracked entities each answer names, summed over the answers that name one.", "method_version": 1},
            "mention_rate": {"metric": "ai.mention_rate", "value": 0.5, "numerator": 2.0, "denominator": 4.0, "unit": "ratio", "n_observations": 10, "n_prompts": 4, "aggregation": "prompt_weighted", "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "observation_class": "consumer_ui", "engine_code": "chatgpt_web", "entity_id": "0000004a-7c1e-4a52-9b3d-00000000004a", "is_estimate": false, "method": "Valid answers that name the entity, prompt weighted.", "method_version": 1, "pooled": {"successes": 4, "trials": 8}}
          }
        ]
      },
      {
        "entity": {"entity_id": "0000004b-7c1e-4a52-9b3d-00000000004b", "canonical_name": "Globex", "entity_type": "brand", "role": "competitor", "color_index": 2},
        "ai": [
          {
            "engine_code": "chatgpt_web",
            "share_of_voice": {"metric": "ai.share_of_voice", "value": 0.5, "numerator": 3.0, "denominator": 6.0, "unit": "ratio", "n_observations": 10, "aggregation": "observation_weighted", "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "observation_class": "consumer_ui", "engine_code": "chatgpt_web", "entity_id": "0000004b-7c1e-4a52-9b3d-00000000004b", "is_estimate": false, "method": "The entity's share of the tracked entities each answer names, summed over the answers that name one.", "method_version": 1},
            "mention_rate": {"metric": "ai.mention_rate", "value": 0.5, "numerator": 2.0, "denominator": 4.0, "unit": "ratio", "n_observations": 10, "n_prompts": 4, "aggregation": "prompt_weighted", "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"}, "filters": {"include_branded": false, "branded_only": false, "country_iso": null, "term_id": null}, "observation_class": "consumer_ui", "engine_code": "chatgpt_web", "entity_id": "0000004b-7c1e-4a52-9b3d-00000000004b", "is_estimate": false, "method": "Valid answers that name the entity, prompt weighted.", "method_version": 1, "pooled": {"successes": 4, "trials": 8}}
          }
        ]
      }
    ]
  },
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

## Open choices

Each row can be tightened by WP-32 through the change log. The rows Q1 to Q7 are in
[c8-metrics.md](c8-metrics.md).

| Q | Question | Choice | Why |
|---|---|---|---|
| Q8 | Where the competitor numbers come from (D1, D10) | The summary's entity cells for mention rate and share of voice; the sources lane (flag default) for citation share | The same numbers as the Topics & Prompts and Sources pages (R12); the own row's citation share equals the Overview tile. |
| Q9 | The top competitor rule and the `include` caps (D11) | The competitor with the largest share of voice numerator per engine, none when none was named; `lost_limit` 1 to 10 (default 5), `sources_limit` 1 to 5 (default 3), both opt-in | Never name a top competitor that was never named; the opt-in blocks keep the plain read small. |
| Q10 | The SEO half of the Overview competitor table (D13) | `overview/competitors` is built for the AI half; the `seo` and `seo_other_domains` members are declared and absent | SEO share of voice needs the CTR model and volumes (doc 09 section 7), built nowhere. BE-REPORTS-03 closes with its remainder named, as WP-12 closed BE-METRICS-22. It is its own package. |

## How the owner package fills it

1. Task 2 (schemas): the models of this note in `api/schemas/ai_metrics.py`, the two route stubs in
   `api/ai/competitor_routes.py` (`@not_built`, final parameters and descriptions, reusing the scope and compare
   dependencies of `metrics_routes.py`), the access lines, the cross-tenant entries, the contract tests, the Example
   blocks printed from the models, `backend/openapi/v1.json`, then `pnpm gen:api` in `apps/web`. First push.
2. Task 6 (competitors): `api/ai/competitor_repository.py` (`entity_refs`, `entity_units`),
   `api/ai/competitors.py` (`CompetitorService.competitors`, the top competitor rule as a pure function);
   route 6 drops `@not_built`. Until task 7 an `include` value answers `501` naming it, so a client cannot mistake
   an unbuilt block for an empty one.
3. Task 7 (lost prompts, top sources, overview competitors): `lost_counts`, `prompt_cards`, `top_sources`,
   `CompetitorService.overview`; the `include` refusal is removed; route 7 drops `@not_built`; the cross-tenant
   entry of route 6 gains `include=lost_prompts,top_sources`.
4. Task 8: the scope guards on both routes, the measured statement counts, this note's status "built by WP-32",
   and the As built paragraphs of docs 19 and 29.
5. House rules: aggregates in the summary's grouped queries with a statement count test, an absent block when it
   was not asked for, branded prompts excluded by default, a foreign or deleted project is `404`.

## Change log

Newest last; one line per change, in the form `date package: change`.

2026-11-13 WP-32: contract published
2026-11-13 WP-32: C-1 rows: the tracked set and its order (the own entities first, then the competitors by name; at most 20); `entity_ids` narrows the rows; foreign or untracked ids are left out and the answer is `200`.
2026-11-13 WP-32: C-2 members: the sources of `mention_rate`, `share_of_voice` and `citation_share`; `previous` only on the first two; recommendation suppressed for every entity.
2026-11-13 WP-32: C-3 top competitor: the rule above, per engine; none when no competitor was named.
2026-11-13 WP-32: C-4 lost prompts: `include=lost_prompts`, its rule, sort and `lost_limit`; the same prompts `filter[opportunity]=lost_to:<id>` keeps on the summary.
2026-11-13 WP-32: C-5 top sources: `include=top_sources`, `sources_limit`, over all engines, with the sources lane's flag default.
2026-11-13 WP-32: C-6 overview competitors: the AI half; `seo` and `seo_other_domains` declared and absent (D13).
2026-11-13 WP-32: C-7 statement counts: the statement table above (design figures until measured, then the test).
2026-11-13 WP-32: C-8 errors: the error table above (401, 404, 403, 422, then the service).
2026-11-13 WP-32: C-9 differences from the specs, written once: doc 19 3.7.9 lists `top_sources: DomainRef[]` and `MetricValue` members only; this contract returns `CompetitorSource` (domain, citation units, answers) and adds `is_top_competitor` and the opt-in `lost_prompts`; doc 20 5.2 puts SEO share of voice and visibility in the competitor overview, and they are not built (Q10); doc 19's `entity_ids` is the same name here and its `entity_id` is not accepted; `previous` replaces `MetricComparison` as in c8 (Q2); recommendation is suppressed `not_classified` against doc 16 A5 (see c8 C-15).
2026-11-13 WP-32: C-10 reading of the contract where the plan was silent: with `include=top_sources` the own rows list their domains as well; `lost` of a `LostPrompt` has `pooled` null (it is a count of answers of one prompt); an engine entry whose engine has no answer has null values and zero counts and no top competitor; `meta.entities` lists the whole tracked set in the summary's order (competitors by name, then the own entities).
2026-11-13 WP-32: C-11 lost prompt context: `lost_prompts_total` (every prompt lost to the competitor on the engine, before the `lost_limit` cap) and `lost_prompts_with_min_answers` (prompts in scope with at least 4 answers on the engine, the "of N prompts" context) are optional integers on `AiCompetitorEngine`, present exactly when `lost_prompts` is, absent otherwise.
2026-11-13 WP-32: C-12 `top_sources` is `[]` for an entity with no cited domain, absent without `include=top_sources`. The `meta` of every body gains the optional `entity_config_changes` and the shared text of c8 C-17 to C-23 (value text, engine filter, order as built) applies.
