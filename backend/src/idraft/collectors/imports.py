"""The worker's side of keyword imports, part A (docs/08-seo-keyword-system.md section 3.3; plan
decisions D11 to D13): reading an uploaded source into the preview, and letting previews
nobody confirmed expire.

The API stores each source in the bucket and records the import as `uploaded`. A tick claims
one at a time (FOR UPDATE SKIP LOCKED), reads the source, checks every row, classifies each
against what the project already tracks, and replaces the import's rows, all in one
transaction: two workers never parse one import, and a crash leaves it `uploaded` for the next
tick. Every statement names the workspace, because the worker bypasses row-level security.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Final, Literal
from uuid import UUID

import structlog
from sqlalchemy import (
    ARRAY,
    Integer,
    Text,
    and_,
    any_,
    delete,
    exists,
    func,
    insert,
    literal,
    or_,
    select,
    update,
)
from sqlalchemy.exc import DataError, DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.db.tables import keyword_import_rows, keyword_imports, locations, projects
from idraft.keywords.import_rows import (
    CELL_MAX,
    Defaults,
    Locations,
    ParsedRow,
    RowError,
    SourceError,
    SourceRow,
    parse_row,
    read_api_rows,
    read_csv,
    read_paste,
    resolve_mapping,
    storable,
)
from idraft.keywords.writer import WRITE_MAX, Device, Identity, keyword_texts, rows_of
from idraft.storage.raw import ObjectStore, RawStorageError, decompress

_log = structlog.get_logger(__name__)

# What the API writes under `kind` in a stored paste or rows source, by the import's source. A
# file is stored as itself, compressed, with no `kind`.
_KIND: Final = {"paste": "paste", "api": "api"}
# A source the bucket will not give back for this long is not the bucket's hiccup any more.
SOURCE_GIVE_UP: Final = timedelta(hours=1)
WAITING_PASSED_OVER: Final = 8
# What an import that cannot be read raises on every try, as opposed to the errors of the
# database or the network, which the next tick may not meet again.
BROKEN: Final = (DataError, IntegrityError, UnicodeError, LookupError, TypeError, ValueError)
# The SQLSTATE classes of an error that repeats: bad data (22), a broken constraint (23), a
# statement or a privilege the database refuses (42), a feature it lacks (0A). Deadlocks (40),
# lost connections (08) and shutdowns (57) are not: the next tick may not meet them.
_PERMANENT_SQLSTATES: Final = ("22", "23", "42", "0A")


def is_broken(error: BaseException) -> bool:
    """Whether trying the same import again would raise the same error, so that it has to end
    instead of holding up every import behind it."""
    if isinstance(error, DBAPIError):
        state = getattr(error.orig, "sqlstate", None)
        return isinstance(error, DataError | IntegrityError) or (
            isinstance(state, str) and state.startswith(_PERMANENT_SQLSTATES)
        )
    return isinstance(error, BROKEN)


# Imports that wait for the user, and expire when nobody answers.
WAITING: Final = ("uploaded", "needs_mapping", "preview_ready")
ROWS_PER_INSERT: Final = 1000
_NUMBER_DIGITS_MAX: Final = 9


@dataclass(frozen=True, slots=True)
class ParseReport:
    parsed: int = 0  # imports that reached a preview or need a mapping
    failed: int = 0
    # Whose source the bucket would not give back this time: tried again on the next tick.
    waiting: int = 0

    @property
    def quiet(self) -> bool:
        return self == ParseReport()


@dataclass(frozen=True, slots=True)
class _Claimed:
    id: UUID
    workspace_id: UUID
    project_id: UUID
    source: str
    key: str | None
    mapping: dict[str, str]
    defaults: dict[str, Any]
    age: timedelta
    # It has been read into a preview before: a person changed it since.
    had_rows: bool


def _chunks[T](items: Sequence[T], size: int) -> Iterator[Sequence[T]]:
    for start in range(0, len(items), size):
        yield items[start : start + size]


async def parse_next(
    sessions: async_sessionmaker[AsyncSession], store: ObjectStore, *, limit: int = 2
) -> ParseReport:
    """Parse up to `limit` uploaded imports, oldest first, each in one transaction. An import
    whose source the bucket will not give back is passed over for this call without using up
    one of the `limit`, so a few of them cannot hold up the imports behind them (at most
    `WAITING_PASSED_OVER` are tried)."""
    parsed = failed = waiting = 0
    skip: set[UUID] = set()
    for _ in range(limit + WAITING_PASSED_OVER):
        if parsed + failed >= limit:
            break
        claimed: _Claimed | None = None
        try:
            async with sessions() as db, db.begin():
                claimed = await _claim(db, skip)
                if claimed is None:
                    break
                try:
                    payload = await _read_source(store, claimed)
                    await _preview(db, claimed, payload)
                except RawStorageError as error:
                    _log.warning(
                        "import source not read", import_id=str(claimed.id), error=str(error)
                    )
                    # One that was read before is not given up on: the bucket is what failed.
                    if claimed.age > SOURCE_GIVE_UP and not claimed.had_rows:
                        await _fail(db, claimed, "source_unreadable")
                        failed += 1
                    else:
                        skip.add(claimed.id)
                        waiting += 1
                except SourceError as error:
                    await _fail(db, claimed, error.code)
                    failed += 1
                except _ProjectGoneError:
                    await _fail(db, claimed, "project_gone")
                    failed += 1
                else:
                    parsed += 1
        except Exception as error:
            if claimed is None or not is_broken(error):
                raise
            # The transaction is rolled back, and the import would break the same way on every
            # tick, ahead of every other import: it ends here.
            _log.exception("import could not be parsed", import_id=str(claimed.id))
            async with sessions() as db, db.begin():
                await _fail(db, claimed, "parse_failed")
            failed += 1
    return ParseReport(parsed=parsed, failed=failed, waiting=waiting)


async def expire_imports(sessions: async_sessionmaker[AsyncSession], *, now: datetime) -> int:
    """Imports waiting for the user (uploaded, needs_mapping, preview_ready) past `expires_at`
    become `expired`. Returns how many."""
    i = keyword_imports.c
    async with sessions() as db, db.begin():
        done = await db.execute(
            update(keyword_imports)
            .where(i.status.in_(WAITING), i.expires_at <= now)
            .values(status="expired", finished_at=now)
            .returning(i.id)
        )
        return len(done.all())


class _ProjectGoneError(Exception):
    """The import's project is deleted."""


