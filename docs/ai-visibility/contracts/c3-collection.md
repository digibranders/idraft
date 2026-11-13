# C3 and N5: AI coverage of a run and daily AI collection

## Status

Published by WP-03 on 2026-11-13 as two new routes that answered `501 not_implemented` after their access
checks, and built by WP-30 on 2026-11-14: both routes now answer as described below. Owner package:
[WP-30 runs-costs-health](../work-packages/WP-30-runs-costs-health.md)
(MASTER-PLAN 3.3: `api/operations/collection_routes.py`; rows BE-COLLECT-10 and OV-N5). The schemas are
in `backend/src/idraft/api/schemas/ai_collection.py`, the services in `ai_coverage.py` and
`collection_daily.py` of the same package, and `NotAnAiRunError` in `collection_errors.py`.

## Routes and parameters

| Method | Path | Permission | Success |
|---|---|---|---|
| GET | `{P}/runs/{run_id}/ai-coverage` | `data:read` | `200 AiCoverageResponse` |
| GET | `{P}/ai/collection/daily` | `data:read` | `200 CollectionDailyResponse` |

### GET {P}/runs/{run_id}/ai-coverage

Path: `run_id` (uuid). No query parameters. For a run of workload `ai_prompt`: per engine the tasks
planned, the answers stored, the valid ones and the others by status, with the valid rate; and every
planned task with no stored answer.

`data`:

