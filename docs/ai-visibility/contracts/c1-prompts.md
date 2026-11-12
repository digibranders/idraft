# C1: prompts (list filters, create, change, lint, bulk, limits, provenance)

## Status

Published by WP-03 on 2026-11-13. Owner package: [WP-13 prompts-lane](../work-packages/WP-13-prompts-lane.md)
(MASTER-PLAN 3.3: `api/ai/limits_routes.py`; 3.6: the prompt and lint models in `schemas/ai.py` and
`schemas/ai_bulk.py`, which WP-03 extended additively under plan decision D4).

| Item | Kind | Answers today |
|---|---|---|
| `POST {P}/prompts/bulk-update` | new route (stub) | `501` after the access checks and body validation |
| `GET {P}/ai/limits` | new route (stub) | `501` after the access checks |
| `GET {P}/prompts`: `filter[prompt_type_in]`, `filter[funnel_stage_in]`, `filter[importance_in]`, `filter[is_branded]`, `sort`, `filter[is_active]=any` | optional addition to a built route | `501` when used |
| `POST {P}/prompts` and the items of `POST {P}/prompts/bulk-create`: `is_branded`, `source`, `creation_method`, `generated_from` | optional addition | `501` when any is sent; nothing is written |
| `PATCH {P}/prompts/{prompt_id}`: header `If-Match` | optional addition | `501` when sent; nothing is changed |
| `POST {P}/prompts/lint`: body shape `items`, member `language_code` | optional addition | `501` when used |
| `POST {P}/prompts/bulk-archive`: body shape `filter` | optional addition | `501` when used |
| Response fields `Prompt.prompt_type_source`, `Prompt.is_branded_source`, `PromptLint.tracked`, `PromptLint.near_duplicate_of`, `PromptLint.suggested_prompt_type`, `PromptQuota.would_create`, `PromptLintResponse.estimate` | new optional fields | absent from every response (not returned yet) |
| Lint rule names `word_count`, `multiple_questions`, `leading_wording`, `language_mismatch`, `contains_competitor_alias` | widened `LintWarning.rule` enum | never returned yet |

A request that leaves every addition out behaves exactly as before. Nothing else about the built routes
changes.

## Routes and parameters

All paths start with `{P}` (`/api/v1/workspaces/{workspace_id}/projects/{project_id}`).

| Method | Path | Permission | Success |
|---|---|---|---|
| GET | `{P}/prompts` | `data:read` | `200 PromptPage` |
| POST | `{P}/prompts` | `prompts:write` | `201 PromptResponse` (built) |
| POST | `{P}/prompts/bulk-create` | `prompts:write` | `200 PromptBulkResponse` (built) |
| PATCH | `{P}/prompts/{prompt_id}` | `prompts:write` | `200 PromptResponse` |
| POST | `{P}/prompts/lint` | `data:read` (stores nothing) | `200 PromptLintResponse` |
| POST | `{P}/prompts/bulk-archive` | `prompts:write` | `200 BulkArchiveResponse` |
| POST | `{P}/prompts/bulk-update` | `prompts:write` | `200 PromptBulkUpdateResponse` |
| GET | `{P}/ai/limits` | `data:read` | `200 AiLimitsResponse` |

### GET {P}/prompts: added query parameters

Existing parameters are unchanged (`filter[q]`, `filter[term]`, `filter[intent_in]`,
`filter[country_iso]`, `filter[language_code]`, `cursor`, `limit`).

| Parameter | Type | Bounds | Meaning |
|---|---|---|---|
| `filter[prompt_type_in]` | comma list of `question`, `comparison`, `recommendation`, `how_to`, `definition`, `local`, `transactional`, `other` | each value from the list | Prompts of any of these types. `501` when used. |
| `filter[funnel_stage_in]` | comma list of `tofu`, `mofu`, `bofu`, `retention`, `unknown` | each value from the list | `501` when used. |
| `filter[importance_in]` | comma list of integers | each 1 to 5 | `501` when used. |
| `filter[is_branded]` | boolean | | Branded or not branded prompts. `501` when used. |
| `sort` | `text`, `-text`, `importance`, `-importance`, `created_at`, `-created_at`, `updated_at`, `-updated_at` | one value | A field, `-` first for descending; left out: newest first. `501` when used. |
| `filter[is_active]` | `true` (default), `false` or the string `any` | | `any` lists active and archived prompts. `501` for `any` only; `true` and `false` work as before. |

