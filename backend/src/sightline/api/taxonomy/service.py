"""Rules for vocabularies and terms (docs/19-api-specification.md section 3.5).

Every change is audited in its own transaction. Term writes lock their vocabulary first, so
writes to one vocabulary run one at a time: slugs are picked, names compared and cycles checked
against a tree no other request is changing.

A member limited to some projects sees the workspace-wide vocabularies and those of its
projects, and gets `404` for the others. A workspace-wide vocabulary is shared by every project,
so only a member who is not limited to some may change it.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass, field
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.api import audit
from sightline.api.pagination import OffsetParams
from sightline.api.problems import (
    CycleDetectedError,
    DuplicateError,
    ForbiddenError,
    HasChildrenError,
    NotFoundError,
    SingleValuedViolationError,
    invalid_field,
)
from sightline.api.projects import repository as projects
from sightline.api.request_info import RequestInfo
from sightline.api.schemas.taxonomy import TERM_DEPTH_MAX, TermInput
from sightline.api.taxonomy import repository
from sightline.api.taxonomy.repository import (
    TermRecord,
    TermSlugTakenError,
    VocabularyNameTakenError,
    VocabularyRecord,
)
from sightline.api.workspaces.access import WorkspaceAccess
from sightline.db.engine import workspace_transaction
from sightline.keywords.terms import fold, free_slug, lock_vocabulary, slugify


@dataclass(frozen=True, slots=True)
class Branch:
    """A term and the branches under it, in path order."""

    term: TermRecord
    children: list[Branch]


@dataclass(slots=True)
class _Level:
    """The terms right under one parent, as a batch has found or made them."""

    by_name: dict[str, TermRecord] = field(default_factory=dict)
    slugs: set[str] = field(default_factory=set)

    def add(self, term: TermRecord) -> None:
        self.by_name[fold(term.name)] = term
        self.slugs.add(term.slug)


def _path_order(term: TermRecord) -> list[str]:
    # Level by level, so a parent comes right before its subtree: `a-b` sorts after `a/b`.
    return term.path.split("/")


def arrange(terms: Sequence[TermRecord], *, q: str | None, tree: bool) -> list[Branch]:
    """The terms in path order. In a tree, `q` keeps the terms whose name holds it with their
    ancestors; flat, it keeps only the terms whose name holds it."""
    ordered = sorted(terms, key=_path_order)
    matching = None
    if q is not None:
        needle = fold(q)
        matching = {term.id for term in ordered if needle in fold(term.name)}
    if not tree:
        return [Branch(term, []) for term in ordered if matching is None or term.id in matching]
    by_id = {term.id: term for term in ordered}
    kept = set(by_id) if matching is None else set()
    for term_id in matching or ():
        current: TermRecord | None = by_id[term_id]
        while current is not None and current.id not in kept:
            kept.add(current.id)
            current = None if current.parent_id is None else by_id.get(current.parent_id)
    branches = {term.id: Branch(term, []) for term in ordered if term.id in kept}
    roots: list[Branch] = []
    for term in ordered:
        branch = branches.get(term.id)
        if branch is None:
            continue
        if term.parent_id is None:
            roots.append(branch)
        else:
            branches[term.parent_id].children.append(branch)
    return roots


def _depth(path: str) -> int:
    return path.count("/") + 1


def _name_taken() -> DuplicateError:
    return DuplicateError("The scope has a vocabulary of this kind with this name.")


def _sibling_name() -> DuplicateError:
    return DuplicateError("A term under this parent has this name.")


def _sibling_slug() -> DuplicateError:
    return DuplicateError("A term under this parent has this slug.")


def _vocabulary_snapshot(vocabulary: VocabularyRecord) -> dict[str, str | bool | None]:
    return {
        "project_id": None if vocabulary.project_id is None else str(vocabulary.project_id),
        "kind": vocabulary.kind,
        "name": vocabulary.name,
        "is_hierarchical": vocabulary.is_hierarchical,
        "is_single_valued": vocabulary.is_single_valued,
    }


def _term_snapshot(term: TermRecord) -> dict[str, str | None]:
    return {
        "vocabulary_id": str(term.vocabulary_id),
        "parent_id": None if term.parent_id is None else str(term.parent_id),
        "name": term.name,
        "slug": term.slug,
        "path": term.path,
        "description": term.description,
    }


def _audit_value(value: object) -> str | bool | None:
    if value is None or isinstance(value, str | bool):
        return value
    return str(value)


class TaxonomyService:
    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    def _transaction(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        return workspace_transaction(self._sessions, access.workspace_id, user_id=access.user_id)

    # Vocabularies.

    async def list_vocabularies(
        self,
        access: WorkspaceAccess,
        *,
        project_id: UUID | None,
        kind: str | None,
        page: OffsetParams,
    ) -> tuple[list[VocabularyRecord], int]:
        async with self._transaction(access) as db:
            return await repository.list_vocabularies(
                db,
                access.workspace_id,
                visible=access.project_ids,
                project_id=project_id,
                kind=kind,
                offset=page.offset,
                limit=page.limit,
            )

    async def create_vocabulary(
        self,
        access: WorkspaceAccess,
        *,
        kind: str,
        name: str,
        project_id: UUID | None,
        is_hierarchical: bool,
        is_single_valued: bool,
        info: RequestInfo,
    ) -> VocabularyRecord:
        if project_id is None:
            self._may_share(access)
        try:
            async with self._transaction(access) as db:
                if project_id is not None and (
                    not access.sees(project_id)
                    or await projects.get_project(db, access.workspace_id, project_id) is None
                ):
                    raise invalid_field(
                        "project_id", code="project_unknown", message="No such project."
                    )
                vocabulary_id = await repository.insert_vocabulary(
                    db,
                    workspace_id=access.workspace_id,
                    project_id=project_id,
                    kind=kind,
                    name=name,
                    is_hierarchical=is_hierarchical,
                    is_single_valued=is_single_valued,
                )
                created = await self._vocabulary(db, access, vocabulary_id)
                await audit.record(
                    db,
                    workspace_id=access.workspace_id,
                    actor_id=access.user_id,
                    action="vocabulary.created",
                    target_type="vocabulary",
                    target_id=vocabulary_id,
                    info=info,
                    after=_vocabulary_snapshot(created),
                )
        except VocabularyNameTakenError:
            raise _name_taken() from None
        return created

    async def update_vocabulary(
        self,
        access: WorkspaceAccess,
        vocabulary_id: UUID,
        changes: Mapping[str, object],
        info: RequestInfo,
    ) -> VocabularyRecord:
        """Change the given fields. Nothing is written or logged when nothing differs. Turning
        `is_single_valued` on is `409 single_valued_violation` while a tracked keyword has two
        of its terms; the vocabulary lock makes assignments wait for the check."""
        try:
            async with self._transaction(access) as db:
                current = await self._writable(db, access, vocabulary_id)
                differing = {
                    name: value
                    for name, value in changes.items()
                    if getattr(current, name) != value
                }
                if not differing:
                    return current
                if differing.get("is_single_valued") is True:
                    offending = await repository.a_keyword_with_two_terms(
                        db, access.workspace_id, vocabulary_id
                    )
                    if offending is not None:
                        raise SingleValuedViolationError(
                            "A tracked keyword has two terms of this vocabulary. Leave it one, "
                            "then try again.",
                            tracked_keyword_id=offending,
                        )
                await repository.update_vocabulary(
                    db, access.workspace_id, vocabulary_id, differing
                )
                await audit.record(
                    db,
                    workspace_id=access.workspace_id,
                    actor_id=access.user_id,
                    action="vocabulary.updated",
                    target_type="vocabulary",
                    target_id=vocabulary_id,
                    info=info,
                    before={name: _audit_value(getattr(current, name)) for name in differing},
                    after={name: _audit_value(value) for name, value in differing.items()},
                )
                updated = await self._vocabulary(db, access, vocabulary_id)
        except VocabularyNameTakenError:
            raise _name_taken() from None
        return updated

    async def delete_vocabulary(
        self, access: WorkspaceAccess, vocabulary_id: UUID, info: RequestInfo
    ) -> None:
        async with self._transaction(access) as db:
            current = await self._writable(db, access, vocabulary_id)
            await repository.delete_vocabulary(db, access.workspace_id, vocabulary_id)
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="vocabulary.deleted",
                target_type="vocabulary",
                target_id=vocabulary_id,
                info=info,
                before={**_vocabulary_snapshot(current), "term_count": current.term_count},
            )

    # Terms.

    async def terms(
        self, access: WorkspaceAccess, vocabulary_id: UUID, *, q: str | None, tree: bool
    ) -> tuple[list[Branch], dict[UUID, int]]:
        """The terms, and the keyword count of each term that has any (`keyword_counts`)."""
        async with self._transaction(access) as db:
            await self._vocabulary(db, access, vocabulary_id)
            found = await repository.terms_of(db, access.workspace_id, vocabulary_id)
            counts = await repository.keyword_counts(
                db, access.workspace_id, vocabulary_id, visible=access.project_ids
            )
        return arrange(found, q=q, tree=tree), counts

    async def add_terms(
        self,
        access: WorkspaceAccess,
        vocabulary_id: UUID,
        items: Sequence[TermInput],
        *,
        batch: bool,
        info: RequestInfo,
    ) -> list[TermRecord]:
        """Each item in order; a `path` reuses the terms it names that exist, matched by name
        without case, and creates the rest. Only the terms created are returned."""
        try:
            async with self._transaction(access) as db:
                vocabulary = await self._writable(db, access, vocabulary_id)
                adder = _TermAdder(db, access.workspace_id, vocabulary)
                for index, item in enumerate(items):
                    where = f"items.{index}." if batch else ""
                    await adder.add(item, where)
                await audit.record_each(
                    db,
                    workspace_id=access.workspace_id,
                    actor_id=access.user_id,
                    action="term.created",
                    target_type="term",
                    info=info,
                    entries=[
                        audit.Entry(target_id=term.id, after=_term_snapshot(term))
                        for term in adder.created
                    ],
                )
        except TermSlugTakenError:  # pragma: no cover - checked against the siblings first
            raise _sibling_slug() from None
        return adder.created

    async def update_term(
        self,
        access: WorkspaceAccess,
        term_id: UUID,
        changes: Mapping[str, object],
        info: RequestInfo,
    ) -> TermRecord:
        """Rename, re-slug, describe or move a term. A new slug or parent rewrites the paths
        of its whole subtree. Nothing is written or logged when nothing differs."""
        try:
            async with self._transaction(access) as db:
                vocabulary, current = await self._term_to_write(db, access, term_id)
                differing = {
                    name: value
                    for name, value in changes.items()
                    if getattr(current, name) != value
                }
                if not differing:
                    return current
                written = dict(differing)
                if differing.keys() & {"name", "slug", "parent_id"}:
                    written |= await self._reshaped(
                        db, access, vocabulary, current, differing, slug_given="slug" in changes
                    )
                await repository.update_term(db, access.workspace_id, term_id, written)
                if "path" in written:
                    await repository.move_subtree(
                        db,
                        access.workspace_id,
                        vocabulary.id,
                        old_path=current.path,
                        new_path=str(written["path"]),
                    )
                await audit.record(
                    db,
                    workspace_id=access.workspace_id,
                    actor_id=access.user_id,
                    action="term.updated",
                    target_type="term",
                    target_id=term_id,
                    info=info,
                    before={field: _audit_value(getattr(current, field)) for field in written},
                    after={field: _audit_value(value) for field, value in written.items()},
                )
                updated = await repository.get_term(db, access.workspace_id, term_id)
        except TermSlugTakenError:  # pragma: no cover - checked against the siblings first
            raise _sibling_slug() from None
        if updated is None:  # pragma: no cover - read in this transaction
            raise NotFoundError
        return updated

    async def delete_term(
        self, access: WorkspaceAccess, term_id: UUID, *, cascade: bool, info: RequestInfo
    ) -> None:
        async with self._transaction(access) as db:
            vocabulary, current = await self._term_to_write(db, access, term_id)
            below = await repository.count_below(
                db, access.workspace_id, vocabulary.id, current.path
            )
            if below and not cascade:
                raise HasChildrenError(
                    "The term has children. Move or delete them, or delete with cascade=true."
                )
            await repository.delete_term(db, access.workspace_id, term_id)
            await audit.record(
                db,
                workspace_id=access.workspace_id,
                actor_id=access.user_id,
                action="term.deleted",
                target_type="term",
                target_id=term_id,
                info=info,
                before={**_term_snapshot(current), "terms_below": below},
            )

    # Shared steps.

    @staticmethod
    def _may_share(access: WorkspaceAccess) -> None:
        if access.project_ids is not None:
            raise ForbiddenError(
                "A workspace-wide vocabulary is shared by every project, so a member limited "
                "to some projects cannot change it."
            )

    @staticmethod
    async def _vocabulary(
        db: AsyncSession, access: WorkspaceAccess, vocabulary_id: UUID, *, lock: bool = False
    ) -> VocabularyRecord:
        if lock:
            # Before the row lock, as the worker's imports take it: writers of one vocabulary
            # run one at a time, whichever side they are on.
            await lock_vocabulary(db, vocabulary_id)
        found = await repository.get_vocabulary(
            db, access.workspace_id, vocabulary_id, visible=access.project_ids, for_update=lock
        )
        if found is None:
            raise NotFoundError
        return found

    async def _writable(
        self, db: AsyncSession, access: WorkspaceAccess, vocabulary_id: UUID
    ) -> VocabularyRecord:
        """The vocabulary, locked, when the member may change it."""
        found = await self._vocabulary(db, access, vocabulary_id, lock=True)
        if found.project_id is None:
            self._may_share(access)
        return found

    async def _term_to_write(
        self, db: AsyncSession, access: WorkspaceAccess, term_id: UUID
    ) -> tuple[VocabularyRecord, TermRecord]:
        """The term and its vocabulary, locked, read again after the lock."""
        found = await repository.get_term(db, access.workspace_id, term_id)
        if found is None:
            raise NotFoundError
        vocabulary = await self._writable(db, access, found.vocabulary_id)
        current = await repository.get_term(
            db, access.workspace_id, term_id, vocabulary_id=vocabulary.id
        )
        if current is None:  # pragma: no cover - deleted while this request waited for the lock
            raise NotFoundError
        return vocabulary, current

    async def _reshaped(
        self,
        db: AsyncSession,
        access: WorkspaceAccess,
        vocabulary: VocabularyRecord,
        current: TermRecord,
        differing: Mapping[str, object],
        *,
        slug_given: bool,
    ) -> dict[str, object]:
        """What a rename, new slug or move writes besides the fields given: the new path, and a
        new slug when a move without a given slug lands next to a sibling with the term's slug.
        A name or a given slug a sibling has is refused."""
        moving = "parent_id" in differing
        parent = await self._new_parent(db, access, vocabulary, current, differing)
        siblings = [
            term
            for term in await repository.children_of(
                db, access.workspace_id, vocabulary.id, None if parent is None else parent.id
            )
            if term.id != current.id
        ]
        name = str(differing.get("name", current.name))
        if (moving or "name" in differing) and fold(name) in {fold(term.name) for term in siblings}:
            raise _sibling_name()
        taken = {term.slug for term in siblings}
        written: dict[str, object] = {}
        slug = str(differing.get("slug", current.slug))
        if slug_given:
            if (moving or "slug" in differing) and slug in taken:
                raise _sibling_slug()
        elif moving and slug in taken:
            # No slug was given, so the term is numbered among its new siblings as an insert is.
            slug = free_slug(slug, taken)
            written["slug"] = slug
        path = slug if parent is None else f"{parent.path}/{slug}"
        if path != current.path:
            written["path"] = path
        return written

    @staticmethod
    async def _new_parent(
        db: AsyncSession,
        access: WorkspaceAccess,
        vocabulary: VocabularyRecord,
        current: TermRecord,
        differing: Mapping[str, object],
    ) -> TermRecord | None:
        """The parent the term has after the change: checked when it moves."""
        if "parent_id" not in differing:
            if current.parent_id is None:
                return None
            return await repository.get_term(db, access.workspace_id, current.parent_id)
        parent_id = differing["parent_id"]
        if not isinstance(parent_id, UUID):
            return None
        if not vocabulary.is_hierarchical:
            raise invalid_field(
                "parent_id", code="not_hierarchical", message="The vocabulary is flat."
            )
        parent = await repository.get_term(
            db, access.workspace_id, parent_id, vocabulary_id=vocabulary.id
        )
        if parent is None:
            raise invalid_field(
                "parent_id", code="parent_unknown", message="No such term in this vocabulary."
            )
        if parent.id == current.id or parent.path.startswith(current.path + "/"):
            raise CycleDetectedError("The parent is this term or one under it.")
        below = await repository.levels_below(db, access.workspace_id, vocabulary.id, current.path)
        if _depth(parent.path) + 1 + below > TERM_DEPTH_MAX:
            raise invalid_field(
                "parent_id",
                code="too_deep",
                message=f"A term is at most {TERM_DEPTH_MAX} levels from its root.",
            )
        return parent


class _TermAdder:
    """Adds the items of one request to a locked vocabulary, remembering each level it reads."""

    def __init__(self, db: AsyncSession, workspace_id: UUID, vocabulary: VocabularyRecord) -> None:
        self._db = db
        self._workspace_id = workspace_id
        self._vocabulary = vocabulary
        self._levels: dict[UUID | None, _Level] = {}
        self.created: list[TermRecord] = []

    async def add(self, item: TermInput, where: str) -> None:
        if item.path is not None:
            await self._add_path(item, item.path.split("/"), where)
            return
        if item.name is None:  # pragma: no cover - TermInput holds a name or a path
            raise ValueError("a term input without a name or a path")
        parent = None
        if item.parent_id is not None:
            self._needs_hierarchy(f"{where}parent_id")
            parent = await repository.get_term(
                self._db, self._workspace_id, item.parent_id, vocabulary_id=self._vocabulary.id
            )
            if parent is None:
                raise invalid_field(
                    f"{where}parent_id",
                    code="parent_unknown",
                    message="No such term in this vocabulary.",
                )
            if _depth(parent.path) >= TERM_DEPTH_MAX:
                raise invalid_field(
                    f"{where}parent_id",
                    code="too_deep",
                    message=f"A term is at most {TERM_DEPTH_MAX} levels from its root.",
                )
        level = await self._level(parent)
        if fold(item.name) in level.by_name:
            raise _sibling_name()
        await self._insert(parent, level, item.name, item.slug, item.description)

    async def _add_path(self, item: TermInput, names: Sequence[str], where: str) -> None:
        if len(names) > 1:
            self._needs_hierarchy(f"{where}path")
        parent: TermRecord | None = None
        for depth, name in enumerate(names, start=1):
            level = await self._level(parent)
            existing = level.by_name.get(fold(name))
            if existing is not None:
                parent = existing
                continue
            last = depth == len(names)
            parent = await self._insert(
                parent,
                level,
                name,
                item.slug if last else None,
                item.description if last else None,
            )

    def _needs_hierarchy(self, path: str) -> None:
        if not self._vocabulary.is_hierarchical:
            raise invalid_field(
                path, code="not_hierarchical", message="The vocabulary is flat: no parents."
            )

    async def _level(self, parent: TermRecord | None) -> _Level:
        key = None if parent is None else parent.id
        level = self._levels.get(key)
        if level is None:
            level = _Level()
            for term in await repository.children_of(
                self._db, self._workspace_id, self._vocabulary.id, key
            ):
                level.add(term)
            self._levels[key] = level
        return level

    async def _insert(
        self,
        parent: TermRecord | None,
        level: _Level,
        name: str,
        slug: str | None,
        description: str | None,
    ) -> TermRecord:
        if slug is None:
            slug = free_slug(slugify(name), level.slugs)
        elif slug in level.slugs:
            raise _sibling_slug()
        term = await repository.insert_term(
            self._db,
            workspace_id=self._workspace_id,
            vocabulary_id=self._vocabulary.id,
            parent_id=None if parent is None else parent.id,
            name=name,
            slug=slug,
            path=slug if parent is None else f"{parent.path}/{slug}",
            description=description,
        )
        level.add(term)
        self._levels[term.id] = _Level()
        self.created.append(term)
        return term
