"""The worker's side of keyword imports, part B (docs/08-seo-keyword-system.md section 3.3; the
imports sub-plan, rule I8): writing a confirmed import in batches of at most 1,000 parts.

A tick claims the oldest import in `writing` (FOR UPDATE SKIP LOCKED, so two workers never write
one import, and the API's changes to it wait), takes its next pending parts, writes them in one
transaction, and records what became of each part. A crash or a restart leaves the parts it had
not recorded pending: the next tick goes on from there. The batch that leaves nothing pending
ends the import.

Locks are taken in one order, the order the API's writers take theirs in, so no two can wait on
each other: the import row, the vocabularies the batch files terms under (by id), the project's
groups, the target URLs (by host, then hash), the workspace's quota, and last the tracked
keywords whose links change. Every statement names the workspace, because the worker bypasses
row-level security.
"""

from __future__ import annotations

from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Final
from uuid import UUID

import structlog
from sqlalchemy import bindparam, func, select, tuple_, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.collectors.imports import BROKEN, import_defaults, locations_for
from sightline.db import dictionaries
from sightline.db.tables import keyword_import_rows, keyword_imports, projects, tracked_keywords
from sightline.extraction.urls import CanonicalUrl
from sightline.keywords import links, writer
from sightline.keywords.groups import ensure_group_path, lock_groups
from sightline.keywords.import_rows import Defaults, ParsedRow, RowError, parse_row
from sightline.keywords.terms import VocabularyRef, ensure_term_path, fold, lock_vocabulary
from sightline.keywords.terms import vocabulary_ref as read_vocabulary

_log = structlog.get_logger(__name__)

# What a tracked keyword records as its source, by the import's source.
_SOURCES: Final[Mapping[str, writer.Source]] = {
    "upload": "csv_import",
    "paste": "bulk_paste",
    "api": "api",
}
# Results of parts that were written: their keyword gets the row's group and terms.
_WRITTEN: Final = ("created", "merged")


@dataclass(frozen=True, slots=True)
class WriteReport:
    batches: int = 0
    finished: int = 0  # imports that ended: completed, completed_with_errors or failed

    @property
    def quiet(self) -> bool:
        return self == WriteReport()


@dataclass(frozen=True, slots=True)
class _Import:
    id: UUID
    workspace_id: UUID
    project_id: UUID
    source: str
    created_by: UUID
    mapping: dict[str, str]
    defaults: dict[str, Any]
    counts: dict[str, int]


@dataclass(slots=True, eq=False)
class _Part:
    """One row of the preview as the write sees it, and what became of it."""

    row_no: int
    part: int
    raw: dict[str, str]
    keyword_text: str | None
    normalized_text: str | None
    language_code: str | None
    device: str | None
    location_id: int | None
    action: str
    outcome: str
    reason_code: str | None
    existing: UUID | None
    parsed: ParsedRow | None = None
    result: str | None = None
    tracked_id: UUID | None = None
    error: str | None = None

    @property
    def repeated(self) -> bool:
        return self.outcome == "duplicate" and self.reason_code == "repeated_in_file"

    @property
    def reads_again(self) -> bool:
        """The parts to write, and a repeat in the file, whose groups and terms go to the first
        of its kind."""
        return self.action in ("create", "merge") or self.repeated

    def fail(self, code: str) -> None:
        self.result = "failed"
        self.error = code


@dataclass(frozen=True, slots=True)
class _Slot:
    """A term as the one-term-per-single-valued-vocabulary rule sees it."""

    term_id: UUID
    vocabulary_id: UUID
    is_single_valued: bool


type _Identity = tuple[str, str, int, str]  # normalized text, language, location, device


async def write_next(
    sessions: async_sessionmaker[AsyncSession],
    *,
    batch_limit: int = 5,
    batch_size: int = writer.WRITE_MAX,
) -> WriteReport:
    """Write up to `batch_limit` batches of the oldest imports in `writing`, each in its own
    transaction. The batch that finds nothing pending ends its import."""
    size = min(batch_size, writer.WRITE_MAX)
    batches = finished = 0
    for _ in range(batch_limit):
        imp: _Import | None = None
        try:
            async with sessions() as db, db.begin():
                imp = await _claim(db)
                if imp is None:
                    break
                ended = await _batch(db, imp, size)
        except BROKEN:
            if imp is None:
                raise
            # The batch is rolled back, and would break the same way on every tick, ahead of
            # every other import: the import ends here, with what earlier batches wrote.
            _log.exception("import could not be written", import_id=str(imp.id))
            async with sessions() as db, db.begin():
                await _end(db, imp, "failed", error_code="write_failed")
            ended = True
        batches += 1
        finished += ended
    return WriteReport(batches=batches, finished=finished)