The new list filters carry no bound on the number of values, as the existing `filter[intent_in]`.

### POST {P}/prompts and bulk-create items: added body members

All optional, none required. Existing members are unchanged (`text`, `language_code`, `country_iso`,
`intent`, `funnel_stage`, `prompt_type`, `importance`, `term_ids`).

| Member | Type | Bounds | Meaning |
|---|---|---|---|
| `is_branded` | boolean | | Overrides the branded flag computed from the own aliases. |
| `source` | `manual`, `csv_import`, `seo_keyword`, `paa`, `gsc_query` | | Where the prompt came from; left out: `manual`. The column holds more values (migration 0018) which only the server sets. |
| `creation_method` | `human`, `template`, `imported` | | How it was written; left out: `human`. `llm_generated` is set by the server only. |
| `generated_from` | `{ tracked_keyword_id: uuid, template: recommendation, comparison, how_to or procurement }` | both required, no other member | The tracked keyword and template it was generated from. |

A used member answers `501` before anything is written; in `bulk-create` that holds for the first item
that uses one, and no item is stored.

### PATCH {P}/prompts/{prompt_id}: added header

| Header | Type | Bounds | Meaning |
|---|---|---|---|
| `If-Match` | string | up to 128 characters | The `ETag` of the prompt as read. Optional. `501` when sent. |

The body (`PromptPatch`) is unchanged.

### POST {P}/prompts/lint: added request shape and member

The body is one of two shapes; the shape sent is the one validated (`items` present means the second).

| Shape | Members | Bounds |
|---|---|---|
| `texts` (built) | `texts`, `engine_codes?`, `language_code?` (new) | `texts` 1 to 1,000 strings; `engine_codes` 1 or more; `language_code` two lowercase letters. `language_code` answers `501`. |
| `items` (new, `501`) | `items`, `engine_codes?` | `items` 1 to 1,000 of `{ text, language_code, country_iso }`; `text` up to 8,000 characters (a text too long to save is linted and told so); `country_iso` two uppercase letters. |

### POST {P}/prompts/bulk-archive: added request shape

`{ ids, archive }` is built. The second shape, `{ filter, archive }`, answers `501`. `filter` is a
`PromptSelectionFilter`: the names of the list's filters without the brackets (`q`, `term`,
`intent_in`, `funnel_stage_in`, `prompt_type_in`, `importance_in`, `is_branded`, `country_iso`,
`language_code`, `is_active`). Each list holds 1 to 100 values; `q` is 1 to 200 characters;
`is_active` left out takes archived and active prompts alike.

### POST {P}/prompts/bulk-update (new)

| Member | Type | Bounds | Meaning |
|---|---|---|---|
| `ids` | uuid list | 1 to 1,000 | The project's prompts to change. Exactly one of `ids` and `filter`. |
| `filter` | `PromptSelectionFilter` | as above | The list's filters as a body. |
| `set` | `{ intent?, funnel_stage?, prompt_type?, importance?, is_branded? }` | at least one member, none null | The metadata to set. |
| `add_term_ids` | uuid list | up to 20, default empty | Terms to add. |
| `remove_term_ids` | uuid list | up to 20, default empty | Terms to remove. |

At least one of `set`, `add_term_ids` and `remove_term_ids` must say something. Response
`PromptBulkUpdateResponse`: `data.matched` (the project's prompts found) and `data.updated` (those that
changed). One transaction; one `prompt.bulk_changed` audit entry and one `prompt.updated` per prompt
changed (as the route description states).

### GET {P}/ai/limits (new)

No parameters. Response `data`:

| Field | Type | Meaning |
|---|---|---|
| `prompts` | `{ limit, used }` | Active prompts of the whole workspace against `max_active_prompts`. |
| `ai_observations_month` | `{ limit, used }` | AI answers of the whole workspace this UTC month, planned runs included, against `max_ai_observations_per_month`, counted as Run now counts them. |
| `manual_runs_today` | `{ used, limit }` | Manual runs people started in the project today (UTC). |

### New response fields (all optional, absent until built)

