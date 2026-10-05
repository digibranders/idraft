"""Statements for keyword imports, as the API reads and changes them. Every function runs inside
`workspace_transaction`, and every statement names the workspace as well. The API never writes
the rows of a preview or the counts: the worker does. It changes an import's mapping, defaults
and status, and the action of a row.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Final
from uuid import UUID

from sqlalchemy import Row, Select, func, insert, or_, select, tuple_, update
from sqlalchemy.ext.asyncio import AsyncSession

from sightline.db.tables import keyword_import_rows, keyword_imports, locations, users

# How long a preview waits to be confirmed (plan decision D11).
PREVIEW_LIFETIME: Final = timedelta(days=7)
ACTIONS_PER_STATEMENT: Final = 1000


@dataclass(frozen=True, slots=True)
class ImportRecord:
    id: UUID
    project_id: UUID
    source: str
    original_filename: str | None
    status: str
    column_mapping: dict[str, str]
    defaults: dict[str, Any]
    counts: dict[str, int]
    duplicate_action: str | None
    error_code: str | None
    created_by: UUID
    created_by_name: str
    created_by_email: str
    created_at: datetime
    expires_at: datetime
    finished_at: datetime | None
    # Past `expires_at` by the database clock, whatever the status says yet: the worker marks
    # an expired import within seconds, and no change is allowed in between.
    past_expiry: bool
    # Parts the write has dealt with.
    rows_done: int


@dataclass(frozen=True, slots=True)
class RowRecord:
    row_no: int
    part: int
    raw: dict[str, str]
    keyword_text: str | None
    normalized_text: str | None
    language_code: str | None
    device: str | None
    location_id: int | None
    outcome: str
    reason_code: str | None
    reason: str | None
    existing_tracked_keyword_id: UUID | None
    action: str
    result: str | None
    tracked_keyword_id: UUID | None
    write_error_code: str | None


def _imports(workspace_id: UUID) -> Select[Any]:
    i, r = keyword_imports.c, keyword_import_rows.c
    done = (
        select(func.count())
        .where(r.workspace_id == i.workspace_id, r.import_id == i.id, r.result.is_not(None))
        .scalar_subquery()
    )
    return (
        select(
            keyword_imports,
            users.c.name.label("user_name"),
            users.c.email.label("user_email"),
            (i.expires_at <= func.now()).label("past_expiry"),
            done.label("rows_done"),
        )
        .select_from(keyword_imports.join(users, users.c.id == i.created_by))
        .where(i.workspace_id == workspace_id)
    )


def _record(row: Row[Any]) -> ImportRecord:
    return ImportRecord(
        id=row.id,
        project_id=row.project_id,
        source=row.source,
        original_filename=row.original_filename,
        status=row.status,
        column_mapping={str(k): str(v) for k, v in (row.column_mapping or {}).items()},
        defaults=dict(row.defaults or {}),
        counts={str(k): int(v) for k, v in (row.counts or {}).items()},
        duplicate_action=row.duplicate_action,
        error_code=row.error_code,
        created_by=row.created_by,
        created_by_name=row.user_name,
        created_by_email=row.user_email,
        created_at=row.created_at,
        expires_at=row.expires_at,
        finished_at=row.finished_at,
        past_expiry=row.past_expiry,
        rows_done=row.rows_done,
    )


async def insert_import(
    db: AsyncSession,
    *,
    import_id: UUID,
    workspace_id: UUID,
    project_id: UUID,
    source: str,
    original_filename: str | None,
    object_key: str,
    column_mapping: Mapping[str, str],
    defaults: Mapping[str, Any],
    created_by: UUID,
) -> None:
    """A new import, `uploaded`, whose source is already in the bucket under `object_key`."""
    await db.execute(
        insert(keyword_imports).values(
            id=import_id,
            workspace_id=workspace_id,
            project_id=project_id,
            source=source,
            original_filename=original_filename,
            upload_object_key=object_key,
            status="uploaded",
            column_mapping=dict(column_mapping),
            defaults=dict(defaults),
            created_by=created_by,
            expires_at=func.now() + PREVIEW_LIFETIME,
        )
    )


async def get_import(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, import_id: UUID, *, lock: bool
) -> ImportRecord | None:
    """The project's import. With `lock`, held (FOR UPDATE) until the transaction ends, so a
    change waits for a parse that is under way and then sees what it made."""
    statement = _imports(workspace_id).where(
        keyword_imports.c.project_id == project_id, keyword_imports.c.id == import_id
    )
    if lock:
        statement = statement.with_for_update(of=keyword_imports)
    row = (await db.execute(statement)).one_or_none()
    return None if row is None else _record(row)


async def list_imports(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    *,
    status: str | None,
    after: tuple[datetime, UUID] | None,
    limit: int,
) -> list[ImportRecord]:
    """The project's imports, newest first, after the (created_at, id) of the last row of the
    page before; at most `limit`."""
    i = keyword_imports.c
    statement = _imports(workspace_id).where(i.project_id == project_id)
    if status is not None:
        statement = statement.where(i.status == status)
    if after is not None:
        statement = statement.where(tuple_(i.created_at, i.id) < tuple_(*after))
    rows = await db.execute(statement.order_by(i.created_at.desc(), i.id.desc()).limit(limit))
    return [_record(row) for row in rows]


async def update_import(
    db: AsyncSession, workspace_id: UUID, import_id: UUID, values: Mapping[str, Any]
) -> None:
    """Only the columns the API may change: the mapping, the defaults, the status, the
    duplicate action and when it finished."""
    await db.execute(
        update(keyword_imports)
        .where(keyword_imports.c.workspace_id == workspace_id, keyword_imports.c.id == import_id)
        .values(**values)
    )


def _row(row: Row[Any]) -> RowRecord:
    return RowRecord(
        row_no=row.row_no,
        part=row.part,
        raw={str(k): str(v) for k, v in (row.raw or {}).items()},
        keyword_text=row.keyword_text,
        normalized_text=row.normalized_text,
        language_code=row.language_code,
        device=row.device,
        location_id=row.location_id,
        outcome=row.outcome,
        reason_code=row.reason_code,
        reason=row.reason,
        existing_tracked_keyword_id=row.existing_tracked_keyword_id,
        action=row.action,
        result=row.result,
        tracked_keyword_id=row.tracked_keyword_id,
        write_error_code=row.write_error_code,
    )


async def list_rows(
    db: AsyncSession,
    workspace_id: UUID,
    import_id: UUID,
    *,
    outcomes: frozenset[str],
    action: str | None,
    after: tuple[int, int] | None,
    limit: int | None,
) -> list[RowRecord]:
    """The import's rows in (row_no, part) order, after the key of the last row of the page
    before; at most `limit`, or all of them when None."""
    r = keyword_import_rows.c
    statement = select(keyword_import_rows).where(
        r.workspace_id == workspace_id, r.import_id == import_id
    )
    if outcomes:
        statement = statement.where(r.outcome.in_(sorted(outcomes)))
    if action is not None:
        statement = statement.where(r.action == action)
    if after is not None:
        statement = statement.where(tuple_(r.row_no, r.part) > tuple_(*after))
    statement = statement.order_by(r.row_no, r.part)
    if limit is not None:
        statement = statement.limit(limit)
    return [_row(row) for row in await db.execute(statement)]


async def row_kinds(
    db: AsyncSession, workspace_id: UUID, import_id: UUID, keys: Sequence[tuple[int, int]]
) -> dict[tuple[int, int], tuple[str, str | None]]:
    """(outcome, reason code) of the rows with these (row_no, part) keys that exist."""
    r = keyword_import_rows.c
    found: dict[tuple[int, int], tuple[str, str | None]] = {}
    for start in range(0, len(keys), ACTIONS_PER_STATEMENT):
        rows = await db.execute(
            select(r.row_no, r.part, r.outcome, r.reason_code).where(
                r.workspace_id == workspace_id,
                r.import_id == import_id,
                tuple_(r.row_no, r.part).in_(keys[start : start + ACTIONS_PER_STATEMENT]),
            )
        )
        found.update({(row.row_no, row.part): (row.outcome, row.reason_code) for row in rows})
    return found


async def set_actions(
    db: AsyncSession, workspace_id: UUID, import_id: UUID, actions: Mapping[tuple[int, int], str]
) -> None:
    """The action of each row among the given keys."""
    r = keyword_import_rows.c
    by_action: dict[str, list[tuple[int, int]]] = {}
    for key, action in actions.items():
        by_action.setdefault(action, []).append(key)
    for action, keys in by_action.items():
        for start in range(0, len(keys), ACTIONS_PER_STATEMENT):
            await db.execute(
                update(keyword_import_rows)
                .where(
                    r.workspace_id == workspace_id,
                    r.import_id == import_id,
                    tuple_(r.row_no, r.part).in_(keys[start : start + ACTIONS_PER_STATEMENT]),
                )
                .values(action=action)
            )


async def merge_tracked_duplicates(db: AsyncSession, workspace_id: UUID, import_id: UUID) -> int:
    """Turn the tracked duplicates still at `skip` into `merge` (confirming with
    `merge_terms`). A repeat in the file stays skipped: its extras reach the keyword through the
    first row. How many were changed."""
    r = keyword_import_rows.c
    changed = await db.execute(
        update(keyword_import_rows)
        .where(
            r.workspace_id == workspace_id,
            r.import_id == import_id,
            r.outcome == "duplicate",
            r.reason_code == "tracked",
            r.action == "skip",
        )
        .values(action="merge")
        .returning(r.row_no)
    )
    return len(changed.all())


async def planned_writes(db: AsyncSession, workspace_id: UUID, import_id: UUID) -> int:
    """Tracked keywords the import would add to the quota: parts to create, and archived ones
    to bring back by merging."""
    r = keyword_import_rows.c
    found: int = (
        await db.execute(
            select(func.count()).where(
                r.workspace_id == workspace_id,
                r.import_id == import_id,
                or_(r.action == "create", (r.outcome == "conflict") & (r.action == "merge")),
            )
        )
    ).scalar_one()
    return found


async def active_location(db: AsyncSession, location_id: int) -> bool:
    """Whether the location exists and is in use."""
    found = await db.execute(
        select(locations.c.id).where(locations.c.id == location_id, locations.c.is_active)
    )
    return found.first() is not None
