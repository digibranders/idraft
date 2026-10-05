"""Reading an import's source and its rows (docs/08-seo-keyword-system.md section 3; plan
decisions D12 and D13). Pure functions, shared by the worker's parse and its write: no database.

A source is paste text, rows given by the API, or a CSV file. Each becomes `SourceRow`s keyed by
the headers as written; `resolve_mapping` says which header is which field, and `parse_row`
checks one row's fields and fills what it leaves out from the defaults.
"""

from __future__ import annotations

import csv
import io
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Final
from uuid import UUID

from sightline.extraction.urls import CanonicalUrl, canonicalize
from sightline.keywords.groups import NAME_MAX, path_fits
from sightline.keywords.terms import TERM_DEPTH_MAX, fold
from sightline.keywords.text import KeywordRefusedError, check_keyword, normalize
from sightline.keywords.writer import Device

IMPORT_ROWS_MAX: Final = 10_000
CELL_MAX: Final = 2000
FIELDS: Final = frozenset(
    {
        "keyword",
        "country",
        "location",
        "language",
        "device",
        "tags",
        "topic",
        "group",
        "intent",
        "funnel_stage",
        "priority",
        "target_url",
        "depth_profile",
    }
)
DEPTH_PROFILES: Final = frozenset(
    {"light", "standard", "deep", "full", "weekly", "weekly_light", "until_own_match_100"}
)
INTENTS: Final = frozenset(
    {"informational", "navigational", "commercial", "transactional", "local", "unknown"}
)
FUNNEL_STAGES: Final = frozenset({"tofu", "mofu", "bofu", "retention", "unknown"})
# The measurements a device choice makes: `both` is two, desktop then mobile.
_DEVICES: Final[Mapping[str, tuple[Device, ...]]] = {
    "desktop": ("desktop",),
    "mobile": ("mobile",),
    "both": ("desktop", "mobile"),
}
_DELIMITERS: Final = (",", ";", "\t")
_SNIFF_CHARS: Final = 4096
_LANGUAGE: Final = re.compile(r"[a-z]{2}")
_NUMBER: Final = re.compile(r"[0-9]+")
_COUNTRY: Final = re.compile(r"[A-Za-z]{2}")
PRIORITY_RANGE: Final = range(1, 6)