async def _claim(db: AsyncSession, skip: set[UUID]) -> _Claimed | None:
    i = keyword_imports.c
    statement = (
        select(
            i.id,
            i.workspace_id,
            i.project_id,
            i.source,
            i.upload_object_key,
            i.column_mapping,
            i.defaults,
            (func.now() - i.created_at).label("age"),
            exists()
            .where(
                keyword_import_rows.c.workspace_id == i.workspace_id,
                keyword_import_rows.c.import_id == i.id,
            )
            .label("had_rows"),
        )
        .where(i.status == "uploaded")
        .order_by(i.created_at, i.id)
        .limit(1)
        .with_for_update(skip_locked=True)
    )
    if skip:
        statement = statement.where(i.id.not_in(skip))
    row = (await db.execute(statement)).one_or_none()
    if row is None:
        return None
    return _Claimed(
        id=row.id,
        workspace_id=row.workspace_id,
        project_id=row.project_id,
        source=row.source,
        key=row.upload_object_key,
        mapping={str(header): str(field) for header, field in (row.column_mapping or {}).items()},
        defaults=dict(row.defaults or {}),
        age=row.age,
        had_rows=row.had_rows,
    )


async def _read_source(store: ObjectStore, imp: _Claimed) -> Mapping[str, Any] | bytes:
    """The stored source: the bytes of the file for an upload, else the JSON of the paste or
    the rows. `RawStorageError` when the bucket does not give it back (tried again later),
    `SourceError` when what it gives back is not a source of this import. The work on a large
    source runs in a thread, so the worker's other ticks go on."""
    if imp.key is None:
        raise SourceError("source_corrupt", "The import has no stored source.")
    blob = await store.get(imp.key)
    try:
        body = await asyncio.to_thread(decompress, blob)
        if imp.source == "upload":
            return body
        payload = await asyncio.to_thread(json.loads, body)
    except (RawStorageError, ValueError):
        raise SourceError("source_corrupt", "The stored source cannot be read.") from None
    if not isinstance(payload, dict) or payload.get("kind") != _KIND.get(imp.source):
        raise SourceError("source_corrupt", "The stored source is not this import's.")
    return payload