| Model | Field | Type | Meaning |
|---|---|---|---|
| `Prompt` | `prompt_type_source` | `rule` or `person` | Who set `prompt_type`. |
| `Prompt` | `is_branded_source` | `computed` or `override` | Whether `is_branded` is computed or set by a person. |
| `PromptLint` | `tracked` | `{ prompt_id, is_active }` | The project's prompt with this identity, archived ones too (with `items`). |
| `PromptLint` | `near_duplicate_of` | `{ prompt_id, text }` | A prompt that differs only in case and spacing. |
| `PromptLint` | `suggested_prompt_type` | `PromptType` | The type the server rule gives the text. |
| `PromptQuota` | `would_create` | integer | Of the items, those neither tracked nor repeated. |
| `PromptLintResponse` | `estimate` | `{ engines: [{ engine_code, prompts_fit, answers_per_month, monthly_cost_usd, run_now_answers, run_now_cost_usd }], total_monthly_cost_usd }` | What the prompts that would be created cost on the standard queue. Money is a decimal string, null when the price book has no price. |
| `LintWarning` | `rule` | widened enum | `contains_brand_alias`, `engine_limit` (built) plus `word_count`, `multiple_questions`, `leading_wording`, `language_mismatch`, `contains_competitor_alias`. |

## Error codes

Status and code, as the problem body carries them (`code`).

| Status | Code | When |
|---|---|---|
| 401 | `unauthenticated` | No session. |
| 404 | `not_found` | Not a member of the workspace; a project outside the member's scope; once built, a deleted or unknown project or prompt. |
| 403 | `forbidden` | The role lacks `data:read` (list, lint, limits) or `prompts:write` (the writes). A viewer is refused before any new member is looked at. |
| 403 | `workspace_suspended` | A write in a suspended workspace. |
| 422 | `validation_failed` | A value outside its bounds (for example `filter[importance_in]=6`, `sort=volume`, an `If-Match` over 128 characters, a `source` outside the five); the `errors` list names location, path and code. |
| 422 | `validation_failed` with field code `nothing_to_change` | Bulk update with none of `set`, `add_term_ids`, `remove_term_ids`. Raised by the body model today, before the `501`. |
| 422 | `validation_failed` with field code `added_and_removed` | Bulk update with a term in both `add_term_ids` and `remove_term_ids`. Raised today, before the `501`. |
| 422 | `validation_failed` (no named field code) | Bulk update with both or neither of `ids` and `filter`; `set` with no member or a null one. |
| 422 | `validation_failed` with field code `term_unknown` | A later body: a term the project may not use, at `add_term_ids` (create already answers it at `term_ids`). The exact path is the owner's. |
| 422 | `validation_failed` with field code `prompt_too_long` | Create or bulk-create text over the longest an engine takes (built). |
| 422 | `quota_exceeded` | A later body: bulk archive by filter with `archive: false` past the active prompt limit, all or none; carries `limit`, `used`, `requested` (built for `ids`). |
| 412 | `precondition_failed` | A later body: `If-Match` is not the prompt's current ETag. |
| 400 | `invalid_cursor` | A cursor used with other filters than it was issued for; the new filters and `sort` count as filters once built. |
| 501 | `not_implemented` | A stub, or an addition that was used (`detail` names it). |

Order: 401, 404, 403, 422 (body and parameters), then `501`. An addition used on a built route answers
`501` before the service reads anything, so `PATCH` with `If-Match` on a prompt that does not exist
answers `501`, not `404`, until the owner builds it.

## Example

The `501` body is in the [README](README.md). The responses below show what the owner will return.

### List with the new filters

```http
GET {P}/prompts?filter[prompt_type_in]=comparison,recommendation&filter[importance_in]=4,5&filter[is_branded]=false&sort=-importance&limit=50
```