async def _batch(db: AsyncSession, imp: _Import, size: int) -> bool:
    """One batch of the claimed import: whether the import ended."""
    project = (
        await db.execute(
            select(
                projects.c.default_location_id,
                projects.c.default_language_code,
                projects.c.settings,
            ).where(
                projects.c.workspace_id == imp.workspace_id,
                projects.c.id == imp.project_id,
                projects.c.deleted_at.is_(None),
            )
        )
    ).one_or_none()
    if project is None:
        await _end(db, imp, "failed", error_code="project_gone")
        return True
    parts = await _pending(db, imp, size)
    if parts:
        try:
            await _write(db, imp, project, parts)
        except writer.ProjectGoneError:
            await _end(db, imp, "failed", error_code="project_gone")
            return True
        await _record(db, imp, parts)
    if await _remaining(db, imp) == 0:
        await _finish(db, imp)
        return True
    return False


async def _claim(db: AsyncSession) -> _Import | None:
    i = keyword_imports.c
    row = (
        await db.execute(
            select(
                i.id,
                i.workspace_id,
                i.project_id,
                i.source,
                i.created_by,
                i.column_mapping,
                i.defaults,
                i.counts,
            )
            .where(i.status == "writing")
            .order_by(i.created_at, i.id)
            .limit(1)
            .with_for_update(skip_locked=True)
        )
    ).one_or_none()
    if row is None:
        return None
    return _Import(
        id=row.id,
        workspace_id=row.workspace_id,
        project_id=row.project_id,
        source=row.source,
        created_by=row.created_by,
        mapping={str(header): str(name) for header, name in (row.column_mapping or {}).items()},
        defaults=dict(row.defaults or {}),
        counts={str(name): int(count) for name, count in (row.counts or {}).items()},
    )


async def _pending(db: AsyncSession, imp: _Import, size: int) -> list[_Part]:
    r = keyword_import_rows.c
    rows = await db.execute(
        select(
            r.row_no,
            r.part,
            r.raw,
            r.keyword_text,
            r.normalized_text,
            r.language_code,
            r.device,
            r.location_id,
            r.action,
            r.outcome,
            r.reason_code,
            r.existing_tracked_keyword_id,
        )
        .where(r.workspace_id == imp.workspace_id, r.import_id == imp.id, r.result.is_(None))
        .order_by(r.row_no, r.part)
        .limit(size)
    )
    return [
        _Part(
            row_no=row.row_no,
            part=row.part,
            raw={str(header): str(cell) for header, cell in (row.raw or {}).items()},
            keyword_text=row.keyword_text,
            normalized_text=row.normalized_text,
            language_code=row.language_code,
            device=row.device,
            location_id=row.location_id,
            action=row.action,
            outcome=row.outcome,
            reason_code=row.reason_code,
            existing=row.existing_tracked_keyword_id,
        )
        for row in rows
    ]


async def _remaining(db: AsyncSession, imp: _Import) -> int:
    r = keyword_import_rows.c
    left: int = (
        await db.execute(
            select(func.count()).where(
                r.workspace_id == imp.workspace_id, r.import_id == imp.id, r.result.is_(None)
            )
        )
    ).scalar_one()
    return left


async def _write(db: AsyncSession, imp: _Import, project: Any, parts: Sequence[_Part]) -> None:
    """Write the batch and set `result` on every part of it."""
    defaults = import_defaults(imp.defaults, project)
    seo = (project.settings or {}).get("seo") or {}
    await _read_again(db, imp, defaults, parts)
    for part in parts:
        if part.result is None and part.action == "skip":
            part.result = "skipped"
        elif part.result is None and part.action not in ("create", "merge"):
            part.fail("action_not_supported")
    creates = [p for p in parts if p.result is None and p.action == "create"]
    merges = [p for p in parts if p.result is None and p.action == "merge"]
    filing = [p.parsed for p in parts if p.parsed is not None and (p.repeated or p.result is None)]

    tags_ref, topic_ref = await _lock_vocabularies(db, imp, defaults, filing)
    if any(parsed.group_path for parsed in filing):
        await lock_groups(db, imp.project_id)
    targets = await _target_urls(db, [p.parsed.target for p in creates if p.parsed is not None])
    now: datetime = (await db.execute(select(func.now()))).scalar_one()

    restored = await _create(
        db, imp, creates, targets, str(seo.get("default_frequency") or "daily"), now
    )
    await _merge(db, imp, merges, now)
    await _file(db, imp, parts, restored, tags_ref, topic_ref)


