# WP-26 evidence-viewer: detailed task plan

Brief: [WP-26](../../ai-visibility/work-packages/WP-26-evidence-viewer.md). Release A, Tier 2 ([RELEASE-A](../../ai-visibility/RELEASE-A.md)).
Branch `ai/wp-26-evidence` (the brief says `ai/wp-26-evidence-viewer`; the worktree and the tracker use the shorter name),
worktree `.claude/worktrees/wp-26`, base `origin/develop` at `b3907451`. Migration head on develop: `0022`.
Owner decisions: none. Defaults taken below (D1 to D8), never blocked on.

## Header

- Goal: finish the evidence viewer (the answer inspector at `features/prompts/answer-inspector.tsx`): citation markers,
  entity toggles, Evidence, Formatted and Raw views, quote box, facts footer, provider link, quoted passage, answer
  compare; backend: hashes on the observation detail, a quote per citation, `GET {P}/ai/observations/{id}/compare`.
- Constraints: tests first, see them fail for the right reason. Implementers edit files only with Write and Edit (never
  heredoc, `sed`, replace scripts). Migrations numbered 0023 or higher, renumbered at push time after the rebase (MASTER-PLAN 3.9).
  Targeted pytest `--no-cov -n 2`; web tests `vitest --maxWorkers=3`. Full suites (`./check.sh`, `pnpm test`, `pnpm build`)
  only through `infra/dev/heavy`. No real provider or LLM call anywhere. ASCII only; no em-dash or en-dash anywhere
  (`src/test/source-text.test.ts` bites). Commit `WP-26: <task title>`, only this package's files, no attribution.
- Medium lane form: `infra/dev/heavy --lane medium --label wp26-tN --wait 30 --max 20 -- bash -c '<command>'`.
  Backend needs `export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock" TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`
  (`colima status` only; never start or stop Colima, never touch `idraft-dev-*`).
- House rules for web (every reviewer checks): tokens and type utilities only; numbers and dates through `@/lib/format`;
  collected text is React text children only, never `dangerouslySetInnerHTML`; links only through `webHref` (http or https) with
  `rel="noopener noreferrer"` and the host shown; every percent shows its count; unknown is never 0 (`EMPTY_VALUE`); engines
  never pooled; keyboard path for every action; states: skeleton, empty with reason, error with retry, partial, stale.

## Verified facts (read from code at b3907451)

1. CF-25. `CitationOut` already has `first_char_offset` and `answer_block_index`; `ObservationDetail` serves them
   (`observations.py` converts `first_char_offset` to UTF-16, `answer_block_index` as stored). Both are populated by ingest
   (`collectors/ai_prompt_ingest.py` `_insert_citations`). `first_char_offset` is the code point index where
   `extraction/ai_facts.py::_citation` finds the provider's `raw_url` (else the canonical url) in `answer_text`; null when
   the URL is not in the text. I checked the captured ChatGPT fixture: 17 of 17 inline source URLs occur in the markdown, inside
   a markdown link target, so the offset points at the URL inside `(...)`, not at the link start. `answer_block_index` is the
   provider's item position of the first block that cites the source (null for a source-list-only source), not a stage 3 block
   of doc 13 (stage 3 is not built). Existing coverage: only `test_citation_offsets_count_utf16_code_units` (hand made text);
   nothing asserts `answer_block_index` on the API nor offsets on the captured payloads. So CF-25 needs tests, no code.
2. CF-26. Neither hash is on the API or in `schema.ts` (`ObservationDetail` has no sha field). `ai.observations.answer_hash`
   (bytea) exists, set at ingest as `sha256(answer_text.encode())`; null when the text is null. The raw hash is
   `ops.raw_payloads.sha256` (NOT NULL, sha256 of the uncompressed provider body, checked by `read_stored_answer`), reachable
   through the existing function `ai.observation_raw(id)` (`repository.raw_payload`). No code path deletes the registry row
   after retention (only the body expires), so `raw_sha256` stays available after the 410. No migration needed for CF-26.
3. BE-SOURCES-21. The raw payload has a quote for some engines: Gemini scraper `items[].sources[].snippet` (captured fixture:
   8 of 8 inline sources have it), AI Mode `items[].references[].text` (the passage). ChatGPT scraper: 0 of 17 inline sources
   carry one; AI Mode `links[].description` is empty in the capture. The parser (`providers/dataforseo/ai_parse.py`,
   `CitedSource`, `_Sources.add`) reads only url, title and source_name, so the quote is dropped today, and `ai.citations`
   has no column for it. Smallest change: one nullable `quote text` column (migration 0023+), `CitedSource.quote`, the insert,
   and a nullable `quote` on `CitationOut`. Old rows stay null (the worker has no update grant on answer tables; no re-derive).
4. Route stubs: `idraft.api.stubs` has `not_built` (mark) and `refuse_unbuilt`. A new route uses `@not_built` with a body that
   raises `not_built_yet()`; the cross-tenant suite computes `NOT_BUILT` from the mark.
5. The viewer already has a provider link: `check_url` (http or https only, `rel="noopener noreferrer"`, label `t('check')`),
   WB-ANS-14 is therefore a confirm plus a test, not a build. Download of the raw answer exists (WB-ANS-08).
6. WB-PI-23: WP-25 merged without it (`schema.ts` had no hash). The card is built in `apps/web/src/features/prompts/inspector-latest.tsx`
   (`body(shown: ObservationAnswer)`, owned by WP-25, merged). Adding the hash line needs a coordinator lease.
