"""Rules for keyword imports (docs/19-api-specification.md section 3.6.3; plan decisions D11 to
D13; the imports sub-plan, rules I1 to I13).

The API stores each source in the bucket and records the import as `uploaded`; the worker reads
it into the preview (`sightline.collectors.imports`). What a person can do meanwhile is change
the mapping or the defaults (the worker reads the source again), choose what happens to each
row, and cancel. Every change is audited in its transaction. A change waits for a parse that is
under way (the import row is locked) and then sees what the parse made.
"""

from __future__ import annotations

import asyncio
import base64
import csv
import io
import json
import re
import uuid
from collections.abc import Mapping, Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Final, Literal
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.api import audit
from sightline.api.imports import repository
from sightline.api.imports.repository import ImportRecord, RowRecord
from sightline.api.keywords import repository as keywords
from sightline.api.pagination import decode_cursor, encode_cursor, invalid_cursor
from sightline.api.permissions import Permission
from sightline.api.problems import (
    FieldError,
    ForbiddenError,
    InvalidStateTransitionError,
    NotFoundError,
    StorageUnavailableError,
    UnsupportedMediaTypeError,
    invalid_field,
    invalid_fields,
)
from sightline.api.request_info import RequestInfo
from sightline.api.schemas.imports import (
    ImportDefaults,
    ImportOptions,
    KeywordImportCreate,
    KeywordImportUpdate,
    RowActionInput,
)
from sightline.api.taxonomy import repository as taxonomy
from sightline.api.workspaces.access import WorkspaceAccess
from sightline.db.engine import workspace_transaction
from sightline.keywords import writer
from sightline.keywords.groups import path_fits
from sightline.storage.raw import ObjectStore, RawStorageError, compress

# Statuses in which a person can still change or cancel an import.
OPEN: Final = frozenset({"uploaded", "needs_mapping", "preview_ready"})
# No rows to show yet.
NO_ROWS_YET: Final = frozenset({"uploaded", "parsing", "needs_mapping"})
# No report to give: there is nothing to report on.
NO_REPORT: Final = frozenset({"uploaded", "parsing", "needs_mapping", "failed"})
CSV_TYPES: Final = frozenset(
    {"text/csv", "application/csv", "text/plain", "application/vnd.ms-excel"}
)
UNKNOWN_TYPES: Final = frozenset({"", "application/octet-stream"})
FILENAME_MAX: Final = 255
REPORT_COLUMNS: Final = (
    "row_no",
    "part",
    "keyword",
    "location_id",
    "language_code",
    "device",
    "outcome",
    "reason_code",
    "reason",
    "action",
    "result",
    "tracked_keyword_id",
    "write_error_code",
)
# What a spreadsheet takes for a formula when it opens a cell.
_FORMULA_START: Final = ("=", "+", "-", "@", "\t", "\r")
_PATH_SEPARATORS: Final = re.compile(r"[\\/]")


@dataclass(frozen=True, slots=True)
class Quota:
    limit: int
    used: int
    would_use: int


@dataclass(frozen=True, slots=True)
class ImportDetail:
    record: ImportRecord
    # Once the preview is ready.
    quota: Quota | None


@dataclass(frozen=True, slots=True)
class ImportPage:
    imports: list[ImportDetail]
    next_cursor: str | None


@dataclass(frozen=True, slots=True)
class RowPage:
    rows: list[RowRecord]
    next_cursor: str | None


def allowed_actions(outcome: str, reason_code: str | None) -> frozenset[str]:
    """What a person may choose for a row (rule I6): create what is new, merge into what is
    tracked or archived, and skip anything. A repeat in the file and an invalid row can only
    be skipped."""
    if outcome in ("new", "variant"):
        return frozenset({"create", "skip"})
    if outcome == "conflict" or (outcome == "duplicate" and reason_code == "tracked"):
        return frozenset({"skip", "merge"})
    return frozenset({"skip"})


def _neutral(cell: object) -> str:
    """A cell of the report as text a spreadsheet will not run as a formula."""
    text = "" if cell is None else str(cell)
    return "'" + text if text.startswith(_FORMULA_START) else text