def _read_rows(
    imp: _Claimed, payload: Mapping[str, Any] | bytes
) -> tuple[list[str], list[SourceRow]]:
    try:
        if isinstance(payload, bytes):
            return read_csv(payload)
        if imp.source == "api":
            return read_api_rows(payload["rows"])
        rows = read_paste(str(payload["text"]))
    except (KeyError, TypeError, AttributeError):
        raise SourceError("source_corrupt", "The stored source is damaged.") from None
    # A paste has the headers its lines use: the keyword, and tags when a line has them.
    return ["keyword", "tags"] if any("tags" in row.cells for row in rows) else ["keyword"], rows


def _names(path: object) -> tuple[str, ...]:
    return tuple(name.strip() for name in str(path).split("/")) if path else ()


def import_defaults(given: Mapping[str, Any], project: Any) -> Defaults:
    """The import's defaults over the project's own (the parse and the write read rows alike)."""
    seo = (project.settings or {}).get("seo") or {}

    def vocabulary(name: str) -> UUID | None:
        value = given.get(name)
        return None if value is None else UUID(str(value))

    return Defaults(
        location_id=given.get("location_id") or project.default_location_id,
        language_code=given.get("language_code") or project.default_language_code,
        device=given.get("device") or seo.get("default_device") or "desktop",
        priority=given.get("priority") or 3,
        depth_profile=given.get("depth_profile") or seo.get("default_depth_profile") or "standard",
        group_path=_names(given.get("group_path")),
        tags_vocabulary_id=vocabulary("tags_vocabulary_id"),
        topic_vocabulary_id=vocabulary("topic_vocabulary_id"),
    )


def _missing(fields: set[str], defaults: Defaults) -> str | None:
    """Why the import cannot go on without the user: a code, or None."""
    if "keyword" not in fields:
        return "keyword_column_missing"
    if "tags" in fields and defaults.tags_vocabulary_id is None:
        return "tags_vocabulary_missing"
    if "topic" in fields and defaults.topic_vocabulary_id is None:
        return "topic_vocabulary_missing"
    return None


async def locations_for(
    db: AsyncSession, cells: Sequence[Mapping[str, str]], default_location: int | None
) -> Locations:
    """The active locations the rows (and the default) name, and no others."""
    ids: set[int] = set() if default_location is None else {default_location}
    names: set[str] = set()
    countries: set[str] = set()
    for row in cells:
        location = row.get("location", "").strip()
        if location.isascii() and location.isdigit():
            if len(location) <= _NUMBER_DIGITS_MAX:
                ids.add(int(location))
        elif location:
            names.add(location.lower())
        country = row.get("country", "").strip()
        if len(country) == 2 and country.isascii() and country.isalpha():
            countries.add(country.upper())
    loc = locations.c
    found = await db.execute(
        select(loc.id, loc.name, loc.country_iso, loc.location_type).where(
            loc.is_active,
            or_(
                loc.id == any_(literal(sorted(ids), type_=ARRAY(Integer))),
                func.lower(loc.name) == any_(literal(sorted(names), type_=ARRAY(Text))),
                and_(
                    loc.location_type == "Country",
                    func.upper(loc.country_iso)
                    == any_(literal(sorted(countries), type_=ARRAY(Text))),
                ),
            ),
        )
    )
    active: set[int] = set()
    by_country: dict[str, int] = {}
    by_name: dict[str, int | None] = {}
    for place in found:
        active.add(place.id)
        if place.location_type == "Country":
            by_country[str(place.country_iso).upper()] = place.id
        lowered = str(place.name).lower()
        if lowered in names:
            # Two locations with one name: a name that cannot say which.
            by_name[lowered] = None if lowered in by_name else place.id
    return Locations(frozenset(active), by_country, by_name)


@dataclass(frozen=True, slots=True)
class _Valid:
    row_no: int
    part: int
    raw: dict[str, str]
    text: str
    normalized: str
    language: str
    device: Device
    location_id: int


@dataclass(frozen=True, slots=True)
class _Invalid:
    row_no: int
    raw: dict[str, str]
    keyword: str | None
    error: RowError