| Field | Type | Bounds | Meaning |
|---|---|---|---|
| `by_engine[]` | `AiCoverageEngine` | at most 3 (one per engine) | One entry per engine of the run. |
| `by_engine[].engine_code` | `EngineCode` (`chatgpt_web`, `gemini_web`, `google_ai_mode`) | | |
| `by_engine[].planned` | integer | | Tasks the run planned on the engine. |
| `by_engine[].observed` | integer | | Answers stored, of any status: `valid` plus `invalid_by_status`. |
| `by_engine[].valid` | integer | | Answers with status `complete` or `partial`. |
| `by_engine[].partial` | integer | | Of the valid answers, the ones flagged `partial` (2026-11-14, WP-30). |
| `by_engine[].invalid_by_status` | `{ empty, refused, error }` integers | | The stored answers that are not valid, by status. `partial` is not here (2026-11-14, WP-30). |
| `by_engine[].valid_rate` | `MetricCell` | | `valid` of `planned`: `numerator` valid, `denominator` planned. |
| `missing[]` | `AiCoverageMissing` | unbounded (the run's tasks) | Every planned task with no stored answer. |
| `missing[].prompt_id` | uuid | | |
| `missing[].engine_code` | `EngineCode` | | |
| `missing[].location_id` | integer or null | | |
| `missing[].replicate_index` | integer | | |
| `missing[].task_status` | `pending`, `submit_unknown`, `submitted`, `ready`, `fetched`, `ingested`, `failed`, `dead`, `cancelled`, `skipped_cached` | | `ops.collection_tasks.status` (migration 0004). |

### GET {P}/ai/collection/daily

| Parameter | Type | Bounds | Meaning |
|---|---|---|---|
| `from` | date | | First project-local day, included. Default: the 28 days ending today. |
| `to` | date | | Last project-local day, included. At most 92 days from `from` (`422 window_too_large`). |
| `filter[engine_code_in]` | comma list of `EngineCode` | at most 3 values (published as `maxLength: 3`) | Left out: every engine. |

Response:

| Field | Type | Bounds | Meaning |
|---|---|---|---|
| `data[]` | `CollectionDay` | at most 276 (92 days times 3 engines) | A row per day and engine. |
| `data[].date` | date | | A project day. (In Python the field is `date_`; the wire name is `date`.) |
| `data[].engine_code` | `EngineCode` | | |
| `data[].scheduled` | integer or null | | Answers the schedules active that day planned; null when unknown, never 0 for unknown. |
| `data[].answers` | integer | | Answers stored that day. |
| `data[].by_status` | `{ complete, partial, empty, refused, error }` integers | | The answers stored by status. |
| `data[].valid` | integer | | Answers with status `complete` or `partial`. |
| `data[].budget_blocked` | integer | | Runs of the day a budget blocked. |
| `data[].runs[]` | uuid | unbounded (the day's runs) | The runs whose answers the day holds. |
| `meta.window` | `{ from, to, timezone }` | | The window answered. |
| `meta.engine_codes` | `EngineCode[]` | at most 3 | The engines read. |

## Error codes

| Status | Code | When |
|---|---|---|
| 401 | `unauthenticated` | No session. |
| 404 | `not_found` | Not a member of the workspace; a project outside the member's scope; a run that is not in the project. |
| 403 | `forbidden` | The role lacks `data:read`. |
| 422 | `validation_failed` | A bad `run_id` (not a uuid), an engine outside `EngineCode` (`filter[engine_code_in]=perplexity_web`), a value that is not a date. |
| 422 | `validation_failed` with field code `range_invalid` | `from` after `to`, at `from` (as the built AI reads). |
| 422 | `not_an_ai_run` | The run's workload is not `ai_prompt` (ai-coverage): `NotAnAiRunError`, WP-30 plan decision D5. |
| 422 | `window_too_large` | `to` more than 92 days after `from` (carries `limit_days`). |

Order of ai-coverage: 401, 404 (workspace, project, or a run outside the project), 403, 422 (path and
query values), then `not_an_ai_run`.

## Example

The responses show what the routes return.

```http
GET {P}/runs/0000006a-7c1e-4a52-9b3d-00000000006a/ai-coverage
```

`200`:

```json
{
  "data": {
    "by_engine": [
      {
        "engine_code": "chatgpt_web",
        "planned": 147,
        "observed": 145,
        "valid": 141,
        "partial": 3,
        "invalid_by_status": {"empty": 2, "refused": 1, "error": 1},
        "valid_rate": {"value": 0.96, "numerator": 141.0, "denominator": 147, "n_observations": 145, "pooled": null}
      }
    ],
    "missing": [
      {
        "prompt_id": "0000001a-7c1e-4a52-9b3d-00000000001a",
        "engine_code": "chatgpt_web",
        "location_id": 2840,
        "replicate_index": 0,
        "task_status": "failed"
      },
      {
        "prompt_id": "0000001b-7c1e-4a52-9b3d-00000000001b",
        "engine_code": "chatgpt_web",
        "location_id": null,
        "replicate_index": 1,
        "task_status": "dead"
      }
    ]
  }
}
```

```http
GET {P}/ai/collection/daily?from=2026-11-12&to=2026-11-13&filter[engine_code_in]=chatgpt_web
```

`200`:

```json
{
  "data": [
    {
      "date": "2026-11-12",
      "engine_code": "chatgpt_web",
      "scheduled": 147,
      "answers": 145,
      "by_status": {"complete": 138, "partial": 3, "empty": 2, "refused": 1, "error": 1},
      "valid": 141,
      "budget_blocked": 0,
      "runs": ["0000006a-7c1e-4a52-9b3d-00000000006a"]
    },
    {
      "date": "2026-11-13",
      "engine_code": "chatgpt_web",
      "scheduled": null,
      "answers": 0,
      "by_status": {"complete": 0, "partial": 0, "empty": 0, "refused": 0, "error": 0},
      "valid": 0,
      "budget_blocked": 1,
      "runs": []
    }
  ],
  "meta": {
    "window": {"from": "2026-11-12", "to": "2026-11-13", "timezone": "Europe/Berlin"},
    "engine_codes": ["chatgpt_web"]
  }
}
```

## Open choices

Each row can be tightened by WP-30 through the change log.

| Q | Question | Choice | Why |
|---|---|---|---|
| Q15 | `valid_rate` as `MetricValue` (doc 19 3.7.5) or `MetricCell` | `MetricCell`, numerator `valid`, denominator `planned` | Every AI read so far uses `MetricCell`; "valid of planned" is BE-COLLECT-10. |
| Q16 | Unit of `budget_blocked` | Runs of that day blocked by a budget | The field sits beside `runs`; answers of a blocked run are never asked. |
| D7 | Bounds | `by_engine`, `meta.engine_codes` at most 3; `data` at most 276; `missing` and `runs` left unbounded | Response lists sized by the run's tasks and the day's runs; a bound would cut real data. |

## How the owner package fills it

1. In `api/operations/collection_routes.py` drop `@not_built` and `raise not_built_yet()` from
   `ai_coverage` and `collection_daily` (`idraft.api.stubs`); check the window and the run in the
   service (`window_too_large`, `range_invalid`, `not_an_ai_run` as a new `ProblemError` in WP-30's own
   module).
2. Replace `tests/api/operations/test_contract_collection.py` with real tests.
3. A foreign or nonexistent project, and a run outside the project, answer `404` through the service;
   the stubs answered `501`.
4. Remove the `Not built yet` sentence from both route descriptions, regenerate
   `backend/openapi/v1.json`, then `pnpm gen:api`.

## Change log

Newest last; one line per change, in the form `date package: change`.

2026-11-13 WP-03: contract published
2026-11-14 WP-30: `valid` is answers with status `complete` or `partial` (what every rate counts, doc 07 section 5.5); it was ambiguous because `InvalidByStatus` listed `partial` as invalid
2026-11-14 WP-30: `InvalidByStatus` is `{ empty, refused, error }`; `partial` is removed from it
2026-11-14 WP-30: `AiCoverageEngine.partial` added (required): of the valid answers, the ones flagged `partial`
2026-11-14 WP-30: example corrected so it adds up: observed is valid plus empty, refused and error (147 planned, 145 observed, 141 valid of which 3 partial, 2 empty, 1 refused, 1 error, 2 missing)
2026-11-14 WP-30: `not_an_ai_run` is `422`, checked after 401, 404 (workspace, project, run outside the project), 403 and the 422 of path and query values (D5)
2026-11-14 WP-30: `planned` is the run's tasks that are not `cancelled` or `skipped_cached`; `observed` is the tasks with a current answer; `missing` is the planned tasks with no current answer in any task status, ordered by prompt, engine, location (nulls last) and replicate (D2, D3)
2026-11-14 WP-30: `valid_rate.value` is null when `planned` is 0, never 0 (D4)
2026-11-14 WP-30: a day is the project's local day; the default window is the 28 days ending today, at most 92 (`window_too_large` with `limit_days`), `from` after `to` is `range_invalid`; rows are dense (a row per day and engine, zero filled); `meta.engine_codes` is the filter, else the engines enabled on the project plus any engine with a row in the window (D6)
2026-11-14 WP-30: `scheduled` counts the tasks (not cancelled, not skipped) of `ai_prompt` runs whose `scheduled_for` falls on the day; null when the day and engine have no such task, even if a blocked run exists (D7, as built)
2026-11-14 WP-30: `budget_blocked` counts `ai_prompt` runs with status `budget_blocked` by the local day of `completed_at`, on each engine the run asked for, else on every engine of the response; it counts runs, so it is never summed across engines; `runs[]` is the distinct runs of the day's answers on that engine plus the blocked runs of the day, oldest first (D8)
2026-11-14 WP-30: valid_rate.n_observations is the answers observed (145 in the example), not the planned tasks
2026-11-14 WP-30: routes built, so neither answers `501` any more; the Status paragraph, the error table and the order line are plain statements of what the code does; the examples are kept; a `complete` answer whose extraction hit `TooManyMatchesError` is stored `complete` with `is_valid` false and coverage counts by observation status, so it is not seen (rare)