```json
{
  "data": [
    {
      "prompt_id": "0000001b-7c1e-4a52-9b3d-00000000001b",
      "current_version": {
        "prompt_version_id": "0000009b-7c1e-4a52-9b3d-00000000009b",
        "version_no": 1,
        "text": "Asana vs Trello for a ten person agency",
        "text_hash": "661f8d4bb9d84b507c257a4be6682571a1b5f628b735e38f56901a3787a83913",
        "change_kind": "initial",
        "created_at": "2026-11-10T09:12:44Z"
      },
      "language_code": "en",
      "country_iso": "US",
      "intent": "commercial",
      "funnel_stage": "mofu",
      "prompt_type": "comparison",
      "prompt_type_source": "person",
      "importance": 4,
      "is_branded": false,
      "is_branded_source": "computed",
      "source": "manual",
      "creation_method": "human",
      "is_active": true,
      "terms": [
        {
          "term_id": "0000002a-7c1e-4a52-9b3d-00000000002a",
          "vocabulary_kind": "topic",
          "name": "Project management",
          "path": "Project management"
        }
      ],
      "created_by": {"user_id": "0000005a-7c1e-4a52-9b3d-00000000005a", "name": "Mara Voss", "email": "mara@example.com"},
      "created_at": "2026-11-10T09:12:44Z",
      "updated_at": "2026-11-10T09:12:44Z"
    }
  ],
  "page": {"limit": 50, "next_cursor": null, "has_more": false}
}
```

### Create with provenance

```http
POST {P}/prompts
```

```json
{
  "text": "Which CRM suits a small agency best?",
  "language_code": "en",
  "country_iso": "US",
  "intent": "commercial",
  "funnel_stage": "bofu",
  "prompt_type": "recommendation",
  "importance": 4,
  "term_ids": ["0000002a-7c1e-4a52-9b3d-00000000002a"],
  "is_branded": false,
  "source": "seo_keyword",
  "creation_method": "template",
  "generated_from": {"tracked_keyword_id": "0000003a-7c1e-4a52-9b3d-00000000003a", "template": "recommendation"}
}
```

`201`:

```json
{
  "data": {
    "prompt_id": "0000001c-7c1e-4a52-9b3d-00000000001c",
    "current_version": {
      "prompt_version_id": "0000009c-7c1e-4a52-9b3d-00000000009c",
      "version_no": 1,
      "text": "Which CRM suits a small agency best?",
      "text_hash": "06f50e2a132275ce29285ffd203ed499a40faf0becba107f5bb032e25b8e99dc",
      "change_kind": "initial",
      "created_at": "2026-11-10T09:12:44Z"
    },
    "language_code": "en",
    "country_iso": "US",
    "intent": "commercial",
    "funnel_stage": "bofu",
    "prompt_type": "recommendation",
    "prompt_type_source": "person",
    "importance": 4,
    "is_branded": false,
    "is_branded_source": "override",
    "source": "seo_keyword",
    "creation_method": "template",
    "is_active": true,
    "terms": [
      {
        "term_id": "0000002a-7c1e-4a52-9b3d-00000000002a",
        "vocabulary_kind": "topic",
        "name": "Project management",
        "path": "Project management"
      }
    ],
    "created_by": {"user_id": "0000005a-7c1e-4a52-9b3d-00000000005a", "name": "Mara Voss", "email": "mara@example.com"},
    "created_at": "2026-11-10T09:12:44Z",
    "updated_at": "2026-11-10T09:12:44Z"
  }
}
```

### Change with If-Match

The `ETag` format is the owner's to fix; the value below only shows where it goes.

```http
PATCH {P}/prompts/0000001a-7c1e-4a52-9b3d-00000000001a
If-Match: "3f9a1c"
```

```json
{"funnel_stage": "bofu", "importance": 5}
```

`200`:

```json
{
  "data": {
    "prompt_id": "0000001a-7c1e-4a52-9b3d-00000000001a",
    "current_version": {
      "prompt_version_id": "0000009a-7c1e-4a52-9b3d-00000000009a",
      "version_no": 1,
      "text": "What are the best project management tools for remote teams?",
      "text_hash": "871bfed7e47ba61ab0442a7afcf15fadcc097ff17cdcb9986d100bcc22be03ae",
      "change_kind": "initial",
      "created_at": "2026-11-10T09:12:44Z"
    },
    "language_code": "en",
    "country_iso": "US",
    "intent": "commercial",
    "funnel_stage": "bofu",
    "prompt_type": "recommendation",
    "prompt_type_source": "rule",
    "importance": 5,
    "is_branded": false,
    "is_branded_source": "computed",
    "source": "manual",
    "creation_method": "human",
    "is_active": true,
    "terms": [
      {
        "term_id": "0000002a-7c1e-4a52-9b3d-00000000002a",
        "vocabulary_kind": "topic",
        "name": "Project management",
        "path": "Project management"
      }
    ],
    "created_by": {"user_id": "0000005a-7c1e-4a52-9b3d-00000000005a", "name": "Mara Voss", "email": "mara@example.com"},
    "created_at": "2026-11-10T09:12:44Z",
    "updated_at": "2026-11-10T09:12:44Z"
  }
}
```

