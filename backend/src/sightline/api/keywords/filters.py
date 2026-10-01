"""The tracked keyword filter and sort (plan decision D15): one parser for the list, the bulk
changes and term assignments.

A filter becomes SQL conditions on `seo.tracked_keywords`, joined to its keyword and to the
keyword's current Labs metrics (`repository.LABS_CURRENT`). A sort becomes ordered components
with the id last, so a page boundary is one row; a metric sorts keywords without one last in
both directions, through a null flag before the value.
"""

from __future__ import annotations

from collections.abc import Collection, Sequence
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Final, Literal
from uuid import UUID

from fastapi.exceptions import RequestValidationError
from sqlalchemy import ColumnElement, Select, and_, case, exists, false, func, literal, or_, select

from sightline.api.keywords.repository import LABS_CURRENT, among_ids
from sightline.api.pagination import KeyValue, invalid_cursor
from sightline.api.schemas.keywords import TrackedKeywordFilter
from sightline.db.tables import (
    keyword_group_members,
    keyword_groups,
    keywords,
    taxonomy_terms,
    tracked_keyword_terms,
    tracked_keywords,
)
from sightline.keywords.text import normalize

SortField = Literal[
    "keyword", "search_volume", "keyword_difficulty", "cpc_usd", "priority", "created_at"
]
SORT_FIELDS: Final[tuple[SortField, ...]] = (
    "keyword",
    "search_volume",
    "keyword_difficulty",
    "cpc_usd",
    "priority",
    "created_at",
)
type Kind = Literal["text", "int", "decimal", "time", "id"]


@dataclass(frozen=True, slots=True)
class SortKey:
    field: SortField
    descending: bool

    def label(self) -> str:
        return f"-{self.field}" if self.descending else self.field


DEFAULT_SORT: Final = (SortKey("keyword", descending=False),)


def _invalid_sort(message: str) -> RequestValidationError:
    return RequestValidationError(
        [{"loc": ("query", "sort"), "type": "invalid_sort", "msg": message}]
    )


def parse_sort(raw: str | None) -> tuple[SortKey, ...]:
    """`keyword` when not given. Each field at most once, `-` for descending."""
    if raw is None:
        return DEFAULT_SORT
    keys: list[SortKey] = []
    for part in raw.split(","):
        descending = part.startswith("-")
        name = part[1:] if descending else part
        field = next((known for known in SORT_FIELDS if known == name), None)
        if field is None:
            raise _invalid_sort(f"Sort by one of: {', '.join(SORT_FIELDS)}.")
        if any(key.field == field for key in keys):
            raise _invalid_sort(f"`{field}` is given twice.")
        keys.append(SortKey(field, descending))
    return tuple(keys)


@dataclass(frozen=True, slots=True)
class TermGroups:
    """`term` resolved: one tuple of terms per vocabulary, and every tuple must match. A term
    that does not exist is a tuple of its own, so it matches nothing."""

    groups: tuple[tuple[UUID, ...], ...]


def term_groups(term_ids: Sequence[UUID], vocabulary_of: dict[UUID, UUID]) -> TermGroups:
    by_vocabulary: dict[UUID, list[UUID]] = {}
    unknown: list[tuple[UUID, ...]] = []
    for term_id in term_ids:
        vocabulary_id = vocabulary_of.get(term_id)
        if vocabulary_id is None:
            unknown.append((term_id,))
        else:
            by_vocabulary.setdefault(vocabulary_id, []).append(term_id)
    return TermGroups((*(tuple(ids) for ids in by_vocabulary.values()), *unknown))


def scope(given: TrackedKeywordFilter) -> dict[str, object]:
    """What a cursor is bound to, besides the sort."""
    return given.model_dump(mode="json")


def _descendants(
    kind: Literal["group", "term"], roots: Collection[UUID], workspace_id: UUID, name: str
) -> Select[tuple[UUID]]:
    """The ids of the given groups or terms and of every one under them, through `parent_id`."""
    table = keyword_groups if kind == "group" else taxonomy_terms
    start = (
        select(table.c.id)
        .where(table.c.workspace_id == workspace_id, among_ids(table.c.id, roots))
        .cte(name=name, recursive=True)
    )
    child = table.alias(f"{name}_child")
    tree = start.union_all(
        select(child.c.id).where(
            child.c.parent_id == start.c.id, child.c.workspace_id == workspace_id
        )
    )
    return select(tree.c.id)


def _has_term_under(roots: Collection[UUID], workspace_id: UUID, name: str) -> ColumnElement[bool]:
    return exists().where(
        tracked_keyword_terms.c.tracked_keyword_id == tracked_keywords.c.id,
        tracked_keyword_terms.c.workspace_id == workspace_id,
        tracked_keyword_terms.c.term_id.in_(_descendants("term", roots, workspace_id, name)),
    )


def chosen(
    *, workspace_id: UUID, project_id: UUID, ids: Collection[UUID]
) -> list[ColumnElement[bool]]:
    """The project's live tracked keywords among `ids`, archived or not."""
    t = tracked_keywords.c
    return [t.workspace_id == workspace_id, t.project_id == project_id, among_ids(t.id, ids)]