async def _preview(db: AsyncSession, imp: _Claimed, payload: Mapping[str, Any] | bytes) -> None:
    """Replace the import's rows with the preview of its source, or ask for a mapping."""
    headers, source_rows = await asyncio.to_thread(_read_rows, imp, payload)
    mapping = (
        {header: header for header in headers}
        if imp.source == "paste"
        else resolve_mapping(headers, imp.mapping)
    )
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
        raise _ProjectGoneError
    defaults = import_defaults(imp.defaults, project)
    await db.execute(
        delete(keyword_import_rows).where(
            keyword_import_rows.c.workspace_id == imp.workspace_id,
            keyword_import_rows.c.import_id == imp.id,
        )
    )
    needs = _missing(set(mapping.values()), defaults)
    if needs is not None:
        await _update(db, imp, status="needs_mapping", error_code=needs, mapping=mapping, counts={})
        return

    fields = [
        {field: row.cells[header] for header, field in mapping.items() if header in row.cells}
        for row in source_rows
    ]
    place = await locations_for(db, fields, defaults.location_id)
    entries: list[_Valid | _Invalid] = []
    for source_row, cells in zip(source_rows, fields, strict=True):
        parsed = parse_row(cells, defaults, place, raw=source_row.cells)
        if isinstance(parsed, RowError):
            typed = cells.get("keyword", "").strip()[:CELL_MAX]
            entries.append(_Invalid(source_row.row_no, source_row.cells, typed or None, parsed))
            continue
        for part, device in enumerate(parsed.devices, start=1):
            entries.append(_valid(source_row, parsed, part, device))

    rows, counts = await _classify(db, imp, entries)
    for chunk in _chunks(rows, ROWS_PER_INSERT):
        await db.execute(insert(keyword_import_rows).values(list(chunk)))
    await _update(db, imp, status="preview_ready", error_code=None, mapping=mapping, counts=counts)


def _valid(source_row: SourceRow, parsed: ParsedRow, part: int, device: Device) -> _Valid:
    return _Valid(
        row_no=source_row.row_no,
        part=part,
        raw=source_row.cells,
        text=parsed.text,
        normalized=parsed.normalized,
        language=parsed.language_code,
        device=device,
        location_id=parsed.location_id,
    )