async def _read_again(
    db: AsyncSession, imp: _Import, defaults: Defaults, parts: Sequence[_Part]
) -> None:
    """Check the fields the preview did not keep (priority, depth profile, intent, funnel
    stage, target, group, tags, topic) from each part's source row. A part to write that no
    longer reads, for example a location deactivated since the preview, is not written."""
    reading = [part for part in parts if part.reads_again]
    cells = [
        {name: part.raw[header] for header, name in imp.mapping.items() if header in part.raw}
        for part in reading
    ]
    place = await locations_for(db, cells, defaults.location_id)
    for part, fields in zip(reading, cells, strict=True):
        parsed = parse_row(fields, defaults, place, raw=part.raw)
        if isinstance(parsed, RowError):
            # A repeat only adds extras: it is skipped either way.
            if not part.repeated:
                part.fail(parsed.code)
            continue
        part.parsed = parsed


async def _lock_vocabularies(
    db: AsyncSession, imp: _Import, defaults: Defaults, filing: Sequence[ParsedRow]
) -> tuple[VocabularyRef | None, VocabularyRef | None]:
    """The vocabularies the batch files terms under, locked in id order and read after the lock;
    None for one the batch does not use or that has been deleted."""
    wanted = {
        vocabulary_id: needed
        for vocabulary_id, needed in (
            (defaults.tags_vocabulary_id, any(parsed.tags for parsed in filing)),
            (defaults.topic_vocabulary_id, any(parsed.topic for parsed in filing)),
        )
        if vocabulary_id is not None and needed
    }
    for vocabulary_id in sorted(wanted, key=str):
        await lock_vocabulary(db, vocabulary_id)

    async def read(vocabulary_id: UUID | None) -> VocabularyRef | None:
        if vocabulary_id is None or vocabulary_id not in wanted:
            return None
        return await read_vocabulary(db, imp.workspace_id, vocabulary_id)

    return await read(defaults.tags_vocabulary_id), await read(defaults.topic_vocabulary_id)


async def _target_urls(db: AsyncSession, given: Sequence[CanonicalUrl | None]) -> dict[bytes, int]:
    """The `core.urls` id of each target URL, by its hash, added in the API's order (host, then
    hash) so two writers adding the same new ones cannot wait on each other."""
    distinct = {url.url_hash: url for url in given if url is not None}
    ordered = sorted(distinct.values(), key=lambda url: (url.host.name, url.url_hash))
    return {url.url_hash: (await dictionaries.url_for(db, url)).id for url in ordered}


async def _create(
    db: AsyncSession,
    imp: _Import,
    creates: Sequence[_Part],
    targets: Mapping[bytes, int],
    frequency: str,
    now: datetime,
) -> set[UUID]:
    """Add the parts to create in one call of the writer, which counts the quota and brings
    back deleted keywords. Returns the tracked keywords it brought back."""
    items: list[writer.NewTrackedKeyword] = []
    sent: list[_Part] = []
    for part in creates:
        parsed = part.parsed
        if (
            parsed is None
            or part.keyword_text is None
            or part.language_code is None
            or part.location_id is None
            or part.device not in ("desktop", "mobile")
        ):
            part.fail("row_incomplete")
            continue
        device: writer.Device = "mobile" if part.device == "mobile" else "desktop"
        items.append(
            writer.NewTrackedKeyword(
                text=part.keyword_text,
                location_id=part.location_id,
                language_code=part.language_code,
                device=device,
                depth_profile=parsed.depth_profile,
                target_url_id=None if parsed.target is None else targets[parsed.target.url_hash],
                intent=parsed.intent,
                intent_source=None if parsed.intent == "unknown" else "manual",
                funnel_stage=parsed.funnel_stage,
                priority=parsed.priority,
                frequency=frequency,
            )
        )
        sent.append(part)
    if not items:
        return set()
    try:
        written = await writer.write_tracked_keywords(
            db,
            workspace_id=imp.workspace_id,
            project_id=imp.project_id,
            items=items,
            source=_SOURCES[imp.source],
            created_by=imp.created_by,
            now=now,
        )
    except writer.QuotaExceededError:
        # Something else took the room since the person confirmed: the batch is not written.
        for part in sent:
            part.fail("quota_exceeded")
        return set()
    restored: set[UUID] = set()
    for entry in written.created:
        part = sent[entry.index]
        part.result, part.tracked_id = "created", entry.tracked_keyword_id
        if entry.restored:
            restored.add(entry.tracked_keyword_id)
    for taken in written.existing:
        # Tracked since the preview: nothing to create, and the row says which keyword.
        part = sent[taken.index]
        part.result, part.tracked_id = "skipped", taken.tracked_keyword_id
    return restored