def conditions(
    given: TrackedKeywordFilter,
    *,
    workspace_id: UUID,
    project_id: UUID,
    terms: TermGroups,
) -> list[ColumnElement[bool]]:
    """The filter as conditions on the project's live tracked keywords."""
    t = tracked_keywords.c
    found: list[ColumnElement[bool]] = [t.workspace_id == workspace_id, t.project_id == project_id]
    if given.is_active is not None:
        found.append(t.is_active.is_(given.is_active))
    if given.q is not None:
        found.append(keywords.c.normalized_text.contains(normalize(given.q), autoescape=True))
    if given.group is not None:
        found.append(
            exists().where(
                keyword_group_members.c.tracked_keyword_id == t.id,
                keyword_group_members.c.workspace_id == workspace_id,
                keyword_group_members.c.group_id.in_(
                    _descendants("group", [given.group], workspace_id, "group_tree")
                ),
            )
        )
    for index, group in enumerate(terms.groups):
        found.append(_has_term_under(group, workspace_id, f"term_tree_{index}"))
    if given.term_in is not None:
        found.append(
            _has_term_under(given.term_in, workspace_id, "term_in_tree")
            if given.term_in
            else false()
        )
    equal: tuple[tuple[ColumnElement[Any], object | None], ...] = (
        (t.device, given.device),
        (t.location_id, given.location_id),
        (t.language_code, given.language_code),
        (t.search_engine, given.search_engine),
    )
    for column, value in equal:
        if value is not None:
            found.append(column == value)
    among: tuple[tuple[ColumnElement[Any], Sequence[str] | None], ...] = (
        (t.intent, given.intent_in),
        (t.funnel_stage, given.funnel_stage_in),
        (t.source, given.source_in),
        (t.depth_profile, given.depth_profile_in),
    )
    for column, values in among:
        if values is not None:
            found.append(column.in_(list(values)))
    if given.priority_lte is not None:
        found.append(t.priority <= given.priority_lte)
    if given.search_volume_gte is not None:
        found.append(LABS_CURRENT.c.search_volume >= given.search_volume_gte)
    if given.keyword_difficulty_lte is not None:
        found.append(LABS_CURRENT.c.keyword_difficulty <= given.keyword_difficulty_lte)
    return found


@dataclass(frozen=True, slots=True)
class Component:
    """One ordered value of a sort: a null flag, a value, or the id that ends every sort."""

    expression: ColumnElement[Any]
    descending: bool
    kind: Kind


def _sorted_column(field: SortField) -> tuple[ColumnElement[Any], Kind, bool]:
    """The column, its kind and whether it may be null (a metric)."""
    t = tracked_keywords.c
    match field:
        case "keyword":
            return keywords.c.normalized_text, "text", False
        case "search_volume":
            return LABS_CURRENT.c.search_volume, "int", True
        case "keyword_difficulty":
            return LABS_CURRENT.c.keyword_difficulty, "int", True
        case "cpc_usd":
            return LABS_CURRENT.c.cpc_usd, "decimal", True
        case "priority":
            return t.priority, "int", False
        case "created_at":
            return t.created_at, "time", False


def components(keys: Sequence[SortKey]) -> list[Component]:
    found: list[Component] = []
    for key in keys:
        column, kind, nullable = _sorted_column(key.field)
        if nullable:
            # Nulls last both ways: the flag sorts ascending whatever the direction, and a null's
            # value is a constant, so rows without the metric compare equal on it.
            found.append(Component(case((column.is_(None), 1), else_=0), False, "int"))
            column = func.coalesce(column, 0)
        found.append(Component(column, key.descending, kind))
    found.append(Component(tracked_keywords.c.id, False, "id"))
    return found


def order_by(parts: Sequence[Component]) -> list[ColumnElement[Any]]:
    return [part.expression.desc() if part.descending else part.expression.asc() for part in parts]


def after(parts: Sequence[Component], values: Sequence[object]) -> ColumnElement[bool]:
    """Rows that come after the row whose components had these values."""
    bound = [
        literal(value, type_=part.expression.type)
        for part, value in zip(parts, values, strict=True)
    ]
    alternatives = []
    for index, part in enumerate(parts):
        beyond = (
            part.expression < bound[index] if part.descending else part.expression > bound[index]
        )
        equal = [earlier.expression == bound[n] for n, earlier in enumerate(parts[:index])]
        alternatives.append(and_(*equal, beyond))
    return or_(*alternatives)


def encode_key(parts: Sequence[Component], values: Sequence[object]) -> list[KeyValue]:
    """A row's component values as a cursor holds them: integers, or text."""
    encoded: list[KeyValue] = []
    for part, value in zip(parts, values, strict=True):
        if part.kind == "int" and isinstance(value, int):
            encoded.append(value)
        elif isinstance(value, datetime):
            encoded.append(value.isoformat())
        else:
            encoded.append(str(value))
    return encoded


def decode_key(parts: Sequence[Component], key: Sequence[KeyValue]) -> list[object]:
    """The values `encode_key` stored, typed again. `400 invalid_cursor` for anything else."""
    if len(key) != len(parts):
        raise invalid_cursor()
    return [_decode(part.kind, value) for part, value in zip(parts, key, strict=True)]


def _decode(kind: Kind, value: KeyValue) -> object:
    if kind in ("int", "text"):
        if isinstance(value, int) != (kind == "int"):
            raise invalid_cursor()
        return value
    try:
        match kind:
            case "decimal":
                return Decimal(str(value))
            case "time":
                parsed = datetime.fromisoformat(str(value))
                if parsed.tzinfo is None:
                    raise invalid_cursor()
                return parsed
            case _:
                return UUID(str(value))
    except (InvalidOperation, ValueError):
        raise invalid_cursor() from None
