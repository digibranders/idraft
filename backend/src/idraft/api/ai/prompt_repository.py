"""Reads and writes of prompts, their versions and their terms (docs/04-data-model.md section
8.2).

Runs in the caller's transaction as the API role; every statement names the workspace. A prompt
is shown with its current version, in slice 1 the first and only one.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import (
    ColumnElement,
    Row,
    Select,
    and_,
    delete,
    func,
    insert,
    literal,
    select,
    tuple_,
    update,
)
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.api.keywords.repository import UserRecord
from idraft.db.tables import (
    ai_prompt_terms,
    ai_prompt_versions,
    ai_prompts,
    projects,
    taxonomy_terms,
    tracked_keywords,
    users,
    workspace_quotas,
)
from idraft.domain.ai_engines import BASE_PLAN
from idraft.keywords.links import TermRecord, term_record, terms_query
from idraft.keywords.trees import among_ids, descendants

# Rows per insert: 14 values a prompt row stays far under the 32,767 parameters of a statement.
INSERT_MAX = 1000
# The database default of `max_ai_observations_per_month` (migration 0003): a workspace without a
# quota row has this limit (test_the_limit_defaults_match_the_database).
MONTHLY_ANSWERS_DEFAULT = 20_000
# Term links per insert: three values each.
_TERM_ROWS_MAX = 5000


@dataclass(frozen=True, slots=True)
class VersionRecord:
    id: UUID
    version_no: int
    text: str
    text_hash: bytes
    change_kind: str
    created_at: datetime


@dataclass(frozen=True, slots=True)
class PromptRecord:
    id: UUID
    current_version: VersionRecord
    language_code: str
    country_iso: str | None
    intent: str
    funnel_stage: str
    prompt_type: str
    prompt_type_source: str
    importance: int
    is_branded: bool
    is_branded_source: str
    source: str
    creation_method: str
    is_active: bool
    created_by: UserRecord | None
    created_at: datetime
    updated_at: datetime
    terms: list[TermRecord]


@dataclass(frozen=True, slots=True)
class PromptFilter:
    q: str | None = None
    # The term or one under it.
    term: UUID | None = None
    intents: frozenset[str] = frozenset()
    prompt_types: frozenset[str] = frozenset()
    funnel_stages: frozenset[str] = frozenset()
    importances: frozenset[int] = frozenset()
    is_branded: bool | None = None
    country_iso: str | None = None
    language_code: str | None = None
    # `None` lists archived and active prompts together.
    is_active: bool | None = True


# The value a keyset page continues after: text, importance or an instant, with the prompt's id.
type SortValue = str | int | datetime


@dataclass(frozen=True, slots=True)
class NewPrompt:
    """One prompt to write; the caller has checked it."""

    text: str
    text_hash: bytes
    language_code: str
    country_iso: str
    intent: str
    funnel_stage: str
    prompt_type: str
    # `rule` when the server's wording rule chose the type, `person` when the caller sent it.
    prompt_type_source: str
    importance: int
    is_branded: bool
    # `override` when the caller sent `is_branded`, `computed` when the own aliases gave it.
    is_branded_source: str
    source: str
    creation_method: str
    term_ids: tuple[UUID, ...]


# What makes two prompts of a project one (plan decision A2).
type PromptKey = tuple[bytes, str, str | None]  # text hash, language, country


def _contains(text: str) -> str:
    return "%" + text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def _current_version() -> Any:
    return and_(
        ai_prompt_versions.c.id == ai_prompts.c.current_version_id,
        ai_prompt_versions.c.workspace_id == ai_prompts.c.workspace_id,
    )


def _prompts(workspace_id: UUID, project_id: UUID) -> Select[tuple[object, ...]]:
    p, v = ai_prompts.c, ai_prompt_versions.c
    return (
        select(
            p.id,
            p.language_code,
            p.country_iso,
            p.intent,
            p.funnel_stage,
            p.prompt_type,
            p.prompt_type_source,
            p.importance,
            p.is_branded,
            p.is_branded_source,
            p.source,
            p.creation_method,
            p.is_active,
            p.created_at,
            p.updated_at,
            v.id.label("version_id"),
            v.version_no,
            v.text,
            v.text_hash,
            v.change_kind,
            v.created_at.label("version_created_at"),
            users.c.id.label("user_id"),
            users.c.name.label("user_name"),
            users.c.email.label("user_email"),
        )
        .select_from(
            ai_prompts.join(ai_prompt_versions, _current_version()).outerjoin(
                users, users.c.id == p.created_by
            )
        )
        .where(p.workspace_id == workspace_id, p.project_id == project_id, p.deleted_at.is_(None))
    )


def _record(row: Row[Any], terms: Mapping[UUID, list[TermRecord]]) -> PromptRecord:
    return PromptRecord(
        id=row.id,
        current_version=VersionRecord(
            id=row.version_id,
            version_no=row.version_no,
            text=row.text,
            text_hash=bytes(row.text_hash),
            change_kind=row.change_kind,
            created_at=row.version_created_at,
        ),
        language_code=row.language_code,
        country_iso=row.country_iso,
        intent=row.intent,
        funnel_stage=row.funnel_stage,
        prompt_type=row.prompt_type,
        prompt_type_source=row.prompt_type_source,
        importance=row.importance,
        is_branded=row.is_branded,
        is_branded_source=row.is_branded_source,
        source=row.source,
        creation_method=row.creation_method,
        is_active=row.is_active,
        created_by=None
        if row.user_id is None
        else UserRecord(user_id=row.user_id, name=row.user_name, email=row.user_email),
        created_at=row.created_at,
        updated_at=row.updated_at,
        terms=list(terms.get(row.id, [])),
    )


async def terms_of(
    db: AsyncSession, workspace_id: UUID, prompt_ids: Collection[UUID]
) -> dict[UUID, list[TermRecord]]:
    """Each prompt's terms, in path order."""
    if not prompt_ids:
        return {}
    rows = await db.execute(
        terms_query()
        .add_columns(ai_prompt_terms.c.prompt_id)
        .join(
            ai_prompt_terms,
            and_(
                ai_prompt_terms.c.term_id == taxonomy_terms.c.id,
                ai_prompt_terms.c.workspace_id == taxonomy_terms.c.workspace_id,
            ),
        )
        .where(
            ai_prompt_terms.c.workspace_id == workspace_id,
            among_ids(ai_prompt_terms.c.prompt_id, prompt_ids),
        )
        .order_by(taxonomy_terms.c.path, taxonomy_terms.c.id)
    )
    found: defaultdict[UUID, list[TermRecord]] = defaultdict(list)
    for row in rows:
        found[row.prompt_id].append(term_record(row))
    return dict(found)


