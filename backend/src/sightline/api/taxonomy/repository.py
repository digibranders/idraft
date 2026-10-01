"""Statements for vocabularies and terms. Every function runs inside `workspace_transaction`,
and every statement names the workspace as well: row-level security is the second line, not
the first.

`visible` is a member's project scope: None for every project, else the projects the member
may see. Workspace-wide vocabularies are visible to every member.
"""

from __future__ import annotations

from collections.abc import Collection, Mapping
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    ColumnElement,
    Row,
    Select,
    delete,
    exists,
    func,
    insert,
    literal,
    or_,
    select,
    update,
)
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from sightline.db.errors import violated_unique_constraint
from sightline.db.tables import projects, taxonomy_terms, taxonomy_vocabularies

_VOCABULARY_TAKEN = "taxonomy_vocabularies_scope_kind_name"
_SLUG_TAKEN = "taxonomy_terms_vocabulary_id_parent_id_slug_key"


class VocabularyNameTakenError(Exception):
    """The scope has a vocabulary of this kind with this name. The transaction is spent."""


class TermSlugTakenError(Exception):
    """A sibling has this slug. The transaction is spent."""


@dataclass(frozen=True, slots=True)
class VocabularyRecord:
    id: UUID
    project_id: UUID | None
    kind: str
    name: str
    is_hierarchical: bool
    is_single_valued: bool
    term_count: int


@dataclass(frozen=True, slots=True)
class TermRecord:
    id: UUID
    vocabulary_id: UUID
    parent_id: UUID | None
    name: str
    slug: str
    path: str
    source: str
    description: str | None
    created_at: datetime


def _visible(visible: Collection[UUID] | None) -> ColumnElement[bool]:
    """Workspace-wide, or on a project the member may see that has not been deleted."""
    live_project = exists().where(
        projects.c.id == taxonomy_vocabularies.c.project_id,
        projects.c.workspace_id == taxonomy_vocabularies.c.workspace_id,
        projects.c.deleted_at.is_(None),
    )
    on_project = (
        live_project
        if visible is None
        else live_project & taxonomy_vocabularies.c.project_id.in_(visible)
    )
    return or_(taxonomy_vocabularies.c.project_id.is_(None), on_project)


def _vocabularies(workspace_id: UUID) -> Select[tuple[object, ...]]:
    term_count = (
        select(func.count())
        .where(
            taxonomy_terms.c.vocabulary_id == taxonomy_vocabularies.c.id,
            taxonomy_terms.c.workspace_id == taxonomy_vocabularies.c.workspace_id,
        )
        .scalar_subquery()
    )
    return select(
        taxonomy_vocabularies.c.id,
        taxonomy_vocabularies.c.project_id,
        taxonomy_vocabularies.c.kind,
        taxonomy_vocabularies.c.name,
        taxonomy_vocabularies.c.is_hierarchical,
        taxonomy_vocabularies.c.is_single_valued,
        term_count.label("term_count"),
    ).where(taxonomy_vocabularies.c.workspace_id == workspace_id)


def _vocabulary(row: Row[tuple[object, ...]]) -> VocabularyRecord:
    fields = row._mapping
    return VocabularyRecord(
        id=fields["id"],
        project_id=fields["project_id"],
        kind=fields["kind"],
        name=fields["name"],
        is_hierarchical=fields["is_hierarchical"],
        is_single_valued=fields["is_single_valued"],
        term_count=fields["term_count"],
    )


async def list_vocabularies(
    db: AsyncSession,
    workspace_id: UUID,
    *,
    visible: Collection[UUID] | None,
    project_id: UUID | None,
    kind: str | None,
    offset: int,
    limit: int,
) -> tuple[list[VocabularyRecord], int]:
    """A page by name, and how many match. `project_id` keeps that project's vocabularies and
    the workspace-wide ones."""
    conditions = [taxonomy_vocabularies.c.workspace_id == workspace_id, _visible(visible)]
    if project_id is not None:
        conditions.append(
            or_(
                taxonomy_vocabularies.c.project_id.is_(None),
                taxonomy_vocabularies.c.project_id == project_id,
            )
        )
    if kind is not None:
        conditions.append(taxonomy_vocabularies.c.kind == kind)
    total: int = (
        await db.execute(select(func.count()).select_from(taxonomy_vocabularies).where(*conditions))
    ).scalar_one()
    statement = (
        _vocabularies(workspace_id)
        .where(*conditions)
        .order_by(func.lower(taxonomy_vocabularies.c.name), taxonomy_vocabularies.c.id)
        .offset(offset)
        .limit(limit)
    )
    return [_vocabulary(row) for row in await db.execute(statement)], total


