# AI visibility contract notes

Published by WP-03 on 2026-11-13. One note per contract group; each says what is published, what it
looks like on the wire, who builds the body and how. The code and `backend/openapi/v1.json` are the
source of truth for a field name or a bound; a note explains them and holds the choices behind them.
Plan: [docs/superpowers/plans/2026-11-13-ai-wp-03-contract-pack.md](../../superpowers/plans/2026-11-13-ai-wp-03-contract-pack.md).
Brief: [WP-03](../work-packages/WP-03-contract-pack.md).

## Index

| Note | Group | Routes | Owner package |
|---|---|---|---|
| [c1-prompts.md](c1-prompts.md) | C1: prompt list, create, change, lint, bulk, limits, provenance | 6 built operations extended, `POST {P}/prompts/bulk-update`, `GET {P}/ai/limits` | [WP-13](../work-packages/WP-13-prompts-lane.md) |
| [c2-summary.md](c2-summary.md) | C2: summary compare, total, rows, co-mentions, filters, country | `GET {P}/ai/prompts-summary` extended | [WP-12](../work-packages/WP-12-summary-lane.md) |
| [c3-collection.md](c3-collection.md) | C3 and N5: run coverage, daily collection | `GET {P}/runs/{run_id}/ai-coverage`, `GET {P}/ai/collection/daily` | [WP-30](../work-packages/WP-30-runs-costs-health.md) |
| [budgets-costs.md](budgets-costs.md) | Budgets CRUD, cost forecast, unit costs | `GET/POST {W}/budgets`, `PATCH/DELETE {W}/budgets/{budget_id}`, `GET {W}/costs/forecast`, `GET {W}/costs/unit-costs` | [WP-30](../work-packages/WP-30-runs-costs-health.md) |
| [sources-additions.md](sources-additions.md) | Sources: series, cited with, role per engine, country, min support, changes | 4 built reads extended, `GET {P}/ai/sources/changes` | [WP-14](../work-packages/WP-14-sources-lane.md) |
| [annotations-notes.md](annotations-notes.md) | N9 annotations and N13 notes | `GET {P}/ai/annotations`, `GET` and `POST {P}/notes`, `DELETE {P}/notes/{note_id}` | [WP-38](../work-packages/WP-38-notes-annotations.md) |
| [evidence.md](evidence.md) | Evidence: answer hashes, citation quote, answer compare | `GET {P}/ai/observations/{observation_id}/compare`, 3 optional fields of the answer detail | [WP-26](../work-packages/WP-26-evidence-viewer.md) |
| [c12a-layouts.md](c12a-layouts.md) | C12a: team and personal page layouts | `GET {W}/layouts/{screen}`, `PUT` and `DELETE {W}/me/layouts/{screen}`, `PUT` and `DELETE {W}/layouts/{screen}/default` | [WP-11](../work-packages/WP-11-layouts-api.md) |
| [c8-metrics.md](c8-metrics.md) | C8 metric part: overview, one metric, series, breakdown | `GET {P}/ai/metrics/overview`, `GET {P}/overview/ai`, `GET {P}/ai/metrics/{metric}`, `.../{metric}/series`, `.../{metric}/breakdown` | [WP-32](../work-packages/WP-32-overview-aggregates.md) |
| [c5-competitors.md](c5-competitors.md) | C5 competitor part: competitors read and Overview competitor table | `GET {P}/ai/competitors`, `GET {P}/overview/competitors` | [WP-32](../work-packages/WP-32-overview-aggregates.md) |
| [wp-31-engines-device.md](wp-31-engines-device.md) | WP-31: device per AI engine (Google AI Mode) | `GET {P}/engines` and `PUT {P}/engines/{engine_code}` extended | [WP-31](../work-packages/WP-31-settings-engines.md) |

14 new routes (all answered `501 not_implemented` after their access checks when published) and 11 built
operations with optional additions (answer `501` when an addition is used). Update 2026-11-13: the five
layout routes of C12a are built by WP-11 and no longer answer `501`; the other notes are still stubs
until their owners build them. Owners follow MASTER-PLAN 3.3 (modules)
and 3.6 (ownership). WP-03 edited the summary, prompt, lint and source models of other packages
only additively (plan decision D4).

Update 2026-11-13 (WP-14): the sources note ([sources-additions.md](sources-additions.md)) is built by WP-14. Its
additions and `GET {P}/ai/sources/changes` no longer answer `501`, and WP-14 added three routes (`sources/diversity`,
`sources/domains/{registrable_domain}`, `sources/prompts`); only `category` and `category_source` stay unreturned (WP-60).

Update 2026-11-13 (WP-32): two notes are added, [c8-metrics.md](c8-metrics.md) and [c5-competitors.md](c5-competitors.md),
for seven new routes (`ai/metrics/overview`, `overview/ai`, `ai/metrics/{metric}`, `ai/metrics/{metric}/series`,
`ai/metrics/{metric}/breakdown`, `ai/competitors`, `overview/competitors`). They answer `501 not_implemented` after
their access checks until WP-32 builds them, and they are not in the count above.

## Conventions

- `{W}` is `/api/v1/workspaces/{workspace_id}`; `{P}` is `{W}/projects/{project_id}`.
- Examples were produced by instantiating the Pydantic model each documents and printing it, so they
  are valid against it. Ids, names, numbers and model names inside them are made up. A request example
  shows only the members that matter for the addition.
- A response field marked "not returned yet" is optional in the generated client and absent from
  every response (the model leaves it out, it is never sent as `null`) until the owner builds it.