async def _with_terms(
    db: AsyncSession, workspace_id: UUID, rows: Sequence[Row[Any]]
) -> list[PromptRecord]:
    terms = await terms_of(db, workspace_id, [row.id for row in rows])
    return [_record(row, terms) for row in rows]


def _conditions(workspace_id: UUID, given: PromptFilter) -> list[ColumnElement[bool]]:
    """The `WHERE` terms of a filter over `_prompts`, one per filter that is used: shared by the
    list and by the selections of the bulk writes, so both mean the same prompts."""
    p, v = ai_prompts.c, ai_prompt_versions.c
    found: list[ColumnElement[bool]] = []
    if given.q is not None:
        found.append(v.text.ilike(_contains(given.q), escape="\\"))
    if given.term is not None:
        tagged = select(ai_prompt_terms.c.prompt_id).where(
            ai_prompt_terms.c.workspace_id == workspace_id,
            ai_prompt_terms.c.term_id.in_(
                descendants("term", [given.term], workspace_id, "term_tree")
            ),
        )
        found.append(p.id.in_(tagged))
    if given.intents:
        found.append(p.intent.in_(sorted(given.intents)))
    if given.prompt_types:
        found.append(p.prompt_type.in_(sorted(given.prompt_types)))
    if given.funnel_stages:
        found.append(p.funnel_stage.in_(sorted(given.funnel_stages)))
    if given.importances:
        found.append(p.importance.in_(sorted(given.importances)))
    if given.is_branded is not None:
        found.append(p.is_branded == given.is_branded)
    if given.country_iso is not None:
        found.append(p.country_iso == given.country_iso)
    if given.language_code is not None:
        found.append(p.language_code == given.language_code)
    if given.is_active is not None:
        found.append(p.is_active == given.is_active)
    return found


