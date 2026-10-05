# Keyword Imports (Task 10) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build keyword imports end to end: a user sends paste text, JSON rows or a CSV file; the worker parses and classifies every row into a preview; the user adjusts and confirms; the worker writes the tracked keywords in batches of 1,000 with their groups and terms.

**Architecture:** The API stores each source in R2 and records an import (`seo.keyword_imports`) in status `uploaded`. A worker tick claims uploaded imports, parses them in one transaction and writes the preview rows (`seo.keyword_import_rows`). Confirming sets status `writing`; the same tick writes pending rows batch by batch, each batch in its own transaction, so a crash resumes where it stopped. Parsing rules are pure functions shared by both stages; group, term and link helpers move below the API so the worker can use them (import-linter forbids `collectors` importing `api`).

**Tech Stack:** Python 3.13, FastAPI, SQLAlchemy 2 Core async on asyncpg, PostgreSQL 18 with RLS, Pydantic v2, strict mypy, pytest with Testcontainers, `python-multipart` (new).

**Parent plan:** `docs/superpowers/plans/2026-10-01-keywords.md`, Task 10 and decisions D11 to D13. This sub-plan replaces Task 10's bullet list; tick Task 10 there when Part B is reviewed.

---

## 0. Read this first (for the implementer)

**Where:** worktree `/Users/a12345/Desktop/AI/SEO Tool/.claude/worktrees/backend-keywords`, branch `backend/keywords`. Run everything from `backend/`.

**Commands:**
- One test file: `export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"; uv run pytest tests/path/test_x.py -q -p no:cacheprovider --no-cov`
- Lint and types: `uv run ruff format src tests && uv run ruff check src tests && uv run mypy src tests`
- Full gates (about 15 minutes, run in the background and wait for the file): `./check.sh > <scratchpad>/gates.log 2>&1; echo "exit=$?" >> <scratchpad>/gates.log`. Do not edit `src` while the gates run (coverage reads files at the end).
- Docker must answer (`docker version`) before any database test. If it does not, stop and tell the user; do not restart anything yourself.

**House rules (these are enforced in review):**
- Write and edit files with the Write and Edit tools. No heredocs, `sed -i` or replace scripts to change source.
- No em-dashes or en-dashes anywhere (code comments, docs, messages, commit messages).
- No attribution lines in commits. Commit only at the steps below. Never push.
- Strict typing: no `Any` unless the surrounding code already uses it for SQLAlchemy rows; explicit return types.
- Every statement names the workspace (`workspace_id == ...`), also in the API, even though RLS applies there: the worker bypasses RLS.
- Comments say why, in the style of the surrounding code. Docstrings on public functions.
- After each Part: full gates, commit, then an **Opus** review (Agent tool, `model: "opus"`, background), fix what it finds, gates again, a fix commit. The parent session does the review; the implementer stops after the Part's commit.

**Patterns to copy (read these files before starting):**
- API service and transaction: `src/sightline/api/operations/runs.py` (`workspace_transaction`, `_live_project`, cursor pages with `encode_cursor`/`decode_cursor`).
- API routes and permissions: `src/sightline/api/operations/run_routes.py`, `schedule_routes.py`.
- Worker claim with `FOR UPDATE SKIP LOCKED`: `_next_manual` in `src/sightline/collectors/planner.py`.
- Worker ticks: `assemble` in `src/sightline/worker/assembly.py`.
- Test helpers: `tests/api/keywords/support.py` (`keyword_project`, `project_url`, `errors`, `tracked_id`, `group`, `vocabulary`, `term`), `tests/api/entities/support.py` (`member`, `problem`), `tests/collectors/test_fetching.py` (`MemoryStore`), worker fixtures `worker_db` and `migrated`.

## 1. Decisions (settled; do not reopen)

**I1. The contract is the frontend's draft.** `apps/web/openapi/step-5-draft.json` and `src/sightline/api/schemas/imports.py` (already written) are the contract. Routes, under `{P} = /api/v1/workspaces/{workspace_id}/projects/{project_id}`:

| Method | Path | Permission | Answer |
|---|---|---|---|
| POST | `{P}/keyword-imports` | `imports:write` | `202 KeywordImportResponse` (JSON body `KeywordImportCreate`, source `paste` or `api`) |
| POST | `{P}/keyword-imports/upload` | `imports:write` | `202 KeywordImportResponse` (multipart: `file`, optional `options` = JSON of `ImportOptions`) |
| GET | `{P}/keyword-imports` | `data:read` | `KeywordImportPage`, newest first, cursor, `filter[status]` |
| GET | `{P}/keyword-imports/{import_id}` | `data:read` | `KeywordImportResponse` |
| GET | `{P}/keyword-imports/{import_id}/rows` | `data:read` | `ImportRowPage` in `(row_no, part)` order, cursor, `filter[outcome_in]` (comma list), `filter[action]` |
| PATCH | `{P}/keyword-imports/{import_id}` | `imports:write` | `202 KeywordImportResponse` (body `KeywordImportUpdate`) |
| POST | `{P}/keyword-imports/{import_id}/confirm` | `imports:write` | `202 KeywordImportResponse` (body `KeywordImportConfirm`) (Part B) |
| POST | `{P}/keyword-imports/{import_id}/cancel` | `imports:write` | `200 KeywordImportResponse` |
| GET | `{P}/keyword-imports/{import_id}/report` | `data:read` | `200 text/csv`, built from the rows |

Doc 19's `upload-url` (presigned) route is not built; doc 19 gets an as-built note.

**I2. Statuses.**
- Create: `uploaded`, `expires_at = now() + 7 days`.
- Parse (worker): `uploaded` to `preview_ready`, `needs_mapping` or `failed`. Parsing runs in one transaction, so `parsing` is never committed: a crash leaves the import `uploaded` and the next tick retries it. `parsing` stays a valid value in the enum but is not used.
- PATCH with `column_mapping` or `defaults`: allowed in `uploaded`, `needs_mapping`, `preview_ready`; sets `uploaded` (the worker parses again, replacing the rows). PATCH with `row_actions`: only in `preview_ready`. Both kinds in one PATCH: `422 validation_failed` with `not_with_mapping` at `row_actions`.
- Confirm (Part B): only `preview_ready` with `expires_at > now()`; sets `writing`.
- Write (worker, Part B): `writing` to `completed`, `completed_with_errors` (any row `result = 'failed'`) or `failed` (`error_code = 'project_gone'`).
- Cancel: from `uploaded`, `needs_mapping`, `preview_ready`; sets `cancelled`, `finished_at = now()`. Any other status: `409 invalid_state_transition`.
- Expire (worker): `uploaded`, `needs_mapping` or `preview_ready` with `expires_at <= now()` become `expired` with `finished_at`.

