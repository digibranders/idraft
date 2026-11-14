# Sources additions: series, cited with, role per engine, country, min support, changes

## Status

Published by WP-03 on 2026-11-13. WP-14 published three more routes and parameters on 2026-11-13
(first push of its package, contract first). Owner package:
[WP-14 sources-lane](../work-packages/WP-14-sources-lane.md)
(rows CF-07 to CF-10, OV-N6, OV-N7, BE-SOURCES-05, BE-SOURCES-06; the source models in
`schemas/ai_sources.py` and the routes in `api/ai/source_routes.py`, extended additively by WP-03 under
plan decision D4).

| Item | Kind | Answers today |
|---|---|---|
| `GET {P}/ai/sources/changes` | new route | built |
| `GET {P}/ai/sources/diversity` | new route (WP-14) | built |
| `GET {P}/ai/sources/domains/{registrable_domain}` | new route (WP-14) | built |
| `GET {P}/ai/sources/prompts` | new route (WP-14) | built |
| `sources/domains`: `include`, `min_support`, `filter[country_iso]` | optional additions to a built route | built |
| `sources/pages`: `include=series`, `min_support`, `filter[country_iso]` | optional additions | built |
| `citations`: `filter[country_iso]` | optional addition | built |
| `fanout-queries`: `filter[country_iso]` | optional addition | built |
| `fanout-queries`: `include=topics` | optional addition | built |
| `include_unresolved_redirects`, `include_engine_internal` (default false) on domains, pages, changes, diversity, domain detail, prompts | optional additions | built |
| Response fields on domain rows, page rows and `meta` | new optional fields | returned when their `include` is asked for; `category` and `category_source` are not returned yet (WP-60) |
| `FanoutQueryRow.topics` | new optional field | returned with `include=topics`, absent otherwise |

A request that leaves the additions out answers as before (no `series` or `by_role_by_engine` in
`meta`), with one deliberate change: citations flagged `unresolved_redirect` or `engine_internal` are
no longer counted by the aggregate source reads unless a toggle asks for them (see the flag toggles
below and the change log).

## Routes and parameters

All paths start with `{P}`. All need `data:read`.

| Method | Path | Success |
|---|---|---|
| GET | `{P}/ai/sources/domains` | `200 SourceDomainPage` (built) |
| GET | `{P}/ai/sources/pages` | `200 SourcePagePage` (built) |
| GET | `{P}/ai/citations` | `200 CitationPage` (built) |
| GET | `{P}/ai/fanout-queries` | `200 FanoutQueryPage` (built) |
| GET | `{P}/ai/sources/changes` | `200 SourceChangePage` (new) |
| GET | `{P}/ai/sources/diversity` | `200 SourceDiversity` (new, WP-14) |
| GET | `{P}/ai/sources/domains/{registrable_domain}` | `200 SourceDomainDetail` (new, WP-14) |
| GET | `{P}/ai/sources/prompts` | `200 PromptOwnPagesPage` (new, WP-14) |

The shared scope of the built reads is unchanged: `from`, `to` (project-local days, default the 28 days
ending today, at most 92), `filter[engine_code_in]` (at most 3 values), `filter[prompt_id]`,
`filter[term]`, `include_branded` (default false), `filter[domain_role_in]` (`own`, `competitor`,
`third_party`, at most 3 values; not on the fan-out route), and offset paging (`offset` 0 to 100,000,
`limit` 1 to 200, default 50; citations uses a keyset `cursor`).

### Added query parameters