def _sort_column(field: str) -> ColumnElement[Any]:
    p, v = ai_prompts.c, ai_prompt_versions.c
    columns: dict[str, ColumnElement[Any]] = {
        "text": v.text,
        "importance": p.importance,
        "created_at": p.created_at,
        "updated_at": p.updated_at,
    }
    return columns[field]


async def list_prompts(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    given: PromptFilter,
    *,
    sort: str | None,
    after: tuple[SortValue | None, UUID] | None,
    limit: int,
) -> list[PromptRecord]:
    """Newest first (prompt ids are time-ordered, `uuidv7()`), or by `sort`: a field, `-` first
    for descending, the id breaking ties. `after` is the last row's sort value (`None` without
    `sort`) and id; the page continues past it."""
    p = ai_prompts.c
    statement = _prompts(workspace_id, project_id).where(*_conditions(workspace_id, given))
    if sort is None:
        if after is not None:
            statement = statement.where(p.id < after[1])
        statement = statement.order_by(p.id.desc())
    else:
        column = _sort_column(sort.removeprefix("-"))
        descending = sort.startswith("-")
        if after is not None:
            key = tuple_(column, p.id)
            statement = statement.where(
                key < tuple_(*after) if descending else key > tuple_(*after)
            )
        statement = statement.order_by(
            *((column.desc(), p.id.desc()) if descending else (column, p.id))
        )
    rows = (await db.execute(statement.limit(limit))).all()
    return await _with_terms(db, workspace_id, rows)


async def prompts_by_ids(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, ids: Sequence[UUID]
) -> list[PromptRecord]:
    """The project's prompts with these ids, in the order of `ids`."""
    if not ids:
        return []
    statement = _prompts(workspace_id, project_id).where(among_ids(ai_prompts.c.id, ids))
    rows = (await db.execute(statement)).all()
    by_id = {record.id: record for record in await _with_terms(db, workspace_id, rows)}
    return [by_id[prompt_id] for prompt_id in ids if prompt_id in by_id]


async def get_prompt(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, prompt_id: UUID, *, lock: bool = False
) -> PromptRecord | None:
    """With `lock`, the prompt row is held (FOR NO KEY UPDATE) until the transaction ends."""
    statement = _prompts(workspace_id, project_id).where(ai_prompts.c.id == prompt_id)
    if lock:
        statement = statement.with_for_update(of=ai_prompts, key_share=True)
    row = (await db.execute(statement)).one_or_none()
    if row is None:
        return None
    (record,) = await _with_terms(db, workspace_id, [row])
    return record


async def lock_prompt_writes(db: AsyncSession, workspace_id: UUID) -> None:
    """Prompt writers of one workspace take turns until the transaction ends, so the quota count
    and the duplicate check of one write are never overtaken by another (plan decision A2)."""
    await db.execute(
        select(
            func.pg_advisory_xact_lock(func.hashtextextended(literal(f"prompts:{workspace_id}"), 0))
        )
    )


async def quota_usage(db: AsyncSession, workspace_id: UUID) -> tuple[int, int]:
    """The workspace's active prompt limit and its active prompts. Without a quota row the limit
    is the base plan's. A deleted project's prompts do not count; an archived project's do, so
    bringing a project back never takes the workspace over its limit."""
    stored: int | None = (
        await db.execute(
            select(workspace_quotas.c.max_active_prompts).where(
                workspace_quotas.c.workspace_id == workspace_id
            )
        )
    ).scalar_one_or_none()
    limit = BASE_PLAN.max_prompts if stored is None else stored
    used: int = (
        await db.execute(
            select(func.count())
            .select_from(
                ai_prompts.join(
                    projects,
                    and_(
                        projects.c.id == ai_prompts.c.project_id,
                        projects.c.workspace_id == ai_prompts.c.workspace_id,
                    ),
                )
            )
            .where(
                ai_prompts.c.workspace_id == workspace_id,
                ai_prompts.c.is_active,
                ai_prompts.c.deleted_at.is_(None),
                projects.c.deleted_at.is_(None),
            )
        )
    ).scalar_one()
    return limit, used


