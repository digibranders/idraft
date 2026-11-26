"""The mentions of a page note (spec 9.8.1): which entries are kept, whether each target is real
for this workspace and project, and the path a page chip shows. The server reads ids and text and
nothing else; a label is stored as text and never interpreted."""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Iterable, Sequence
from typing import Any, TypedDict
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.api.internal_links.mention_sources import IssueChecks
from idraft.api.problems import FieldError, invalid_fields
from idraft.api.schemas.page_notes import PageNoteMentionIn
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.tables import crawl_pages, crawl_runs, keywords, memberships, tracked_keywords, urls

_BIGINT_DIGITS = 18


class StoredMention(TypedDict):
    type: str
    label: str
    target: str


type Entry = tuple[int, StoredMention]
type Found = list[tuple[int, FieldError]]


def _in_text(body: str, entries: Iterable[Entry]) -> list[Entry]:
    """The entries whose label is in the text; of two with one label, the first."""
    labels: set[str] = set()
    kept: list[Entry] = []
    for index, mention in entries:
        if mention["label"] in body and mention["label"] not in labels:
            labels.add(mention["label"])
            kept.append((index, mention))
    return kept


def stored_in_text(body: str, stored: Sequence[StoredMention]) -> list[StoredMention]:
    """What a change that sends no `mentions` keeps: the stored entries still in the text. They
    are not judged again, so a note stays editable after a teammate leaves."""
    return [mention for _, mention in _in_text(body, enumerate(stored))]


def _field(index: int, name: str, code: str, message: str) -> tuple[int, FieldError]:
    return index, FieldError(f"mentions[{index}].{name}", code, message)


def _unknown(index: int, what: str) -> tuple[int, FieldError]:
    return _field(
        index, "target", "mention_target_unknown", f"This {what} cannot be mentioned here."
    )


async def _judge[T](
    entries: Sequence[Entry],
    parse: Callable[[str], T | None],
    lookup: Callable[[set[T]], Awaitable[set[T]]],
    what: str,
) -> Found:
    found: Found = []
    parsed: dict[int, T] = {}
    for index, mention in entries:
        value = parse(mention["target"])
        if value is None:
            found.append(
                _field(index, "target", "invalid_target", f"A {what} target is malformed.")
            )
        else:
            parsed[index] = value
    if parsed:
        real = await lookup(set(parsed.values()))
        found += [_unknown(index, what) for index, value in parsed.items() if value not in real]
    return found


def _url_id(target: str) -> int | None:
    digits = target.isascii() and target.isdigit() and len(target) <= _BIGINT_DIGITS
    return int(target) if digits else None


def _user_id(target: str) -> UUID | None:
    try:
        return UUID(target)
    except ValueError:
        return None


def _text(target: str) -> str | None:
    return target


async def check_mentions(
    db: AsyncSession,
    access: WorkspaceAccess,
    project_id: UUID,
    body: str,
    mentions: Sequence[PageNoteMentionIn],
    issues: IssueChecks,
) -> list[StoredMention]:
    """The entries to store: those whose label is in `body`, each judged by its type with one
    statement per type. `422` names every entry that fails, by its place in `mentions`."""
    entries = _in_text(
        body,
        (
            (index, StoredMention(type=item.type, label=item.label, target=item.target))
            for index, item in enumerate(mentions)
        ),
    )

    def of(kind: str) -> list[Entry]:
        return [entry for entry in entries if entry[1]["type"] == kind]

    async def pages(ids: set[int]) -> set[int]:
        rows = await db.execute(
            select(crawl_pages.c.url_id)
            .join(
                crawl_runs,
                (crawl_runs.c.id == crawl_pages.c.run_id)
                & (crawl_runs.c.workspace_id == crawl_pages.c.workspace_id),
            )
            .where(
                crawl_pages.c.workspace_id == access.workspace_id,
                crawl_runs.c.project_id == project_id,
                crawl_pages.c.url_id.in_(ids),
            )
            .distinct()
        )
        return {row.url_id for row in rows}

    async def users(ids: set[UUID]) -> set[UUID]:
        rows = await db.execute(
            select(memberships.c.user_id).where(
                memberships.c.workspace_id == access.workspace_id, memberships.c.user_id.in_(ids)
            )
        )
        return {row.user_id for row in rows}

    async def tracked(texts: set[str]) -> set[str]:
        rows = await db.execute(
            select(keywords.c.text)
            .join(
                tracked_keywords,
                (tracked_keywords.c.keyword_id == keywords.c.id)
                & (tracked_keywords.c.workspace_id == keywords.c.workspace_id),
            )
            .where(
                tracked_keywords.c.workspace_id == access.workspace_id,
                tracked_keywords.c.project_id == project_id,
                tracked_keywords.c.is_active.is_(True),
                tracked_keywords.c.deleted_at.is_(None),
                keywords.c.text.in_(texts),
            )
            .distinct()
        )
        return {row.text for row in rows}

    found: Found = [
        *await _judge(of("page"), _url_id, pages, "page"),
        *await _judge(of("user"), _user_id, users, "teammate"),
        *await _judge(of("keyword"), _text, tracked, "keyword"),
    ]
    issue_entries = of("issue")
    if issue_entries:
        known = await issues.known({mention["target"] for _, mention in issue_entries})
        for index, mention in issue_entries:
            if known is None:
                message = "Issues cannot be mentioned yet."
                found.append(_field(index, "type", "mention_type_unavailable", message))
            elif mention["target"] not in known:
                found.append(_unknown(index, "issue"))
    if found:
        raise invalid_fields([error for _, error in sorted(found, key=lambda pair: pair[0])])
    return [mention for _, mention in entries]


async def paths_of(db: AsyncSession, mentions: Iterable[StoredMention]) -> dict[str, str]:
    """The current path of each page mentioned, by target, in one statement. A `core.urls` row is
    never deleted, so an address that was redirected still resolves."""
    ids = {
        value
        for mention in mentions
        if mention["type"] == "page" and (value := _url_id(mention["target"])) is not None
    }
    if not ids:
        return {}
    rows = await db.execute(select(urls.c.id, urls.c.path).where(urls.c.id.in_(ids)))
    return {str(row.id): row.path for row in rows}


def of_row(raw: Any) -> list[StoredMention]:
    """The stored list as the column holds it."""
    return [StoredMention(type=m["type"], label=m["label"], target=m["target"]) for m in raw]


def as_snapshot(mentions: Sequence[StoredMention]) -> list[dict[str, str]]:
    """The list as an audit entry records it."""
    return [{"type": m["type"], "label": m["label"], "target": m["target"]} for m in mentions]