async def _merge(db: AsyncSession, imp: _Import, merges: Sequence[_Part], now: datetime) -> None:
    """The parts to merge into a tracked keyword the preview found: it must still exist, and
    an archived one is brought back, within the quota, when the preview called it a conflict."""
    if not merges:
        return
    wanted = sorted({part.existing for part in merges if part.existing is not None}, key=str)
    limit, used = await writer.lock_quota(db, imp.workspace_id)
    await links.lock_rows(db, imp.workspace_id, wanted)
    t = tracked_keywords.c
    found = await db.execute(
        select(t.id, t.is_active, t.deleted_at).where(
            t.workspace_id == imp.workspace_id,
            t.project_id == imp.project_id,
            t.id.in_(wanted),
        )
    )
    states = {row.id: (row.is_active, row.deleted_at is not None) for row in found}
    room = limit - used
    revived: set[UUID] = set()
    for part in merges:
        state = None if part.existing is None else states.get(part.existing)
        if part.existing is None or state is None or state[1]:
            part.fail("tracked_keyword_gone")
            continue
        if part.outcome == "conflict" and not state[0] and part.existing not in revived:
            if room <= 0:
                part.fail("quota_exceeded")
                continue
            room -= 1
            revived.add(part.existing)
        part.result, part.tracked_id = "merged", part.existing
    if revived:
        await db.execute(
            update(tracked_keywords)
            .where(t.workspace_id == imp.workspace_id, t.id.in_(sorted(revived, key=str)))
            .values(is_active=True, updated_at=now)
        )


async def _file(
    db: AsyncSession,
    imp: _Import,
    parts: Sequence[_Part],
    restored: Collection[UUID],
    tags_ref: VocabularyRef | None,
    topic_ref: VocabularyRef | None,
) -> None:
    """File the written keywords under the groups and terms their rows name, and the first
    keyword of a repeat in the file under the groups and terms of the repeat."""
    filing: list[tuple[UUID, ParsedRow]] = [
        (part.tracked_id, part.parsed)
        for part in parts
        if part.result in _WRITTEN and part.tracked_id is not None and part.parsed is not None
    ]
    firsts = {_identity(part): part.tracked_id for part in parts if part.result in _WRITTEN}
    repeats = [part for part in parts if part.repeated and _identity(part) is not None]
    earlier = await _earlier_firsts(
        db, imp, {i for part in repeats if (i := _identity(part)) is not None and i not in firsts}
    )
    for part in repeats:
        identity = _identity(part)
        target = firsts.get(identity) or earlier.get(identity) if identity is not None else None
        part.tracked_id = target
        if target is not None and part.parsed is not None:
            filing.append((target, part.parsed))
    if not filing:
        return
    tracked_ids = sorted({tracked_id for tracked_id, _ in filing}, key=str)
    await links.lock_rows(db, imp.workspace_id, tracked_ids)
    held = await links.terms_of(db, imp.workspace_id, tracked_ids)
    have: dict[UUID, list[links.TermSlot]] = {}
    for tracked_id in tracked_ids:
        stored = held.get(tracked_id, [])
        if tracked_id in restored:
            # A vocabulary that became single-valued while the keyword was deleted keeps its
            # first term in path order, as when the API brings a keyword back.
            stored, surplus = links.one_per_single_valued_vocabulary(stored)
            if surplus:
                await links.remove_terms(db, imp.workspace_id, [tracked_id], surplus)
        have[tracked_id] = list(stored)

    groups: dict[tuple[str, ...], UUID] = {}
    members: set[tuple[UUID, UUID]] = set()
    for tracked_id, parsed in filing:
        if not parsed.group_path:
            continue
        if parsed.group_path not in groups:
            groups[parsed.group_path] = await ensure_group_path(
                db,
                workspace_id=imp.workspace_id,
                project_id=imp.project_id,
                names=parsed.group_path,
            )
        members.add((groups[parsed.group_path], tracked_id))
    await links.add_members(
        db, workspace_id=imp.workspace_id, project_id=imp.project_id, pairs=members
    )

    slots: dict[tuple[UUID, tuple[str, ...]], _Slot] = {}

    async def term(vocabulary: VocabularyRef, names: tuple[str, ...]) -> _Slot:
        key = (vocabulary.id, tuple(fold(name) for name in names))
        if key not in slots:
            term_id = await ensure_term_path(
                db, workspace_id=imp.workspace_id, vocabulary=vocabulary, names=names
            )
            slots[key] = _Slot(term_id, vocabulary.id, vocabulary.is_single_valued)
        return slots[key]

    assigned: set[tuple[UUID, UUID]] = set()
    for tracked_id, parsed in filing:
        wanted: list[_Slot] = []
        if tags_ref is not None:
            wanted.extend([await term(tags_ref, (tag,)) for tag in parsed.tags])
        # A flat vocabulary has no paths: a topic of several names does not fit it.
        if (
            topic_ref is not None
            and parsed.topic
            and (topic_ref.is_hierarchical or len(parsed.topic) == 1)
        ):
            wanted.append(await term(topic_ref, parsed.topic))
        for slot in links.terms_to_add(have[tracked_id], wanted):
            assigned.add((tracked_id, slot.term_id))
            have[tracked_id].append(slot)
    await links.add_terms(db, workspace_id=imp.workspace_id, pairs=assigned, assigned_by="import")