### Lint with items

```http
POST {P}/prompts/lint
```

```json
{
  "items": [
    {"text": "best crm", "language_code": "en", "country_iso": "US"},
    {
      "text": "what are the best project management tools for remote teams?",
      "language_code": "en",
      "country_iso": "US"
    },
    {"text": "Asana vs Trello for a ten person agency", "language_code": "en", "country_iso": "US"}
  ],
  "engine_codes": ["chatgpt_web", "gemini_web"]
}
```

The other new shape, `texts` with a language (`501` too until built):

```json
{"texts": ["Quelle est la meilleure solution de facturation ?"], "language_code": "en"}
```

`200`:

```json
{
  "data": [
    {
      "text": "best crm",
      "is_branded": false,
      "matched_aliases": [],
      "warnings": [
        {
          "rule": "word_count",
          "severity": "warning",
          "message": "A prompt reads best with 5 to 60 words.",
          "engine_code": null,
          "span": null
        }
      ],
      "suggested_prompt_type": "other"
    },
    {
      "text": "what are the best project management tools for remote teams?",
      "is_branded": false,
      "matched_aliases": [],
      "warnings": [],
      "near_duplicate_of": {
        "prompt_id": "0000001a-7c1e-4a52-9b3d-00000000001a",
        "text": "What are the best project management tools for remote teams?"
      },
      "suggested_prompt_type": "recommendation"
    },
    {
      "text": "Asana vs Trello for a ten person agency",
      "is_branded": false,
      "matched_aliases": [],
      "warnings": [],
      "tracked": {"prompt_id": "0000001b-7c1e-4a52-9b3d-00000000001b", "is_active": false},
      "suggested_prompt_type": "comparison"
    }
  ],
  "quota": {"limit": 150, "used": 87, "would_create": 1},
  "estimate": {
    "engines": [
      {
        "engine_code": "chatgpt_web",
        "prompts_fit": 1,
        "answers_per_month": 9,
        "monthly_cost_usd": "0.010800",
        "run_now_answers": 1,
        "run_now_cost_usd": "0.001200"
      },
      {
        "engine_code": "gemini_web",
        "prompts_fit": 1,
        "answers_per_month": 9,
        "monthly_cost_usd": null,
        "run_now_answers": 1,
        "run_now_cost_usd": null
      }
    ],
    "total_monthly_cost_usd": "0.010800"
  }
}
```

### Bulk update

```http
POST {P}/prompts/bulk-update
```

```json
{
  "ids": ["0000001a-7c1e-4a52-9b3d-00000000001a", "0000001b-7c1e-4a52-9b3d-00000000001b"],
  "set": {"funnel_stage": "bofu", "importance": 5},
  "add_term_ids": ["0000002b-7c1e-4a52-9b3d-00000000002b"],
  "remove_term_ids": ["0000002a-7c1e-4a52-9b3d-00000000002a"]
}
```

The same with a selection by filter instead of ids:

```json
{"filter": {"prompt_type_in": ["comparison"], "is_active": true}, "set": {"is_branded": false}}
```

`200`:

```json
{"data": {"matched": 2, "updated": 2}}
```

### Bulk archive by filter

```http
POST {P}/prompts/bulk-archive
```

```json
{"filter": {"importance_in": [1, 2], "is_branded": false}, "archive": true}
```

`200`:

```json
{"data": {"matched": 14, "updated": 14}}
```

### Limits

```http
GET {P}/ai/limits
```

`200`:

```json
{
  "data": {
    "prompts": {"limit": 150, "used": 87},
    "ai_observations_month": {"limit": 20000, "used": 5220},
    "manual_runs_today": {"used": 3, "limit": 20}
  }
}
```

## Open choices

Each row can be tightened (or fixed in detail) by WP-13 through the change log.

