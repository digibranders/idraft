# Evidence: answer detail additions and answer compare

## Status

Published by WP-26 on 2026-11-13 (task T0). Owner package: [WP-26 evidence-viewer](../work-packages/WP-26-evidence-viewer.md).
Plan: [docs/superpowers/plans/2026-11-13-ai-wp-26-evidence-viewer.md](../../superpowers/plans/2026-11-13-ai-wp-26-evidence-viewer.md).
The route and the three fields are in the API document and the generated client. The route answers
`501 not_implemented` after its access and path checks until WP-26 T2 builds it; the fields are
optional and WP-26 T1 starts filling them. Where this text and the change log (the last section)
differ, the change log is right.

| Item | Kind | State |
|---|---|---|
| `GET {P}/ai/observations/{observation_id}/compare` | new route | published: `501` |
| `CitationOut.quote` | optional field of a built route | published, absent (null) until T1 |
| `ObservationDetail.answer_sha256` | optional field of a built route | published, absent (null) until T1 |
| `ObservationDetail.raw_sha256` | optional field of a built route | published, absent (null) until T1 |

`{P}` is `/api/v1/workspaces/{workspace_id}/projects/{project_id}`. The three fields have a default of
`null` in the model, so they are optional in the generated client (`?: string | null`): no mock or test
of another package breaks. Once T1 is built the API always sends them.

## Routes and parameters

| Method | Path | Permission | Success |
|---|---|---|---|
| GET | `{P}/ai/observations/{observation_id}/compare` | `data:read` | `200 AnswerCompareResponse` |

`observation_id` is a 64-bit integer, validated as on the detail route (1 to 2^63 - 1). No query
parameters. The answer in the path may be any answer of the project that has text: it is the
"latest" by role, not necessarily the newest.

## New response fields

| Model | Field | Type | Meaning |
|---|---|---|---|
| `CitationOut` | `quote` | string or null | The passage the provider quoted from the source, whitespace collapsed, at most 1,000 characters. Null when the provider gave none or the answer was stored before quotes were kept. |
| `ObservationDetail` | `answer_sha256` | string or null | SHA-256 of `answer_text` as UTF-8, lowercase hex, 64 characters. Null when the answer has no text. |
| `ObservationDetail` | `raw_sha256` | string or null | SHA-256 of the provider's body as received, lowercase hex, 64 characters. Null when the payload row is gone. It stays available after the raw body expires (`410 raw_expired`). |

### Answer compare, response `data`

| Field | Type | Meaning |
|---|---|---|
| `prompt_id` | uuid | The prompt of both answers. |
| `engine_code` | engine code | The engine of both answers; engines are never pooled. |
| `latest` | `CompareSide` | The answer of the path. |
| `baseline` | `CompareSide` | The answer it is compared with. |
| `entities` | `{ gained, lost, kept }` | Lists of `CompareEntity` (`entity_id`, `name`, `role`: `own`, `competitor` or `watch`). |
| `sources` | `{ gained, lost, kept_count }` | `gained` and `lost` are lists of `CompareSource` (`registrable_domain`, `host`, `domain_role`, `title`); `kept_count` is a count, the kept domains are not listed. |

`CompareSide` is `observation_id` (a string, as on the detail), `observed_at`, `own_mentioned` and
`own_domain_cited`.

## Rules

- D1, baseline. Same project, same `prompt_id` and `engine_code`, not superseded (`superseded_by`
  null), current facts `is_valid` and `own_mentioned`, strictly earlier than the answer in the path
  (`observed_at`, then id). The newest such answer. No baseline: `404 no_baseline`.
- D2, what is compared. Entities: the accepted mentions (any tracked role) of the current derivation,
  matched by `entity_id`. Sources: the registrable domain of each citation; citations flagged
  `unresolved_redirect` or `engine_internal` are left out (owner decision O1). `host` and `title` come
  from the first citation of the domain.
