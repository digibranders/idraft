"""Reads of the stored rank checks that the Cannibalization rules need (docs/33 section 3.1).

Nothing here writes and nothing calls a provider: the history of which own page ranked is in
`seo.domain_rank_observations` (own entities, `all_organic_ranks` and `all_url_ids`).
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Literal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.db.tables import (
    domain_rank_observations as obs,
)
from idraft.db.tables import (
    keyword_group_members,
    keyword_metrics_current,
    keywords,
    tracked_keywords,
    urls,
)
from idraft.keywords.trees import descendants
from idraft.ranks.cannibalization import Check, check_from_observation


@dataclass(frozen=True, slots=True)
class KeywordSeries:
    tracked_keyword_id: UUID
    keyword: str
    volume: int | None
    target_url_id: int | None
    group_ids: tuple[UUID, ...]
    checks: tuple[Check, ...]  # oldest first, one per day; `day` is the date's ordinal


@dataclass(slots=True)
class _Snapshot:
    day: date
    at: datetime
    valid: bool
    depth: int
    ranks: list[int] = field(default_factory=list)
    urls: list[int] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class UrlInfo:
    url_id: int
    url: str
    path: str
    title: str | None


async def load_series(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    project_id: UUID,
    device: Literal["desktop", "mobile"],
    since: date,
    group_id: UUID | None = None,
    tracked_keyword_id: UUID | None = None,
) -> tuple[list[KeywordSeries], dict[int, UrlInfo]]:
    """Active tracked keywords of the project on a device with their checks after `since`
    (exclusive), and the pages those checks name."""
    t = tracked_keywords
    volume = (
        select(func.max(keyword_metrics_current.c.search_volume))
        .where(
            keyword_metrics_current.c.workspace_id == workspace_id,
            keyword_metrics_current.c.keyword_id == t.c.keyword_id,
            keyword_metrics_current.c.location_id == t.c.location_id,
            keyword_metrics_current.c.language_code == t.c.language_code,
        )
        .scalar_subquery()
    )
    query = (
        select(t.c.id, keywords.c.text, volume.label("volume"), t.c.target_url_id)
        .join(
            keywords,
            (keywords.c.id == t.c.keyword_id) & (keywords.c.workspace_id == t.c.workspace_id),
        )
        .where(
            t.c.workspace_id == workspace_id,
            t.c.project_id == project_id,
            t.c.device == device,
            t.c.is_active.is_(True),
            t.c.deleted_at.is_(None),
        )
    )
    if tracked_keyword_id is not None:
        query = query.where(t.c.id == tracked_keyword_id)
    if group_id is not None:
        query = query.where(
            t.c.id.in_(
                select(keyword_group_members.c.tracked_keyword_id).where(
                    keyword_group_members.c.workspace_id == workspace_id,
                    keyword_group_members.c.group_id.in_(
                        descendants("group", [group_id], workspace_id, "cannibalization_groups")
                    ),
                )
            )
        )
    tracked = (await db.execute(query)).all()
    ids = [row.id for row in tracked]
    if not ids:
        return [], {}

    groups: dict[UUID, list[UUID]] = defaultdict(list)
    for member in await db.execute(
        select(keyword_group_members.c.tracked_keyword_id, keyword_group_members.c.group_id).where(
            keyword_group_members.c.workspace_id == workspace_id,
            keyword_group_members.c.tracked_keyword_id.in_(ids),
        )
    ):
        groups[member.tracked_keyword_id].append(member.group_id)

    # One row per own entity per check: several own entities of a check are one own side, and
    # of two checks on one day the later one counts.
    snapshots: dict[tuple[UUID, int], _Snapshot] = {}
    titles: dict[int, str] = {}
    rows = await db.execute(
        select(
            obs.c.tracked_keyword_id,
            obs.c.serp_snapshot_id,
            obs.c.observed_at,
            obs.c.observed_date,
            obs.c.all_organic_ranks,
            obs.c.all_url_ids,
            obs.c.depth_requested,
            obs.c.is_valid,
            obs.c.ranking_url_id,
            obs.c.ranking_title,
        )
        .where(
            obs.c.workspace_id == workspace_id,
            obs.c.project_id == project_id,
            obs.c.role == "own",
            obs.c.tracked_keyword_id.in_(ids),
            obs.c.observed_date > since,
        )
        .order_by(obs.c.observed_at)
    )
    for row in rows:
        snap = snapshots.setdefault(
            (row.tracked_keyword_id, row.serp_snapshot_id),
            _Snapshot(row.observed_date, row.observed_at, row.is_valid, row.depth_requested),
        )
        snap.ranks.extend(row.all_organic_ranks)
        snap.urls.extend(row.all_url_ids)
        if row.ranking_url_id is not None and row.ranking_title:
            titles[row.ranking_url_id] = row.ranking_title  # the latest check wins

    latest_of_day: dict[tuple[UUID, date], _Snapshot] = {}
    for (tracked_id, _), snap in sorted(snapshots.items(), key=lambda item: item[1].at):
        latest_of_day[(tracked_id, snap.day)] = snap

    by_keyword: dict[UUID, list[Check]] = defaultdict(list)
    used: set[int] = set()
    for (tracked_id, day), snap in sorted(latest_of_day.items(), key=lambda item: item[0][1]):
        check = check_from_observation(
            day=day.toordinal(),
            is_valid=snap.valid,
            depth_requested=snap.depth,
            ranks=snap.ranks,
            url_ids=snap.urls,
        )
        by_keyword[tracked_id].append(check)
        used.update(page for page, _ in check.ranks)
        used.update(check.grouped)

    infos: dict[int, UrlInfo] = {}
    if used:
        for url in await db.execute(
            select(urls.c.id, urls.c.canonical_url, urls.c.path).where(urls.c.id.in_(used))
        ):
            infos[url.id] = UrlInfo(url.id, url.canonical_url, url.path, titles.get(url.id))

    series = [
        KeywordSeries(
            tracked_keyword_id=row.id,
            keyword=row.text,
            volume=row.volume,
            target_url_id=row.target_url_id,
            group_ids=tuple(groups.get(row.id, ())),
            checks=tuple(by_keyword.get(row.id, ())),
        )
        for row in tracked
    ]
    return series, infos
