# C12a: team and personal page layouts

## Status

Published by WP-03 on 2026-11-13 as five new routes that answer `501 not_implemented` after their access
checks. Owner package: [WP-11 layouts-api](../work-packages/WP-11-layouts-api.md) (MASTER-PLAN 3.3:
`api/layouts/routes.py`; doc 19 section 3.11.5c; the layout spec sections 4, 6 and 9). The schemas are
in `backend/src/idraft/api/schemas/ai_layouts.py`. Web consumers: WP-15 and WP-16.

A layout belongs to the workspace and is the same in every project. Presets are code in the web app
(owner decision D-01), so there is no preset route. No table is added by WP-03: WP-11 adds
`core.layouts` (owner decision D-09: row-level security on the current user id plus the application
check, both tested).

## Routes and parameters

Paths start with `{W}` (`/api/v1/workspaces/{workspace_id}`); these routes have no project.

| Method | Path | Permission | Success |
|---|---|---|---|
| GET | `{W}/layouts/{screen}` | any member | `200 ResolvedLayoutResponse`, with an `ETag` |
| PUT | `{W}/me/layouts/{screen}` | any member | `200 ResolvedLayoutResponse` |
| DELETE | `{W}/me/layouts/{screen}` | any member | `204`, no body |
| PUT | `{W}/layouts/{screen}/default` | `layouts:manage` (owner, admin; D-11) | `200 ResolvedLayoutResponse` |
| DELETE | `{W}/layouts/{screen}/default` | `layouts:manage` | `204`, no body |

Common parameters:

| Parameter | In | Type | Bounds | Meaning |
|---|---|---|---|---|
| `screen` | path | string | 1 to 64, `^[a-z_]+(\.[a-z_]+)?$` | A screen key (layout spec section 4); an unknown one is `404` (WP-11 checks it). |
| `If-Match` | header, `PUT` only | string | up to 128 characters | The `ETag` of the layout as read: required when one exists, `412 precondition_failed` when it changed. Declared optional here. |

The screens the response names (`LayoutScreen`): `overview`, `ai_overview`, `rankings`, `prompts`,
`citations`, `sources`, `pages`, `inspector.keyword`, `inspector.prompt`, `inspector.page`,
`inspector.citation`.

### Request body of both `PUT` routes: `LayoutDocument`

A full snapshot of the numbers and cards of one screen, in order, at most 16 KB. No other member is
allowed.

| Member | Type | Bounds | Meaning |
|---|---|---|---|
| `schema` | `1` | required | The document format version. |
| `numbers` | `NumberItem[]` or null | at most 6 | The number strip. |
| `cards` | `CardItem[]` or null | at most 12 | The cards. |

`NumberItem`:

| Member | Type | Bounds | Meaning |
|---|---|---|---|
| `id` | string | 1 to 64, `^[A-Za-z0-9_-]+$` | A plain token (layout spec section 6.3 rule 6). |
| `metric` | string | 1 to 64, `^[a-z0-9_]+(\.[a-z0-9_]+)*$` | A metric registry key (docs/16 section 2.1); WP-11 checks it against the generated catalog JSON for the screen (D-10). |
| `engine` | `EngineCode` or null | | Required when `metric` is an AI metric. |

`CardItem`:

| Member | Type | Bounds | Meaning |
|---|---|---|---|
| `id` | string | as `NumberItem.id` | |
| `type` | string | 1 to 64, the same pattern as `metric` | A card type of the catalog for the screen. |
| `width` | `third`, `half`, `two_thirds`, `full` or null | | Dashboard screens only; left out: the type's default. |
| `options` | object or null | keys `^[a-z0-9_]+$` up to 64 characters; values printable strings up to 256 | A flat object of strings; each card type checks its own in the web app. |

### Response: `ResolvedLayoutResponse`

| Field | Type | Meaning |
|---|---|---|
| `data.screen` | `LayoutScreen` | |
| `data.source` | `personal`, `team` or `builtin` | Their personal layout, else the team default, else `builtin`. |
| `data.document` | `LayoutDocument` or null | Null when `source` is `builtin`: the web app holds the built-in default. |
| `data.team_default_exists` | boolean | |
| `data.updated_at` | datetime or null | |
| `data.updated_by` | `{ user_id, name }` or null | |

The `PUT` routes answer the layout as it now resolves. The team default is audited as
`layout.default.set` (documents before and after) and `layout.default.remove`.

## Error codes

| Status | Code | When |
|---|---|---|
| 401 | `unauthenticated` | No session. |
| 404 | `not_found` | Not a member of the workspace; once built, an unknown `screen`. |
| 403 | `forbidden` | The team default routes: the role lacks `layouts:manage`. |
| 403 | `workspace_suspended` | A write in a suspended workspace. |
| 412 | `precondition_failed` | A later body: `If-Match` is not the layout's current ETag. What a missing `If-Match` answers when a layout exists is WP-11's to fix (the header text says required). |
| 422 | `validation_failed` | A value outside its bounds: a `screen` that is not a key, a bad `schema`, an unknown member, more than 12 cards or 6 numbers, a bad `id`, `type` or `metric` token, a bad `width`, an option key or value out of bounds, an `engine` outside `EngineCode`. The `errors` list carries field paths. |
| 422 | `validation_failed` (later body) | A card type or metric key not in the catalog for the screen, a width the screen does not allow, a missing `engine` for an AI metric, a document over 16 KB. |
| 501 | `not_implemented` | All five routes, until WP-11 builds them. |