- A route's success status is the one its built shape will have (`200`, `201` or `204`); until then it
  answers `501`.
- Every owner may tighten a choice (narrow a bound, add a code, fix a format) through the note's
  change log. Widening a request value later is additive; narrowing is not, so the contract starts wide
  only where a spec asked for it.

## The stub mechanism

`backend/src/idraft/api/stubs.py` holds the shared pattern:

| Name | What it does |
|---|---|
| `not_built(endpoint)` | Marks the endpoint function of a route whose body only raises `not_built_yet()`. |
| `is_not_built(endpoint)` | True for a marked endpoint; read by the cross-tenant suite. |
| `not_built_yet(detail)` | Returns `NotImplementedProblemError` (`501`, code `not_implemented`, title "Not built yet"). |
| `refuse_unbuilt(sent)` | For a built route that gained an addition: `501` naming, in order, every addition the request used (`Not built yet: rows, group_by.`); nothing when none was used. |

A stub declares the access dependency, path, query and body parameters its built route will have, and
its body is `raise not_built_yet()`. The checks run before the body, so the answer order is:

1. `401 unauthenticated`: no session.
2. `404 not_found`: not a member of the workspace, or a project outside the member's scope.
3. `403 forbidden` (`workspace_suspended` on a write in a suspended workspace): permission missing.
4. `422 validation_failed`: a path, query, header or body value outside its bounds (FastAPI reports it
   after the dependencies above and before the route body).
5. `501 not_implemented`.

A built route with an addition (`refuse_unbuilt`) answers `501` for a used addition after the same four
steps and before its service reads anything. A request that leaves the additions out behaves exactly as
before. Because the stub and the refusal read nothing, a project id that does not exist, or belongs to
another workspace, still answers `501` for a caller who is inside their own workspace and scope; the
`404` for such a project comes from the service the moment the owner builds the body.

The `501` problem body (RFC 9457, `application/problem+json`); `type` starts with the configured app
origin, shown here as `https://app.idraft.ai`:

```json
{
  "type": "https://app.idraft.ai/api/problems/not_implemented",
  "title": "Not built yet",
  "status": 501,
  "detail": "This route's contract is published; its body is not built yet.",
  "instance": "/api/v1/workspaces/0191a7c2-7c1e-4a52-9b3d-0000000000a1/projects/0191a7c2-7c1e-4a52-9b3d-0000000000b2/ai/limits",
  "code": "not_implemented",
  "request_id": "req_01JD3Y8Q6Z7K4M2N9P5R8T1V0W"
}
```

`detail` is `Not built yet: <names>.` for an addition. Problem codes are not part of the OpenAPI
document; each note lists the codes a route answers or will answer.

## The NOT_BUILT rule in the cross-tenant suite

`backend/tests/security/test_cross_tenant.py` computes `NOT_BUILT`: every `(method, path)` whose endpoint
carries the mark. The rule is generic, with no list to maintain. For a marked route the suite expects
`501` where it would otherwise expect a success or a `404`: inside the member's scope, for a project
outside the workspace (`_answer_for_a_foreign_child`), and for a list read. A package moves a route out
of `NOT_BUILT` by dropping `@not_built` and the `raise`; from then on the strict rules apply (`404` for a
foreign child, `2xx` inside the scope, a list that shows the caller's own data). A body that still
raises after the mark was dropped fails the suite, and a mark left on a built body does too.
`test_the_published_contracts_are_the_not_built_routes` asserts that every marked route is a workspace
route (the fixed layouts example this note once described no longer exists in the test; the layouts
note says what WP-11 did).
Routes extended through `refuse_unbuilt` are ordinary routes and are not marked.

## How an owner fills a note (all notes)

1. Drop `@not_built` and the `raise not_built_yet()` from the stub (`idraft.api.stubs`); for an extended
   operation replace the `refuse_unbuilt` entry of the addition with its behaviour.
2. Replace the `tests/api/**/test_contract_*.py` file of the group with real tests, then delete it.
3. A foreign or nonexistent project answers `404` through the new service; the stub answered `501`.
4. Regenerate `backend/openapi/v1.json` and, in the same push, run `pnpm gen:api` in `apps/web`.
5. Add a row to the note's change log for anything that is not exactly as published.

Each note ends with the steps that are specific to its group.

## Known quirks (not defects)

- The annotations route function is named `list_annotations`, so its `operationId` is
  `list_annotations_api_v1_workspaces__workspace_id__projects__project_id__ai_annotations_get` and the
  generated client calls it `list_annotations...`.
- A list query parameter's bound is published as `maxLength` in the OpenAPI document (for example
  `filter[engine_code_in]` has `maxLength: 3`), as the existing engine filters do. It bounds the number
  of values, not their length.
- Two long generated component names, `FilterList_Annotated_int__...` and `FilterList_Literal__...`,
  come from the house alias `FilterList` (`schemas/keywords.py`), as for other lists. This package adds
  two more of them for the bulk selection filter: the importance list
  (`FilterList_Annotated_int__..._Le_le_5_____`) and the prompt type list
  (`FilterList_Literal__question____comparison____...`). Do not rename them.
- `AiCoverage.missing` and `CollectionDay.runs` are unbounded response lists (their size is the run's
  tasks and the day's runs, set by the data). Every other new list is bounded.
- The `PromptLintBody` and `PromptBulkArchiveBody` request bodies are tagged unions: the OpenAPI
  document shows `oneOf` of two components, and the error mapper leaves the tags out of error paths.