7. There is no markdown library in `apps/web/package.json`. SafeMarkdown needs one (lease, own commit) or an in-house subset renderer.
8. No contract note exists for observations. This package creates `docs/ai-visibility/contracts/evidence.md`.

## Defaults taken (change only on the coordinator's or owner's word)

- D1 Compare baseline: same project, `prompt_id` and `engine_code`, `superseded_by` null, current facts `is_valid` and
  `own_mentioned`, strictly earlier than the path observation (`observed_at`, then `id`); the newest such. The path
  observation may be any answer with text (it is "latest" by role, not necessarily the newest). No baseline: `404 no_baseline`.
- D2 Entities compared: accepted mentions (any tracked role) of the current derivation, by `entity_id`. Sources compared: the
  registrable domain of each citation, flagged citations (`unresolved_redirect`, `engine_internal`) left out (owner decision O1).
- D3 New response fields are optional with a default in Pydantic (`= None`): generated TS is `?: string | null`, so no mock or test
  elsewhere breaks; the API always sends them. Avoids edits in about six files other packages own.
- D4 `AnswerViewMode` has three modes as DS25 15.18: Evidence (default, current marked text plus markers), Formatted
  (`SafeMarkdown`, no marks), Raw (the provider's raw answer fetched on open, `raw:read` only, escaped `type-mono`, first
  200,000 characters with a note and the existing download for the rest). Mode is not in the URL.
- D5 Markers sit at the end of the cited URL (`first_char_offset + length of the raw_url or url found there`), one per citation
  (first occurrence only; the API has no further offsets). A citation without an offset appears in the list only.
- D6 AnswerCompare at 440 px is the fact-based difference summary (gained, lost, kept, both ids with "Open" links), as a section
  of the answer viewer. The two-column text view needs 1000 px and belongs to Prompt Detail (WP-52); not built here.
- D7 Quote per citation: parser keeps the first non-empty `snippet` (scrapers) or `text` (AI Mode references) per canonical URL,
  whitespace collapsed, at most 1,000 characters, via `scrub_text`. `PARSER_VERSION` stays 1 (additive, no re-derive).
- D8 WB-SRC-04 closes as the reusable `QuotedPassage` section plus its use in the answer viewer; mounting it in the cited URL
  inspector belongs to WP-22 (it owns WB-SRC-01 to 03) and needs `quote` on the citations list read. Reported, not built.

## Leases to request before the task that needs them (exact paths)

| Path | Task | Change | Held by now |
|---|---|---|---|
| `backend/src/idraft/api/schemas/ai.py` | T0 | `CitationOut.quote`, `ObservationDetail.answer_sha256`, `raw_sha256` (additive) | SHARED WP-12/13/14 |
| `backend/src/idraft/api/ai/observation_repository.py` | T1 | `_O.answer_hash` in `get_observation`, `c.quote` in `citations_of`, new `raw_sha256()` | nobody listed |
| `backend/src/idraft/db/tables.py` | T1 | one `Column("quote", Text)` in `ai_citations` | WP-13 (merged; re-grant) |
| `backend/src/idraft/collectors/ai_prompt_ingest.py` | T1 | `"quote": source.quote` in `_insert_citations` | nobody listed |
| `backend/src/idraft/providers/dataforseo/ai_parse.py` | T1 | `CitedSource.quote`, `_Sources.add`, `READS_PATHS` | nobody listed |
| `backend/tests/security/test_cross_tenant.py` | T0, T2 | anchor block `# WP-26 evidence-viewer` (QUERIES none, BODIES none) and a baseline answer in `_tenant` (T2) | WP-32 |
| `docs/ai-visibility/contracts/README.md` | T0 | one index row for `evidence.md` | WP-32 |
| `apps/web/package.json`, `pnpm-lock.yaml` | T3a | `react-markdown` and `remark-gfm`, own commit | none (new dependency) |
| `apps/web/messages/en.json` | T3 to T5 | only `evidence.*` (shared parts) and `prompts.evidence.*` and `prompts.answer.*` | SHARED WP-19 |
| `apps/web/src/mocks/handlers/prompt-answers.ts`, `apps/web/src/mocks/prompt-fixtures.ts` | T3b | detail answers carry `answer_sha256`, `raw_sha256`, `quote` on some citations (additive) | WP-19 |
| `apps/web/src/features/prompts/inspector-latest.tsx`, `inspector-latest.test.tsx` | T4 | extract `ResponsePreview`, add the hash line (WB-PI-23) | none (WP-25 merged) |

Not leases (protocol): new migration, `backend/openapi/v1.json` and `schema.ts` (regenerated once, T0), anchor blocks in
`tests/api/test_route_access.py`, the append-only As built sections, the contract note change log.
New files nobody owns, added to this package's list: `backend/src/idraft/api/schemas/ai_evidence.py`,
`backend/src/idraft/db/migrations/versions/0023_ai_citation_quote.py`, `docs/ai-visibility/contracts/evidence.md`,
`apps/web/src/features/prompts/answer-markers.ts`, `answer-compare-query.ts`, new tests and e2e files.

## Schedule (two subagents at most; the second is a read-only reviewer whenever an implementer finishes)

1. T0 alone (backend contract push; everything else waits for the regenerated `schema.ts`).
2. T1 (backend) in parallel with T3 (web). T3a lands the dependency commit first, alone.
3. T2 (backend, after T1: both edit `observations.py`) in parallel with T4 (web, after T3: both edit `answer-inspector.tsx`
   and `en.json`).