async def get_vocabulary(
    db: AsyncSession,
    workspace_id: UUID,
    vocabulary_id: UUID,
    *,
    visible: Collection[UUID] | None,
    for_update: bool = False,
) -> VocabularyRecord | None:
    """With `for_update`, writes to the vocabulary and its terms wait for this transaction (FOR
    NO KEY UPDATE, so the key checks of term inserts are not blocked)."""
    statement = _vocabularies(workspace_id).where(
        taxonomy_vocabularies.c.id == vocabulary_id, _visible(visible)
    )
    if for_update:
        statement = statement.with_for_update(of=taxonomy_vocabularies, key_share=True)
    row = (await db.execute(statement)).one_or_none()
    return None if row is None else _vocabulary(row)


async def insert_vocabulary(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    project_id: UUID | None,
    kind: str,
    name: str,
    is_hierarchical: bool,
    is_single_valued: bool,
) -> UUID:
    statement = (
        insert(taxonomy_vocabularies)
        .values(
            workspace_id=workspace_id,
            project_id=project_id,
            kind=kind,
            name=name,
            is_hierarchical=is_hierarchical,
            is_single_valued=is_single_valued,
        )
        .returning(taxonomy_vocabularies.c.id)
    )
    try:
        vocabulary_id: UUID = (await db.execute(statement)).scalar_one()
    except IntegrityError as error:
        if violated_unique_constraint(error) == _VOCABULARY_TAKEN:
            raise VocabularyNameTakenError from None
        raise
    return vocabulary_id


async def update_vocabulary(
    db: AsyncSession, workspace_id: UUID, vocabulary_id: UUID, changes: Mapping[str, object]
) -> None:
    statement = (
        update(taxonomy_vocabularies)
        .where(
            taxonomy_vocabularies.c.workspace_id == workspace_id,
            taxonomy_vocabularies.c.id == vocabulary_id,
        )
        .values(**changes)
    )
    try:
        await db.execute(statement)
    except IntegrityError as error:
        if violated_unique_constraint(error) == _VOCABULARY_TAKEN:
            raise VocabularyNameTakenError from None
        raise


async def delete_vocabulary(db: AsyncSession, workspace_id: UUID, vocabulary_id: UUID) -> None:
    """Its terms go with it."""
    await db.execute(
        delete(taxonomy_vocabularies).where(
            taxonomy_vocabularies.c.workspace_id == workspace_id,
            taxonomy_vocabularies.c.id == vocabulary_id,
        )
    )


_TERM_COLUMNS = (
    taxonomy_terms.c.id,
    taxonomy_terms.c.vocabulary_id,
    taxonomy_terms.c.parent_id,
    taxonomy_terms.c.name,
    taxonomy_terms.c.slug,
    taxonomy_terms.c.path,
    taxonomy_terms.c.source,
    taxonomy_terms.c.description,
    taxonomy_terms.c.created_at,
)


def _term(row: Row[tuple[object, ...]]) -> TermRecord:
    fields = row._mapping
    return TermRecord(
        id=fields["id"],
        vocabulary_id=fields["vocabulary_id"],
        parent_id=fields["parent_id"],
        name=fields["name"],
        slug=fields["slug"],
        path=fields["path"],
        source=fields["source"],
        description=fields["description"],
        created_at=fields["created_at"],
    )


def _terms(workspace_id: UUID, vocabulary_id: UUID) -> Select[tuple[object, ...]]:
    return select(*_TERM_COLUMNS).where(
        taxonomy_terms.c.workspace_id == workspace_id,
        taxonomy_terms.c.vocabulary_id == vocabulary_id,
    )


async def terms_of(db: AsyncSession, workspace_id: UUID, vocabulary_id: UUID) -> list[TermRecord]:
    """Every term of the vocabulary, in no particular order."""
    return [_term(row) for row in await db.execute(_terms(workspace_id, vocabulary_id))]


async def children_of(
    db: AsyncSession, workspace_id: UUID, vocabulary_id: UUID, parent_id: UUID | None
) -> list[TermRecord]:
    """The terms right under `parent_id`; the roots when it is None."""
    parent = (
        taxonomy_terms.c.parent_id.is_(None)
        if parent_id is None
        else taxonomy_terms.c.parent_id == parent_id
    )
    return [
        _term(row) for row in await db.execute(_terms(workspace_id, vocabulary_id).where(parent))
    ]


