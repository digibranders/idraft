"""The links of tracked keywords to groups and terms, as the API and the worker both read and
write them (docs/08-seo-keyword-system.md section 4). Every statement names the workspace:
the worker bypasses row-level security, and the API's second line is this one.
"""

from __future__ import annotations

from collections.abc import Collection, Sequence
from dataclasses import dataclass
from typing import Final, Protocol
from uuid import UUID

from sqlalchemy import Row, Select, and_, delete, func, select
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.dml import ReturningDelete, ReturningInsert

from sightline.db.tables import (
    keyword_group_members,
    keyword_groups,
    taxonomy_terms,
    taxonomy_vocabularies,
    tracked_keyword_terms,
    tracked_keywords,
)
from sightline.keywords.trees import among_ids

# Rows per multi-row insert of links: 4 parameters a row stays well under the 32,767 a
# statement may carry.
LINKS_PER_STATEMENT: Final = 5000

# Link changes counted per keyword, by the database.
type PerKeyword = dict[UUID, int]


@dataclass(frozen=True, slots=True)
class GroupRecord:
    group_id: UUID
    name: str
    path: str


@dataclass(frozen=True, slots=True)
class TermRecord:
    term_id: UUID
    vocabulary_id: UUID
    vocabulary_kind: str
    name: str
    path: str
    is_single_valued: bool


class TermSlot(Protocol):
    """What the one-term-per-single-valued-vocabulary rule needs to know of a term."""

    @property
    def term_id(self) -> UUID: ...

    @property
    def vocabulary_id(self) -> UUID: ...

    @property
    def is_single_valued(self) -> bool: ...


def terms_to_add[T: TermSlot](have: Sequence[TermSlot], wanted: Sequence[T]) -> list[T]:
    """The wanted terms a keyword holding `have` can take, in order: not held already, and not
    of a single-valued vocabulary in which it holds another term."""
    held = {term.term_id for term in have}
    taken = {term.vocabulary_id for term in have if term.is_single_valued}
    found: list[T] = []
    for term in wanted:
        if term.term_id in held or (term.is_single_valued and term.vocabulary_id in taken):
            continue
        found.append(term)
        held.add(term.term_id)
        if term.is_single_valued:
            taken.add(term.vocabulary_id)
    return found


def one_per_single_valued_vocabulary[T: TermSlot](terms: Sequence[T]) -> tuple[list[T], list[UUID]]:
    """The terms to keep (the first of each single-valued vocabulary, in the order given, and
    every other term) and the ids of the rest."""
    kept: list[T] = []
    surplus: list[UUID] = []
    seen: set[UUID] = set()
    for term in terms:
        if term.is_single_valued and term.vocabulary_id in seen:
            surplus.append(term.term_id)
            continue
        seen.add(term.vocabulary_id)
        kept.append(term)
    return kept, surplus


def terms_query() -> Select[tuple[object, ...]]:
    """Terms with what a reference to one shows and the rule of their vocabulary."""
    return select(
        taxonomy_terms.c.id.label("term_id"),
        taxonomy_terms.c.vocabulary_id,
        taxonomy_vocabularies.c.kind.label("vocabulary_kind"),
        taxonomy_terms.c.name.label("term_name"),
        taxonomy_terms.c.path.label("term_path"),
        taxonomy_vocabularies.c.is_single_valued,
    ).join(
        taxonomy_vocabularies,
        and_(
            taxonomy_vocabularies.c.id == taxonomy_terms.c.vocabulary_id,
            taxonomy_vocabularies.c.workspace_id == taxonomy_terms.c.workspace_id,
        ),
    )


def term_record(row: Row[tuple[object, ...]]) -> TermRecord:
    return TermRecord(
        term_id=row.term_id,
        vocabulary_id=row.vocabulary_id,
        vocabulary_kind=row.vocabulary_kind,
        name=row.term_name,
        path=row.term_path,
        is_single_valued=row.is_single_valued,
    )


async def lock_rows(db: AsyncSession, workspace_id: UUID, ids: Collection[UUID]) -> None:
    """Locks these tracked keywords in id order (FOR NO KEY UPDATE), as bulk changes do, so
    their terms are read and changed by one request at a time."""
    if not ids:
        return
    await db.execute(
        select(tracked_keywords.c.id)
        .where(
            tracked_keywords.c.workspace_id == workspace_id,
            among_ids(tracked_keywords.c.id, ids),
        )
        .order_by(tracked_keywords.c.id)
        .with_for_update(key_share=True)
    )