def report_csv(rows: Sequence[RowRecord]) -> str:
    """One line per row of the import, with what it was and what became of it."""
    out = io.StringIO()
    writer_ = csv.writer(out, lineterminator="\n")
    writer_.writerow(REPORT_COLUMNS)
    for row in rows:
        writer_.writerow(
            _neutral(cell)
            for cell in (
                row.row_no,
                row.part,
                row.keyword_text,
                row.location_id,
                row.language_code,
                row.device,
                row.outcome,
                row.reason_code,
                row.reason,
                row.action,
                row.result,
                row.tracked_keyword_id,
                row.write_error_code,
            )
        )
    return out.getvalue()


def _pack(payload: Mapping[str, object]) -> bytes:
    return compress(json.dumps(payload).encode())


def _filename(given: str | None) -> str | None:
    """The file's name without any path it came with, at most `FILENAME_MAX` characters."""
    if not given:
        return None
    name = _PATH_SEPARATORS.split(given)[-1].strip()[:FILENAME_MAX]
    return name or None


def _is_csv(content_type: str | None, filename: str | None) -> bool:
    kind = (content_type or "").split(";", 1)[0].strip().lower()
    if kind in CSV_TYPES:
        return True
    return kind in UNKNOWN_TYPES and (filename or "").lower().endswith(".csv")


def _mapping_errors(mapping: Mapping[str, object]) -> list[FieldError]:
    """Two headers that are one header without case, or two headers for one field."""
    errors: list[FieldError] = []
    if len({header.strip().lower() for header in mapping}) != len(mapping):
        errors.append(FieldError("column_mapping", "header_repeated", "A header is mapped twice."))
    fields = [str(field) for field in mapping.values()]
    if len(set(fields)) != len(fields):
        errors.append(
            FieldError(
                "column_mapping", "field_mapped_twice", "Two columns are mapped to one field."
            )
        )
    return errors