async def get_term(
    db: AsyncSession, workspace_id: UUID, term_id: UUID, *, vocabulary_id: UUID | None = None
) -> TermRecord | None:
    """The term; with `vocabulary_id`, only when it is in that vocabulary."""
    statement = select(*_TERM_COLUMNS).where(
        taxonomy_terms.c.workspace_id == workspace_id, taxonomy_terms.c.id == term_id
    )
    if vocabulary_id is not None:
        statement = statement.where(taxonomy_terms.c.vocabulary_id == vocabulary_id)
    row = (await db.execute(statement)).one_or_none()
    return None if row is None else _term(row)


async def insert_term(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    vocabulary_id: UUID,
    parent_id: UUID | None,
    name: str,
    slug: str,
    path: str,
    description: str | None,
) -> TermRecord:
    statement = (
        insert(taxonomy_terms)
        .values(
            workspace_id=workspace_id,
            vocabulary_id=vocabulary_id,
            parent_id=parent_id,
            name=name,
            slug=slug,
            path=path,
            description=description,
        )
        .returning(*_TERM_COLUMNS)
    )
    try:
        row = (await db.execute(statement)).one()
    except IntegrityError as error:
        if violated_unique_constraint(error) == _SLUG_TAKEN:
            raise TermSlugTakenError from None
        raise
    return _term(row)


async def update_term(
    db: AsyncSession, workspace_id: UUID, term_id: UUID, changes: Mapping[str, object]
) -> None:
    statement = (
        update(taxonomy_terms)
        .where(taxonomy_terms.c.workspace_id == workspace_id, taxonomy_terms.c.id == term_id)
        .values(**changes)
    )
    try:
        await db.execute(statement)
    except IntegrityError as error:
        if violated_unique_constraint(error) == _SLUG_TAKEN:
            raise TermSlugTakenError from None
        raise


def _under(path: str) -> ColumnElement[bool]:
    """Strictly below the term at `path`. Paths hold only `a-z`, `0-9`, `-` and `/` (a check
    says so), none of which LIKE treats as special, so no escaping is needed."""
    return taxonomy_terms.c.path.like(path + "/%")


async def move_subtree(
    db: AsyncSession, workspace_id: UUID, vocabulary_id: UUID, *, old_path: str, new_path: str
) -> None:
    """The paths below a term whose own path changed from `old_path` to `new_path`."""
    await db.execute(
        update(taxonomy_terms)
        .where(
            taxonomy_terms.c.workspace_id == workspace_id,
            taxonomy_terms.c.vocabulary_id == vocabulary_id,
            _under(old_path),
        )
        .values(
            path=literal(new_path) + func.substr(taxonomy_terms.c.path, literal(len(old_path) + 1))
        )
    )


async def count_below(db: AsyncSession, workspace_id: UUID, vocabulary_id: UUID, path: str) -> int:
    """How many terms the subtree under the term at `path` holds, the term itself left out."""
    count: int = (
        await db.execute(
            select(func.count()).where(
                taxonomy_terms.c.workspace_id == workspace_id,
                taxonomy_terms.c.vocabulary_id == vocabulary_id,
                _under(path),
            )
        )
    ).scalar_one()
    return count


async def levels_below(db: AsyncSession, workspace_id: UUID, vocabulary_id: UUID, path: str) -> int:
    """How many levels the subtree reaches below the term at `path`: 0 for a leaf."""
    separators = func.length(taxonomy_terms.c.path) - func.length(
        func.replace(taxonomy_terms.c.path, "/", "")
    )
    deepest: int | None = (
        await db.execute(
            select(func.max(separators)).where(
                taxonomy_terms.c.workspace_id == workspace_id,
                taxonomy_terms.c.vocabulary_id == vocabulary_id,
                _under(path),
            )
        )
    ).scalar_one()
    return 0 if deepest is None else deepest - path.count("/")


async def delete_term(db: AsyncSession, workspace_id: UUID, term_id: UUID) -> None:
    """Its subtree goes with it."""
    await db.execute(
        delete(taxonomy_terms).where(
            taxonomy_terms.c.workspace_id == workspace_id, taxonomy_terms.c.id == term_id
        )
    )