**I3. Sources.**
- `paste`: one keyword per non-blank line; text after the first TAB is the `tags` cell (pipe-separated). `row_no` is the line number in the text (1-based, blank lines keep their number but make no row). Headers are `keyword` and `tags`; `column_mapping` with paste is `422` with `not_applicable` at `column_mapping`.
- `api`: `rows`, each a header to cell map. Headers are the union of keys in row order of first appearance. `row_no` is the index in `rows`, 1-based.
- `upload`: CSV, UTF-8 (a BOM is dropped). Delimiter sniffed among `,`, `;` and TAB from the first 4 KiB, comma otherwise. The first row is the header. `row_no` is the data row number (1-based, header excluded); a row whose cells are all blank makes no row but keeps its number. The part's `content_type` must be one of `text/csv`, `application/csv`, `text/plain`, `application/vnd.ms-excel`, or `application/octet-stream` with a filename ending `.csv`; otherwise `415 unsupported_media_type`. Size: up to 50 MB (`413 payload_too_large` above). `original_filename` is the part's filename cut to 255 characters (`None` when empty).
- Every source: at most `IMPORT_ROWS_MAX = 10_000` rows; more is `failed` with `error_code = 'too_many_rows'`. Other unreadable sources fail with `not_utf8`, `no_header`, `duplicate_headers` (two headers equal without case after trimming).
- The API generates the import id with `uuid.uuid4()`, builds the key `imports/v1/{workspace_id}/{import_id}/source`, stores the source with `store.put`, then inserts the import with that `id` and `upload_object_key` (the API's UPDATE grant does not cover `upload_object_key`, so the key is written by the insert). If `put` raises `RawStorageError`, nothing is inserted and the answer is `503 storage_unavailable`; an object stored by a request whose insert then fails is left for the bucket's lifecycle rule. Lists order by `(created_at, id)`, so a random id is fine. The body is `compress(json.dumps({"kind": "csv" | "paste" | "api", ...}).encode())` from `sightline.storage.raw`. Store layout:
  - CSV: `{"kind": "csv", "data": <base64 of the file bytes>}`.
  - paste: `{"kind": "paste", "text": ...}`.
  - api: `{"kind": "api", "rows": [...]}`.
- No R2 configured: `503` with code `storage_unavailable`.

**I4. Column mapping.** A header maps to the field whose name equals it without case, after trimming. `column_mapping` (header to field) overrides, matching headers without case. Two headers mapped to one field: `422` with `field_mapped_twice` at `column_mapping` (API, when given) or, from headers alone, the first one wins. Headers mapped to nothing are kept in `raw` and ignored. No header maps to `keyword`: `needs_mapping`, `error_code = 'keyword_column_missing'`, no rows. A header maps to `tags` (or a paste line has a TAB) and `defaults.tags_vocabulary_id` is not set: `needs_mapping`, `error_code = 'tags_vocabulary_missing'`, no rows. The same for `topic` with `topic_vocabulary_missing`.

**I5. Field rules** (pure, `sightline/keywords/import_rows.py`). Empty or blank cell: the field takes its default. The first failing field decides the row's `reason_code`, in this order:
1. `keyword`: `check_keyword` (its `KeywordRefusedError.code`: `keyword_missing`, `keyword_invalid`, `keyword_too_long`, `search_operator_not_allowed`). Any cell over 2,000 characters: `cell_too_long`.
2. Location: `location` cell, then `country`, then `defaults.location_id`, then the project's default location. `location`: digits are a location id that must be active; otherwise a name matched without case among active locations, unique, else `location_unknown`. `country`: two letters, the active location with that `country_iso` and `location_type = 'Country'`, else `location_unknown`. No location at all: `location_unknown`.
3. `language`: two lowercase letters after lowercasing the cell; then `defaults.language_code`, then the project's default language. Otherwise `language_invalid`.
4. `device`: `desktop`, `mobile` or `both` without case; default `defaults.device`, then the project's `settings.seo.default_device`. Otherwise `device_invalid`. `both` gives two parts.
5. `priority`: integer 1 to 5; default `defaults.priority`, then 3. Otherwise `priority_invalid`.
6. `depth_profile`: one of `DEPTH_PROFILES`; default `defaults.depth_profile`, then the project's `settings.seo.default_depth_profile`. Otherwise `depth_profile_invalid`.
7. `intent`: one of `INTENTS` without case; default `unknown`. Otherwise `intent_invalid`.
8. `funnel_stage`: one of `FUNNEL_STAGES` without case; default `unknown`. Otherwise `funnel_stage_invalid`.
9. `target_url`: `canonicalize` from `sightline.extraction.urls`; any exception: `target_url_invalid`.
10. `group`: split on `/`, each segment trimmed, 1 to 100 characters, at most 10 segments, the joined path at most 2,048 bytes; default `defaults.group_path`. Otherwise `group_path_invalid`.
11. `tags`: split on `|`, each trimmed, empty ones dropped, each 1 to 100 characters, duplicates without case dropped. Otherwise `tags_invalid`.
12. `topic`: a path split on `/` like `group` (each 1 to 100 characters, at most 10 segments). Otherwise `topic_invalid`.
`competitors` is not offered: a header named `competitors` maps to nothing.

**I6. Outcomes** (worker, per part, in row order):
- Invalid row: one part (`part = 1`, `device = NULL`), `outcome = 'invalid'`, `action = 'skip'`.
- Identity: `(keyword key (normalized text, language), 'google', location_id, language_code, device)`.
- Repeat of an identity seen earlier in this import (valid rows only): `duplicate`, `reason_code = 'repeated_in_file'`, `reason = 'Same as row {first row_no}'`, `action = 'skip'`, no `existing_tracked_keyword_id`.
- Identity live and active in the project: `duplicate`, `reason_code = 'tracked'`, `existing_tracked_keyword_id`, `action = 'skip'`.
- Identity live and archived: `conflict`, `reason_code = 'archived'`, `existing_tracked_keyword_id`, `action = 'skip'`.
- Otherwise (absent or deleted; a deleted one is brought back by the writer, D3): if the workspace has the keyword and its stored `text` differs from the row's cleaned text: `variant`, `reason_code = 'casing_differs'`, `reason = 'Tracked as "{stored text}"'`, `action = 'create'`; else `new`, `action = 'create'`.
- Allowed `row_actions` (anything else is `422 validation_failed` with `action_not_allowed` at `row_actions.{i}.action`; `force_separate` is always `force_separate_not_available`):
  - `new`, `variant`: `create`, `skip`.
  - `duplicate` with `reason_code = 'tracked'`, and `conflict`: `skip`, `merge`.
  - `duplicate` with `reason_code = 'repeated_in_file'`, and `invalid`: `skip`.
  - A `(row_no, part)` the import does not have: `row_unknown` at `row_actions.{i}`.
- Counts (JSON on the import) count parts: `rows_total`, `new`, `duplicate`, `variant`, `conflict`, `invalid`, and after writing `created`, `skipped`, `merged`.
- Quota (on the view when `preview_ready`): `limit` and `used` as `writer.lock_quota` counts them (read without the lock, `writer.quota_usage`), `would_use = used + (parts with action create) + (conflict parts with action merge)`.

**I7. Confirm (Part B).** `duplicate_action = 'merge_terms'` turns every `duplicate` part with `reason_code = 'tracked'` and `action = 'skip'` into `merge`; `skip` changes nothing. Quota: `would_use > limit` is `422 quota_exceeded` with `limit`, `used`, `requested` (the keyword service's `_quota` message), nothing changed.

**I8. Writing (Part B).** Pending parts are those with `result IS NULL`. A batch is at most 1,000 pending parts in `(row_no, part)` order, in one transaction:
- Lock order, matching the API's: the import's advisory lock (`pg_try_advisory_xact_lock`, skip the import this tick if taken), then each vocabulary's advisory lock in id order (`sightline.keywords.terms.lock_vocabulary`), then the project's group lock (`sightline.keywords.groups.lock_groups`), then target URLs (`dictionaries.url_for`, host then hash order), then the quota lock (inside the writer, and `writer.lock_quota` for unarchiving), then rows (`links.lock_rows` for merge targets, id order).
- `skip` parts: `result = 'skipped'`.
- `create` parts: one `writer.write_tracked_keywords` call for the batch with `source` from the import (`upload` to `csv_import`, `paste` to `bulk_paste`, `api` to `api`) and `created_by` = the import's creator. `Created`: `result = 'created'`, `tracked_keyword_id`. `Existing` (added since the preview): `result = 'skipped'`, `tracked_keyword_id`. `QuotaExceededError`: every create part of the batch `result = 'failed'`, `write_error_code = 'quota_exceeded'`, the other parts of the batch go on. `ProjectGoneError`: the import becomes `failed` with `error_code = 'project_gone'`, `finished_at`; the batch's row changes are rolled back.
- `merge` parts: `duplicate` merges add links to the tracked keyword; `conflict` merges unarchive it first (quota: `writer.lock_quota` then `writer.check_quota(limit, used, n)`; failing parts `failed` with `quota_exceeded`). The target gone or deleted since: `failed`, `tracked_keyword_gone`. Done: `result = 'merged'`, `tracked_keyword_id`.
- Links for `created` and `merged` parts: the row's group (created along its path when missing), its tags (top-level terms of the tags vocabulary, matched by name without case, created when missing) and its topic (a term path in the topic vocabulary, created along the path when missing). The extras of `repeated_in_file` parts of the same identity are added to the first part too. Terms use `assigned_by = 'import'`. A term of a single-valued vocabulary is not added when the keyword holds, or has just been given, another term of that vocabulary. A vocabulary deleted since the preview: its terms are skipped for the batch.
- When no pending part is left: counts `created`, `skipped`, `merged` from the results, status `completed`, or `completed_with_errors` when any part failed, `finished_at`.

**I9. Locks shared with the API.** One advisory key per vocabulary, `taxonomy:{vocabulary_id}`, taken by the API's term writes, vocabulary update and vocabulary delete (inside `TaxonomyService._writable` and the vocabulary update and delete paths) and by the worker before it creates or assigns terms. The group key stays `keyword_groups:{project_id}`.

**I10. Report.** `text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="import-{import_id}.csv"`. Columns: `row_no, part, keyword, location_id, language_code, device, outcome, reason_code, reason, action, result, tracked_keyword_id, write_error_code`. A cell starting with `=`, `+`, `-`, `@`, TAB or CR gets a leading `'` (CSV injection). Available when the import has rows (status `preview_ready`, `writing`, `completed`, `completed_with_errors`, or `cancelled` and `expired` that reached a preview); otherwise `409 invalid_state_transition`.

**I11. Permissions.** Reads need `data:read`, writes `imports:write`. Naming `defaults.tags_vocabulary_id` or `defaults.topic_vocabulary_id` also needs `taxonomy:write` (missing terms are created): `403 forbidden` without it. The vocabulary must be workspace-wide or the project's own: `422 validation_failed` with `vocabulary_unknown` at `defaults.tags_vocabulary_id` (or `topic_...`). `defaults.location_id` must be an active location: `location_unknown` at `defaults.location_id`. `defaults.group_path` follows rule I5.10: `group_path_invalid` at `defaults.group_path`.

**I12. Audit** (API only): `keyword_import.created`, `keyword_import.updated`, `keyword_import.confirmed`, `keyword_import.cancelled`, each with `target_type = 'keyword_import'`. The worker writes no audit entries; tracked keywords carry `source`.

**I13. The operation on the view.** `kind = 'keyword_import'`. Status: `uploaded` and `parsing` to `queued`; `needs_mapping` and `preview_ready` to `waiting_for_input`; `writing` to `running`; `completed` to `succeeded`; `completed_with_errors` to `succeeded_with_errors`; `failed` and `expired` to `failed` (error `{code: error_code or 'expired', detail}`); `cancelled` to `cancelled`. `progress`: `{done: parts with a result, total: rows_total or null before the preview, unit: 'rows'}`. `links.self` is the import's URL; `links.cancel` is set while cancellable; `links.result` is the report URL when available.

## 2. File structure

Created:
- `backend/src/sightline/keywords/links.py`: group and term links of tracked keywords (moved from the API repository).
- `backend/src/sightline/keywords/groups.py`: the group lock, group limits, `ensure_group_path`.
- `backend/src/sightline/keywords/terms.py`: slugs, `fold`, the vocabulary lock, `ensure_term_path`.
- `backend/src/sightline/keywords/import_rows.py`: pure source readers, mapping and field rules.
- `backend/src/sightline/collectors/imports.py`: worker parse, classify and expire (Part A).
- `backend/src/sightline/collectors/import_writer.py`: worker batches and finish (Part B).
- `backend/src/sightline/api/imports/__init__.py`, `repository.py`, `service.py`, `routes.py`: the API.
- Tests: `tests/keywords/test_import_rows.py`, `tests/keywords/test_groups_and_terms.py`, `tests/collectors/test_imports.py`, `tests/collectors/test_import_writer.py`, `tests/api/imports/__init__.py`, `tests/api/imports/support.py`, `tests/api/imports/test_imports.py`, `tests/api/imports/test_import_write.py`, `tests/worker/test_import_end_to_end.py`.

Modified:
- `api/keywords/repository.py` (re-export moved link functions), `api/keywords/group_repository.py` and `group_service.py` (use `keywords.groups`), `api/taxonomy/service.py`, `api/taxonomy/slugs.py` (use `keywords.terms`, take the vocabulary lock), `keywords/writer.py` (public `rows_of`, `keyword_texts`, `quota_usage`).
- `api/problems.py` (`UnsupportedMediaTypeError`, `StorageUnavailableError`), `api/body_limit.py` (50 MB for the upload path), `api/resources.py` and `api/main.py` (`import_store`, `imports` service, router), `api/audit.py` (actions), `worker/assembly.py` (the tick).
- `pyproject.toml` and `uv.lock` (`python-multipart`).
- Tests: `tests/api/test_route_access.py`, `tests/security/test_cross_tenant.py`, `tests/worker/test_assembly.py`, `tests/api/conftest.py` (an `import_store` for the app).
- Docs: `docs/19-api-specification.md` (as-built note in 3.6.3), `docs/superpowers/plans/2026-10-01-keywords.md` (Task 10 as-built note and ticks), `backend/openapi/v1.json` (regenerated).

---

# Part A: sources, parse, preview

### Task A1: Shared helpers below the API (no behaviour change)

**Files:**
- Create: `backend/src/sightline/keywords/links.py`, `backend/src/sightline/keywords/groups.py`, `backend/src/sightline/keywords/terms.py`
- Modify: `backend/src/sightline/api/keywords/repository.py`, `api/keywords/group_repository.py`, `api/keywords/group_service.py`, `api/taxonomy/slugs.py`, `api/taxonomy/service.py`, `api/schemas/taxonomy.py`, `keywords/writer.py`
- Test: `backend/tests/keywords/test_groups_and_terms.py`

- [ ] **Step 1: Move the link helpers.** Cut `lock_rows`, `add_members`, `add_terms`, `groups_of`, `terms_of`, `remove_terms` (and the record types they return, `GroupRecord` for `groups_of` excepted if it is the group repository's: check `grep -n "def groups_of" -A30 src/sightline/api/keywords/repository.py` and move only what these functions need, including `TermRecord` and its `_term`/`_terms` builders if they are used only by these and `project_terms`) from `api/keywords/repository.py` into `sightline/keywords/links.py`, unchanged. In `api/keywords/repository.py`, re-export them so every caller keeps working, with the explicit re-export form strict mypy needs:

```python
from sightline.keywords.links import add_members as add_members
from sightline.keywords.links import add_terms as add_terms
from sightline.keywords.links import groups_of as groups_of
from sightline.keywords.links import lock_rows as lock_rows
from sightline.keywords.links import remove_terms as remove_terms
from sightline.keywords.links import terms_of as terms_of
```

`add_terms` already takes `assigned_by: str`; imports pass `"import"` (allowed by the column's check).

- [ ] **Step 2: Groups module.** Create `sightline/keywords/groups.py`:

```python
"""Keyword groups as the API and the worker both change them (docs/19-api-specification.md
section 3.6.2): one change at a time per project, the same limits, and a path made of names.
A group's `path` is the names from the root down joined by `/`."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Final
from uuid import UUID

from sqlalchemy import func, insert, literal, select
from sqlalchemy.ext.asyncio import AsyncSession

from sightline.db.tables import keyword_groups

GROUP_DEPTH_MAX: Final = 10
# The check on `seo.keyword_groups.path` in migration 0011.
PATH_BYTES_MAX: Final = 2048
NAME_MAX: Final = 100


async def lock_groups(db: AsyncSession, project_id: UUID) -> None:
    """Group changes in one project run one at a time until the transaction ends, so a move is
    checked for cycles against a tree no other request is changing."""
    await db.execute(
        select(
            func.pg_advisory_xact_lock(
                func.hashtextextended(literal(f"keyword_groups:{project_id}"), 0)
            )
        )
    )


def path_fits(names: Sequence[str]) -> bool:
    """Whether a path of these names is within the limits: 1 to `NAME_MAX` characters each,
    no `/` in a name, at most `GROUP_DEPTH_MAX` names, and at most `PATH_BYTES_MAX` bytes."""
    if not 1 <= len(names) <= GROUP_DEPTH_MAX:
        return False
    if any(not 1 <= len(name) <= NAME_MAX or "/" in name for name in names):
        return False
    return len("/".join(names).encode()) <= PATH_BYTES_MAX


async def ensure_group_path(
    db: AsyncSession, *, workspace_id: UUID, project_id: UUID, names: Sequence[str]
) -> UUID:
    """The group at this path of names, created level by level where missing. Names match
    without case, as sibling names are unique without case. The caller holds `lock_groups`
    and has checked `path_fits`."""
    parent_id: UUID | None = None
    path = ""
    for name in names:
        path = name if parent_id is None else f"{path}/{name}"
        g = keyword_groups.c
        statement = select(g.id, g.path).where(
            g.workspace_id == workspace_id,
            g.project_id == project_id,
            func.lower(g.name) == name.lower(),
            g.parent_id.is_(None) if parent_id is None else g.parent_id == parent_id,
        )
        found = (await db.execute(statement)).one_or_none()
        if found is not None:
            parent_id, path = found.id, found.path
            continue
        parent_id = (
            await db.execute(
                insert(keyword_groups)
                .values(
                    workspace_id=workspace_id,
                    project_id=project_id,
                    parent_id=parent_id,
                    name=name,
                    path=path,
                )
                .returning(keyword_groups.c.id)
            )
        ).scalar_one()
    if parent_id is None:
        raise ValueError("a group path has at least one name")
    return parent_id
```

Check `keyword_groups` table columns first (`grep -n "^keyword_groups = Table" -A14 src/sightline/db/tables.py`); if the unique sibling index is `lower(name)`-based, the lookup above matches it. In `api/keywords/group_repository.py` replace `lock_groups` with `from sightline.keywords.groups import lock_groups as lock_groups`; in `group_service.py` import `GROUP_DEPTH_MAX` and `PATH_BYTES_MAX` from `sightline.keywords.groups` instead of defining them.

- [ ] **Step 3: Terms module.** Create `sightline/keywords/terms.py`. Move `slugify`, `free_slug`, `FALLBACK_SLUG` from `api/taxonomy/slugs.py` and `fold` from `api/taxonomy/service.py` (read both first). `SLUG_MAX` and the term name maximum come from `api/schemas/taxonomy.py`: move those two constants here and import them back into the schema module. Keep `api/taxonomy/slugs.py` as a module that re-exports (`from sightline.keywords.terms import free_slug as free_slug` and so on) so its importers keep working. Add:

```python
async def lock_vocabulary(db: AsyncSession, vocabulary_id: UUID) -> None:
    """Term writes and term assignments of one vocabulary run one at a time, in the API and in
    the worker, until the transaction ends (plan decision D13). An advisory lock, since the
    worker may read a vocabulary but not lock its row."""
    await db.execute(
        select(
            func.pg_advisory_xact_lock(
                func.hashtextextended(literal(f"taxonomy:{vocabulary_id}"), 0)
            )
        )
    )


@dataclass(frozen=True, slots=True)
class VocabularyRef:
    id: UUID
    is_hierarchical: bool
    is_single_valued: bool


async def vocabulary_ref(
    db: AsyncSession, workspace_id: UUID, vocabulary_id: UUID
) -> VocabularyRef | None:
    """The vocabulary as the worker needs it; None when it is gone."""
    v = taxonomy_vocabularies.c
    row = (
        await db.execute(
            select(v.id, v.is_hierarchical, v.is_single_valued).where(
                v.workspace_id == workspace_id, v.id == vocabulary_id
            )
        )
    ).one_or_none()
    return None if row is None else VocabularyRef(row.id, row.is_hierarchical, row.is_single_valued)


async def ensure_term_path(
    db: AsyncSession, *, workspace_id: UUID, vocabulary: VocabularyRef, names: Sequence[str]
) -> UUID:
    """The term at this path of names, created level by level where missing, as the API's
    `add_terms` does for a `path`: names match without case (`fold`), a new term's slug is the
    first free one among its siblings. A flat vocabulary takes one name only (the caller
    checks). The caller holds `lock_vocabulary`."""
```

Implement `ensure_term_path` with `taxonomy_terms` directly (same insert values as `api/taxonomy/repository.insert_term`: `workspace_id`, `vocabulary_id`, `parent_id`, `name`, `slug`, `path` = slug path), reading each level's children (`parent_id` IS NULL or `=`), matching `fold(name)`, and `free_slug(slugify(name), sibling slugs)`. In `api/taxonomy/service.py`, call `await lock_vocabulary(db, vocabulary_id)` first thing in `_writable` and in the vocabulary update and delete paths (before their row lock), import `fold` from `sightline.keywords.terms`.

- [ ] **Step 4: Writer helpers.** In `keywords/writer.py`:
  - rename `_rows_of` to `rows_of` (keep its docstring; update the one internal caller);
  - add `keyword_texts`:

```python
async def keyword_texts(
    db: AsyncSession, workspace_id: UUID, wanted: Collection[KeywordKey]
) -> dict[KeywordKey, tuple[UUID, str]]:
    """The workspace's keywords among `wanted`, with the text they were first entered as."""
    if not wanted:
        return {}
    rows = await db.execute(
        select(
            keywords.c.id, keywords.c.text, keywords.c.normalized_text, keywords.c.language_code
        ).where(
            keywords.c.workspace_id == workspace_id,
            tuple_(keywords.c.normalized_text, keywords.c.language_code).in_(list(wanted)),
        )
    )
    return {(row.normalized_text, row.language_code): (row.id, row.text) for row in rows}
```

  - split `lock_quota` into `quota_usage(db, workspace_id) -> tuple[int, int]` (the two reads, no lock) and `lock_quota` (the advisory lock, then `return await quota_usage(db, workspace_id)`).

- [ ] **Step 5: Tests for the new helpers.** Create `tests/keywords/test_groups_and_terms.py` (as `app_worker`, fixtures `worker_db`, `migrated`; tenants with `make_tenant` from `tests/collectors/support.py`):

```python
async def test_a_group_path_is_found_or_made_level_by_level(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    async with worker_db() as db, db.begin():
        await lock_groups(db, project.id)
        first = await ensure_group_path(
            db, workspace_id=project.workspace_id, project_id=project.id, names=["Product", "Pricing"]
        )
        again = await ensure_group_path(
            db, workspace_id=project.workspace_id, project_id=project.id, names=["product", "PRICING"]
        )
    assert first == again
    rows = await fetch(migrated, "SELECT name, path FROM seo.keyword_groups WHERE project_id = $1 ORDER BY path", project.id)
    assert [(row["name"], row["path"]) for row in rows] == [("Product", "Product"), ("Pricing", "Product/Pricing")]


@pytest.mark.parametrize(
    ("names", "fits"),
    [(["a"], True), ([], False), (["a/b"], False), (["x" * 101], False), (["a"] * 11, False), (["é" * 100] * 10, True), (["é" * 100] * 11, False)],
)
def test_a_group_path_fits_the_limits(names: list[str], fits: bool) -> None:
    assert path_fits(names) is fits


async def test_a_term_path_is_found_or_made_with_free_slugs(
    worker_db: Ledger, migrated: PostgresServer
) -> None:
    project = await make_tenant(migrated)
    vocabulary = await fetchrow(
        migrated,
        "INSERT INTO core.taxonomy_vocabularies (workspace_id, kind, name, is_hierarchical) "
        "VALUES ($1, 'topic', 'Topics', true) RETURNING id",
        project.workspace_id,
    )
    await execute(
        migrated,
        "INSERT INTO core.taxonomy_terms (workspace_id, vocabulary_id, name, slug, path) "
        "VALUES ($1, $2, 'CRM', 'crm', 'crm')",
        project.workspace_id,
        vocabulary["id"],
    )
    async with worker_db() as db, db.begin():
        ref = await vocabulary_ref(db, project.workspace_id, vocabulary["id"])
        assert ref is not None
        await lock_vocabulary(db, ref.id)
        first = await ensure_term_path(
            db, workspace_id=project.workspace_id, vocabulary=ref, names=["crm", "CRM for Startups"]
        )
        # The same path written another way finds the same terms (names match without case).
        again = await ensure_term_path(
            db, workspace_id=project.workspace_id, vocabulary=ref, names=["CRM", "crm for startups"]
        )
    assert first == again
    rows = await fetch(
        migrated,
        "SELECT name, path FROM core.taxonomy_terms WHERE vocabulary_id = $1 ORDER BY path",
        vocabulary["id"],
    )
    assert [(row["name"], row["path"]) for row in rows] == [
        ("CRM", "crm"),
        ("CRM for Startups", "crm/crm-for-startups"),
    ]
```

- [ ] **Step 6: Run** `uv run pytest tests/keywords tests/api/keywords tests/api/taxonomy -q -p no:cacheprovider --no-cov` and lint and types. Expected: all pass (the moves change no behaviour). Fix import cycles by importing modules, not names, if any appear.

### Task A2: The pure row parser

**Files:**
- Create: `backend/src/sightline/keywords/import_rows.py`
- Test: `backend/tests/keywords/test_import_rows.py`

- [ ] **Step 1: Write the failing tests.** Cover each item in I3, I4 and I5. The tests below are the minimum; write them all out:

```python
from sightline.keywords.import_rows import (
    Defaults, Locations, ParsedRow, RowError, SourceError, read_api_rows, read_csv, read_paste,
    resolve_mapping, parse_row, IMPORT_ROWS_MAX,
)

LOCATIONS = Locations(
    active_ids=frozenset({2840, 2826, 1023191}),
    by_country={"US": 2840, "GB": 2826},
    by_name={"united states": 2840, "united kingdom": 2826, "new york,new york,united states": 1023191, "springfield": None},
)
DEFAULTS = Defaults(
    location_id=2840, language_code="en", device="desktop", priority=3, depth_profile="standard",
    group_path=(), tags_vocabulary_id=None, topic_vocabulary_id=None,
)


def test_a_csv_with_a_bom_quoted_fields_and_semicolons_is_read() -> None:
    data = "﻿Keyword;Device;Group\n\"crm; software\";mobile;Product/Pricing\n;;\nerp;;\n".encode()
    headers, rows = read_csv(data)
    assert headers == ["Keyword", "Device", "Group"]
    # The blank row keeps its number and makes no row.
    assert [(row.row_no, row.cells["Keyword"]) for row in rows] == [(1, "crm; software"), (3, "erp")]


@pytest.mark.parametrize(
    ("data", "code"),
    [(b"\xff\xfekeyword", "not_utf8"), (b"", "no_header"), (b"keyword,KEYWORD\ncrm,erp\n", "duplicate_headers")],
)
def test_an_unreadable_csv_says_why(data: bytes, code: str) -> None:
    with pytest.raises(SourceError) as raised:
        read_csv(data)
    assert raised.value.code == code


def test_more_rows_than_allowed_are_refused() -> None:
    data = ("keyword\n" + "kw\n" * (IMPORT_ROWS_MAX + 1)).encode()
    with pytest.raises(SourceError, match="10000") as raised:
        read_csv(data)
    assert raised.value.code == "too_many_rows"


def test_paste_takes_tags_after_a_tab_and_keeps_line_numbers() -> None:
    rows = read_paste("crm\tpricing|b2b\n\n  erp  \n")
    assert [(row.row_no, row.cells) for row in rows] == [
        (1, {"keyword": "crm", "tags": "pricing|b2b"}),
        (3, {"keyword": "  erp  "}),
    ]


def test_headers_map_by_name_without_case_and_a_mapping_overrides() -> None:
    assert resolve_mapping(["Keyword", "Land", "competitors"], {}) == {"Keyword": "keyword"}
    assert resolve_mapping(["Term", "Land"], {"term": "keyword", "LAND": "country"}) == {
        "Term": "keyword", "Land": "country",
    }


def test_a_row_takes_its_defaults_and_both_devices() -> None:
    parsed = parse_row({"keyword": " CRM  Software ", "device": "Both"}, DEFAULTS, LOCATIONS)
    assert isinstance(parsed, ParsedRow)
    assert (parsed.text, parsed.normalized, parsed.devices) == ("CRM Software", "crm software", ("desktop", "mobile"))
    assert (parsed.location_id, parsed.language_code, parsed.priority) == (2840, "en", 3)


@pytest.mark.parametrize(
    ("cells", "code"),
    [
        ({"keyword": ""}, "keyword_missing"),
        ({"keyword": "site:example.com"}, "search_operator_not_allowed"),
        ({"keyword": "x" * 701}, "keyword_too_long"),
        ({"keyword": "crm", "location": "Atlantis"}, "location_unknown"),
        ({"keyword": "crm", "location": "Springfield"}, "location_unknown"),
        ({"keyword": "crm", "country": "XX"}, "location_unknown"),
        ({"keyword": "crm", "language": "english"}, "language_invalid"),
        ({"keyword": "crm", "device": "tablet"}, "device_invalid"),
        ({"keyword": "crm", "priority": "9"}, "priority_invalid"),
        ({"keyword": "crm", "depth_profile": "huge"}, "depth_profile_invalid"),
        ({"keyword": "crm", "intent": "buy"}, "intent_invalid"),
        ({"keyword": "crm", "funnel_stage": "top"}, "funnel_stage_invalid"),
        ({"keyword": "crm", "target_url": "not a url"}, "target_url_invalid"),
        ({"keyword": "crm", "group": "a//b"}, "group_path_invalid"),
        ({"keyword": "crm", "tags": "x" * 101}, "tags_invalid"),
        ({"keyword": "crm", "topic": "/"}, "topic_invalid"),
        ({"keyword": "crm", "note": "y" * 2001}, "cell_too_long"),
    ],
)
def test_the_first_failing_field_names_the_reason(cells: dict[str, str], code: str) -> None:
    parsed = parse_row(cells, DEFAULTS, LOCATIONS)
    assert isinstance(parsed, RowError)
    assert parsed.code == code


def test_location_beats_country_beats_the_default() -> None:
    by_location = parse_row({"keyword": "crm", "location": "1023191", "country": "GB"}, DEFAULTS, LOCATIONS)
    by_country = parse_row({"keyword": "crm", "country": "gb"}, DEFAULTS, LOCATIONS)
    assert isinstance(by_location, ParsedRow) and by_location.location_id == 1023191
    assert isinstance(by_country, ParsedRow) and by_country.location_id == 2826


def test_the_value_sets_match_the_api_schemas() -> None:
    from typing import get_args
    from sightline.api.schemas.keywords import DepthProfile, FunnelStage, Intent
    from sightline.keywords import import_rows
    assert import_rows.DEPTH_PROFILES == frozenset(get_args(DepthProfile))
    assert import_rows.INTENTS == frozenset(get_args(Intent))
    assert import_rows.FUNNEL_STAGES == frozenset(get_args(FunnelStage))
```

`parse_row` takes cells keyed by **field** name (the caller applies the mapping); the `cell_too_long` check runs over every cell of the original row, so the caller passes the whole raw row too: give `parse_row` a keyword-only `raw: Mapping[str, str] | None = None` and check `raw` (or `cells` when `raw` is None) for length first. Adjust the last parametrized case to pass `raw={"note": "y" * 2001, "keyword": "crm"}` and `cells={"keyword": "crm"}`.

- [ ] **Step 2: Run** `uv run pytest tests/keywords/test_import_rows.py -q --no-cov -p no:cacheprovider`. Expected: import error (module missing).

- [ ] **Step 3: Implement** `sightline/keywords/import_rows.py`. Public names: `IMPORT_ROWS_MAX`, `CELL_MAX`, `FIELDS`, `DEPTH_PROFILES`, `INTENTS`, `FUNNEL_STAGES`, `SourceRow`, `SourceError`, `read_csv`, `read_paste`, `read_api_rows`, `resolve_mapping`, `Defaults`, `Locations`, `ParsedRow`, `RowError`, `parse_row`. Shapes:

```python
IMPORT_ROWS_MAX: Final = 10_000
CELL_MAX: Final = 2000
FIELDS: Final = frozenset({
    "keyword", "country", "location", "language", "device", "tags", "topic", "group",
    "intent", "funnel_stage", "priority", "target_url", "depth_profile",
})
DEPTH_PROFILES: Final = frozenset({"light", "standard", "deep", "full", "weekly", "weekly_light", "until_own_match_100"})
INTENTS: Final = frozenset({"informational", "navigational", "commercial", "transactional", "local", "unknown"})
FUNNEL_STAGES: Final = frozenset({"tofu", "mofu", "bofu", "retention", "unknown"})
_SNIFF_BYTES: Final = 4096


@dataclass(frozen=True, slots=True)
class SourceRow:
    row_no: int
    cells: dict[str, str]  # header as in the source to cell


class SourceError(ValueError):
    """A source that cannot be read at all; the import fails with `code`."""
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True, slots=True)
class Defaults:
    location_id: int | None
    language_code: str | None
    device: str          # desktop, mobile or both
    priority: int
    depth_profile: str
    group_path: tuple[str, ...]
    tags_vocabulary_id: UUID | None
    topic_vocabulary_id: UUID | None


@dataclass(frozen=True, slots=True)
class Locations:
    active_ids: frozenset[int]
    by_country: Mapping[str, int]       # ISO alpha-2, upper case
    by_name: Mapping[str, int | None]   # lower-cased name; None when two locations share it


@dataclass(frozen=True, slots=True)
class ParsedRow:
    text: str
    normalized: str
    location_id: int
    language_code: str
    devices: tuple[Device, ...]
    priority: int
    depth_profile: str
    intent: str
    funnel_stage: str
    target: CanonicalUrl | None
    group_path: tuple[str, ...]
    tags: tuple[str, ...]
    topic: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class RowError:
    code: str
    message: str
```

`read_csv`: decode with `data.decode("utf-8-sig")` (UnicodeDecodeError to `not_utf8`); sniff with `csv.Sniffer().sniff(sample, delimiters=",;\t")` inside `try` (falls back to `csv.excel`); `csv.reader(io.StringIO(text), dialect)`; header row missing or all blank to `no_header`; header cells trimmed; duplicates without case to `duplicate_headers`; data rows numbered from 1; a row of only blank cells skipped; short rows padded with `""`, extra cells ignored; more than `IMPORT_ROWS_MAX` non-blank rows to `too_many_rows` with message `f"An import has at most {IMPORT_ROWS_MAX} rows."`. `read_paste` and `read_api_rows` per I3 (`read_api_rows` returns `(headers, rows)` with headers in first-appearance order; values are already strings from the schema). `resolve_mapping(headers, given)`: returns header to field for headers that map, per I4, first one wins when two headers would map to one field by name; `given` keys and values are matched without case, and a given value not in `FIELDS` is ignored (the schema already restricts it). `parse_row` implements I5 in order and returns the first `RowError`. Use `check_keyword` and `normalize` from `sightline.keywords.text`, `canonicalize` from `sightline.extraction.urls`, `path_fits` and `NAME_MAX` from `sightline.keywords.groups`, and `Device` from `sightline.keywords.writer`. Messages are short sentences without dashes, for example `"No active location has this name or id."`.

- [ ] **Step 4: Run the tests; expected PASS.** Then ruff and mypy.

- [ ] **Step 5: Commit** (with Task A1): `git add` the files of A1 and A2, message `Imports: shared group, term and link helpers, and the row parser`.

### Task A3: R2 in the API, problems, the body limit, multipart

**Files:**
- Modify: `backend/pyproject.toml`, `uv.lock` (via `uv add`), `api/problems.py`, `api/body_limit.py`, `api/resources.py`, `api/main.py`, `tests/api/conftest.py`
- Test: `backend/tests/api/test_body_limit.py` (extend)

- [ ] **Step 1:** `uv add python-multipart` (installs are allowed). Confirm `uv.lock` changed.
- [ ] **Step 2: Problems.** In `api/problems.py`, beside `PayloadTooLargeError`:

```python
class UnsupportedMediaTypeError(ProblemError):
    status, code, title = 415, "unsupported_media_type", "Unsupported media type"


class StorageUnavailableError(ProblemError):
    """Object storage is not configured, or did not answer; nothing was recorded."""

    status, code, title = 503, "storage_unavailable", "Storage unavailable"
```

- [ ] **Step 3: Body limit.** `BodyLimitMiddleware` gets a keyword-only `larger: Sequence[tuple[re.Pattern[str], int]] = ()`: the first pattern that `fullmatch`es `scope["path"]` sets the limit for that request, otherwise `max_bytes`. In `main.py` pass `larger=((UPLOAD_PATH, UPLOAD_MAX_BYTES),)` with, in `api/imports/routes.py` (created in A5; define the two constants there now in a new module or in `body_limit.py` if A5 is not started):

```python
UPLOAD_MAX_BYTES: Final = 50 * 1024 * 1024
UPLOAD_PATH: Final = re.compile(
    r"/api/v1/workspaces/[^/]+/projects/[^/]+/keyword-imports/upload"
)
```

Put both constants in `api/body_limit.py` to avoid an import cycle, with a comment that only the import upload is larger (docs/19 section 2.7). The detail text for the larger limit: `"An upload is at most 50 MB."`. Test in `tests/api/test_body_limit.py`: a POST of 2 MB to an upload path is not refused by the middleware (it may be refused later for auth; assert the answer is not 413), and 51 MB announced is 413.

- [ ] **Step 4: The store.** `Resources` gains `import_store: ObjectStore | None`. `create_app` gains a keyword-only `import_store: ObjectStore | None = None`: when given, it is used; otherwise, when `settings.raw_storage_configured`, the lifespan opens one with `open_raw_store(...)` (same arguments as the worker's `_open_raw_store`, `max_connections=4`) inside the lifespan's `AsyncExitStack`; otherwise `None`. In `tests/api/conftest.py`, `auth_app` passes `import_store=MemoryStore()` (from `tests.collectors.test_fetching`) and exposes it as a fixture `import_store` (create the `MemoryStore` in its own fixture and pass it in). `client_for` keeps `None` unless a test passes one.
- [ ] **Step 5: Run** `uv run pytest tests/api/test_body_limit.py tests/api/test_health.py -q --no-cov -p no:cacheprovider`; lint; types.

### Task A4: Worker parse, classify and expire

**Files:**
- Create: `backend/src/sightline/collectors/imports.py`
- Modify: `backend/src/sightline/worker/assembly.py`, `tests/worker/test_assembly.py`
- Test: `backend/tests/collectors/test_imports.py`

- [ ] **Step 1: Test helpers.** In `tests/collectors/test_imports.py` add a helper that records an import as the API would (as superuser via `execute`), storing the source in a `MemoryStore`:

```python
async def _import(
    pg: PostgresServer,
    store: MemoryStore,
    project: Project,
    source: dict[str, object],
    *,
    kind: str = "upload",
    mapping: dict[str, str] | None = None,
    defaults: dict[str, object] | None = None,
) -> uuid.UUID:
    import_id = uuid.uuid4()
    key = f"imports/v1/{project.workspace_id}/{import_id}/source"
    await store.put(key, compress(json.dumps(source).encode()))
    user = await make_user(pg, name="Importer")  # from tests.api.auth.support
    await execute(
        pg,
        "INSERT INTO seo.keyword_imports (id, workspace_id, project_id, source, upload_object_key, "
        "status, column_mapping, defaults, created_by, expires_at) VALUES ($1, $2, $3, $4, $5, "
        "'uploaded', $6::jsonb, $7::jsonb, $8, now() + interval '7 days')",
        import_id, project.workspace_id, project.id, kind, key,
        json.dumps(mapping or {}), json.dumps(defaults or {}), user.id,
    )
    return import_id
```

- [ ] **Step 2: Write the failing tests** (each one written out in full):
  - `test_a_csv_import_reaches_its_preview_with_every_outcome`: project tracks "crm" (desktop, active), "erp" (archived), has keyword "CRM Software" in the workspace untracked at this location, and a deleted tracked "hr". CSV rows: `crm` (duplicate tracked), `erp` (conflict archived), `crm software` (variant), `hr` (new: the deleted one is brought back at write), `site:x.com` (invalid), `crm` again (duplicate with `reason_code = 'repeated_in_file'` and reason `Same as row 1`: a repeat is judged before the project's rows), `seo` with `device` `both` (two parts, both new). After `parse_next`, the import is `preview_ready`, rows match outcome, reason_code, action, part and existing id exactly, counts are `{"rows_total": 8, "new": 3, "duplicate": 2, "variant": 1, "conflict": 1, "invalid": 1}` plus `created/skipped/merged` 0.
  - `test_without_a_keyword_column_the_import_needs_a_mapping`: CSV header `Term`; status `needs_mapping`, `error_code = 'keyword_column_missing'`, no rows. Then set `column_mapping = {"Term": "keyword"}`, status back to `uploaded` with SQL, parse again: `preview_ready`.
  - `test_tags_without_a_vocabulary_need_a_mapping`: paste `"crm\tb2b"`; `needs_mapping`, `tags_vocabulary_missing`.
  - `test_parsing_again_replaces_the_rows`: parse, change mapping to make a different column the keyword, set `uploaded`, parse: rows are the new ones only.
  - `test_an_unreadable_source_fails_the_import`: CSV bytes `b"\xff\xfe"`; `failed`, `not_utf8`. A missing object in the store (`RawStorageError` from a `LosingStore`, see `tests/collectors/test_keyword_metrics.py`): the import stays `uploaded` (tried again on the next tick).
  - `test_two_workers_parse_an_import_once`: two concurrent `parse_next` calls (`asyncio.gather`) on one uploaded import: one returns 1, the other 0; rows are not doubled.
  - `test_old_previews_expire`: imports in `preview_ready`, `needs_mapping`, `uploaded` with `expires_at` in the past and one `writing`: `expire_imports` makes the first three `expired` with `finished_at`, leaves `writing`.
  - `test_five_thousand_rows_reach_the_preview_quickly`: a 5,000-row CSV parses in under 30 seconds (`time.monotonic()` around `parse_next`); this stands for the acceptance target "well under 2 minutes".

- [ ] **Step 3: Run; expected: import error.**

- [ ] **Step 4: Implement** `collectors/imports.py`. Public API:

```python
@dataclass(frozen=True, slots=True)
class ParseReport:
    parsed: int = 0      # imports that reached a preview or needs_mapping
    failed: int = 0
    waiting: int = 0     # source not readable from storage now; tried again


async def parse_next(
    sessions: async_sessionmaker[AsyncSession], store: ObjectStore, *, limit: int = 2
) -> ParseReport:
    """Parse up to `limit` uploaded imports, each in one transaction that holds the import
    (FOR UPDATE SKIP LOCKED), so two workers never parse one import and a crash leaves it
    uploaded."""


async def expire_imports(sessions: async_sessionmaker[AsyncSession], *, now: datetime) -> int:
    """Imports waiting for the user (uploaded, needs_mapping, preview_ready) past `expires_at`
    become `expired`. Returns how many."""
```

Inside one parse transaction, in this order:
1. Claim: `SELECT ... FROM seo.keyword_imports WHERE status = 'uploaded' ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED` (columns: id, workspace_id, project_id, source, upload_object_key, column_mapping, defaults).
2. Read and decompress the source (`decompress` from `sightline.storage.raw`); `RawStorageError`: roll back, count `waiting`, continue with the next import.
3. Read the rows with `import_rows` (`SourceError`: status `failed`, `error_code = code`, `finished_at = now()`, no rows).
4. Resolve the mapping (paste: identity mapping `keyword`, `tags`). Apply I4: `needs_mapping` with the error code, delete any old rows, no new ones.
5. Load `Defaults`: the import's `defaults` JSON merged over the project's `default_location_id`, `default_language_code` and `settings.seo` (`default_device`, `default_depth_profile`), `priority` 3. A deleted project: status `failed`, `error_code = 'project_gone'`.
6. Load `Locations` from `core.locations` (active ones: id, `country_iso`, `location_type`, `name`; `by_name` lower-cased, `None` when a name repeats).
7. Parse every row (`parse_row` with `cells` = mapped fields, `raw` = the source cells).
8. Classify per I6: collect keyword keys, call `writer.keyword_texts`, then `writer.rows_of` for the identities whose keyword exists, then walk rows in order, tracking the first `row_no` of each identity.
9. Replace rows: `DELETE FROM seo.keyword_import_rows WHERE workspace_id = :w AND import_id = :i`, then insert in chunks of 1,000 (`raw` as JSON of the source cells, `keyword_text` = the cleaned text, the other columns per I6).
10. Update the import: `status = 'preview_ready'`, `counts`, `error_code = NULL`.
Every statement names `workspace_id`. Use `sightline.db.tables` objects (`keyword_imports`, `keyword_import_rows`, `locations`, `projects`).

- [ ] **Step 5: The tick.** In `worker/assembly.py`, add constants `IMPORTS_EVERY = timedelta(seconds=5)`, `IMPORTS_LOCK = timedelta(seconds=4)` and a tick named `keyword_imports` that, when `context.raw_store` is set, runs `expire_imports` then `parse_next` (Part B adds `write_next`), logging non-quiet reports like the other ticks. Update `tests/worker/test_assembly.py` to expect the tick's interval and lock.

- [ ] **Step 6: Run the tests; expected PASS.** Lint, types.

### Task A5: The API

**Files:**
- Create: `backend/src/sightline/api/imports/__init__.py`, `repository.py`, `service.py`, `routes.py`
- Modify: `api/resources.py`, `api/main.py`, `api/audit.py`, `tests/api/test_route_access.py`, `tests/security/test_cross_tenant.py`
- Test: `backend/tests/api/imports/__init__.py`, `support.py`, `test_imports.py`

- [ ] **Step 1: Write the failing tests** in `tests/api/imports/test_imports.py` (use `_owner` as in `tests/api/operations/test_schedules.py`; for worker steps call `parse_next` with a session factory from `resources.sessions` is not allowed: it is `app_api`. Instead, for the preview steps, insert rows with SQL helpers in `tests/api/imports/support.py`: `async def preview(pg, import_id, rows: list[dict])` that inserts rows and sets `preview_ready` and counts). Tests, each written out in full:
  - paste create: `202`, status `uploaded`, `source = 'paste'`, `expires_at` about 7 days ahead, the object stored under `imports/v1/{workspace}/{import}/source` in `import_store`, audit `keyword_import.created`.
  - api rows create, and `422` when both `paste` and `rows` are given (schema), and `column_mapping` with paste is `not_applicable`.
  - upload: a CSV file part with `options` JSON; `202`, `original_filename`; a `.xlsx` part (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`) is `415 unsupported_media_type`; `options` that is not JSON or not `ImportOptions` is `422 validation_failed` at `options`.
  - no store: an app built with `client_for` and `import_store=None` answers `503 storage_unavailable`.
  - defaults: unknown location, a group path with an empty segment, a vocabulary of another project; and an analyst (no `taxonomy:write`) naming a tags vocabulary is `403`.
  - list newest first with a cursor and `filter[status]`; get one; another project's import is `404`.
  - rows: `409 invalid_state_transition` while `uploaded`; after `preview`, rows in `(row_no, part)` order with `filter[outcome_in]=new,variant` and `filter[action]=skip`, cursor paging.
  - PATCH mapping sets `uploaded`; PATCH row actions in `preview_ready` (allowed and refused cases per I6, `force_separate_not_available`, `row_unknown`); both together is `not_with_mapping`; PATCH while `writing` is `409`.
  - cancel from `preview_ready` (`200`, `cancelled`), again is `409`.
  - report: CSV header and rows, a cell `=1+1` comes out as `'=1+1`, `409` while `uploaded`.
  - the view: `quota` is set only in `preview_ready` with `would_use` per I6; `operation` per I13.
- [ ] **Step 2: Run; expected failures (404 for every route).**
- [ ] **Step 3: Repository** (`api/imports/repository.py`): `ImportRecord` (all import columns plus `created_by_name`, `created_by_email` via a join on `auth.users`), `insert_import`, `get_import(lock: bool)`, `list_imports(given_status, after, limit)` keyset on `(created_at, id)` descending, `set_import(values)`, `list_rows(filter, after, limit)` keyset on `(row_no, part)`, `all_rows` (for the report), `row_keys` (a set of `(row_no, part, outcome, reason_code)` for validating actions), `set_actions(pairs)` (one `UPDATE ... FROM (VALUES ...)`), `pending_creates(import_id)` (counts for `would_use`). Every statement names the workspace.
- [ ] **Step 4: Service** (`api/imports/service.py`): `ImportService` with `create`, `upload`, `page`, `get`, `rows`, `update`, `cancel`, `report` (Part B adds `confirm`). Rules from I2, I3, I4, I6, I10, I11, I12. `create` and `upload` validate defaults (I11) inside the transaction before storing, then `store.put` the compressed source, then insert the import and audit, in one transaction; if `put` raises `RawStorageError`, raise `StorageUnavailableError` and record nothing. `quota` on the view: only for `preview_ready`, from `writer.quota_usage` and `repository.pending_creates`.
- [ ] **Step 5: Routes** (`api/imports/routes.py`) per I1, with descriptions that state the rules in a sentence or two each (they become the API document). The upload handler declares `file: Annotated[UploadFile, File(description="CSV, UTF-8 (a BOM is fine).")]` and `options: Annotated[str | None, Form(description="The JSON of `ImportOptions`.")] = None`, reads `await file.read()` (the body limit already bounds it), and validates `options` with `ImportOptions.model_validate_json` (a `ValidationError` becomes `RequestValidationError` at `("body", "options")`). The report returns `Response(content=..., media_type="text/csv; charset=utf-8", headers={"Content-Disposition": ...})` and declares `response_class=Response` with `responses={200: {"content": {"text/csv": {}}}}`.
- [ ] **Step 6: Wire** `ImportService` into `Resources` (`imports`) and `main.py` (service and router). Add the audit actions. Add every route to `tests/api/test_route_access.py` (`import_id` to `PATH_PARAMETERS`) and to the cross-tenant suite: an import of each tenant (with a preview row) in `_tenant`, `import_id` in `ids()`, bodies for POST, PATCH and the upload (the suite sends JSON; give the upload route a body entry and accept that it answers `422` for A's own path: check how the suite treats routes whose own call is not a success and follow it, or skip the upload route in `test_a_list_holds_nothing...` only), `seo.keyword_imports` and `seo.keyword_import_rows` in `_TENANT_ROWS`.
- [ ] **Step 7: Run** `uv run pytest tests/api/imports tests/api/test_route_access.py tests/security -q --no-cov -p no:cacheprovider`; expected PASS. Regenerate `openapi/v1.json` (`uv run python -m sightline.api.openapi > openapi/v1.json`) and run `tests/api/test_openapi.py`. Compare the import paths of `openapi/v1.json` with `apps/web/openapi/step-5-draft.json` (names, parameters, request and response schemas): they must match; report any difference to the parent session instead of changing the draft.

### Task A6: Part A gates, docs and commit

- [ ] **Step 1:** Doc 19 section 3.6.3: an **As built (step 5, imports, part A)** paragraph stating I1 to I6 and I10 to I13 in prose (routes as built, the 415 and 503 cases, the reason codes added to D12: `cell_too_long`, `intent_invalid`, `funnel_stage_invalid`, `tags_invalid`, `topic_invalid`; `needs_mapping` error codes; `parsing` unused; the report built from rows).
- [ ] **Step 2:** Full gates; all pass.
- [ ] **Step 3: Commit** `Imports part A: sources in R2, worker parse and preview, the import routes`. Stop: the parent session runs the Opus review.

---

# Part B: confirm and write

### Task B1: Confirm

**Files:** Modify `api/imports/service.py`, `api/imports/routes.py`, `api/imports/repository.py`. Test: `tests/api/imports/test_import_write.py`.

- [ ] **Step 1: Failing tests:** confirm from `preview_ready` gives `writing` and `duplicate_action`; `merge_terms` turns tracked duplicates at `skip` into `merge` and leaves `repeated_in_file` rows; confirm in any other status and after `expires_at` is `409`; over the quota (`core.workspace_quotas.max_tracked_keywords` low) is `422 quota_exceeded` with `limit`, `used`, `requested` and nothing changed; audit `keyword_import.confirmed`.
- [ ] **Step 2: Implement** per I7 in one transaction: lock the import (`get_import(lock=True)`), check status and expiry, compute `would_use` under `writer.lock_quota` (the lock makes the check consistent with concurrent adds; the worker checks again per batch), apply `merge_terms`, set `status = 'writing'`, `duplicate_action`, audit.
- [ ] **Step 3: Run; PASS.**

### Task B2: The worker writes

**Files:** Create `collectors/import_writer.py`; modify `worker/assembly.py`. Test: `tests/collectors/test_import_writer.py`.

- [ ] **Step 1: Failing tests** (each written out; build previews with `parse_next` from Part A, then set `writing` and `duplicate_action` with SQL, then call `write_next`):
  - creates: new and variant rows become tracked keywords with `source = 'csv_import'` (upload) or `bulk_paste` (paste), their group made along its path, tags and topic terms made and assigned with `assigned_by = 'import'`; the deleted identity comes back with its stored settings (D3); rows `created` with `tracked_keyword_id`; counts and status `completed`.
  - batches: 2,500 new rows are written in three calls of `write_next(batch_limit=1)` and the import is `writing` after the first two (resumable), `completed` after the third.
  - merges: a tracked duplicate at `merge` gets the row's group and terms (not a second term of a single-valued vocabulary); an archived conflict at `merge` is unarchived and linked; `repeated_in_file` rows add their tags to the first row's keyword.
  - quota: a batch over the quota fails its create rows with `quota_exceeded` and the import ends `completed_with_errors`.
  - races: an identity tracked between preview and write becomes `skipped` with its id; a merge target deleted since becomes `failed` with `tracked_keyword_gone`; a project deleted since makes the import `failed` with `project_gone`.
  - concurrency: two `write_next` calls at once on one import write each row once (`asyncio.gather`, then every row has one result and one tracked keyword per identity).
  - vocabulary gone: terms of a deleted vocabulary are skipped and the rows still `created`.
- [ ] **Step 2: Implement** per I8:

```python
@dataclass(frozen=True, slots=True)
class WriteReport:
    batches: int = 0
    finished: int = 0     # imports completed, completed_with_errors or failed

    @property
    def quiet(self) -> bool:
        return self == WriteReport()


async def write_next(
    sessions: async_sessionmaker[AsyncSession], *, batch_limit: int = 5, batch_size: int = 1000
) -> WriteReport:
    """Write up to `batch_limit` batches of the oldest imports in `writing`. Each batch is one
    transaction under the import's advisory lock; a batch that finds no pending row finishes
    the import."""
```

Structure the batch in small functions: `_claim(db)` (oldest `writing` import whose advisory lock is free: select candidates ordered by `created_at, id`, try `pg_try_advisory_xact_lock(hashtextextended('keyword_import:' || id, 0))` on each until one is taken), `_pending(db, imp, size)`, `_parse_again(imp, rows)` (re-runs `parse_row` on `raw` with the import's mapping and defaults to get priority, depth profile, intent, funnel stage, target, group path, tags and topic; rows whose re-parse now fails get `failed` with `write_error_code = row reason code`), `_creates`, `_merges`, `_link`, `_finish`. Follow the lock order of I8 exactly and say so in the module docstring.
- [ ] **Step 3: Tick:** the `keyword_imports` tick also runs `write_next` after `parse_next`.
- [ ] **Step 4: Run; PASS.**

### Task B3: End to end, docs, gates

- [ ] **Step 1:** `tests/worker/test_import_end_to_end.py`: the API (test app with a `MemoryStore` shared with a worker context, see `tests/worker/test_keyword_metrics_end_to_end.py` for running the worker with `run_worker` and shortened intervals) receives a CSV upload, the worker parses it, the API reads the rows and confirms, the worker writes, and `GET {P}/tracked-keywords` lists the new keywords with their group. Then `GET .../report` lists every row with `result`.
- [ ] **Step 2:** Doc 19 3.6.3 **As built (part B)**: I7, I8, the lock order, the report's `result` columns. Parent plan: Task 10 as-built note (this sub-plan's path, the deviations from doc 19) and tick Task 10's checkboxes.
- [ ] **Step 3:** Regenerate `openapi/v1.json`; full gates; commit `Imports part B: confirm and the worker's batched write`. Stop: the parent session runs the Opus review, then regenerates the frontend's draft and tells the frontend session.

## 3. Self-review notes (for the parent session)

- Spec coverage: D11 (sources in R2, worker parse and write in batches of 1,000, report from rows, 7-day expiry), D12 (every outcome, `both` parts, `force_separate` refused, source mapping), D13 (tags and topic vocabularies, `taxonomy:write`, per-vocabulary lock, groups made with the API's lock and limits), the Task 5 review note (groups through `lock_groups` and the same limits), the acceptance timing (A4 test). The parent plan's "R2 in API settings" is A3.
- Known differences from doc 19, recorded as as-built: no presigned upload, report as a direct CSV, `parsing` never committed, extra reason codes.