class ImportService:
    def __init__(
        self, *, sessions: async_sessionmaker[AsyncSession], store: ObjectStore | None
    ) -> None:
        self._sessions = sessions
        self._store = store

    def _transaction(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        return workspace_transaction(self._sessions, access.workspace_id, user_id=access.user_id)

    @staticmethod
    async def _project(db: AsyncSession, access: WorkspaceAccess, project_id: UUID) -> None:
        if await keywords.project_defaults(db, access.workspace_id, project_id) is None:
            raise NotFoundError

    async def _import(
        self,
        db: AsyncSession,
        access: WorkspaceAccess,
        project_id: UUID,
        import_id: UUID,
        *,
        lock: bool = False,
    ) -> ImportRecord:
        await self._project(db, access, project_id)
        found = await repository.get_import(
            db, access.workspace_id, project_id, import_id, lock=lock
        )
        if found is None:
            raise NotFoundError
        return found

    @staticmethod
    async def _detail(
        db: AsyncSession, access: WorkspaceAccess, record: ImportRecord
    ) -> ImportDetail:
        """The import with its quota, which the preview is judged against."""
        if record.status != "preview_ready":
            return ImportDetail(record, None)
        limit, used = await writer.quota_usage(db, access.workspace_id)
        planned = await repository.planned_writes(db, access.workspace_id, record.id)
        return ImportDetail(record, Quota(limit, used, used + planned))

    async def _check_defaults(
        self,
        db: AsyncSession,
        access: WorkspaceAccess,
        project_id: UUID,
        defaults: ImportDefaults,
    ) -> None:
        """The defaults name things the project can use. Naming a vocabulary lets the import
        create the terms it is missing, so it needs `taxonomy:write`, and a workspace-wide
        vocabulary is only for a member who is not limited to some projects."""
        if defaults.location_id is not None and not await repository.active_location(
            db, defaults.location_id
        ):
            raise invalid_field(
                "defaults.location_id",
                code="location_unknown",
                message="No active location has this id.",
            )
        if defaults.group_path is not None and not path_fits(
            [name.strip() for name in defaults.group_path.split("/")]
        ):
            raise invalid_field(
                "defaults.group_path",
                code="group_path_invalid",
                message="A group is a path of names (Product/Pricing), at most 10 levels of "
                "100 characters.",
            )
        for field, vocabulary_id in (
            ("tags_vocabulary_id", defaults.tags_vocabulary_id),
            ("topic_vocabulary_id", defaults.topic_vocabulary_id),
        ):
            if vocabulary_id is None:
                continue
            if not access.holds(Permission.TAXONOMY_WRITE):
                raise ForbiddenError(
                    "Naming a vocabulary for tags or topics lets an import create its terms, "
                    "which needs taxonomy:write."
                )
            found = await taxonomy.get_vocabulary(
                db, access.workspace_id, vocabulary_id, visible=access.project_ids
            )
            if found is None or found.project_id not in (None, project_id):
                raise invalid_field(
                    f"defaults.{field}",
                    code="vocabulary_unknown",
                    message="A vocabulary of this workspace or this project.",
                )
            if found.project_id is None and access.project_ids is not None:
                raise ForbiddenError(
                    "A member limited to some projects cannot add terms to a workspace-wide "
                    "vocabulary."
                )

    async def _record(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        *,
        source: Literal["upload", "paste", "api"],
        filename: str | None,
        payload: Mapping[str, object],
        mapping: Mapping[str, str],
        defaults: ImportDefaults,
        info: RequestInfo,
    ) -> ImportDetail:
        """Store the source, then record the import. Nothing is recorded when the bucket
        does not take the source."""
        if self._store is None:
            raise StorageUnavailableError("Imports need object storage, which is not set up.")
        async with self._transaction(access) as db:
            await self._project(db, access, project_id)
            await self._check_defaults(db, access, project_id, defaults)
            import_id = uuid.uuid4()
            key = f"imports/v1/{access.workspace_id}/{import_id}/source"
            blob = await asyncio.to_thread(_pack, payload)
            try:
                await self._store.put(key, blob)
            except RawStorageError:
                raise StorageUnavailableError(
                    "The source could not be stored. Try again."
                ) from None
            stored_defaults = defaults.model_dump(mode="json", exclude_none=True)
            await repository.insert_import(
                db,
                import_id=import_id,
                workspace_id=access.workspace_id,
                project_id=project_id,
                source=source,
                original_filename=filename,
                object_key=key,
                column_mapping=mapping,
                defaults=stored_defaults,
                created_by=access.user_id,
            )
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="keyword_import.created",
                target_type="keyword_import",
                target_id=import_id,
                info=info,
                after={
                    "project_id": str(project_id),
                    "source": source,
                    "original_filename": filename,
                },
            )
            record = await repository.get_import(
                db, access.workspace_id, project_id, import_id, lock=False
            )
        if record is None:  # pragma: no cover - inserted by this transaction
            raise NotFoundError
        return ImportDetail(record, None)

    async def create(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        body: KeywordImportCreate,
        info: RequestInfo,
    ) -> ImportDetail:
        """Paste text, or rows given in the request."""
        if body.source == "paste" and body.column_mapping is not None:
            raise invalid_field(
                "column_mapping",
                code="not_applicable",
                message="Pasted lines have a keyword and tags, and nothing to map.",
            )
        mapping = {header: field.value for header, field in (body.column_mapping or {}).items()}
        if errors := _mapping_errors(mapping):
            raise invalid_fields(errors)
        payload: dict[str, object] = (
            {"kind": "paste", "text": body.paste}
            if body.source == "paste"
            else {"kind": "api", "rows": body.rows}
        )
        return await self._record(
            access,
            project_id,
            source=body.source,
            filename=None,
            payload=payload,
            mapping=mapping,
            defaults=body.defaults,
            info=info,
        )

    async def upload(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        *,
        filename: str | None,
        content_type: str | None,
        data: bytes,
        options: ImportOptions,
        info: RequestInfo,
    ) -> ImportDetail:
        """A CSV file, with options that map its columns and give defaults."""
        if not _is_csv(content_type, filename):
            raise UnsupportedMediaTypeError("An import file is CSV (text/csv).")
        mapping = {header: field.value for header, field in (options.column_mapping or {}).items()}
        if errors := _mapping_errors(mapping):
            raise invalid_fields(errors)
        payload = {"kind": "csv", "data": base64.b64encode(data).decode("ascii")}
        return await self._record(
            access,
            project_id,
            source="upload",
            filename=_filename(filename),
            payload=payload,
            mapping=mapping,
            defaults=options.defaults,
            info=info,
        )

    async def page(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        *,
        status: str | None,
        cursor: str | None,
        limit: int,
    ) -> ImportPage:
        """The project's imports, newest first."""
        scope: dict[str, object] = {"project_id": str(project_id), "status": status}
        after = None if cursor is None else _import_key(decode_cursor(cursor, scope=scope))
        async with self._transaction(access) as db:
            await self._project(db, access, project_id)
            found = await repository.list_imports(
                db, access.workspace_id, project_id, status=status, after=after, limit=limit + 1
            )
            shown = found[:limit]
            details = [await self._detail(db, access, record) for record in shown]
        next_cursor = None
        if len(found) > limit:
            last = shown[-1]
            next_cursor = encode_cursor([last.created_at.isoformat(), str(last.id)], scope=scope)
        return ImportPage(details, next_cursor)

    async def get(self, access: WorkspaceAccess, project_id: UUID, import_id: UUID) -> ImportDetail:
        async with self._transaction(access) as db:
            record = await self._import(db, access, project_id, import_id)
            return await self._detail(db, access, record)

    async def rows(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        import_id: UUID,
        *,
        outcomes: frozenset[str],
        action: str | None,
        cursor: str | None,
        limit: int,
    ) -> RowPage:
        """The preview rows in file order. `409` until the preview is ready."""
        scope: dict[str, object] = {
            "import_id": str(import_id),
            "outcomes": sorted(outcomes),
            "action": action,
        }
        after = None if cursor is None else _row_key(decode_cursor(cursor, scope=scope))
        async with self._transaction(access) as db:
            record = await self._import(db, access, project_id, import_id)
            if record.status in NO_ROWS_YET:
                raise InvalidStateTransitionError("The preview is not ready yet.")
            found = await repository.list_rows(
                db,
                access.workspace_id,
                import_id,
                outcomes=outcomes,
                action=action,
                after=after,
                limit=limit + 1,
            )
        shown = found[:limit]
        next_cursor = None
        if len(found) > limit:
            next_cursor = encode_cursor([shown[-1].row_no, shown[-1].part], scope=scope)
        return RowPage(shown, next_cursor)

    async def update(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        import_id: UUID,
        body: KeywordImportUpdate,
        info: RequestInfo,
    ) -> ImportDetail:
        """A new mapping or new defaults make the worker read the source again (the import is
        `uploaded` until then); row actions apply to the preview that is ready."""
        if body.row_actions is not None and (
            body.column_mapping is not None or body.defaults is not None
        ):
            raise invalid_field(
                "row_actions",
                code="not_with_mapping",
                message="A new mapping or new defaults read the source again: choose the rows "
                "after the preview is ready.",
            )
        mapping = (
            None
            if body.column_mapping is None
            else {header: field.value for header, field in body.column_mapping.items()}
        )
        if mapping is not None and (errors := _mapping_errors(mapping)):
            raise invalid_fields(errors)
        async with self._transaction(access) as db:
            current = await self._import(db, access, project_id, import_id, lock=True)
            if body.row_actions is not None:
                if current.status != "preview_ready" or current.past_expiry:
                    raise InvalidStateTransitionError("Rows are chosen while the preview is ready.")
                await self._choose(db, access, import_id, body.row_actions)
                changed = "row_actions"
            else:
                self._open(current)
                values: dict[str, Any] = {"status": "uploaded"}
                if mapping is not None:
                    values["column_mapping"] = mapping
                if body.defaults is not None:
                    await self._check_defaults(db, access, project_id, body.defaults)
                    values["defaults"] = body.defaults.model_dump(mode="json", exclude_none=True)
                await repository.update_import(db, access.workspace_id, import_id, values)
                changed = "source_settings"
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="keyword_import.updated",
                target_type="keyword_import",
                target_id=import_id,
                info=info,
                after={
                    "changed": changed,
                    "row_actions": len(body.row_actions or ()),
                },
            )
            record = await self._import(db, access, project_id, import_id)
            return await self._detail(db, access, record)

    @staticmethod
    def _open(current: ImportRecord) -> None:
        if current.status not in OPEN or current.past_expiry:
            raise InvalidStateTransitionError(
                f"The import is {current.status}; only one waiting for a person can change."
            )

    @staticmethod
    async def _choose(
        db: AsyncSession,
        access: WorkspaceAccess,
        import_id: UUID,
        chosen: Sequence[RowActionInput],
    ) -> None:
        """Check each chosen action against what the row is, then apply them all."""
        keys = [(item.row_no, item.part) for item in chosen]
        kinds = await repository.row_kinds(db, access.workspace_id, import_id, keys)
        errors: list[FieldError] = []
        seen: set[tuple[int, int]] = set()
        for index, item in enumerate(chosen):
            key = (item.row_no, item.part)
            path = f"row_actions.{index}"
            if key in seen:
                errors.append(FieldError(path, "row_repeated", "This row is chosen twice."))
            elif key not in kinds:
                errors.append(FieldError(path, "row_unknown", "The import has no such row."))
            elif item.action == "force_separate":
                errors.append(
                    FieldError(
                        f"{path}.action",
                        "force_separate_not_available",
                        "A case-sensitive keyword is not offered yet.",
                    )
                )
            elif item.action not in allowed_actions(*kinds[key]):
                errors.append(
                    FieldError(
                        f"{path}.action",
                        "action_not_allowed",
                        "This row cannot be given that action.",
                    )
                )
            seen.add(key)
        if errors:
            raise invalid_fields(errors)
        await repository.set_actions(
            db,
            access.workspace_id,
            import_id,
            {(item.row_no, item.part): item.action for item in chosen},
        )

    async def cancel(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        import_id: UUID,
        info: RequestInfo,
    ) -> ImportDetail:
        """Before the write starts; `409 invalid_state_transition` after."""
        async with self._transaction(access) as db:
            current = await self._import(db, access, project_id, import_id, lock=True)
            self._open(current)
            await repository.update_import(
                db,
                access.workspace_id,
                import_id,
                {"status": "cancelled", "finished_at": func.now()},
            )
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="keyword_import.cancelled",
                target_type="keyword_import",
                target_id=import_id,
                info=info,
                before={"status": current.status},
                after={"status": "cancelled"},
            )
            record = await self._import(db, access, project_id, import_id)
            return await self._detail(db, access, record)

    async def report(self, access: WorkspaceAccess, project_id: UUID, import_id: UUID) -> str:
        """One CSV line per row: what it was, what was chosen, what became of it."""
        async with self._transaction(access) as db:
            record = await self._import(db, access, project_id, import_id)
            if record.status in NO_REPORT:
                raise InvalidStateTransitionError("There is nothing to report on yet.")
            rows = await repository.list_rows(
                db,
                access.workspace_id,
                import_id,
                outcomes=frozenset(),
                action=None,
                after=None,
                limit=None,
            )
        return await asyncio.to_thread(report_csv, rows)


def _import_key(key: list[str | int]) -> tuple[datetime, UUID]:
    if len(key) != 2 or not all(isinstance(part, str) for part in key):
        raise invalid_cursor()
    try:
        created_at = datetime.fromisoformat(str(key[0]))
        import_id = UUID(str(key[1]))
    except ValueError:
        raise invalid_cursor() from None
    if created_at.tzinfo is None:
        raise invalid_cursor()
    return created_at, import_id


def _row_key(key: list[str | int]) -> tuple[int, int]:
    if len(key) != 2 or not all(isinstance(part, int) for part in key):
        raise invalid_cursor()
    return int(key[0]), int(key[1])