class SourceError(ValueError):
    """A source that cannot be read at all; the import fails with `code`."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True, slots=True)
class SourceRow:
    row_no: int
    # Header as written in the source to cell. A cell longer than `CELL_MAX` is cut just past
    # it: enough to see it is too long, and a huge cell costs nothing to keep.
    cells: dict[str, str]


def _cut(cell: str) -> str:
    return cell[: CELL_MAX + 1]


def _too_many() -> SourceError:
    return SourceError("too_many_rows", f"An import has at most {IMPORT_ROWS_MAX} rows.")


def _blank(cells: Sequence[str]) -> bool:
    return all(not cell.strip() for cell in cells)


def _delimiter(text: str) -> str:
    """The delimiter the header line uses most: comma, semicolon or tab; comma when none."""
    header = text[:_SNIFF_CHARS].split("\n", 1)[0]
    counts = {delimiter: header.count(delimiter) for delimiter in _DELIMITERS}
    best = max(counts.values())
    return next(delimiter for delimiter in _DELIMITERS if counts[delimiter] == best)


def read_csv(data: bytes) -> tuple[list[str], list[SourceRow]]:
    """The headers and the rows of a CSV file (UTF-8, a byte order mark is fine). Row numbers
    count data rows from 1; a blank row keeps its number and makes no row."""
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise SourceError("not_utf8", "The file is not UTF-8 text.") from None
    reader = csv.reader(io.StringIO(text, newline=""), delimiter=_delimiter(text))
    try:
        first = next(reader, None)
        if first is None or _blank(first):
            raise SourceError("no_header", "The file has no header row.")
        headers = [header.strip() for header in first]
        named = [header for header in headers if header]
        if len({header.lower() for header in named}) != len(named):
            raise SourceError(
                "duplicate_headers", "Two columns have the same header, without regard to case."
            )
        rows: list[SourceRow] = []
        for row_no, cells in enumerate(reader, start=1):
            if _blank(cells):
                continue
            if len(rows) >= IMPORT_ROWS_MAX:
                raise _too_many()
            padded = [*cells, *[""] * (len(headers) - len(cells))]
            rows.append(
                SourceRow(
                    row_no,
                    {
                        header: _cut(cell)
                        for header, cell in zip(headers, padded, strict=False)
                        if header
                    },
                )
            )
    except csv.Error:
        raise SourceError("not_csv", "The file is not readable as CSV.") from None
    return named, rows


def read_paste(text: str) -> list[SourceRow]:
    """One keyword per line, and the tags after the first tab. Row numbers are line numbers;
    a blank line keeps its number and makes no row."""
    rows: list[SourceRow] = []
    for row_no, line in enumerate(text.split("\n"), start=1):
        line = line.rstrip("\r")
        if not line.strip():
            continue
        if len(rows) >= IMPORT_ROWS_MAX:
            raise _too_many()
        keyword, tab, tags = line.partition("\t")
        cells = {"keyword": _cut(keyword)}
        if tab and tags.strip():
            cells["tags"] = _cut(tags)
        rows.append(SourceRow(row_no, cells))
    return rows


def read_api_rows(rows: Sequence[Mapping[str, str]]) -> tuple[list[str], list[SourceRow]]:
    """The union of the rows' keys as headers, in order of first appearance. Row numbers count
    the given rows from 1; a row of blank cells keeps its number and makes no row."""
    if len(rows) > IMPORT_ROWS_MAX:
        raise _too_many()
    headers: dict[str, None] = {}
    read: list[SourceRow] = []
    for row_no, given in enumerate(rows, start=1):
        headers.update(dict.fromkeys(given))
        if _blank(list(given.values())):
            continue
        read.append(SourceRow(row_no, {header: _cut(cell) for header, cell in given.items()}))
    return list(headers), read


def resolve_mapping(headers: Sequence[str], given: Mapping[str, str]) -> dict[str, str]:
    """Header to field. A header the user mapped goes to that field; the others to the field
    of their own name, without case and trimmed. Headers that map to nothing are left out, and
    when two headers would take one field the first stays (the user's choices first)."""
    explicit = {key.strip().lower(): str(field) for key, field in given.items()}
    mapping: dict[str, str] = {}
    taken: set[str] = set()
    for header in headers:
        field = explicit.get(header.strip().lower())
        if field in FIELDS and field not in taken:
            assert field is not None  # a member of FIELDS
            mapping[header] = field
            taken.add(field)
    for header in headers:
        if header in mapping:
            continue
        field = header.strip().lower()
        if field in FIELDS and field not in taken:
            mapping[header] = field
            taken.add(field)
    return {header: mapping[header] for header in headers if header in mapping}


@dataclass(frozen=True, slots=True)
class Defaults:
    """What a row leaves out: the import's defaults over the project's."""

    location_id: int | None
    language_code: str | None
    device: str  # desktop, mobile or both
    priority: int
    depth_profile: str
    group_path: tuple[str, ...]
    tags_vocabulary_id: UUID | None
    topic_vocabulary_id: UUID | None


@dataclass(frozen=True, slots=True)
class Locations:
    """The active locations, as a row names them."""

    active_ids: frozenset[int]
    by_country: Mapping[str, int]  # ISO alpha-2 in upper case to the country's location
    by_name: Mapping[str, int | None]  # lower-cased name; None when two locations share it


@dataclass(frozen=True, slots=True)
class ParsedRow:
    text: str
    normalized: str
    location_id: int
    language_code: str
    devices: tuple[Device, ...]
    priority: int
    depth_profile: str
    intent: str
    funnel_stage: str
    target: CanonicalUrl | None
    group_path: tuple[str, ...]
    tags: tuple[str, ...]
    topic: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class RowError:
    code: str
    message: str


def _location(cells: Mapping[str, str], defaults: Defaults, locations: Locations) -> int | RowError:
    unknown = RowError("location_unknown", "No active location has this name, id or country.")
    cell = cells.get("location", "").strip()
    if cell:
        if _NUMBER.fullmatch(cell):
            found = int(cell)
            return found if found in locations.active_ids else unknown
        by_name = locations.by_name.get(cell.lower())
        return unknown if by_name is None else by_name
    country = cells.get("country", "").strip()
    if country:
        if not _COUNTRY.fullmatch(country):
            return unknown
        by_country = locations.by_country.get(country.upper())
        return unknown if by_country is None else by_country
    # A default that has been deactivated since it was chosen is no longer a place to track.
    return defaults.location_id if defaults.location_id in locations.active_ids else unknown


def _path(cell: str, *, depth_max: int) -> tuple[str, ...] | None:
    """A path of names split on `/`, each trimmed; None when it does not fit."""
    names = tuple(name.strip() for name in cell.split("/"))
    if len(names) > depth_max or not path_fits(names):
        return None
    return names


def _tags(cell: str) -> tuple[str, ...] | None:
    seen: dict[str, str] = {}
    for name in (part.strip() for part in cell.split("|")):
        if not name:
            continue
        if len(name) > NAME_MAX:
            return None
        seen.setdefault(fold(name), name)
    return tuple(seen.values())


def parse_row(
    cells: Mapping[str, str],
    defaults: Defaults,
    locations: Locations,
    *,
    raw: Mapping[str, str] | None = None,
) -> ParsedRow | RowError:
    """One row, its cells keyed by field. A blank or missing cell takes its default. The first
    field that fails names the row's reason, in the order: a cell over `CELL_MAX` (in `raw`,
    the whole source row, when given), keyword, location, language, device, priority, depth
    profile, intent, funnel stage, target URL, group, tags, topic."""
    if any(len(cell) > CELL_MAX for cell in (raw if raw is not None else cells).values()):
        return RowError("cell_too_long", f"A cell has at most {CELL_MAX} characters.")
    try:
        text = check_keyword(cells.get("keyword", ""))
    except KeywordRefusedError as refused:
        return RowError(refused.code, str(refused))

    location = _location(cells, defaults, locations)
    if isinstance(location, RowError):
        return location

    language = cells.get("language", "").strip().lower() or defaults.language_code or ""
    if not _LANGUAGE.fullmatch(language):
        return RowError("language_invalid", "A language is two letters, such as en.")

    device = cells.get("device", "").strip().lower() or defaults.device
    devices = _DEVICES.get(device)
    if devices is None:
        return RowError("device_invalid", "A device is desktop, mobile or both.")

    priority_cell = cells.get("priority", "").strip()
    priority = defaults.priority
    if priority_cell:
        if not _NUMBER.fullmatch(priority_cell) or int(priority_cell) not in PRIORITY_RANGE:
            return RowError("priority_invalid", "A priority is a whole number from 1 to 5.")
        priority = int(priority_cell)

    depth_profile = cells.get("depth_profile", "").strip().lower() or defaults.depth_profile
    if depth_profile not in DEPTH_PROFILES:
        return RowError("depth_profile_invalid", "This depth profile does not exist.")

    intent = cells.get("intent", "").strip().lower() or "unknown"
    if intent not in INTENTS:
        return RowError("intent_invalid", "This intent does not exist.")
    funnel_stage = cells.get("funnel_stage", "").strip().lower() or "unknown"
    if funnel_stage not in FUNNEL_STAGES:
        return RowError("funnel_stage_invalid", "This funnel stage does not exist.")

    target: CanonicalUrl | None = None
    target_cell = cells.get("target_url", "").strip()
    if target_cell:
        try:
            target = canonicalize(target_cell)
        except ValueError:
            return RowError("target_url_invalid", "A target URL is a full http or https address.")

    group_path = defaults.group_path
    group_cell = cells.get("group", "").strip()
    if group_cell:
        names = _path(group_cell, depth_max=10)
        if names is None:
            return RowError(
                "group_path_invalid",
                "A group is a path of names (Product/Pricing), at most 10 levels of 100 "
                "characters.",
            )
        group_path = names

    tags = _tags(cells.get("tags", ""))
    if tags is None:
        return RowError("tags_invalid", f"A tag has at most {NAME_MAX} characters.")

    topic: tuple[str, ...] = ()
    topic_cell = cells.get("topic", "").strip()
    if topic_cell:
        names = _path(topic_cell, depth_max=TERM_DEPTH_MAX)
        if names is None:
            return RowError(
                "topic_invalid",
                f"A topic is a path of names (CRM/Startups), at most {TERM_DEPTH_MAX} levels of "
                f"{NAME_MAX} characters.",
            )
        topic = names

    return ParsedRow(
        text=text,
        normalized=normalize(text),
        location_id=location,
        language_code=language,
        devices=devices,
        priority=priority,
        depth_profile=depth_profile,
        intent=intent,
        funnel_stage=funnel_stage,
        target=target,
        group_path=group_path,
        tags=tags,
        topic=topic,
    )