| Q | Question | Choice | Why |
|---|---|---|---|
| Q1 | Length rule name: `word_count` or doc 19 `length` | `word_count` | Inventory C1, N03 and the dialog spec name it; doc 19 predates the 5 to 60 words rule. |
| Q2 | `filter[importance_in]` (C1) or `filter[importance_lte]` (doc 19) | `filter[importance_in]` only | The rows WP-13 closes name it; `_lte` can be added later additively. |
| Q3 | Bulk update term changes | `add_term_ids` and `remove_term_ids` | The tracked keyword bulk update does exactly this (`TrackedKeywordBulkUpdate`); replace can come later. |
| Q4 | Bulk update selection: `ids` only or `ids` or `filter` | exactly one of `ids`, `filter` | Two specs against one; the keyword house rule (`Selection`). |
| Q5 | Quota read: `PromptPage.meta.quota`, `GET {W}/quotas` or `GET {P}/ai/limits` | `GET {P}/ai/limits` with N06's names (decision D6) | One place for the same numbers; CF-11 needs the manual runs too, which are per project. The other two can be added later additively. |
| Q6 | Which `source` values a caller may send | `manual`, `csv_import`, `seo_keyword`, `paa`, `gsc_query` | N07's list; widening a request enum later is additive, narrowing is not. |
| Q7 | `generated_from.template` type | the four template names of doc 19 `from-keywords/preview` | Doc 19 names them; a string would be wider than any spec. |
| Q8 | `prompt_type` default on create | unchanged (`question`); `prompt_type_source` added, not returned yet | The field is optional in the generated client either way; WP-13 swaps the default for the rule. |
| Q26 | `If-Match` on prompt `PATCH` required or optional | optional header, `501` while not built | Doc 19 2.11: optional in V1 except versions and memberships. |
| Q27 | How `filter[is_active]` takes `any` | `boolean` or the string `any` | Keeps `true` and `false` exactly as today. |
| Q28 | `expected_frequency` on create and in `Prompt` | left out | Owner decision: no frequency per prompt ("Not asked of the backend"). |
| D5 | Lint `items` (N01) and bulk archive `filter` (D-23) shape | a second body shape in a tagged union; the first shape is unchanged | The service keeps its types (`body.texts`, `body.ids` stay required), no service file changes, the generated component names stay. |
| D7 | Bounds | every body list and string is bounded (the list query filters of the prompts list are not, as `filter[intent_in]`) | House rule in `schemas/common.py`: a lone surrogate or a control character must be a 422, not a 500. |

Also published, from the work package: `contains_competitor_alias` as a lint rule name (owner decision
D-21, competitor aliases get their own warning rule); the confirmed branded definition and who sets the
funnel stage (D-22) are WP-13's.

## How the owner package fills it

1. `bulk_update_prompts` in `api/ai/prompt_routes.py` and `ai_limits` in `api/ai/limits_routes.py`: drop
   `@not_built` and `raise not_built_yet()` (`idraft.api.stubs`), write the service. Bulk update is a
   write that reads the caller's workspace only: a prompt id of another project or workspace is not
   matched and is no error (as bulk archive).
2. The additions, one by one: remove the entry from the `refuse_unbuilt` call (`list_prompts`,
   `create_prompt`, `bulk_create_prompts` through `_unbuilt_members`, `update_prompt`, `lint_prompts`),
   the `is_active` `any` raise and the `PromptLintItems` and `PromptBulkArchiveByFilter` raises. Delete
   `_unbuilt_members` when the last create member is built. Bind a keyset cursor to the new filters and
   `sort`.
3. Replace `tests/api/ai/test_contract_prompts.py` and `tests/api/ai/test_contract_lint_bulk.py` with
   real tests.
4. A foreign or nonexistent project answers `404` through the service; the stubs answered `501`. The
   cross-tenant suite already sends a bulk-update body (`ids` and `set.importance`) under the WP-03
   anchor; once the mark is gone the strict rules apply to it.
5. Remove the `Not built yet` sentences from the route and parameter descriptions and the `Not
   returned yet` text from the new fields, regenerate `backend/openapi/v1.json`, then `pnpm gen:api`.

## Change log

Newest last; one line per change, in the form `date package: change`.