@dataclass(frozen=True, slots=True)
class LimitsRow:
    ai_observations_limit: int
    # The database clock, read in the same statement.
    now: datetime


async def limits_row(db: AsyncSession, workspace_id: UUID) -> LimitsRow:
    """The workspace's monthly limit of AI answers and the database clock, in one statement that
    only reads: no quota row is created or locked (`run_repository.lock_ai_observation_limit`
    does both, for the writes). Without a quota row the limit is the database default."""
    stored = (
        select(workspace_quotas.c.max_ai_observations_per_month)
        .where(workspace_quotas.c.workspace_id == workspace_id)
        .scalar_subquery()
    )
    limit, now = (
        await db.execute(select(func.coalesce(stored, MONTHLY_ANSWERS_DEFAULT), func.now()))
    ).one()
    return LimitsRow(ai_observations_limit=limit, now=now)


async def live_tracked_keywords(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, ids: Collection[UUID]
) -> set[UUID]:
    """Those of `ids` the project tracks (not deleted): one statement for all of them."""
    if not ids:
        return set()
    t = tracked_keywords.c
    rows = await db.execute(
        select(t.id).where(
            t.workspace_id == workspace_id,
            t.project_id == project_id,
            t.deleted_at.is_(None),
            among_ids(t.id, sorted(ids)),
        )
    )
    return set(rows.scalars())


async def existing(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, keys: Collection[PromptKey]
) -> dict[PromptKey, UUID]:
    """The project's prompts, archived ones too, with one of these identities."""
    if not keys:
        return {}
    p, v = ai_prompts.c, ai_prompt_versions.c
    rows = await db.execute(
        select(p.id, v.text_hash, p.language_code, p.country_iso)
        .select_from(ai_prompts.join(ai_prompt_versions, _current_version()))
        .where(
            p.workspace_id == workspace_id,
            p.project_id == project_id,
            p.deleted_at.is_(None),
            v.workspace_id == workspace_id,
            v.text_hash.in_(sorted({key[0] for key in keys})),
        )
    )
    wanted = set(keys)
    found: dict[PromptKey, UUID] = {}
    for row in rows:
        key: PromptKey = (bytes(row.text_hash), row.language_code, row.country_iso)
        if key in wanted:
            found[key] = row.id
    return found


@dataclass(frozen=True, slots=True)
class LintRow:
    id: UUID
    text: str
    text_hash: bytes
    language_code: str
    country_iso: str | None
    is_active: bool


async def lint_matches(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    markets: Collection[tuple[str, str]],
) -> list[LintRow]:
    """The project's prompts, archived ones too, in these (language, country) markets, oldest
    first: one statement whatever the number of items linted."""
    if not markets:
        return []
    p, v = ai_prompts.c, ai_prompt_versions.c
    # shortcut: reads every prompt of these markets; a functional index on the folded text
    # when a project passes 10,000 prompts.
    rows = await db.execute(
        select(p.id, v.text, v.text_hash, p.language_code, p.country_iso, p.is_active)
        .select_from(ai_prompts.join(ai_prompt_versions, _current_version()))
        .where(
            p.workspace_id == workspace_id,
            p.project_id == project_id,
            p.deleted_at.is_(None),
            v.workspace_id == workspace_id,
            tuple_(p.language_code, p.country_iso).in_(sorted(markets)),
        )
        .order_by(p.id)
    )
    return [
        LintRow(
            id=row.id,
            text=row.text,
            text_hash=bytes(row.text_hash),
            language_code=row.language_code,
            country_iso=row.country_iso,
            is_active=row.is_active,
        )
        for row in rows
    ]