async def _classify(
    db: AsyncSession, imp: _Claimed, entries: Sequence[_Valid | _Invalid]
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """Each part's outcome and default action (the sub-plan's rule I6), against what the
    workspace and the project already hold."""
    valid = [item for item in entries if isinstance(item, _Valid)]
    wanted = sorted({(item.normalized, item.language) for item in valid})
    known: dict[tuple[str, str], tuple[UUID, str]] = {}
    for keys in _chunks(wanted, WRITE_MAX):
        known.update(await keyword_texts(db, imp.workspace_id, keys))
    identities: dict[tuple[str, str, int, str], Identity] = {}
    for item in valid:
        match = known.get((item.normalized, item.language))
        if match is not None:
            identities[(item.normalized, item.language, item.location_id, item.device)] = (
                match[0],
                "google",
                item.location_id,
                item.language,
                item.device,
            )
    stored: dict[Identity, tuple[UUID, bool, bool]] = {}
    for chunk in _chunks(sorted(identities.values(), key=str), WRITE_MAX):
        stored.update(await rows_of(db, imp.workspace_id, imp.project_id, chunk))

    rows: list[dict[str, Any]] = []
    first_of: dict[tuple[str, str, int, str], int] = {}
    for entry in entries:
        if isinstance(entry, _Invalid):
            rows.append(
                _row(
                    imp,
                    entry.row_no,
                    1,
                    entry.raw,
                    keyword_text=entry.keyword,
                    outcome="invalid",
                    reason_code=entry.error.code,
                    reason=entry.error.message,
                    action="skip",
                )
            )
            continue
        identity = (entry.normalized, entry.language, entry.location_id, entry.device)
        details: dict[str, Any] = {
            "keyword_text": entry.text,
            "normalized_text": entry.normalized,
            "language_code": entry.language,
            "device": entry.device,
            "location_id": entry.location_id,
        }
        if identity in first_of:
            rows.append(
                _row(
                    imp,
                    entry.row_no,
                    entry.part,
                    entry.raw,
                    outcome="duplicate",
                    reason_code="repeated_in_file",
                    reason=f"Same as row {first_of[identity]}",
                    action="skip",
                    **details,
                )
            )
            continue
        first_of[identity] = entry.row_no
        keyword = known.get((entry.normalized, entry.language))
        held = None if keyword is None else stored.get(identities[identity])
        if held is not None and not held[2]:
            outcome, code, action = (
                ("duplicate", "tracked", "skip") if held[1] else ("conflict", "archived", "skip")
            )
            rows.append(
                _row(
                    imp,
                    entry.row_no,
                    entry.part,
                    entry.raw,
                    outcome=outcome,
                    reason_code=code,
                    reason="Already tracked." if held[1] else "Tracked, and archived.",
                    action=action,
                    existing_tracked_keyword_id=held[0],
                    **details,
                )
            )
        elif keyword is not None and keyword[1] != entry.text:
            rows.append(
                _row(
                    imp,
                    entry.row_no,
                    entry.part,
                    entry.raw,
                    outcome="variant",
                    reason_code="casing_differs",
                    reason=f'Tracked as "{keyword[1]}"',
                    action="create",
                    **details,
                )
            )
        else:
            rows.append(
                _row(
                    imp,
                    entry.row_no,
                    entry.part,
                    entry.raw,
                    outcome="new",
                    action="create",
                    **details,
                )
            )
    counts = {"rows_total": len(rows)}
    counts.update(dict.fromkeys(("new", "duplicate", "variant", "conflict", "invalid"), 0))
    for row in rows:
        counts[row["outcome"]] += 1
    counts.update({"created": 0, "skipped": 0, "merged": 0})
    return rows, counts


def _row(
    imp: _Claimed,
    row_no: int,
    part: int,
    raw: Mapping[str, str],
    *,
    outcome: str,
    action: str,
    keyword_text: str | None = None,
    normalized_text: str | None = None,
    language_code: str | None = None,
    device: str | None = None,
    location_id: int | None = None,
    reason_code: str | None = None,
    reason: str | None = None,
    existing_tracked_keyword_id: UUID | None = None,
) -> dict[str, Any]:
    return {
        "import_id": imp.id,
        "workspace_id": imp.workspace_id,
        "row_no": row_no,
        "part": part,
        "raw": {storable(header): storable(cell) for header, cell in raw.items()},
        "keyword_text": None if keyword_text is None else storable(keyword_text),
        "normalized_text": normalized_text,
        "language_code": language_code,
        "device": device,
        "location_id": location_id,
        "outcome": outcome,
        "reason_code": reason_code,
        "reason": reason,
        "existing_tracked_keyword_id": existing_tracked_keyword_id,
        "action": action,
    }


async def _update(
    db: AsyncSession,
    imp: _Claimed,
    *,
    status: Literal["preview_ready", "needs_mapping"],
    error_code: str | None,
    mapping: Mapping[str, str],
    counts: Mapping[str, int],
) -> None:
    await db.execute(
        update(keyword_imports)
        .where(keyword_imports.c.workspace_id == imp.workspace_id, keyword_imports.c.id == imp.id)
        .values(
            status=status,
            error_code=error_code,
            column_mapping=dict(mapping),
            counts=dict(counts),
        )
    )


async def _fail(db: AsyncSession, imp: _Claimed, code: str) -> None:
    """The import ends: its rows and counts are dropped, and `code` says why. Only an import
    that is still waiting to be read ends: one a person cancelled meanwhile stays cancelled."""
    _log.warning("import failed", import_id=str(imp.id), code=code)
    ended = await db.execute(
        update(keyword_imports)
        .where(
            keyword_imports.c.workspace_id == imp.workspace_id,
            keyword_imports.c.id == imp.id,
            keyword_imports.c.status == "uploaded",
        )
        .values(status="failed", error_code=code, counts={}, finished_at=func.now())
        .returning(keyword_imports.c.id)
    )
    if ended.first() is not None:
        await db.execute(
            delete(keyword_import_rows).where(
                keyword_import_rows.c.workspace_id == imp.workspace_id,
                keyword_import_rows.c.import_id == imp.id,
            )
        )