- Order. 401, 404 (not a member, or a project outside the member's scope), 403, 422 (the id), then the
  service: `404 not_found` for an answer that is not in the project, `404 no_baseline`, then the
  `200`. The stub answers `501` at the step where the service would run.

## Error codes

| Status | Code | When |
|---|---|---|
| 401 | `unauthenticated` | No session. |
| 404 | `not_found` | Not a member of the workspace; a project outside the member's scope; an answer that is not in the project. |
| 404 | `no_baseline` | The answer exists but has no earlier answer to compare with (D1). |
| 403 | `forbidden` | The role lacks `data:read`. |
| 422 | `validation_failed` | An `observation_id` that is not an integer from 1 to 2^63 - 1. |
| 501 | `not_implemented` | Until WP-26 T2. |

## Example

The compare response below was produced by instantiating the models; ids, names and numbers are made up.

```http
GET {P}/ai/observations/84120007/compare
```

```json
{
  "data": {
    "prompt_id": "00000000-0000-0000-0000-00000000001a",
    "engine_code": "chatgpt_web",
    "latest": {
      "observation_id": "84120007",
      "observed_at": "2026-11-12T09:30:00Z",
      "own_mentioned": true,
      "own_domain_cited": true
    },
    "baseline": {
      "observation_id": "83001115",
      "observed_at": "2026-11-05T09:30:00Z",
      "own_mentioned": true,
      "own_domain_cited": false
    },
    "entities": {
      "gained": [
        {"entity_id": "00000000-0000-0000-0000-000000000007", "name": "Rival One", "role": "competitor"}
      ],
      "lost": [
        {"entity_id": "00000000-0000-0000-0000-000000000009", "name": "Rival Two", "role": "competitor"}
      ],
      "kept": [
        {"entity_id": "00000000-0000-0000-0000-000000000001", "name": "Acme", "role": "own"}
      ]
    },
    "sources": {
      "gained": [
        {"registrable_domain": "acme.example", "host": "www.acme.example", "domain_role": "own", "title": "Acme pricing"}
      ],
      "lost": [
        {"registrable_domain": "news.example", "host": "news.example", "domain_role": "third_party", "title": null}
      ],
      "kept_count": 4
    }
  }
}
```

The detail route (`GET {P}/ai/observations/{observation_id}`) adds, once T1 is built, `"answer_sha256"` and
`"raw_sha256"` (64 hex characters each) to `data` and `"quote"` to each citation.

## Findings that shape the build

### CF-25: citation offsets are already built

`CitationOut.first_char_offset` and `answer_block_index` exist and are filled by ingest, so no code
change is needed; WP-26 adds tests.

- `first_char_offset` is where the provider's `raw_url` (else the canonical url) first occurs in
  `answer_text`, in UTF-16 code units on the API. Null when the URL is not in the text. In the captured
  ChatGPT answer 17 of 17 inline source URLs occur in the markdown, inside a link target: the offset points
  at the URL inside `(...)`, not at the start of the link. A marker therefore sits at the end of the cited
  URL (offset plus the length of the URL found there).
- `answer_block_index` is the provider's item position of the first block that cites the source. It is
  null for a source that is only in the source list. It is not a stage 3 block of doc 13.

### Where a quote comes from (BE-SOURCES-21)

| Engine | Raw payload member | Captured fixture |
|---|---|---|
| Gemini (scraper) | `items[].sources[].snippet` | 8 of 8 inline sources have one |
| AI Mode | `items[].references[].text` | the passage |
| ChatGPT (scraper) | none | 0 of 17 inline sources |
| AI Mode `links[].description` | empty | empty in the capture |

The parser keeps the first non-empty value per canonical URL, whitespace collapsed and cut at 1,000
characters. Rows stored before T1 keep `quote` null: the worker has no update grant on the answer tables
and there is no re-derive.

## Who builds it

- T1 (backend): `quote` (one nullable column, parser, ingest, `CitationOut`), `answer_sha256`
  (`ai.observations.answer_hash`) and `raw_sha256` (`ops.raw_payloads.sha256` through
  `ai.observation_raw`).
- T2 (backend): `compare_observation` in `api/ai/observation_routes.py`: drop `@not_built` and
  `raise not_built_yet()`, write the service, replace `test_contract_evidence.py` with real tests, remove
  the `Not built yet` sentence of the route description and regenerate `backend/openapi/v1.json`, then
  `pnpm gen:api`.

## Change log

Newest last; one line per change, in the form `date package: change`.

2026-11-13 WP-26: contract published (route stub, three optional fields)
