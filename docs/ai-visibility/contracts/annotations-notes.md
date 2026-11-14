# N9 annotations and N13 notes

## Status

Published by WP-03 on 2026-11-13 as four new routes that answer `501 not_implemented` after their access
checks. Owner package: [WP-38 notes-annotations](../work-packages/WP-38-notes-annotations.md)
(MASTER-PLAN 3.3: `api/ai/annotation_routes.py` and `api/notes/routes.py`; rows OV-N9 and OV-N13). The
schemas are in `backend/src/idraft/api/schemas/ai_notes.py`. No notes table exists yet: WP-38 adds it
with its own row-level security.

## Routes and parameters

| Method | Path | Permission | Success |
|---|---|---|---|
| GET | `{P}/ai/annotations` | `data:read` | `200 AnnotationList` |
| GET | `{P}/notes` | `data:read` | `200 NoteList` |
| POST | `{P}/notes` | `notes:write` (owner, admin, editor; owner decision D-18) | `201 NoteResponse` |
| DELETE | `{P}/notes/{note_id}` | `notes:write` | `204`, no body |

### GET {P}/ai/annotations (N9)

The changes every AI time chart marks, oldest first: a new `model_reported` per engine, and entity set,
extractor and prompt set changes.

| Parameter | Type | Bounds | Meaning |
|---|---|---|---|
| `from` | date | | First project-local day, included. Default: the 28 days ending today. |
| `to` | date | | Last project-local day, included. At most 92 days from `from` (`422 window_too_large`). |
| `filter[engine_code_in]` | comma list of `EngineCode` | at most 3 values (published as `maxLength: 3`) | Left out: every engine. |

`data[]` (`Annotation`, unbounded, oldest first):

| Field | Type | Meaning |
|---|---|---|
| `at` | datetime | When the change happened. |
| `kind` | `model_changed`, `entity_set_changed`, `extractor_changed`, `prompt_set_changed` | |
| `engine_code` | `EngineCode` or null | Set for a model change. |
| `from` | integer, string or null | The value before the change. (In Python the field is `from_`.) |
| `to` | integer, string or null | The value after the change. |
| `label` | string | |

### GET {P}/notes (N13)

| Parameter | Type | Bounds | Meaning |
|---|---|---|---|
| `from` | date | | First project day, included. Default: the 28 days ending today. |
| `to` | date | | Last project day, included. At most 92 days from `from` (`422 window_too_large`). |

Notes drawn on days in the window, project wide and per term. No paging (notes are few). Response
`data[]` is a `Note`, ordered by `on`, then `created_at`, oldest first.

### POST {P}/notes

| Member | Type | Bounds | Meaning |
|---|---|---|---|
| `on` | date | | The project day the note is drawn on. |
| `text` | string | trimmed, 1 to 140 characters, one line, printable (a control character is refused) | Shown as text, never as markup. |
| `scope` | `{ kind: "project" }` or `{ kind: "term", term_id: uuid }` | `kind` picks the shape; no other member | For the project, or one term the project may use (`term_unknown` otherwise). |

Response `data` (`Note`):

| Field | Type | Meaning |
|---|---|---|
| `note_id` | uuid | |
| `on` | date | |
| `text` | string | |
| `scope` | as the request | |
| `created_by` | `{ user_id, name }` or null | The author; the model allows null and leaves the case to WP-38 (for example an author who left). |
| `created_at` | datetime | |

### DELETE {P}/notes/{note_id}

Path `note_id` (uuid). Any holder of `notes:write` may delete a note of the project; WP-38 may narrow it
to the author and admins (Q25).

## Error codes