Order: 401, 404, 403, 422 (path, header and body values), then `501`. The stubs check the document's
shape and bounds only, not the catalog or the screen's existence.

## Example

The `501` body is in the [README](README.md). The responses show what WP-11 will return. The card types,
metric keys and options below are made up; the catalog decides them (D-10).

### Read: nothing saved yet

```http
GET {W}/layouts/ai_overview
```

`200`, with an `ETag` header (its format is WP-11's):

```json
{
  "data": {
    "screen": "ai_overview",
    "source": "builtin",
    "document": null,
    "team_default_exists": false,
    "updated_at": null,
    "updated_by": null
  }
}
```

### Save the caller's own layout

```http
PUT {W}/me/layouts/ai_overview
If-Match: "5d1e8a"
```

```json
{
  "schema": 1,
  "numbers": [{"id": "n1", "metric": "ai.mention_rate", "engine": "chatgpt_web"}],
  "cards": [
    {"id": "c1", "type": "ai.by_engine", "width": "half", "options": {"metric": "ai.mention_rate"}},
    {"id": "c2", "type": "ai.by_engine", "width": "full"}
  ]
}
```

`200`:

```json
{
  "data": {
    "screen": "ai_overview",
    "source": "personal",
    "document": {
      "schema": 1,
      "numbers": [{"id": "n1", "metric": "ai.mention_rate", "engine": "chatgpt_web"}],
      "cards": [
        {"id": "c1", "type": "ai.by_engine", "width": "half", "options": {"metric": "ai.mention_rate"}},
        {"id": "c2", "type": "ai.by_engine", "width": "full", "options": null}
      ]
    },
    "team_default_exists": true,
    "updated_at": "2026-11-10T09:12:44Z",
    "updated_by": {"user_id": "0000005a-7c1e-4a52-9b3d-00000000005a", "name": "Mara Voss"}
  }
}
```

### Go back to the team or built-in default

```http
DELETE {W}/me/layouts/ai_overview
```

`204`, no body.

### Save the team default (needs `layouts:manage`)

```http
PUT {W}/layouts/ai_overview/default
If-Match: "5d1e8a"
```

The body is the same `LayoutDocument` as above. `200`:

```json
{
  "data": {
    "screen": "ai_overview",
    "source": "team",
    "document": {
      "schema": 1,
      "numbers": [{"id": "n1", "metric": "ai.mention_rate", "engine": "chatgpt_web"}],
      "cards": [
        {"id": "c1", "type": "ai.by_engine", "width": "half", "options": {"metric": "ai.mention_rate"}},
        {"id": "c2", "type": "ai.by_engine", "width": "full", "options": null}
      ]
    },
    "team_default_exists": true,
    "updated_at": "2026-11-10T09:12:44Z",
    "updated_by": {"user_id": "0000005a-7c1e-4a52-9b3d-00000000005a", "name": "Mara Voss"}
  }
}
```

### Remove the team default (needs `layouts:manage`)

```http
DELETE {W}/layouts/ai_overview/default
```

`204`, no body.

## Open choices

Each row can be tightened by WP-11 through the change log.

| Q | Question | Choice | Why |
|---|---|---|---|
| Q20 | `{screen}` as an enum (`422`) or a string (`404` when unknown) | A bounded string; unknown is `404` (WP-11) | Doc 19 says `404 unknown screen`. |
| Q21 | Card type and metric keys as enums | Bounded strings checked against the generated catalog JSON by WP-11 | The catalog grows per card (LD 7.4); an enum would change the contract each time. |
| Q22 | Bounds of `options` | Keys `^[a-z0-9_]+$` up to 64, values up to 256 printable characters | D7; loosening later is additive. |
| Q23 | Item `id` pattern | `^[A-Za-z0-9_-]{1,64}$` | LD's own definition of a plain token. |
| D7 | Other bounds | 12 cards, 6 numbers, 16 KB, `If-Match` up to 128, `screen` up to 64 | House rule: bounded lists and strings. |

## How the owner package fills it

1. In `api/layouts/routes.py` drop `@not_built` and `raise not_built_yet()` (`idraft.api.stubs`) from the
   five functions; add `core.layouts` with row-level security (D-09), the catalog check (D-10), the
   16 KB check, the `ETag` and `If-Match` handling and the two audit entries.
2. Replace `tests/api/layouts/test_contract_layouts.py` with real tests.
3. In `tests/security/test_cross_tenant.py` add the path of the read, `_W + "/layouts/{screen}"`, to
   `COUNT_ROUTES` (a resolved layout holds no tenant ids, so the list rule's "shows the caller's own
   data" does not apply), and edit the one fixed example of
   `test_the_published_contracts_are_the_not_built_routes`, which asserts the read is still in
   `NOT_BUILT`. `{screen}` is already a word in the suite's `WORDS`, so these routes are not child
   routes.
4. An unknown screen answers `404` through the service; the stubs answered `501` (and `422` only for a
   value that is not a key).
5. Remove the `Not built yet` sentences from the route descriptions, regenerate
   `backend/openapi/v1.json`, then `pnpm gen:api`.

## Change log

Newest last; one line per change, in the form `date package: change`.

2026-11-13 WP-03: contract published