async def per_keyword(
    db: AsyncSession, changing: ReturningDelete[tuple[UUID]] | ReturningInsert[tuple[UUID]]
) -> PerKeyword:
    """Runs a statement that returns `tracked_keyword_id` for each link it changes, and counts
    them per keyword in the database: a change of 20,000 keywords times 100 links sends back
    at most 20,000 rows."""
    changed = changing.cte("changed")
    rows = await db.execute(
        select(changed.c.tracked_keyword_id, func.count().label("links")).group_by(
            changed.c.tracked_keyword_id
        )
    )
    return {row.tracked_keyword_id: row.links for row in rows}


async def remove_terms(
    db: AsyncSession, workspace_id: UUID, ids: Collection[UUID], term_ids: Collection[UUID]
) -> PerKeyword:
    """Takes these terms from the rows among `ids`."""
    if not ids or not term_ids:
        return {}
    k = tracked_keyword_terms.c
    return await per_keyword(
        db,
        delete(tracked_keyword_terms)
        .where(
            k.workspace_id == workspace_id,
            among_ids(k.tracked_keyword_id, ids),
            among_ids(k.term_id, term_ids),
        )
        .returning(k.tracked_keyword_id),
    )


async def add_members(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    project_id: UUID,
    pairs: Collection[tuple[UUID, UUID]],
) -> int:
    """(group, tracked keyword) pairs; those that exist are left. How many were added."""
    rows = [
        {
            "group_id": group_id,
            "tracked_keyword_id": tracked_id,
            "project_id": project_id,
            "workspace_id": workspace_id,
        }
        for group_id, tracked_id in sorted(pairs)
    ]
    added = 0
    for start in range(0, len(rows), LINKS_PER_STATEMENT):
        result = await db.execute(
            upsert(keyword_group_members)
            .values(rows[start : start + LINKS_PER_STATEMENT])
            .on_conflict_do_nothing()
            .returning(keyword_group_members.c.group_id)
        )
        added += len(result.all())
    return added


async def add_terms(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    pairs: Collection[tuple[UUID, UUID]],
    assigned_by: str,
) -> int:
    """(tracked keyword, term) pairs; those that exist are left. How many were added."""
    rows = [
        {
            "tracked_keyword_id": tracked_id,
            "term_id": term_id,
            "workspace_id": workspace_id,
            "assigned_by": assigned_by,
        }
        for tracked_id, term_id in sorted(pairs)
    ]
    added = 0
    for start in range(0, len(rows), LINKS_PER_STATEMENT):
        result = await db.execute(
            upsert(tracked_keyword_terms)
            .values(rows[start : start + LINKS_PER_STATEMENT])
            .on_conflict_do_nothing()
            .returning(tracked_keyword_terms.c.term_id)
        )
        added += len(result.all())
    return added


async def groups_of(
    db: AsyncSession, workspace_id: UUID, tracked_ids: Collection[UUID]
) -> dict[UUID, list[GroupRecord]]:
    rows = await db.execute(
        select(
            keyword_group_members.c.tracked_keyword_id,
            keyword_groups.c.id,
            keyword_groups.c.name,
            keyword_groups.c.path,
        )
        .join(
            keyword_groups,
            and_(
                keyword_groups.c.id == keyword_group_members.c.group_id,
                keyword_groups.c.workspace_id == keyword_group_members.c.workspace_id,
            ),
        )
        .where(
            keyword_group_members.c.workspace_id == workspace_id,
            among_ids(keyword_group_members.c.tracked_keyword_id, tracked_ids),
        )
        .order_by(keyword_groups.c.path, keyword_groups.c.id)
    )
    found: dict[UUID, list[GroupRecord]] = {}
    for row in rows:
        found.setdefault(row.tracked_keyword_id, []).append(GroupRecord(row.id, row.name, row.path))
    return found


async def terms_of(
    db: AsyncSession, workspace_id: UUID, tracked_ids: Collection[UUID]
) -> dict[UUID, list[TermRecord]]:
    rows = await db.execute(
        terms_query()
        .add_columns(tracked_keyword_terms.c.tracked_keyword_id)
        .join(
            tracked_keyword_terms,
            and_(
                tracked_keyword_terms.c.term_id == taxonomy_terms.c.id,
                tracked_keyword_terms.c.workspace_id == taxonomy_terms.c.workspace_id,
            ),
        )
        .where(
            tracked_keyword_terms.c.workspace_id == workspace_id,
            among_ids(tracked_keyword_terms.c.tracked_keyword_id, tracked_ids),
        )
        .order_by(taxonomy_terms.c.vocabulary_id, taxonomy_terms.c.path, taxonomy_terms.c.id)
    )
    found: dict[UUID, list[TermRecord]] = {}
    for row in rows:
        found.setdefault(row.tracked_keyword_id, []).append(term_record(row))
    return found
