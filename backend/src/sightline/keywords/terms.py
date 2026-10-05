"""Taxonomy terms as the API and the worker both create them (docs/19-api-specification.md
section 3.5): slugs made from names, names compared without case, one writer per vocabulary at
a time, and term paths made level by level.

Term slugs are lower-case ASCII letters and digits joined by hyphens. Letters with diacritics
lose them (`Café` is `cafe`); a name with no ASCII letter or digit left, such as one written only
in Japanese, gets `term`, and the sibling numbering keeps it unique.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Collection, Sequence
from dataclasses import dataclass
from typing import Final
from uuid import UUID

from sqlalchemy import func, insert, literal, select
from sqlalchemy.ext.asyncio import AsyncSession

from sightline.db.tables import taxonomy_terms, taxonomy_vocabularies

TERM_NAME_MAX: Final = 200
SLUG_MAX: Final = 100
# Levels from a root term down. Deep enough for a product catalogue, and it bounds the nesting
# of the tree a list returns.
TERM_DEPTH_MAX: Final = 10
FALLBACK_SLUG: Final = "term"

_WORD: Final = re.compile(r"[a-z0-9]+")


def fold(name: str) -> str:
    """How term names compare: without case, and the same in composed and decomposed form
    (`Café` typed either way)."""
    return unicodedata.normalize("NFC", unicodedata.normalize("NFC", name).casefold())


def slugify(name: str) -> str:
    decomposed = unicodedata.normalize("NFKD", name.casefold())
    bare = "".join(char for char in decomposed if not unicodedata.combining(char))
    slug = "-".join(_WORD.findall(bare))[:SLUG_MAX].rstrip("-")
    return slug or FALLBACK_SLUG


def free_slug(base: str, taken: Collection[str]) -> str:
    """`base`, or `base-2`, `base-3` and so on: the first one no sibling has."""
    if base not in taken:
        return base
    number = 2
    while True:
        suffix = f"-{number}"
        candidate = base[: SLUG_MAX - len(suffix)].rstrip("-") + suffix
        if candidate not in taken:
            return candidate
        number += 1


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


@dataclass(frozen=True, slots=True)
class Sibling:
    """A term as its siblings see it when a new one is named."""

    id: UUID
    name: str
    slug: str
    path: str


# The terms under each parent of one vocabulary (None for the top level), read once and kept
# up to date by `ensure_term_path`, for a caller that files many names in one transaction.
type SiblingCache = dict[UUID | None, list[Sibling]]


async def ensure_term_path(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    vocabulary: VocabularyRef,
    names: Sequence[str],
    cache: SiblingCache | None = None,
) -> UUID:
    """The term at this path of names, created level by level where missing, as the API's
    `add_terms` does for a `path`: names match without case (`fold`), and a new term's slug is
    the first free one among its siblings. A flat vocabulary takes one name only: the caller
    checks. The caller holds `lock_vocabulary`. With a `cache` of this vocabulary the siblings
    of a parent are read once, however many names are filed under it; the cache must not
    outlive the lock."""
    if not names:
        raise ValueError("a term path has at least one name")
    t = taxonomy_terms.c
    parent_id: UUID | None = None
    parent_path = ""
    for name in names:
        if cache is not None and parent_id in cache:
            siblings = cache[parent_id]
        else:
            siblings = [
                Sibling(row.id, row.name, str(row.slug), row.path)
                for row in await db.execute(
                    select(t.id, t.name, t.slug, t.path).where(
                        t.workspace_id == workspace_id,
                        t.vocabulary_id == vocabulary.id,
                        t.parent_id.is_(None) if parent_id is None else t.parent_id == parent_id,
                    )
                )
            ]
            if cache is not None:
                cache[parent_id] = siblings
        match = next((row for row in siblings if fold(row.name) == fold(name)), None)
        if match is not None:
            parent_id, parent_path = match.id, match.path
            continue
        slug = free_slug(slugify(name), {row.slug for row in siblings})
        path = slug if parent_id is None else f"{parent_path}/{slug}"
        made: UUID = (
            await db.execute(
                insert(taxonomy_terms)
                .values(
                    workspace_id=workspace_id,
                    vocabulary_id=vocabulary.id,
                    parent_id=parent_id,
                    name=name,
                    slug=slug,
                    path=path,
                    source="import",
                )
                .returning(t.id)
            )
        ).scalar_one()
        siblings.append(Sibling(made, name, slug, path))
        parent_id, parent_path = made, path
    if parent_id is None:  # pragma: no cover - names is not empty
        raise ValueError("a term path has at least one name")
    return parent_id
