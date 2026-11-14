"""The fixture's topics as the project's topic vocabulary, through `TaxonomyService`.

Terms are matched by path (`parent-slug` or `parent-slug/child-slug`), else by name without case
among the siblings under the same parent, so a term a person renamed or re-slugged is reused.
Parents are added by name with their fixture slug, then children under them, so every slug is the
fixture's (a `path` input would make the parent's slug from its name). A term the fixture does
not name is left alone, and so is the name of one it does.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Final
from uuid import UUID

from idraft.api.schemas.taxonomy import TermInput
from idraft.api.taxonomy import repository as taxonomy_rows
from idraft.api.taxonomy.repository import TermRecord
from idraft.api.taxonomy.service import TaxonomyService
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction
from idraft.devseed.context import SEED_INFO, SeedError, Sessions
from idraft.devseed.fixture import TopicParent, topic_paths

VOCABULARY_KIND: Final = "topic"
VOCABULARY_NAME: Final = "Security topics"


async def _vocabulary(
    sessions: Sessions, service: TaxonomyService, access: WorkspaceAccess, project_id: UUID
) -> UUID:
    async with workspace_transaction(sessions, access.workspace_id, user_id=access.user_id) as db:
        found, _ = await taxonomy_rows.list_vocabularies(
            db,
            access.workspace_id,
            visible=None,
            project_id=project_id,
            kind=VOCABULARY_KIND,
            offset=0,
            limit=200,
        )
    for vocabulary in found:
        if (
            vocabulary.project_id == project_id
            and vocabulary.name.casefold() == VOCABULARY_NAME.casefold()
        ):
            if not vocabulary.is_hierarchical or vocabulary.is_single_valued:
                raise SeedError(
                    f"The project's vocabulary {VOCABULARY_NAME!r} is flat or single-valued; "
                    "the topics need a hierarchical one that takes two terms per prompt. "
                    "Change it in the app."
                )
            return vocabulary.id
    created = await service.create_vocabulary(
        access,
        kind=VOCABULARY_KIND,
        name=VOCABULARY_NAME,
        project_id=project_id,
        is_hierarchical=True,
        is_single_valued=False,
        info=SEED_INFO,
    )
    return created.id


async def _terms(
    sessions: Sessions, access: WorkspaceAccess, vocabulary_id: UUID
) -> list[TermRecord]:
    async with workspace_transaction(sessions, access.workspace_id, user_id=access.user_id) as db:
        return await taxonomy_rows.terms_of(db, access.workspace_id, vocabulary_id)


def _existing(terms: Sequence[TermRecord], path: str, item: TermInput) -> UUID | None:
    """The term at this path, else the sibling of the same name without case: a term a person
    renamed or re-slugged is still the fixture's, and keeps what they called it."""
    for term in terms:
        if term.path == path:
            return term.id
    name = str(item.name).casefold()
    for term in terms:
        if term.parent_id == item.parent_id and term.name.casefold() == name:
            return term.id
    return None


async def _ensure_level(
    sessions: Sessions,
    service: TaxonomyService,
    access: WorkspaceAccess,
    vocabulary_id: UUID,
    wanted: Sequence[tuple[str, TermInput]],
    ids: dict[str, UUID],
) -> int:
    """Each wanted `(path, term)` found or made, its id put in `ids` by path. Returns how many
    were made."""
    terms = await _terms(sessions, access, vocabulary_id)
    missing: list[tuple[str, TermInput]] = []
    for path, item in wanted:
        found = _existing(terms, path, item)
        if found is None:
            missing.append((path, item))
        else:
            ids[path] = found
    if missing:
        await service.add_terms(
            access, vocabulary_id, [item for _, item in missing], batch=True, info=SEED_INFO
        )
        by_path = {term.path: term.id for term in await _terms(sessions, access, vocabulary_id)}
        ids.update({path: by_path[path] for path, _ in missing})
    return len(missing)


async def ensure_topics(
    sessions: Sessions,
    access: WorkspaceAccess,
    project_id: UUID,
    topics: Sequence[TopicParent],
) -> tuple[dict[str, UUID], int]:
    """Each fixture topic's slug and term id, and how many terms were made now."""
    service = TaxonomyService(sessions=sessions)
    vocabulary_id = await _vocabulary(sessions, service, access, project_id)
    ids: dict[str, UUID] = {}
    made = await _ensure_level(
        sessions,
        service,
        access,
        vocabulary_id,
        [(parent.slug, TermInput(name=parent.name, slug=parent.slug)) for parent in topics],
        ids,
    )
    made += await _ensure_level(
        sessions,
        service,
        access,
        vocabulary_id,
        [
            (
                f"{parent.slug}/{child.slug}",
                TermInput(name=child.name, slug=child.slug, parent_id=ids[parent.slug]),
            )
            for parent in topics
            for child in parent.children
        ],
        ids,
    )
    return {slug: ids[path] for slug, path in topic_paths(topics).items()}, made