| Parameter | On | Type | Bounds | Meaning |
|---|---|---|---|---|
| `include` | `sources/domains` | comma list of `series`, `cited_with`, `by_role_by_engine` | at most 3 values | Blocks to add. All three are built. |
| `include` | `sources/pages` | comma list of `series` | at most 1 value | Adds a weekly series to each row and to `meta.series`. |
| `min_support` | `sources/domains`, `sources/pages` | integer | 1 to 1,000 | The fewest citation units a row is listed for; rows below it leave the rows and `page.total`, never `meta` or a share. |
| `filter[country_iso]` | domains, pages, citations, fan-out, changes, diversity, domain detail, prompts | string | `^[A-Z]{2}$` | The answers of the prompts of one market, ISO 3166-1 alpha-2; prompts with no market are left out. It narrows `meta` and every share too. |
| `kind` | `sources/changes` | `new` or `lost` | default `new` | `new` (docs/16 C5): at least `min_support` citation units in the window and none in as many days before. `lost` (docs/16 C6): at least `min_support` units in a support window and none in each of the 2 windows after it (the asked window and the one before it). |
| `min_support` | `sources/changes` | integer | 1 to 1,000, default 2 | The citation units a domain needs on the side where it was cited. |
| `include_unresolved_redirects` | domains, pages, changes, diversity, domain detail, prompts | boolean | default `false` | Count citations flagged `unresolved_redirect` (redirect links that were not resolved, such as Gemini's grounding links), which are left out of every share and unit by default (docs/14 section 9). |
| `include_engine_internal` | same six routes | boolean | default `false` | Count citations flagged `engine_internal` (links into the engine's own product), left out by default. Ingest does not set this flag yet, so nothing is left out until it does; the read filters on it already. |
| `include` | `fanout-queries` | comma list of `topics` | at most 1 value | Adds `topics` to each row: one statement for the page. |
| `include` | `sources/diversity` | comma list of `series`, `ads` | at most 2 values | Weekly series and ad presence per engine. |
| `filter[own_cited]` | `sources/prompts` | boolean | | `true` keeps the prompt and engine pairs whose answers cite an own page, `false` those that cite none. Default both. |

The flag toggles apply to the aggregate reads only. A citation carrying several excluded flags counts
only when every one of them is asked for (a link flagged with both is counted by neither toggle
alone). The citation list (`citations`) and the fan-out read keep every citation whatever its flags,
since they show the evidence behind the counts. A cursor of `sources/prompts` is bound to the
toggles.

`sources/diversity` and `sources/domains/{registrable_domain}` take the shared scope. The path value
is a registrable domain (1 to 253 characters), a word and not an id. `sources/prompts` takes the
shared scope and a keyset `cursor` and `limit` (1 to 200).

`sources/changes` takes the shared scope and offset paging above, and no `compare`, `sort` or
`filter[registrable_domain]`. The fan-out route keeps its own `min_support`, which counts answers.

### New response fields (all optional, absent unless asked for)

| Model | Field | Type | Bounds | Meaning |
|---|---|---|---|---|
| `SourceDomainRow` | `series` | `SourceWeekUnits[]` | at most 14 | With `include=series`: a point per week of the window, oldest first. |
| `SourceDomainRow` | `cited_with` | `CitedWith` `{ entity_id, observations }` | | With `include=cited_with`: the tracked entity most named in answers citing it, and the answers citing it that name it. |
| `SourceDomainRow` | `category` | string | up to 64 | The domain's category. Published; not returned yet (WP-60). |
| `SourceDomainRow` | `category_source` | `seed_list`, `rule`, `llm`, `manual` or `tenant_override` | | Where the category came from. Published; not returned yet (WP-60). |
| `SourcePageRow` | `series` | `SourceWeekUnits[]` | at most 14 | With `include=series`. |
| `SourcesMeta` | `series` | `SourcesWeek[]` | at most 14 | With `include=series`: per week `week_start`, `answers`, `citation_units`, `distinct_domains`. |
| `SourcesMeta` | `by_role_by_engine` | `EngineRoleUnits[]` | at most 3 | With `include=by_role_by_engine` on domains: per engine, `own`, `competitor` and `third_party` each as `{ citation_units, answers_citing }`. |
| `FanoutQueryRow` | `topics` | `FanoutTopic[]` `{ term_id, observations }` | at most 10 | With `include=topics`: the topic terms tagged on the prompts whose answers issued it, the most answers first, then by term id. An empty list when none of them is tagged with a topic. |

`SourceWeekUnits`: `week_start` (the Monday the week starts on, in the project's zone), `citation_units`,
`observations`.

### GET {P}/ai/sources/changes: response

| Field | Type | Meaning |
|---|---|---|
| `data[].registrable_domain` | string, up to 253 | One row per registrable domain and role. |
| `data[].domain_role` | `own`, `competitor`, `third_party` | |
| `data[].role_entity_id` | uuid or null | The tracked entity whose domain rule matched; null for a third party. |
| `data[].current_units` | integer | Citation units in `meta.window`. |
| `data[].previous_units` | integer | Citation units in `meta.compare_window`. |
| `data[].first_seen_at` | datetime or null | Its first citation in `meta.window`; null for `lost`. |
| `data[].last_seen_at` | datetime or null | Its last citation in `meta.window`; null for `lost`. |
| `page` | `{ offset, limit, total }` | Offset page, the most units first. |
| `meta` | `{ window, compare_window, include_branded, engine_codes (at most 3), kind, min_support }` | The windows and settings answered. For `new`, `window` is the asked window and `compare_window` the one before it. For `lost`, `window` is the asked window and the one before it (the 2 empty windows) and `compare_window` the support window before those: a 92 day ask reads 276 days. |

### GET {P}/ai/sources/diversity: response

| Field | Type | Meaning |
|---|---|---|
| `data[]` | `SourceDiversityEngine`, at most 3 | One entry per engine in scope. |
| `data[].engine_code`, `answers`, `answers_citing`, `citation_units` | | The valid answers, those citing a source, and the citation units. |
| `data[].distinct_domains` | integer | Registrable domains cited, roles merged. |
| `data[].effective_sources` | `MetricCell` | Docs/16 C3: `(sum of units)^2` over the sum of squared units per domain, both visible. |
| `data[].series` | `DiversityWeek[]`, at most 14 | With `include=series`: `week_start`, `citation_units`, `distinct_domains`, `effective_sources` (null without a unit). |
| `data[].ads` | `AdPresence` `{ answers_with_ads: MetricCell, ads }` | With `include=ads`. |
| `meta` | `{ window, include_branded, engine_codes, distinct_domains, effective_sources_engine_average }` | The count over every engine, and the equal-weight mean of the engines with units (never pooled). |

### GET {P}/ai/sources/domains/{registrable_domain}: response

| Field | Type | Meaning |
|---|---|---|
| `data.registrable_domain` | string, up to 253 | As asked. |
| `data.rows` | `SourceDomainRow[]`, at most 10 | One per role and entity. |
| `data.engines` | `DomainEngineSeries[]`, at most 3 | Per engine, a weekly series (at most 14) of `citation_units`, `observations`, `all_citation_units` and `answers`. |
| `data.top_pages` | `SourcePageRow[]`, at most 10 | Its most cited pages. |
| `data.prompts` | `DomainPrompt[]`, at most 20 | `prompt_id`, `citation_units`, `observations`. |
| `data.cited_with` | `CitedWith[]`, at most 5 | The tracked entities named most in answers citing it. |
| `meta` | `SourcesMeta` | The scope's totals. A domain not cited in scope answers `200` with empty lists. |

### GET {P}/ai/sources/prompts: response

| Field | Type | Meaning |
|---|---|---|
| `data[]` | `PromptOwnPagesRow` | One per prompt and engine with a counted answer: `prompt_id`, `engine_code`, `answers`, `answers_citing_own`, `own_citation_units`, `own_pages`, `top_own_page` (`{ url_id, url }` or null). |
| `page` | `CursorPageInfo` | Keyset on `(prompt_id, engine_code)`. |
| `meta` | `{ window, include_branded, engine_codes }` | |

## Error codes

| Status | Code | When |
|---|---|---|
| 401 | `unauthenticated` | No session. |
| 404 | `not_found` | Not a member of the workspace; a project outside the member's scope; a deleted or unknown project. |
| 403 | `forbidden` | The role lacks `data:read`. |
| 400 | `invalid_cursor` | `citations` and `sources/prompts`: a cursor used with other filters than it was issued for (for the prompts also other toggles), or one whose key is not one the list made. |
| 422 | `validation_failed` | A value outside its bounds: `include=cited_with` on pages, `kind=gone`, `min_support=0`, `filter[country_iso]=us`; a parameter the route does not declare; `from` after `to` is field code `range_invalid`. |
| 422 | `window_too_large` | Over 92 days (the asked window; `sources/changes` with `kind=lost` reads 3 windows of that length). |
| 422 | `engine_has_no_fanout` | Fan-out only: an engine that does not show its queries is named in `filter[engine_code_in]`. |

Order: 401, 404, 403, 422. No addition answers `501` any more.

## Example

The `501` body is in the [README](README.md). The responses show what WP-14 returns.

### Domains with the new blocks

```http
GET {P}/ai/sources/domains?from=2026-10-17&to=2026-11-13&include=series,cited_with,by_role_by_engine&min_support=2&filter[country_iso]=US
```

`200`:

```json
{
  "data": [
    {
      "registrable_domain": "g2.com",
      "domain_role": "third_party",
      "role_entity_id": null,
      "citation_units": 31,
      "observations": 24,
      "prompts": 9,
      "engines": [
        {"engine_code": "chatgpt_web", "citation_units": 20},
        {"engine_code": "gemini_web", "citation_units": 11}
      ],
      "source_share": {
        "value": 0.02574750830564784,
        "numerator": 31.0,
        "denominator": 1204,
        "n_observations": 380,
        "pooled": null
      },
      "first_seen_at": "2026-11-10T09:12:44Z",
      "last_seen_at": "2026-11-10T09:12:44Z",
      "series": [
        {"week_start": "2026-10-12", "citation_units": 4, "observations": 3},
        {"week_start": "2026-10-19", "citation_units": 7, "observations": 5}
      ],
      "cited_with": {"entity_id": "0000004b-7c1e-4a52-9b3d-00000000004b", "observations": 14},
      "category": "review_site",
      "category_source": "seed_list"
    }
  ],
  "page": {"offset": 0, "limit": 50, "total": 1},
  "meta": {
    "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"},
    "include_branded": false,
    "engine_codes": ["chatgpt_web", "gemini_web"],
    "answers": 380,
    "answers_citing": 301,
    "citation_units": 1204,
    "by_role": [
      {"domain_role": "own", "citation_units": 120, "observations": 96},
      {"domain_role": "competitor", "citation_units": 210, "observations": 170},
      {"domain_role": "third_party", "citation_units": 874, "observations": 260}
    ],
    "series": [{"week_start": "2026-10-12", "answers": 88, "citation_units": 270, "distinct_domains": 61}],
    "by_role_by_engine": [
      {
        "engine_code": "chatgpt_web",
        "own": {"citation_units": 70, "answers_citing": 60},
        "competitor": {"citation_units": 120, "answers_citing": 100},
        "third_party": {"citation_units": 500, "answers_citing": 170}
      }
    ]
  }
}
```

### Pages with a series

```http
GET {P}/ai/sources/pages?include=series&min_support=2&filter[country_iso]=US
```

`200`:

```json
{
  "data": [
    {
      "url_id": 9021,
      "url": "https://www.g2.com/categories/project-management",
      "host": "www.g2.com",
      "registrable_domain": "g2.com",
      "title": "Best Project Management Software",
      "domain_role": "third_party",
      "role_entity_id": null,
      "citation_units": 12,
      "observations": 10,
      "prompts": 5,
      "engines": [{"engine_code": "chatgpt_web", "citation_units": 12}],
      "source_share": {
        "value": 0.009966777408637873,
        "numerator": 12.0,
        "denominator": 1204,
        "n_observations": 380,
        "pooled": null
      },
      "first_seen_at": "2026-11-10T09:12:44Z",
      "last_seen_at": "2026-11-10T09:12:44Z",
      "series": [
        {"week_start": "2026-10-12", "citation_units": 4, "observations": 3},
        {"week_start": "2026-10-19", "citation_units": 7, "observations": 5}
      ]
    }
  ],
  "page": {"offset": 0, "limit": 50, "total": 1},
  "meta": {
    "window": {"from": "2026-10-17", "to": "2026-11-13", "timezone": "Europe/Berlin"},
    "include_branded": false,
    "engine_codes": ["chatgpt_web", "gemini_web"],
    "answers": 380,
    "answers_citing": 301,
    "citation_units": 1204,
    "by_role": [
      {"domain_role": "own", "citation_units": 120, "observations": 96},
      {"domain_role": "competitor", "citation_units": 210, "observations": 170},
      {"domain_role": "third_party", "citation_units": 874, "observations": 260}
    ],
    "series": [{"week_start": "2026-10-12", "answers": 88, "citation_units": 270, "distinct_domains": 61}]
  }
}
```

### Citations and fan-out with a country

```http
GET {P}/ai/citations?filter[country_iso]=US
GET {P}/ai/fanout-queries?filter[country_iso]=US&min_support=2
```

Their responses (`CitationPage`, `FanoutQueryPage`) do not change; the answers counted are those of the
prompts of that market.

### Fan-out queries by topic

```http
GET {P}/ai/fanout-queries?include=topics&min_support=2
```

Each row gains `topics`, here two topic terms of the prompts whose answers issued "soc pricing" (3
answers in all: the first term in 2 of them, the second in 1):

```json
{
  "normalized_text": "soc pricing",
  "observations": 3,
  "topics": [
    { "term_id": "0198f3b1-6b3a-7c10-9f0e-5d2a1c7e4a11", "observations": 2 },
    { "term_id": "0198f3b1-6b3a-7c10-9f0e-5d2a1c7e4a12", "observations": 1 }
  ]
}
```

### Changes

```http
GET {P}/ai/sources/changes?kind=lost&min_support=3&filter[country_iso]=US
```

`200`:

```json
{
  "data": [
    {
      "registrable_domain": "capterra.com",
      "domain_role": "third_party",
      "role_entity_id": null,
      "current_units": 0,
      "previous_units": 5,
      "first_seen_at": null,
      "last_seen_at": null
    }
  ],
  "page": {"offset": 0, "limit": 50, "total": 1},
  "meta": {
    "window": {"from": "2026-09-19", "to": "2026-11-13", "timezone": "Europe/Berlin"},
    "compare_window": {"from": "2026-08-22", "to": "2026-09-18", "timezone": "Europe/Berlin"},
    "include_branded": false,
    "engine_codes": ["chatgpt_web", "gemini_web"],
    "kind": "lost",
    "min_support": 3
  }
}
```

## Deviations from doc 19 section 3.7.7

The three routes WP-14 published differ from the rows of doc 19. The coordinator agreed to each.

1. Domain detail is keyed by `{registrable_domain}` and this REPLACES the `{domain_id}` of doc 19:
   domain rows carry no id, only the registrable domain (the as built D2 reads). The value is a
   registrable domain, not an id.
2. The detail has no `publisher`, and no top-level `source_share` or `series`: the shares are on
   `data.rows[].source_share` (one row per role and entity) and the weekly series are per engine in
   `data.engines[].series`.
3. A prompt of the detail has no `text`: `data.prompts[]` carries `prompt_id`, `citation_units` and
   `observations` only.
4. `co_mentioned_entities` is named `cited_with`, and an entry carries `entity_id` and
   `observations`, not an `EntityRef`.
5. In diversity, `distinct_domains` is an integer, not a `MetricValue`. `effective_sources` is a
   `MetricCell`, and a week of `series` holds it as a plain number (null without a unit).
6. Diversity has no `granularity` parameter: `include=series` is weekly only.

## Open choices

Each row can be tightened by WP-14 through the change log.

| Q | Question | Choice | Why |
|---|---|---|---|
| Q17 | What `min_support` counts on source rows | Citation units in the window | Doc 16 C5 counts units ("at least 2 units now"). The fan-out `min_support` keeps counting answers. |
| Q18 | `sources/changes` row shape and paging | `registrable_domain` rows and offset pages, as the built source reads | Doc 19's `DomainRef` and cursor were replaced by the as built D2 reads. |
| Q19 | `cited_with` and `by_role_by_engine` always or opt-in | Opt-in through `include` on `sources/domains` | Handoff rule 5: a new extra query is asked for. |
| D7 | Bounds | `series` at most 14 weeks, engine lists at most 3, `category` up to 64, domain up to 253 | House rule: bounded lists and strings. |
| O1 | Do flagged citations count when a request does not say | No: `unresolved_redirect` and `engine_internal` citations are left out of every share and unit of the aggregate reads, and counted with the toggles | Docs/14 section 9 and docs/19. One named constant, `FLAGGED_COUNTED_BY_DEFAULT` in `source_routes.py`, decides it. |
| O2 | `lost` as the contract first described it ("units before and none in the window") or as docs/16 C6 | C6: `min_support` units in a support window and none in each of the 2 windows after it | BE-SOURCES-05, docs/16, docs/14; the row and meta shapes hold for both. |
| O10 | Ingest never sets `engine_internal` | The toggle filters on it anyway | The read is ready the day ingest marks the links (docs/14 section 9 names the flag); until then `include_engine_internal` changes no number. |

## Built by WP-14

The routes, parameters and fields above are built, except `SourceDomainRow.category` and
`category_source` (WP-60). Every aggregate is
one grouped statement, with a statement count test; a foreign or deleted project answers `404` from the
service; the new blocks stay absent unless asked for (`include`).

## Change log

Newest last; one line per change, in the form `date package: change`.

2026-11-13 WP-03: contract published
2026-11-13 WP-14: added `GET {P}/ai/sources/diversity`, `GET {P}/ai/sources/domains/{registrable_domain}` and `GET {P}/ai/sources/prompts` (stubs)
2026-11-13 WP-14: added `include_unresolved_redirects` and `include_engine_internal` (default false) to domains, pages, changes and the new routes; fan-out `include=topics` and `FanoutQueryRow.topics`
2026-11-13 WP-14: recorded the deviations from doc 19 section 3.7.7 (detail keyed by `{registrable_domain}`, `cited_with`, integer `distinct_domains`, no `granularity`); described `include` of diversity and `filter[own_cited]` of prompts in the API document
2026-11-13 WP-14: built `min_support` on domains and pages (citation units in the window, rows and `page.total` only) and `sources/changes`; `kind=lost` follows docs/16 C6: at least `min_support` units in a support window and none in each of the 2 windows after it, so `meta.window` is the asked window and the one before it, `meta.compare_window` the support window before those (a 92 day ask reads 276 days), `current_units` is 0 and `first_seen_at` and `last_seen_at` are null; `kind=new` compares the asked window with the one before; the flag toggles on `sources/changes` still answer `501`
2026-11-13 WP-14: built `GET {P}/ai/sources/diversity` (per engine: answers, citing answers, units, distinct registrable domains with roles merged, and `effective_sources` as (sum of units)^2 over the sum of squared units per domain with both visible; `meta.distinct_domains` is a count over every engine in scope and `meta.effective_sources_engine_average` the equal-weight mean of the engines with units; `include=series` a weekly point per engine, `include=ads` the answers that showed an ad) and `GET {P}/ai/sources/domains/{registrable_domain}` (the name is read in lower case; at most 10 rows, 10 pages, 20 prompts, 5 `cited_with` entities and 3 engine series of at most 14 weeks; a domain not cited in scope is `200` with every list empty, `engines` included); the flag toggles on both still answer `501`
2026-11-13 WP-14: built `include=cited_with` and `include=by_role_by_engine` on `sources/domains` (`cited_with` is read per row, so per registrable domain, role and entity: the tracked entity named in the most counted answers citing that row, current and accepted mentions of the answer's derivation, ties by entity id, `observations` the answers citing the row that name it, the key absent when no answer names one; `meta.by_role_by_engine` lists every engine of `meta.engine_codes` in that order with the units and citing answers of each role over every citation in scope, zero when none, whatever `filter[domain_role_in]` says, so per role the units over the engines add up to `meta.by_role`); every `include` value of domains is now built; a NUL or other control character in `filter[registrable_domain]` or in the `{registrable_domain}` path value answers `422 validation_failed`
2026-11-13 WP-14: built `GET {P}/ai/sources/prompts` (BE-SOURCES-20): one row per prompt and engine with a counted answer (an engine with none has no row), each with `answers`, `answers_citing_own`, `own_citation_units` (distinct own URLs per answer), `own_pages` and `top_own_page` (the own page with the most units, ties by the lowest url id; null when none); `filter[own_cited]` keeps the pairs that cite an own page (`true`) or none (`false`); keyset pages `(prompt_id, engine_code)` with a cursor bound to the project and every filter (`400 invalid_cursor` for another scope or a forged key); the flag toggles on it still answer `501`
2026-11-13 WP-14: built `include_unresolved_redirects` and `include_engine_internal` on `sources/domains`, `sources/pages`, `sources/changes`, `sources/diversity`, `sources/domains/{registrable_domain}` and `sources/prompts`, and CHANGED the default (open question O1, approved by the coordinator): citations flagged `unresolved_redirect` or `engine_internal` are now left out of the citation units, citing answers, shares, series, `meta`, diversity numbers, change rules and own pages of those reads unless the toggle asks for them (docs/14 section 9); the answers still count in `meta.answers`; a citation with several excluded flags counts only when every one is asked for; `citations` and `fanout-queries` keep every citation; a `sources/prompts` cursor is bound to the toggles; the default is the one constant `FLAGGED_COUNTED_BY_DEFAULT`; ingest never sets `engine_internal` today, so only `unresolved_redirect` (Gemini grounding links and other redirects ingest could not unwrap) moves numbers
2026-11-13 WP-14: built `include=topics` on `fanout-queries` (BE-TOPICS-12): each row gets `topics`, the topic terms (terms of a `topic` vocabulary of the project or of the whole workspace; a term of another kind or of another project is never listed) tagged on the prompts whose counted answers issued the query, as `{ term_id, observations }` with the answers of those prompts that issued it (an answer counts once per term however often it lists the query), the most answers first, then by term id, at most 10; an empty list when no such prompt is tagged, the key absent without `include`; read in one statement for the page and scoped like the rows (branded prompts only with `include_branded`, `filter[country_iso]`, the window and the engines); the fan-out read still keeps every citation whatever its flags; no `501` is left in this contract; the share of answers whose list the 16 KB bound cut is measured by the read only query in `docs/ops/ai-fanout-cut-measure.md`, for the ops session to run once
2026-11-13 WP-14: `include=series` on `sources/pages` fills `meta.series` too, with the weekly answers, citation units and registrable domains of the scope (the row filters narrow the rows, not these)
2026-11-13 WP-14: the 16 KB bound of the stored extras (`ai_parse._bounded`, BE-FANOUT-03) now cuts the other lists (ads, brand entities) before the fan-out queries, for answers collected from now on; `meta.answers_truncated` is unchanged
2026-11-13 WP-14: built every addition of this note: `sources/changes`, `sources/diversity`, `sources/domains/{registrable_domain}`, `sources/prompts`, `include`, `min_support`, `filter[country_iso]`, the flag toggles and fan-out `include=topics`; the note reads as built, and only `category` and `category_source` stay unreturned (WP-60)