2026-11-13 WP-03: contract published
2026-11-13 WP-13: `include=prompt_count` on `GET {W}/vocabularies/{vocabulary_id}/terms` adds `TermNode.prompt_count`. It is opt-in and absent without the include. It counts active, live prompts in projects the member can see, branded or not. It is a membership count, like `keyword_count`, not a rate. Each prompt is counted once, even when several of its terms sit under the same ancestor. One grouped statement. Archived and deleted prompts and projects are left out.
2026-11-13 WP-13: `PromptCreate.prompt_type` loses its default `question`. This replaces the default that Q8 kept. Left out: the server rule (see the `prompt_type` rule entry below) sets the type and `Prompt.prompt_type_source` is `rule`. Sent: the type is kept as sent and `prompt_type_source` is `person`. A PATCH that sets `prompt_type` also sets `person`. Each bulk-create item takes the rule on its own when it leaves the type out.
2026-11-13 WP-13: `GET` and `PATCH {P}/prompts/{prompt_id}` return an `ETag` header. The value is a quoted string of 32 lowercase hex characters: the first 32 of a SHA-256 over the prompt snapshot, its current version id and the two source fields, as sorted JSON. It changes with every metadata or term change. It does not use `updated_at`, because a terms-only PATCH does not bump `updated_at`. `PATCH` takes `If-Match`, a comma list of ETags or `*`. When no listed value matches the current ETag, the answer is `412 precondition_failed` and nothing changes. A missing prompt answers `404` and a viewer is refused before the header is read. Without `If-Match`, PATCH works as before. The `If-Match: "3f9a1c"` value in the change example above is a placeholder, not an ETag in this form.
2026-11-13 WP-13: `Prompt.prompt_type_source` (`rule` or `person`) and `Prompt.is_branded_source` (`computed` or `override`) are required fields and always returned on every prompt response. Rows that exist before the migration read `person` and `computed`.
2026-11-13 WP-13: Term assignments for prompts (`subject_type: prompt`) take `subject_ids` only, up to 5,000. A `subject_filter` answers `422` with `subject_filter` / `filter_not_supported`. To choose prompts by filter, use `POST {P}/prompts/bulk-update`. A bulk selection by filter, on bulk-update and on bulk-archive, takes at most 1,000 prompts. More than that answers `422 too_many_subjects` with `limit: 1000`.
2026-11-13 WP-13: Lint estimate rounding, following PD-QC-01 and PD-QC-03. `answers_per_month` is `prompts_fit x 2 x 52 / 12`, rounded down: one prompt gives 8 and three prompts give 26. `monthly_cost_usd` is `monthly_cost()` rounded to the cent: `"0.01"` for one prompt. `run_now_answers` and `run_now_cost_usd` are not rounded. Correction to the lint example: `answers_per_month` is 8 for `chatgpt_web` and `gemini_web` (not 9), `monthly_cost_usd` and `total_monthly_cost_usd` are `"0.01"` (not `"0.010800"`), and the `run_now` values stay as shown.
2026-11-13 WP-13: `prompt_type` rule (owner decision in doc 19, 2026-11-12). The rule has no recommendation branch. The text is case folded and the first match wins. A word-bounded `vs`, `vs.` or `versus` gives `comparison`. The words `how to` anywhere in the text give `how_to`. A leading `what`, `which`, `who`, `whom`, `whose`, `where`, `when`, `why`, `how`, `is`, `are`, `can`, `could`, `should`, `does`, `do`, `did`, `will` or `would`, or a text ending in `?`, U+FF1F or U+061F, gives `question`. Anything else gives `other`. No LLM. Corrections: the lint example's `suggested_prompt_type` for "what are the best project management tools for remote teams?" is `question`, not `recommendation`. The PATCH example shows `prompt_type: recommendation` with `prompt_type_source: rule`, which the rule cannot give for that text. It reads `question` with `rule`, or `recommendation` with `person` if a person set it. The create example sends `recommendation` by hand; it stays valid and reads `person`.
2026-11-13 WP-13: `language_mismatch` is found by a heuristic, with no new dependency. It needs a known language and at least 4 words. It fires when the dominant script (at least 60% of the letters, script read from the `unicodedata` names) is not one of the language's scripts. For `en`, `de`, `fr`, `es`, `it`, `pt` and `nl` only, it also fires when another of these seven languages' function words hit at least 2 times and at least the declared language's hits plus 2. Unknown language codes skip the script table. The function-word check covers only these seven languages.