async def insert_prompts(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    project_id: UUID,
    items: Sequence[NewPrompt],
    created_by: UUID,
    now: datetime,
) -> list[UUID]:
    """Each prompt with its first version (`change_kind = 'initial'`) and its terms, in the
    order given. Ids are drawn from the database's `uuidv7()` first, so a prompt names its
    version before the version is written; the key between them is checked at commit."""
    if not items:
        return []
    drawn = await db.execute(
        select(func.uuidv7()).select_from(func.generate_series(1, 2 * len(items)))
    )
    ids: list[UUID] = list(drawn.scalars())
    prompt_ids, version_ids = ids[: len(items)], ids[len(items) :]
    for start in range(0, len(items), INSERT_MAX):
        chunk = range(start, min(start + INSERT_MAX, len(items)))
        await db.execute(
            insert(ai_prompts).values(
                [
                    {
                        "id": prompt_ids[index],
                        "workspace_id": workspace_id,
                        "project_id": project_id,
                        "current_version_id": version_ids[index],
                        "language_code": items[index].language_code,
                        "country_iso": items[index].country_iso,
                        "intent": items[index].intent,
                        "funnel_stage": items[index].funnel_stage,
                        "prompt_type": items[index].prompt_type,
                        "prompt_type_source": items[index].prompt_type_source,
                        "importance": items[index].importance,
                        "is_branded": items[index].is_branded,
                        "is_branded_source": items[index].is_branded_source,
                        "source": items[index].source,
                        "creation_method": items[index].creation_method,
                        "created_by": created_by,
                        "created_at": now,
                        "updated_at": now,
                    }
                    for index in chunk
                ]
            )
        )
        await db.execute(
            insert(ai_prompt_versions).values(
                [
                    {
                        "id": version_ids[index],
                        "workspace_id": workspace_id,
                        "prompt_id": prompt_ids[index],
                        "version_no": 1,
                        "text": items[index].text,
                        "text_hash": items[index].text_hash,
                        "created_by": created_by,
                        "created_at": now,
                        "change_kind": "initial",
                    }
                    for index in chunk
                ]
            )
        )
    await add_terms(
        db,
        workspace_id,
        [
            (prompt_ids[index], term_id)
            for index, item in enumerate(items)
            for term_id in item.term_ids
        ],
    )
    return prompt_ids


async def add_terms(
    db: AsyncSession, workspace_id: UUID, pairs: Sequence[tuple[UUID, UUID]]
) -> None:
    """(prompt, term) links; the caller has checked the terms."""
    for start in range(0, len(pairs), _TERM_ROWS_MAX):
        await db.execute(
            insert(ai_prompt_terms).values(
                [
                    {"prompt_id": prompt_id, "term_id": term_id, "workspace_id": workspace_id}
                    for prompt_id, term_id in pairs[start : start + _TERM_ROWS_MAX]
                ]
            )
        )


async def replace_terms(
    db: AsyncSession, workspace_id: UUID, prompt_id: UUID, term_ids: Sequence[UUID]
) -> None:
    await db.execute(
        delete(ai_prompt_terms).where(
            ai_prompt_terms.c.workspace_id == workspace_id,
            ai_prompt_terms.c.prompt_id == prompt_id,
        )
    )
    await add_terms(db, workspace_id, [(prompt_id, term_id) for term_id in term_ids])


async def lock_prompts(
    db: AsyncSession, workspace_id: UUID, project_id: UUID, ids: Sequence[UUID]
) -> dict[UUID, bool]:
    """The project's live prompts among `ids`, each with whether it is active, held (FOR NO KEY
    UPDATE) until the transaction ends, taken in id order so two writers never wait on each
    other in a circle."""
    p = ai_prompts.c
    rows = await db.execute(
        select(p.id, p.is_active)
        .where(
            p.workspace_id == workspace_id,
            p.project_id == project_id,
            p.deleted_at.is_(None),
            among_ids(p.id, ids),
        )
        .order_by(p.id)
        .with_for_update(key_share=True)
    )
    return {row.id: row.is_active for row in rows}


async def set_active(
    db: AsyncSession, workspace_id: UUID, ids: Sequence[UUID], is_active: bool, now: datetime
) -> None:
    if not ids:
        return
    await db.execute(
        update(ai_prompts)
        .where(ai_prompts.c.workspace_id == workspace_id, among_ids(ai_prompts.c.id, ids))
        .values(is_active=is_active, updated_at=now)
    )


async def update_prompt(
    db: AsyncSession, workspace_id: UUID, prompt_id: UUID, values: Mapping[str, object]
) -> None:
    await db.execute(
        update(ai_prompts)
        .where(ai_prompts.c.workspace_id == workspace_id, ai_prompts.c.id == prompt_id)
        .values(**values)
    )
