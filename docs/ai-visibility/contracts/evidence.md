# Evidence: answer detail additions and answer compare

## Status

Published by WP-26 on 2026-11-13 (task T0); built in T1 (fields) and T2 (route). Owner package: [WP-26 evidence-viewer](../work-packages/WP-26-evidence-viewer.md).
Plan: [docs/superpowers/plans/2026-11-13-ai-wp-26-evidence-viewer.md](../../superpowers/plans/2026-11-13-ai-wp-26-evidence-viewer.md).
The route and the three fields are in the API document and the generated client and are all built.
Where this text and the change log (the last section) differ, the change log is right.

| Item | Kind | State |
|---|---|---|
| `GET {P}/ai/observations/{observation_id}/compare` | new route | built (T2); it was `501` after T0 |
| `CitationOut.quote` | optional field of a built route | built (T1); null for rows stored before quotes were kept |
| `ObservationDetail.answer_sha256` | optional field of a built route | built (T1) |
| `ObservationDetail.raw_sha256` | optional field of a built route | built (T1) |

`{P}` is `/api/v1/workspaces/{workspace_id}/projects/{project_id}`. The three fields have a default of
`null` in the model, so they are optional in the generated client (`?: string | null`): no mock or test
of another package breaks. The API always sends them; a value is null only where the table below says.

## Routes and parameters

| Method | Path | Permission | Success |
|---|---|---|---|
| GET | `{P}/ai/observations/{observation_id}/compare` | `data:read` | `200 AnswerCompareResponse` |

`observation_id` is a 64-bit integer, validated as on the detail route (1 to 2^63 - 1). No query
parameters: any parameter, `observed_at` included, is `422 extra_forbidden` (an app-wide rule). The
answer in the path may be any answer of the project that has current facts: it is the "latest" by
role, not necessarily the newest.

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
  `200`.

## Error codes

| Status | Code | When |
|---|---|---|
| 401 | `unauthenticated` | No session. |
| 404 | `not_found` | Not a member of the workspace; a project outside the member's scope; an answer that is not in the project. |
| 404 | `no_baseline` | The answer exists but has no earlier answer to compare with (D1), or it has no current facts yet (its entities and sources are unknown, not empty). |
| 403 | `forbidden` | The role lacks `data:read`. |
| 422 | `validation_failed` | An `observation_id` that is not an integer from 1 to 2^63 - 1. |
| 422 | `extra_forbidden` | Any query parameter (the route takes none). |
| 501 | `not_implemented` | Gone: the route is built. |

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

The detail route (`GET {P}/ai/observations/{observation_id}`) adds `"answer_sha256"` and
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
| Gemini (scraper) | `items[].sources[].snippet` | 3 of the 5 distinct sources have one (the 8 inline mentions repeat them); a source only in the source list has none |
| AI Mode | `items[].references[].text` | the passage |
| ChatGPT (scraper) | none | 0 of 17 inline sources |
| AI Mode `links[].description` | empty | empty in the capture |

The parser keeps the first non-empty value per canonical URL, whitespace collapsed and cut at 1,000
characters. Rows stored before T1 keep `quote` null: the worker has no update grant on the answer tables
and there is no re-derive.

## Who built it

- T1 (backend, built): `quote` (one nullable column `ai.citations.quote`, parser, ingest, `CitationOut`),
  `answer_sha256` (`ai.observations.answer_hash`) and `raw_sha256` (`ops.raw_payloads.sha256` through
  `ai.observation_raw`). `raw_sha256` needs only `data:read`: it is a digest of a body the viewer cannot
  read without `raw:read`, and `/raw` still answers `403` to such a viewer.
- T2 (backend, built): `compare_observation` in `api/ai/observation_routes.py` with the queries in
  `api/ai/answer_diff.py` (`NoBaselineError`); `test_contract_evidence.py` was replaced by
  `test_answer_compare.py`; `backend/openapi/v1.json` and `schema.ts` were regenerated for the new route
  description at the rebase.

## Web rows confirmed by tests (WB-ANS-01 to WB-ANS-09)

Paths are under `apps/web/src/`. `answer.test.tsx` is `features/prompts/answer.test.tsx`.

| Row | Proven by |
|---|---|
| WB-ANS-01 spans as UTF-16, own and competitor marks | `features/prompts/answer-segments.test.ts` (UTF-16 units, an emoji counts two, spans inside a character left out, overlaps); `answer.test.tsx` (hostile spans keep the text whole, own brand and competitors marked) |
| WB-ANS-02 mark accessible names | `components/app/evidence/evidence-highlight.test.tsx` (entity, match and confidence, product); `answer.test.tsx` (role words for watched and untracked brands, uncertain marks) |
| WB-ANS-03 mentions list | `answer.test.tsx` (role and count, uncertain, via product, watched without a number, none named) |
| WB-ANS-04 sources with role and host | `answer.test.tsx` (host and role in words, canonical link); `components/app/evidence/citation-list.test.tsx` |
| WB-ANS-05 ads note | `answer.test.tsx` (note shown in Evidence and Formatted, not for an answer without text) |
| WB-ANS-06 status | `answer.test.tsx` (complete, partial, empty, refused, error words without provider codes, not read yet) |
| WB-ANS-07 details | `answer.test.tsx` (engine, time in the project time zone, model, outcome, provider link, facts and hashes) |
| WB-ANS-08 download raw, 410 and 503 | `answer.test.tsx` (download, busy and focus, past retention, unavailable then retried, no control without `raw:read`) |
| WB-ANS-09 back to the prompt | `answer.test.tsx` (open from a date, back to the prompt, error back, the prompt stays marked) |

The end to end flow is `apps/web/e2e/flows/ai-evidence.spec.ts` (markers, toggles, Formatted and Raw, compare,
provider link, hash copy, no horizontal scroll at 390 px, axe at 1280 and 390 in light and dark).

## Change log

Newest last; one line per change, in the form `date package: change`.

2026-11-13 WP-26: contract published (route stub, three optional fields)
2026-11-13 WP-26: the fields are built (T1): `answer_sha256`, `raw_sha256` and `quote`; the quote column is migration 0024 (`ai.citations.quote`)
2026-11-13 WP-26: the compare route is built (T2): the `501 not_implemented` stub is gone and the route answers `200`, `404 not_found` or `404 no_baseline` (also an answer with no current facts yet); the shapes are unchanged; the route description now states the D1 and D2 rules; `test_contract_evidence.py` is replaced by `test_answer_compare.py`