4. T5, then T6 (needs the backend on develop, `pnpm gen:api` is a no-op check), then T7.
After every task a fresh Sonnet reviewer returns PASS or a numbered fix list, then commit. Push after T0, after T2 (backend done),
and at T6.

---

## T0: Contract first push (schemas, 501 stub, additive fields, ONE regeneration, contract note)

Rows: starts CF-25, CF-26, BE-SOURCES-21, BE-REPORTS-04 (contract part). Owned: WP-26 unless marked.
Files:
- `backend/src/idraft/api/schemas/ai_evidence.py` (new, WP-26): `CompareEntity` (entity_id, name, role), `CompareSource`
  (registrable_domain, host, domain_role, title), `CompareSide` (observation_id str, observed_at, own_mentioned,
  own_domain_cited), `CompareEntities` (gained, lost, kept lists), `CompareSources` (gained, lost lists, kept_count int),
  `AnswerCompare` (prompt_id, engine_code, latest, baseline, entities, sources), `AnswerCompareResponse` (data).
- `backend/src/idraft/api/schemas/ai.py` (LEASE): `CitationOut.quote: str | None = None`, `ObservationDetail.answer_sha256`
  and `raw_sha256`: `str | None = None`, each with a description (lowercase hex, 64 characters; null when the answer has no text
  or the payload row is gone).
- `backend/src/idraft/api/ai/observation_routes.py` (WP-26): `GET /{observation_id}/compare`, `ReadData`, summary and
  description, `@not_built`, body `raise not_built_yet()`. Declared before `/{observation_id}/raw`-style neighbours is irrelevant
  (distinct suffix). Registered already (router in `main.py`); no `main.py` edit.
- `backend/tests/api/ai/test_contract_evidence.py` (new): the 501 contract test; `backend/tests/api/test_route_access.py`
  (line under `# WP-26 evidence-viewer`): `("GET", ".../ai/observations/{observation_id}/compare"): "data:read"`;
  `backend/tests/security/test_cross_tenant.py` (LEASE): nothing to add in T0 (the generic NOT_BUILT rule covers the stub).
- `backend/openapi/v1.json` and `apps/web/src/lib/api/schema.ts`: regenerated once.
- `docs/ai-visibility/contracts/evidence.md` (new): status table (route, optional fields), request and response examples
  produced by instantiating the models, problem codes (`404 not_found`, `404 no_baseline`, `403`, `422`), D1 and D2 rules, the
  CF-25 finding (offsets already built and what they point at), the quote source table (fact 3), a change log. Contract README
  index row (LEASE).
Failing tests first (`test_contract_evidence.py`):
- `test_compare_answers_501_for_a_reader_after_the_access_checks`: viewer gets 501 `not_implemented`.
- `test_compare_is_404_for_a_non_member_and_for_another_workspace_project` and `test_compare_validates_the_id_as_a_64_bit_integer`
  (id 0 and 2**63 give 422 `validation_failed`).
- `test_the_new_fields_are_optional_in_openapi`: `quote`, `answer_sha256`, `raw_sha256` are in the schemas and not in `required`.
- `tests/api/test_route_access.py` and `tests/api/test_openapi.py` fail until the line and `v1.json` exist.
Outline: add models and stub; run `cd backend && uv run python -m idraft.api.openapi > openapi/v1.json`; then `cd apps/web && pnpm gen:api && pnpm typecheck`.
Verify:
- `infra/dev/heavy --lane medium --label wp26-t0 --wait 30 --max 20 -- bash -c 'cd backend && uv run pytest -n 2 --no-cov tests/api/ai/test_contract_evidence.py tests/api/test_route_access.py tests/api/test_openapi.py tests/security/test_cross_tenant.py -k "compare or access or openapi or published_contracts or word_in_a_path"'`
- `cd backend && uv run ruff check src tests && uv run ruff format --check src tests && uv run mypy && uv run lint-imports` (medium lane)
- `cd apps/web && pnpm exec vitest run --maxWorkers=3 src/lib/api/schema.test.ts` then `pnpm typecheck` (medium lane).
Closes: nothing yet (contract). Prove it bites: none (stub). Reviewer checks: field names equal the note; fields are optional and
absent from `required`; `v1.json` and `schema.ts` regenerated from the same code (`schema.test.ts` fresh); stub answers after
permission and path validation; no body written; push is a single commit set, then `wp-status building` and the coordinator line.

## T1: Offsets, hashes and quote (CF-25, CF-26, BE-SOURCES-21)