| Status | Code | When |
|---|---|---|
| 401 | `unauthenticated` | No session. |
| 404 | `not_found` | Not a member of the workspace; a project outside the member's scope; once built, a deleted or unknown project, and a `note_id` that is not a note of the project. |
| 403 | `forbidden` | The role lacks `data:read` (reads) or `notes:write` (a viewer cannot write). |
| 403 | `workspace_suspended` | A write in a suspended workspace. |
| 422 | `validation_failed` | A value outside its bounds: `text` empty, over 140 characters or with a control character, a bad `scope.kind`, a missing `term_id`, a bad date or `note_id`, an engine outside `EngineCode`, an unknown body member. |
| 422 | `validation_failed` with field code `term_unknown` | A later body: a term the project may not use, at `scope.term_id` (the path is the owner's). |
| 422 | `validation_failed` with field code `range_invalid` | A later body: `from` after `to`, at `from`. |
| 422 | `window_too_large` | A later body: `to` more than 92 days after `from` (carries `limit_days`; the class exists). |
| 501 | `not_implemented` | All four routes, until WP-38 builds them. |

Order: 401, 404, 403, 422 (path, query and body values), then `501`. The stubs do not check the window,
the term or the note, so those codes come only with the bodies.

## Example

The `501` body is in the [README](README.md). The responses show what WP-38 will return. Model names and
note texts are made up.

```http
GET {P}/ai/annotations?from=2026-10-17&to=2026-11-13&filter[engine_code_in]=chatgpt_web
```

`200`:

```json
{
  "data": [
    {
      "at": "2026-10-22T00:00:00Z",
      "kind": "model_changed",
      "engine_code": "chatgpt_web",
      "from": "gpt-5.1",
      "to": "gpt-5.2",
      "label": "ChatGPT model changed"
    },
    {
      "at": "2026-11-03T00:00:00Z",
      "kind": "entity_set_changed",
      "engine_code": null,
      "from": 2,
      "to": 3,
      "label": "Tracked entities changed"
    }
  ]
}
```

```http
GET {P}/notes?from=2026-10-17&to=2026-11-13
```

`200`:

```json
{
  "data": [
    {
      "note_id": "0000007a-7c1e-4a52-9b3d-00000000007a",
      "on": "2026-11-03",
      "text": "Pricing page relaunched",
      "scope": {"kind": "term", "term_id": "0000002a-7c1e-4a52-9b3d-00000000002a"},
      "created_by": {"user_id": "0000005a-7c1e-4a52-9b3d-00000000005a", "name": "Mara Voss"},
      "created_at": "2026-11-10T09:12:44Z"
    },
    {
      "note_id": "0000007b-7c1e-4a52-9b3d-00000000007b",
      "on": "2026-11-05",
      "text": "Campaign started",
      "scope": {"kind": "project"},
      "created_by": null,
      "created_at": "2026-11-10T09:12:44Z"
    }
  ]
}
```

```http
POST {P}/notes
```

```json
{
  "on": "2026-11-03",
  "text": "Pricing page relaunched",
  "scope": {"kind": "term", "term_id": "0000002a-7c1e-4a52-9b3d-00000000002a"}
}
```

`201`:

```json
{
  "data": {
    "note_id": "0000007a-7c1e-4a52-9b3d-00000000007a",
    "on": "2026-11-03",
    "text": "Pricing page relaunched",
    "scope": {"kind": "term", "term_id": "0000002a-7c1e-4a52-9b3d-00000000002a"},
    "created_by": {"user_id": "0000005a-7c1e-4a52-9b3d-00000000005a", "name": "Mara Voss"},
    "created_at": "2026-11-10T09:12:44Z"
  }
}
```

```http
DELETE {P}/notes/0000007a-7c1e-4a52-9b3d-00000000007a
```

`204`, no body.

## Open choices

Each row can be tightened by WP-38 through the change log.

| Q | Question | Choice | Why |
|---|---|---|---|
| Q24 | Annotations window, order, `from` and `to` types | `from` and `to` as every AI read (default 28 days, at most 92); oldest first; `from` and `to` are a number or a string, nullable | Doc 19 `VersionBoundary` types; the house window rule. |
| Q25 | Notes list paging and window; who deletes | No paging, the AI read window; any `notes:write` holder deletes (WP-38 may narrow) | N13 shows a plain list; notes are few. |
| D7 | Bounds | `text` 1 to 140; engine list at most 3; the annotation and note lists are unbounded responses of a window of at most 92 days | House rule: bounded strings and request lists. |

## How the owner package fills it

1. In `api/ai/annotation_routes.py` and `api/notes/routes.py` drop `@not_built` and
   `raise not_built_yet()` (`idraft.api.stubs`) from `list_annotations`, `list_notes`, `create_note` and
   `delete_note`; add the notes table with row-level security and the audit entries.
2. Replace `tests/api/ai/test_contract_notes.py` with real tests.
3. In `tests/security/test_cross_tenant.py`, under the WP-38 anchor, seed a real note and remove the
   WP-03 placeholder `more_ids["note_id"] = str(uuid.uuid4())`. Both list routes then follow the
   suite's list rule: they show the caller's own data and nothing of another workspace (a read that
   holds no tenant ids may go in `COUNT_ROUTES` instead).
4. A foreign or nonexistent project, and a note outside the project, answer `404` through the service;
   the stubs answered `501`.
5. Remove the `Not built yet` sentences from the route descriptions, regenerate
   `backend/openapi/v1.json`, then `pnpm gen:api`. The generated operation id of the annotations read
   starts `list_annotations_` (the function is named `list_annotations`); keep the name so the web client
   does not change.

## Change log

Newest last; one line per change, in the form `date package: change`.

2026-11-13 WP-03: contract published