def _identity(part: _Part) -> _Identity | None:
    if (
        part.normalized_text is None
        or part.language_code is None
        or part.location_id is None
        or part.device is None
    ):
        return None
    return (part.normalized_text, part.language_code, part.location_id, part.device)


async def _earlier_firsts(
    db: AsyncSession, imp: _Import, identities: Collection[_Identity]
) -> dict[_Identity, UUID]:
    """The keyword written for the first row of each identity, when an earlier batch wrote it."""
    if not identities:
        return {}
    r = keyword_import_rows.c
    rows = await db.execute(
        select(
            r.normalized_text, r.language_code, r.location_id, r.device, r.tracked_keyword_id
        ).where(
            r.workspace_id == imp.workspace_id,
            r.import_id == imp.id,
            r.result.in_(_WRITTEN),
            r.tracked_keyword_id.is_not(None),
            tuple_(r.normalized_text, r.language_code, r.location_id, r.device).in_(
                sorted(identities)
            ),
        )
    )
    return {
        (
            row.normalized_text,
            row.language_code,
            row.location_id,
            row.device,
        ): row.tracked_keyword_id
        for row in rows
    }


async def _record(db: AsyncSession, imp: _Import, parts: Sequence[_Part]) -> None:
    """What became of each part of the batch."""
    for part in parts:
        if part.result is None:  # pragma: no cover - every branch above gives a result
            part.fail("not_written")
    r = keyword_import_rows.c
    await db.execute(
        update(keyword_import_rows)
        .where(
            r.workspace_id == bindparam("b_workspace"),
            r.import_id == bindparam("b_import"),
            r.row_no == bindparam("b_row"),
            r.part == bindparam("b_part"),
        )
        .values(
            result=bindparam("b_result"),
            tracked_keyword_id=bindparam("b_tracked"),
            write_error_code=bindparam("b_error"),
        ),
        [
            {
                "b_workspace": imp.workspace_id,
                "b_import": imp.id,
                "b_row": part.row_no,
                "b_part": part.part,
                "b_result": part.result,
                "b_tracked": part.tracked_id,
                "b_error": part.error,
            }
            for part in parts
        ],
    )


async def _finish(db: AsyncSession, imp: _Import) -> None:
    """Every part has a result: the counts, and `completed` or `completed_with_errors`."""
    r = keyword_import_rows.c
    found = await db.execute(
        select(r.result, func.count().label("parts"))
        .where(r.workspace_id == imp.workspace_id, r.import_id == imp.id)
        .group_by(r.result)
    )
    by_result = {row.result: row.parts for row in found}
    counts = {
        **imp.counts,
        "created": by_result.get("created", 0),
        "skipped": by_result.get("skipped", 0),
        "merged": by_result.get("merged", 0),
    }
    await _end(
        db,
        imp,
        "completed_with_errors" if by_result.get("failed") else "completed",
        counts=counts,
    )


async def _end(
    db: AsyncSession,
    imp: _Import,
    status: str,
    *,
    error_code: str | None = None,
    counts: Mapping[str, int] | None = None,
) -> None:
    i = keyword_imports.c
    values: dict[str, Any] = {"status": status, "error_code": error_code, "finished_at": func.now()}
    if counts is not None:
        values["counts"] = dict(counts)
    await db.execute(
        update(keyword_imports)
        .where(i.workspace_id == imp.workspace_id, i.id == imp.id)
        .values(**values)
    )