Files: `backend/src/idraft/api/ai/observations.py` (WP-26), `observation_repository.py` (LEASE), `db/tables.py` (LEASE),
`collectors/ai_prompt_ingest.py` (LEASE), `providers/dataforseo/ai_parse.py` (LEASE), new migration
`backend/src/idraft/db/migrations/versions/0023_ai_citation_quote.py` (WP-26; `down_revision` = head after rebase),
new tests `tests/api/ai/test_observation_evidence.py`, `tests/providers/dataforseo/test_ai_parse_quotes.py`,
`tests/collectors/test_ai_citation_quotes.py`.
Failing tests first:
- `test_observation_evidence.py`: `test_the_captured_chatgpt_answer_gives_an_offset_for_every_inline_source` (ingest the
  captured fixture through `ingest()`, GET detail; each citation whose raw url is in the text has a non-null offset and
  `text[offset:offset+len(raw)]` read as UTF-16 equals the url; `answer_block_index` non-null for inline sources, null for a
  source-list-only one); `test_the_detail_carries_the_answer_hash` (equals `sha256(answer_text)` hex, 64 chars);
  `test_the_detail_carries_the_raw_hash` (equals the sha256 registered on the payload row and the digest of the body served by
  `/raw`); `test_a_missing_text_or_payload_gives_null_hashes_never_zeros` (an error answer: `answer_sha256` null);
  `test_the_hash_of_an_expired_raw_answer_is_still_given` (retention past, `/raw` is 410, `raw_sha256` present);
  `test_a_quote_is_given_per_citation_for_gemini_and_null_for_chatgpt` (captured Gemini: 8 inline quotes present; ChatGPT:
  all null); `test_a_quote_is_plain_text_even_when_hostile` (snippet with `<script>`: stored and served as text).
- `test_ai_parse_quotes.py`: scraper `snippet` and AI Mode reference `text` are read; first non-empty wins per canonical URL;
  blank or non-string gives None; longer than 1,000 characters is cut; a lone surrogate or NUL is scrubbed;
  `test_reads_paths_cover_the_quote_fields` (the READS_PATHS test of `test_ai_parse.py` still passes).
- `test_ai_citation_quotes.py`: ingest writes `ai.citations.quote`; an answer without quotes writes null.
- `tests/db/test_ai_schema.py` and `tests/db/test_grants.py` stay green (table-level INSERT covers the new column; check, edit none).
Outline: migration `ALTER TABLE ai.citations ADD COLUMN quote text` (nullable, no default, catalog only; the partitioned parent
carries it; downgrade drops it; docstring as 0022); `ai_citations` gets `Column("quote", Text)`; parser: `CitedSource.quote`,
`_Sources.add(..., quote_field=)` ("snippet" for scrapers, "text" for AI Mode references), `found()` carries it; add the two
paths to `READS_PATHS`; ingest writes it; repository: select `_O.answer_hash` in `get_observation`, `c.quote` in
`citations_of`, `raw_sha256(db, observation_id)` = `SELECT sha256 FROM ai.observation_raw(:id)` (reads one column); service:
`answer_sha256=None if row.answer_hash is None else bytes(row.answer_hash).hex()`, `raw_sha256` the same from the payload row
inside the same transaction as the project check (the function does not check the project; `get_observation` already did).
Verify: `... pytest -n 2 --no-cov tests/api/ai/test_observation_evidence.py tests/api/ai/test_observation_routes.py tests/providers/dataforseo tests/collectors/test_ai_prompt_ingest.py tests/collectors/test_ai_citation_quotes.py tests/db/test_ai_schema.py tests/db/test_grants.py`, then ruff, format, mypy, lint-imports.
Regeneration: none (T0 already did; if a field changed, T0 is amended, not a second regeneration).
Rows: CF-25 (confirmed by tests), CF-26, BE-SOURCES-21.
Prove it bites: (a) hash hex conversion: return zeros for a null `answer_hash`: `test_a_missing_text_or_payload_gives_null_hashes_never_zeros`
fails. (b) the `_web_address`-style guard is not touched. (c) drop `scrub_text` on the quote: `test_a_quote_is_plain_text_even_when_hostile`
or the surrogate case in `test_ai_parse_quotes.py` fails. (d) drop the 1,000 character cut: the length test fails.
Reviewer checks: no real provider call; migration is expand only and numbered above 0022; model and table agree
(`tests/db` schema test); hex is lowercase; no extra statement beyond one for the raw hash; ingest transaction unchanged.

## T2: Answer diff read (BE-REPORTS-04)

Files: `backend/src/idraft/api/ai/answer_diff.py` (new, WP-26: `NoBaselineError(ProblemError)` 404 `no_baseline` "No earlier
answer to compare", the queries and the pure `diff()`), `observations.py` (a `compare()` method on `ObservationService`),
`observation_routes.py` (drop `@not_built`, call the service), `tests/api/ai/test_answer_compare.py` (new, replaces
`test_contract_evidence.py`, which is deleted), anchor lines in `tests/api/test_route_access.py` (already from T0) and
`tests/security/test_cross_tenant.py` (LEASE: add to `_tenant` one earlier answer of the seeded prompt that names the own
brand, written first so its `now()` is older, so the existing seeded answer has a baseline and the strict `< 300` rule holds).
Failing tests first (`test_answer_compare.py`, worlds from `tests/api/ai/sources_support.py` and `tests/collectors/ai_support.py`):
- `test_latest_against_the_last_answer_that_named_you`: three earlier answers (one that did not name the brand, one invalid, one
  that did); the baseline is the newest that named it; both ids and `observed_at` returned.
- `test_entities_and_sources_gained_lost_and_kept`: hand-worked sets; kept lists and `kept_count` agree.
- `test_sources_compare_by_registrable_domain_and_leave_flagged_citations_out`.
- `test_no_earlier_named_answer_is_404_no_baseline` and `test_an_answer_with_no_earlier_answer_at_all_is_404_no_baseline`.
- `test_a_superseded_or_other_engine_or_other_prompt_answer_is_never_the_baseline`; `test_a_later_answer_is_never_the_baseline`.
- `test_an_observation_of_another_project_in_the_workspace_is_404_not_found` and `test_a_deleted_project_is_404`;
  `test_a_viewer_can_compare` (`data:read` only, no `raw:read`); `test_the_observed_at_hint_is_not_a_parameter` (422 not raised
  for an unknown query).
- `test_compare_statements_are_constant`: with `statements()` from `sources_support`, a pair with 2 citations and a pair with 40
  citations and 12 mentions each issue the same number of statements, and at most 5 outside the transaction's own `set_config`
  (lookup of the latest, baseline, mentions of both in one statement, citations of both in one statement).
- Cross-tenant: `test_another_workspaces_child_in_the_callers_own_path_is_not_found` and
  `test_a_project_outside_the_members_scope_is_not_found` now run strict for the compare route (NOT_BUILT no longer lists it).
Outline: `compare(access, project_id, observation_id)` opens one `workspace_transaction`, reuses `repository.get_observation`
(project and deleted check, no hint), reads the baseline with one query on `ai_observation_facts` (index
`observation_facts_prompt_engine_observed`) joined to `ai_observations` with workspace, project, `superseded_by IS NULL`, tuple
`(observed_at, id) <` the latest, order desc, limit 1; then mentions of both observations in one grouped read (current
derivation of each, `mention_status = 'accepted'`) and citations of both in one read joined to `core.urls` and `core.domains`
(`registrable_domain`, flags not in the two flagged ones). `diff()` is set arithmetic over entity ids and registrable domains,
sorted by name and domain for a stable answer. Every statement names `workspace_id`; the lookups never trust a body or the id alone.
Verify: `... pytest -n 2 --no-cov tests/api/ai/test_answer_compare.py tests/api/ai/test_observation_routes.py tests/api/test_route_access.py tests/security/test_cross_tenant.py`, ruff, format, mypy, lint-imports. After T2 the single heavy check
`infra/dev/heavy --label wp26-be --wait 30 --max 30 -- bash -c 'cd backend && ./check.sh -n 4'`, then `git fetch origin && git rebase origin/develop`
(renumber the migration if 0023 is taken: check `ls backend/src/idraft/db/migrations/versions | tail -3` and the tracker `migrations`),
regenerate `v1.json` and `schema.ts` only if the code changed shapes (it must not), then `git push origin HEAD:develop`, status `building`.
Rows: BE-REPORTS-04; change log lines in `contracts/evidence.md` (501 stub gone, codes). As built note for docs 19 and 29 (append-only).
Prove it bites (scratch commit, never pushed, restore after; list in the package report):
1. Remove `_O.project_id == project_id` in the latest lookup: `test_an_observation_of_another_project_in_the_workspace_is_404_not_found` fails.
2. Remove `superseded_by IS NULL` in the baseline: `test_a_superseded_or_other_engine_or_other_prompt_answer_is_never_the_baseline` fails.
3. Remove the `is_valid` or `own_mentioned` predicate: `test_latest_against_the_last_answer_that_named_you` fails.
4. Remove the `(observed_at, id) <` bound: `test_a_later_answer_is_never_the_baseline` fails.
5. Remove the flag filter: `test_sources_compare_by_registrable_domain_and_leave_flagged_citations_out` fails.
6. Replace the one mentions read by a per-observation loop: `test_compare_statements_are_constant` fails.
7. Remove `workspace_id` from the baseline query: RLS masks it in tests, so this guard is covered by the cross-tenant
   suite plus `grep` in review, not by a mutation (state this honestly in the report).
Reviewer checks: `ProblemError` subclass is in `answer_diff.py`, not `problems.py`; no edit to `main.py`, `permissions.py`,
`resources.py`; `data:read`; the route's description states D1 and D2; lists are bounded by the answers' own mentions and
citations (say so in the note); no query inside a loop.

## T3: Web foundation: mock first, SafeMarkdown, markers, list, toggles, view modes (SC-11, WB-ANS-10, 11, 12)

Split in three commits so the dependency lands alone.
T3a (own commit, LEASE package.json and lockfile): add `react-markdown` and `remark-gfm` at exact versions (at least two weeks
old, React 19 compatible) with `pnpm add --save-exact` from `apps/web`; no `rehype-raw`. Fallback if the lease is refused: an
in-house subset renderer in the same file with the same fixtures (headings, paragraphs, lists, emphasis, inline code, links;
tables stay text). Verify: `pnpm install --frozen-lockfile` clean, `pnpm typecheck`.
T3b (mock first): `apps/web/src/mocks/handlers/evidence.ts` (WP-26: the compare handler, computed from the prompt fixtures
with the same rule as D1 and D2, `404 no_baseline` problem, 404 for an unknown id, validation like the detail handler),
`apps/web/src/mocks/handlers/prompt-answers.ts` and `apps/web/src/mocks/prompt-fixtures.ts` (LEASE: detail answers carry
`answer_sha256`, `raw_sha256` (null for one fixture), `quote` on the citations of the Gemini fixture answers).
Failing tests first: `apps/web/src/mocks/handlers/evidence.test.ts`: reads `schema.ts` shapes as `z.ZodType<Schemas['AnswerCompare']>`
(pattern of `layouts.test.ts`) and parses the answer (`test_the_compare_answer_has_the_shape_the_schema_says`), a mutated extra
or missing member fails the parse; `test_no_baseline_answers_404_no_baseline`; `test_the_detail_answers_carry_hashes_and_a_quote`
in `prompt-answers.test.ts` (LEASE file) using shapes `z.ZodType<Schemas['ObservationDetail']>`.
T3c (parts), all in `apps/web/src/components/app/evidence/` (WP-26), each with a test file beside it, copy in `messages/en.json`
under `evidence.*`:
- `safe-markdown.tsx`: `react-markdown` with `skipHtml`, `disallowedElements` for `img`, `iframe`, `script`, `style`, `urlTransform`
  that passes only `webHref` results, `a` rendered with `TextLink` (`target="_blank" rel="noopener noreferrer"`) and the host in
  `type-meta` beside it, no highlights, `lang`.
- `citation-marker.tsx` (`index`, `label`, `onActivate`), `citation-list.tsx` (DS25 15.16: `ol`, index, title escaped, host,
  role badge, `quote` through `QuoteBox` when present (T4), `CopyButton` with the original `raw_url`, open link, flag icons with
  tooltips, `activeIndex`, "Show in answer"), `entity-toggle-list.tsx` (checkbox group "Entities", swatch by color index, span
  count), `answer-view-mode.tsx` (`SegmentedControl semantics="view"`, `canViewRaw`).
- `apps/web/src/features/prompts/answer-markers.ts` (new, pure): `markerAnchors(text, citations)` returns UTF-16 insertion
  offsets (D5, surrogate safe, never inside a surrogate pair, never past the text) and `withMarkers(segments, anchors)` splits
  `answerSegments` output at them; `marked-answer.tsx` (WP-26) renders markers and takes `hidden: ReadonlySet<string>`
  (mentions of hidden entities render as plain text).
- `answer-inspector.tsx` (WP-26): view mode state (Evidence default), toggle state, active citation state; Evidence = marked text
  plus markers plus toggles; Formatted = `SafeMarkdown`; Raw = `fetchRawAnswer` on open (only with `raw:read`), `rawExpired`,
  `rawUnavailable` and `rawFailed` messages reused; the sources section becomes `CitationList`; markers and list link both ways
  (focus moves to the list item; `useShortcut` only if a single key is added, none planned).
Failing tests first:
- `safe-markdown.test.tsx` XSS fixtures from `src/components/app/cells/xss-fixtures.ts` plus new ones: `<script>` text,
  `<img src=x onerror=...>`, `<svg onload=...>`, `[x](javascript:...)` in mixed case and entity encoded, `[x](data:text/html,...)`,
  `![x](https://evil.example/p.png)` (no `img` element, no request), `<iframe>`, `<style>`, HTML comment, credentials URL link
  (text, not an href), an `[x](vbscript:...)`. Assertions per doc 20 section 8.2: no element with an `on*` attribute, no `href`
  or `src` that is not http or https, no `script`, `iframe`, `style` or `img` from content, `window.__wp26_xss` never set after
  render and click, GFM table renders as table. Names: `test_a_script_is_inert`, `test_an_event_handler_attribute_is_inert`,
  `test_a_javascript_link_is_text`, `test_a_markdown_image_is_dropped`, `test_every_hostile_link_scheme_is_text`,
  `test_a_safe_link_opens_with_noopener_and_shows_its_host`.
- `answer-markers.test.ts`: anchor after the URL; a rocket before it shifts by 2 units; no offset gives no anchor; two citations
  at one offset both anchor in order; out of range ignored; segments still add up to the text.
- `citation-marker.test.tsx` and `citation-list.test.tsx`: keyboard activation, `aria-label`, active item, copy copies `raw_url`,
  a javascript `url` is text, flags have tooltips, axe clean.
- `entity-toggle-list.test.tsx`: group legend, toggling reports the id, counts, `chart-other` swatch past six, axe.
- `answer-view-mode.test.tsx`: Raw absent without `canViewRaw`; radio semantics; arrow keys.
- `apps/web/src/features/prompts/answer.test.tsx` (existing, extend): marker click scrolls and marks the list item; hiding an
  entity removes its marks; Formatted shows headings and a table; Raw fetches once on open and shows 410 and 503 messages;
  a viewer without `raw:read` has no Raw mode.
Verify (from `apps/web`): `pnpm exec vitest run --maxWorkers=3 src/components/app/evidence src/features/prompts/answer.test.tsx src/features/prompts/answer-markers.test.ts src/mocks/handlers/evidence.test.ts src/mocks/handlers/prompt-answers.test.ts src/i18n/messages.test.ts src/test/source-text.test.ts`;
`pnpm exec eslint <changed files>`; `pnpm exec prettier --check <changed files>`; `pnpm typecheck` (medium lane).
UI check: `NEXT_PUBLIC_API_MOCKING=all` dev server per the Dev Server Policy (reuse this worktree's, else a free port from 3101 to
3105, never kill another), open an answer from the Prompts page; 390, 768, 1024, 1280; light and dark; Default and Compact.
Rows: SC-11, WB-ANS-10, WB-ANS-11, WB-ANS-12.
Prove it bites (reviewer, scratch commit): (1) `urlTransform` returns the url unchanged: `test_a_javascript_link_is_text` and
`test_every_hostile_link_scheme_is_text` fail. (2) remove `skipHtml`: `test_a_script_is_inert` or the event handler test fails.
(3) allow `img`: `test_a_markdown_image_is_dropped` fails. (4) `canViewRaw` ignored: the viewer-without-`raw:read` test fails.
(5) marker anchors counted in code points: the rocket case fails. (6) hidden set ignored: the toggle test fails.
Reviewer checks: no `dangerouslySetInnerHTML` (grep), `target="_blank"` always with `rel`, host shown beside every link, tokens
only, copy under `evidence.*`, no dash characters, focus visible on markers, the Evidence text keeps `whitespace-pre-wrap`.

## T4: QuoteBox, ResponsePreview, FactsFooter, provider link, compare panel, quoted passage, hash line (SC-23, WB-ANS-13 to 16, WB-SRC-04, WB-PI-23)

Files (WP-26 unless marked), in `apps/web/src/components/app/evidence/`: `quote-box.tsx` (DS25 15.26: blockquote, `cite` source
line, `lang`, typographic quotes, no clamp in the inspector), `response-preview.tsx` (header line, 6 clamped lines of marked
text, mention summary, citation count, "Open evidence"; presentational, takes data and `onOpen`), `facts-footer.tsx` (`dl`:
mentioned, cited, mention order, prominence, citation counts, derivation id; only facts the API gives, `EMPTY_VALUE` for
unknown; the answer and raw hash lines with `CopyButton` placement inline `inGrid={false}`, first 12 hex characters shown, full
value copied, no line when null), `answer-compare-panel.tsx` (D6), `quoted-passage.tsx` (section: list of `QuoteBox` per
citation that has a `quote`, host beside each; hidden when none). In `apps/web/src/features/prompts/`: `answer-compare-query.ts`
(new, `apiQuery` of the compare route, `retry: false` on `no_baseline`), `answer-inspector.tsx` (WP-26: Facts footer section
replaces the details-only tail, provider link relabelled "Open at the provider" with `ExternalLink` glyph, compare section,
quoted passage section when any quote), `inspector-latest.tsx` and its test (LEASE: use `ResponsePreview`; one `type-meta`
line "Answer SHA-256 <12 hex>" with copy and the same for raw, per card; a null hash shows no line).
Failing tests first:
- `quote-box.test.tsx` (hostile text stays text, `lang`, source line), `response-preview.test.tsx` (clamp, summary, open button
  name), `facts-footer.test.tsx` (unknown is `EMPTY_VALUE` never 0; hashes shown, copy copies the full value, null hidden;
  axe), `quoted-passage.test.tsx` (hidden with no quotes; a hostile quote is text), `answer-compare-panel.test.tsx` (states:
  loading skeleton, ready with gained, lost and kept, empty reason for `no_baseline`, error with retry, RefetchBar keeps the
  previous data on refetch, a gained entity is announced as text not by colour alone, "Open" links to the baseline).
- `answer.test.tsx`: `test_the_provider_link_is_http_or_https_only` (a `javascript:` `check_url` renders no link),
  `test_the_provider_link_has_noopener_noreferrer_and_opens_a_new_tab`, `test_the_compare_section_reads_the_route_and_opens_the_baseline`,
  `test_quoted_passages_show_only_where_the_payload_has_one`.
- `inspector-latest.test.tsx`: `test_a_card_shows_the_answer_hash_with_a_copy_button`, `test_a_null_hash_shows_no_line_and_never_zeros`.
Verify as T3 plus `src/features/prompts/inspector-latest.test.tsx src/features/prompts/inspector-tabs.test.tsx`.
Rows: SC-23, WB-ANS-13 (full), WB-ANS-14 (confirmed and tested), WB-ANS-15 (summary form, D6), WB-ANS-16, WB-SRC-04 (D8),
WB-PI-23 (closes the WP-25 note).
Prove it bites: (1) render a null hash as zeros: `test_a_null_hash_shows_no_line_and_never_zeros` fails. (2) drop the scheme check
of the provider link: `test_the_provider_link_is_http_or_https_only` fails. (3) show `quote` through an HTML path: hostile quote test fails.
(4) compare panel treats `no_baseline` as an error: the empty-state test fails.
Reviewer checks: Latest card tests of WP-25 still pass unchanged apart from the extraction; `inspector-latest.tsx` diff is the
extraction plus the hash lines only; no layout shift at 390; the hash is never the only thing copied silently (announcement).

## T5: Built rows confirmed, e2e, browser pass (WB-ANS-01 to 09)

Files: `apps/web/e2e/flows/ai-evidence.spec.ts` (new), `apps/web/e2e/support/ai-evidence.ts` only if a helper is shared,
`apps/web/src/features/prompts/answer.test.tsx` (extend where a row has no named test).
Rows are built; write down for each the test that proves it (row to test list goes in the As built note): WB-ANS-01 spans
(`answer-segments.test.ts`), 02 mark names (`evidence-highlight.test.tsx`), 03 mentions list, 04 sources role and host, 05 ads
note, 06 statuses, 07 details, 08 download and the 410 and 503 toasts, 09 back to the prompt. Add a test for any without one.
e2e (mock world, `signIn` and `expectAccessible` from `../support`, pattern of `ai-prompt-inspector.spec.ts`): open an answer
from the Prompts page; the markers jump to the list; toggling an entity removes its mark; Formatted shows rendered markdown and
no `script`; Raw loads and shows text; compare shows gained and lost; the provider link opens a new tab with `noopener`; at 390
no horizontal scroll (`scrollWidth <= clientWidth`); axe at 1280 and 390 in light and dark.
Verify: `infra/dev/heavy --label wp26-e2e --wait 30 --max 30 -- bash -c 'cd apps/web && pnpm exec playwright test --project=e2e e2e/flows/ai-evidence.spec.ts'`.
Rows: WB-ANS-01 to WB-ANS-09 confirmed. Prove it bites: none new. Reviewer checks: the row to test list is complete; the browser
pass of the acceptance criteria (four widths, light and dark, Default and Compact, loading, empty, error, partial and stale states
for the viewer, compare panel and Raw) is recorded with what was seen.

## T6: Wire to the real route, As built notes, rebase, final checks, push

Precondition: T0 to T2 on develop. `git fetch origin && git rebase origin/develop`; `cd apps/web && pnpm gen:api && git diff --exit-code src/lib/api/schema.ts`
(must be clean). Check against the dev API only if the coordinator's backend dev server has the migration; the shared dev database
is not upgraded by this package (use `idraft_wp_26` on the same server for a manual check, never `idraft-dev-postgres-1` as is).
Files: docs 19 and 29 (As built, append-only, backend), doc 20 section 4.9 and DS23 5 and 6.3, DS25 15.14 to 15.20 and 15.26
(As built notes for web: D4 to D6, the AnswerCompare summary form, markers at the URL end), `contracts/evidence.md` change log,
`docs/ai-visibility/contracts/README.md` (LEASE) index update. Remove any shortcut comment left in code or record it.
Full checks, one job each, through the lock: `infra/dev/heavy --label wp26-final --wait 30 --max 30 -- bash -c 'cd apps/web && pnpm lint && pnpm typecheck && pnpm format:check && pnpm test && pnpm build'`
and the backend `./check.sh -n 4` job of T2 again if the rebase brought backend changes. Then `git push origin HEAD:develop`
(fast forward only), `infra/dev/wp-status WP-26 merged "<note>"` and the coordinator line
`WP-26 merged | branch ai/wp-26-evidence @ <sha> | rows done 23/23 or n/23 | steps 7/7 | blockers: <none or list> | next: <line>`.
Rows: process.

## T7: Whole-package review (fresh Sonnet reviewer) and prove-it-bites report

Reads the brief, this plan and `git diff origin/develop...HEAD`; checks every row of the brief against a test or a recorded
reason; greps the whole diff for U+2014, U+2013, `dangerouslySetInnerHTML`, raw colours, `toFixed`, `toLocaleString`;
runs the guard mutations listed in T2, T3, T4 in scratch commits (never pushed) and records the failing test names;
opens the viewer at 390, 768, 1024 and 1280, light and dark, Default and Compact, keyboard only. Returns PASS or a numbered
fix list; the package report carries the guard list and the failing test names.

---

## Rows and the task that closes them

| Row | Task | Row | Task |
|---|---|---|---|
| CF-25 | T1 (tests only) | WB-ANS-12 | T3 |
| CF-26 | T1 | WB-ANS-13 | T4 |
| BE-SOURCES-21 | T1 | WB-ANS-14 | T4 (confirm) |
| BE-REPORTS-04 | T2 | WB-ANS-15 | T4 (summary form, D6) |
| SC-11 | T3 | WB-ANS-16 | T4 |
| SC-23 | T4 | WB-SRC-04 | T4 (component, D8) |
| WB-ANS-01 to 09 | T5 (confirm) | WB-PI-23 (WP-25's) | T4 |
| WB-ANS-10, 11 | T3 | | |

## Risks

- Quote availability is engine dependent: ChatGPT gives none, so for ChatGPT the quote UI is always absent. Say so in the
  contract note and in the empty state of the quoted passage section ("this engine gives no passage").
- Marker placement in Evidence mode: the text is shown as markdown source (stage 3 blocks are not built), so a marker lands after a
  raw link target and may look odd inside `[text](url)`. Acceptable for release A; a nicer anchor needs stage 3 offsets.
- Dependency lease for markdown rendering; XSS surface is the main risk of the package, covered by the fixtures and mutations.
- `observations.py` and `answer-inspector.tsx` are touched by two tasks each, hence the sequencing; `en.json` conflicts with WP-19
  and others are resolved by keeping both sides, then `pnpm test src/i18n/messages.test.ts`.
- Cross-tenant `_tenant` edit (T2) touches a shared seed under another package's lease; keep it to one inserted answer.
- Raw mode can hold a few hundred KB; the 200,000 character cap and the download keep the inspector fast.
- A second migration number collision: renumber at push, check `tracker.json` `migrations` first.

## Open questions (default taken, none blocks)

1. Lease grants listed above, especially `package.json` and lockfile (react-markdown, remark-gfm), `schemas/ai.py`, `tables.py`
   (WP-13 holds it), `test_cross_tenant.py` (WP-32), `prompt-answers.ts` and `prompt-fixtures.ts` (WP-19), `inspector-latest.tsx`.
2. D3: optional response fields (always sent). Coordinator may prefer required; it costs edits in about six mock and test files.
3. D4: Raw view means the provider's raw JSON (DS25 15.18) rather than the markdown source. Owner or coordinator to confirm.
4. D6: AnswerCompare as a summary at 440 px, two column view left to WP-52 (Prompt Detail). WB-ANS-15 then closes as "summary form".
5. D8: WB-SRC-04 needs `quote` on the citations list read (`CitationRow`, WP-14 and WP-21 shapes) and a mount in the cited URL
   inspector (WP-22). Coordinator to route.
6. `PARSER_VERSION` stays 1 and old citations keep a null quote (no re-derive). Owner may want a backfill later (a WP-56 concern).
7. Design system gallery specimens for the new parts are not in the brief and would need the registry lease; skipped unless asked.
8. Top-level `evidence.*` message namespace is used for the shared parts (it already holds `evidence.highlight`); confirm it is this package's.
