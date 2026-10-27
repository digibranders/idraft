"""The rank history and SERP reads (docs/19-api-specification.md section 3.6.4; plan Task 8).

Each read checks that the tracked keyword (or snapshot) is a live one of the project in the
path, in the workspace of the caller: anything else is a `404`. The membership dependency has
already refused a project outside the caller's scope.
"""

from __future__ import annotations

import asyncio
import gzip
from collections import defaultdict
from collections.abc import Collection, Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi.exceptions import RequestValidationError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api.keywords import rank_repository
from idraft.api.keywords import repository as keyword_repository
from idraft.api.keywords.rank_views import url_ref
from idraft.api.keywords.repository import CompetitorRecord, UrlRecord
from idraft.api.keywords.service import effective_set
from idraft.api.pagination import CursorParams, decode_cursor, encode_cursor, invalid_cursor
from idraft.api.problems import (
    NotFoundError,
    RawExpiredError,
    RawUnavailableError,
    WindowTooLargeError,
)
from idraft.api.ranks import history as history_shapes
from idraft.api.ranks import repository
from idraft.api.ranks.repository import EventRow, Observation, SnapshotRow
from idraft.api.schemas.entities import EntityRef
from idraft.api.schemas.keywords import RankCell, UrlRef
from idraft.api.schemas.metrics import MetricValue, MetricWindow
from idraft.api.schemas.ranks import (
    AioHistoryItem,
    FeatureCheck,
    FeaturePresence,
    HistoryConfig,
    HistoryFormat,
    HistoryInclude,
    HistorySeries,
    HistoryWindow,
    RankEventOut,
    RankHistory,
    SerpCurrent,
    SerpDomain,
    SerpFeatureHistory,
    SerpFeatureOut,
    SerpOrganicItem,
    SerpProvenance,
    SerpResult,
    SerpSnapshotDetail,
    SerpSnapshotSummary,
)
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction
from idraft.storage.raw import ObjectStore, RawStorageError, decompress, digest, read_payload

ENTITIES_MAX = 11
AIO_HISTORY_MAX = 1000
# docs/19 section 2.5: a list of raw rows covers at most 90 days unless it names one keyword.
EVENTS_MAX_WINDOW = timedelta(days=90)


def _event_bounds(
    start: datetime | date | None, end: datetime | date | None, zone: ZoneInfo
) -> tuple[datetime | None, datetime | None]:
    """The instants a request's `from` and `to` mean: a timestamp is itself, and a date is a
    day of the project, whose last day is included."""
    since: datetime | None = None
    until: datetime | None = None
    if isinstance(start, datetime):
        since = start
    elif start is not None:
        since = instants(start, start, zone)[0]
    if isinstance(end, datetime):
        until = end
    elif end is not None:
        until = instants(end, end, zone)[1]
    return since, until


@dataclass(frozen=True, slots=True)
class SnapshotPageResult:
    rows: list[SerpSnapshotSummary]
    next_cursor: str | None


@dataclass(frozen=True, slots=True)
class EventPageResult:
    rows: list[RankEventOut]
    next_cursor: str | None


@dataclass(frozen=True, slots=True)
class RawAnswer:
    body: bytes


def _entity(record: CompetitorRecord, role: str | None = None) -> EntityRef:
    """The entity; with `role`, the role it had when a check was made rather than today's."""
    return EntityRef.model_validate(
        {
            "entity_id": record.entity_id,
            "canonical_name": record.canonical_name,
            "entity_type": record.entity_type,
            "role": role or record.role,
            "color_index": record.color_index,
        }
    )


def _unpack_inline(data: bytes, compression: str) -> bytes:
    """The body of a payload kept in the registry row, by the compression it names."""
    match compression:
        case "none":
            return data
        case "gzip":
            return gzip.decompress(data)
        case _:
            return decompress(data)


def _query_error(name: str, code: str, message: str) -> RequestValidationError:
    return RequestValidationError([{"loc": ("query", name), "type": code, "msg": message}])


def window_dates(
    *, start: date | None, end: date | None, window: str | None, zone: ZoneInfo, today: date
) -> tuple[date, date]:
    """The local dates a read covers, both included. `from` and `to` win over `window`; the
    default is `last_90d`."""
    if start is None and end is None:
        days = history_shapes.WINDOWS.get(window or "last_90d")
        if days is None:
            raise _query_error(
                "window", "invalid_window", f"Use one of: {', '.join(history_shapes.WINDOWS)}."
            )
        return today - timedelta(days=days - 1), today
    last = end or today
    first = start or last - timedelta(days=89)
    if first > last:
        raise _query_error("from", "range_invalid", "`from` is after `to`.")
    if (last - first).days + 1 > history_shapes.WINDOW_MAX_DAYS:
        raise WindowTooLargeError(
            f"A window is at most {history_shapes.WINDOW_MAX_DAYS} days.",
            limit_days=history_shapes.WINDOW_MAX_DAYS,
        )
    return first, last


def instants(first: date, last: date, zone: ZoneInfo) -> tuple[datetime, datetime]:
    """The UTC instants where the local days `first` to `last` begin and end."""
    since = datetime.combine(first, time.min, tzinfo=zone).astimezone(UTC)
    until = datetime.combine(last + timedelta(days=1), time.min, tzinfo=zone).astimezone(UTC)
    return since, until


def _own_cell(observations: Sequence[Observation], urls: dict[int, UrlRecord]) -> RankCell:
    """The own side of one snapshot: the best rank among the own entities."""
    own = [o for o in observations if o.role == "own"]
    if not own:
        return RankCell(
            state="not_checked",
            rank=None,
            absolute_rank=None,
            depth_requested=None,
            url=None,
            observed_at=None,
            serp_snapshot_id=None,
        )
    ranked = [o for o in own if o.organic_rank is not None]
    best = min(ranked, key=lambda o: o.organic_rank or 0) if ranked else own[0]
    url = urls.get(best.ranking_url_id) if best.ranking_url_id is not None else None
    return RankCell.model_validate(
        {
            "state": "ranked" if ranked else "beyond_depth",
            "rank": best.organic_rank,
            "absolute_rank": best.absolute_rank,
            "depth_requested": best.depth_requested,
            "url": url_ref(url),
            "observed_at": best.observed_at,
            "serp_snapshot_id": str(best.snapshot_id),
        }
    )


def _ratio(
    name: str, count: int, total: int, since: date, until: date, timezone: str
) -> MetricValue:
    return MetricValue(
        metric=name,
        value=None if total == 0 else count / total,
        numerator=float(count),
        denominator=float(total),
        unit="ratio",
        n_observations=total,
        n_keywords=1,
        window=MetricWindow(from_=since.isoformat(), to=until.isoformat(), timezone=timezone),
        filters={},
        is_estimate=False,
        method="Share of the checks in the window",
        method_version=1,
    )


class RankService:
    def __init__(
        self, *, sessions: async_sessionmaker[AsyncSession], raw_store: ObjectStore | None
    ) -> None:
        self._sessions = sessions
        self._raw_store = raw_store

    def _transaction(self, access: WorkspaceAccess) -> AbstractAsyncContextManager[AsyncSession]:
        return workspace_transaction(self._sessions, access.workspace_id, user_id=access.user_id)

    @staticmethod
    async def _keyword(
        db: AsyncSession, access: WorkspaceAccess, project_id: UUID, tracked_keyword_id: UUID
    ) -> repository.ProjectZone:
        """The project's zone, once the keyword is known to be a live one of the project."""
        found = await keyword_repository.get_tracked(
            db, access.workspace_id, project_id, tracked_keyword_id
        )
        zone = await repository.project_zone(db, access.workspace_id, project_id)
        if found is None or zone is None:
            raise NotFoundError
        return zone

    # Rank history.

    async def rank_history(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        tracked_keyword_id: UUID,
        *,
        start: date | None,
        end: date | None,
        window: str | None,
        entity_ids: Sequence[str] | None,
        include: Collection[HistoryInclude],
        form: HistoryFormat,
    ) -> RankHistory:
        async with self._transaction(access) as db:
            project_zone = await self._keyword(db, access, project_id, tracked_keyword_id)
            zone = ZoneInfo(project_zone.timezone)
            first, last = window_dates(
                start=start,
                end=end,
                window=window,
                zone=zone,
                today=datetime.now(UTC).astimezone(zone).date(),
            )
            since, until = instants(first, last, zone)
            workspace_id = access.workspace_id
            if entity_ids:
                own = await repository.primary_own_entity(db, workspace_id, project_id)
                chosen = [own if token == "own" else UUID(token) for token in entity_ids]
                given = [entity for entity in chosen if entity is not None]
            else:
                given = await self._default_entities(db, access, project_id, tracked_keyword_id)
            wanted = list(dict.fromkeys(given))  # each entity once, in the order given
            if len(wanted) > ENTITIES_MAX:
                raise _query_error(
                    "entity_ids", "too_many_entities", f"At most {ENTITIES_MAX} entities."
                )
            refs = await repository.entities_by_ids(db, workspace_id, project_id, wanted)
            wanted = [entity_id for entity_id in wanted if entity_id in refs]
            rows = await repository.observations(
                db, workspace_id, tracked_keyword_id, since=since, until=until, entity_ids=wanted
            )
            failed = await repository.failed_checks(
                db, workspace_id, tracked_keyword_id, since=since, until=until
            )
            config = await keyword_repository.config_history(db, workspace_id, tracked_keyword_id)
            events = (
                await repository.events_of(
                    db,
                    workspace_id,
                    tracked_keyword_id,
                    entity_ids=wanted,
                    since=since,
                    until=until,
                )
                if "events" in include
                else None
            )
            url_ids = {o.ranking_url_id for o in rows if o.ranking_url_id is not None}
            urls = await rank_repository.urls_by_id(db, url_ids) if "url" in include else {}
        by_entity: dict[UUID, list[Observation]] = defaultdict(list)
        for observation in rows:
            by_entity[observation.entity_id].append(observation)
        series_points = {
            entity_id: history_shapes.series_points(
                by_entity.get(entity_id, []),
                failed,
                zone,
                absolute="absolute" in include,
                with_url="url" in include,
            )
            for entity_id in wanted
        }
        history_config = [
            HistoryConfig(
                config_version=entry.config_version,
                depth_profile=entry.depth_profile,
                valid_from=entry.valid_from,
                valid_to=entry.valid_to,
            )
            for entry in config
        ]
        # The summary is the project's own: the first own entity asked for, else none.
        own_first = next((e for e in wanted if refs[e].role == "own"), None)
        primary = [] if own_first is None else series_points[own_first]
        return RankHistory(
            tracked_keyword_id=str(tracked_keyword_id),
            window=HistoryWindow(from_=first, to=last, timezone=project_zone.timezone),
            deep_check_weekday=project_zone.deep_check_weekday,
            config_history=history_config,
            urls={str(url_id): url_ref_required(url) for url_id, url in urls.items()},
            series=[HistorySeries(entity=_entity(refs[e]), points=series_points[e]) for e in wanted]
            if form == "points"
            else None,
            columns=[history_shapes.columns_of(_entity(refs[e]), series_points[e]) for e in wanted]
            if form == "columns"
            else None,
            bands=[band for e in wanted for band in history_shapes.bands_of(e, series_points[e])],
            events=None if events is None else history_shapes.events_of(events),
            summary=history_shapes.summary_of(primary, (first, last), project_zone.timezone),
            version_boundaries=history_shapes.version_boundaries(history_config, since, until),
        )

    async def _default_entities(
        self,
        db: AsyncSession,
        access: WorkspaceAccess,
        project_id: UUID,
        tracked_keyword_id: UUID,
    ) -> list[UUID]:
        """The project's primary own entity, then the keyword's effective competitors."""
        workspace_id = access.workspace_id
        own = await repository.primary_own_entity(db, workspace_id, project_id)
        competitors = effective_set(
            await keyword_repository.project_competitors(db, workspace_id, project_id),
            (
                await keyword_repository.overrides_of(
                    db, workspace_id, project_id, [tracked_keyword_id]
                )
            ).get(tracked_keyword_id, []),
        )
        found = ([own] if own is not None else []) + [c.entity_id for c in competitors]
        return found[:ENTITIES_MAX]

    # SERP snapshots.

    async def snapshot_page(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        tracked_keyword_id: UUID,
        *,
        start: date | None,
        end: date | None,
        depth_requested: int | None,
        has_ai_overview: bool | None,
        page: CursorParams,
    ) -> SnapshotPageResult:
        scope: dict[str, object] = {
            "tracked_keyword_id": str(tracked_keyword_id),
            "from": start,
            "to": end,
            "depth": depth_requested,
            "aio": has_ai_overview,
        }
        after: tuple[datetime, int] | None = None
        if page.cursor is not None:
            key = decode_cursor(page.cursor, scope=scope)
            try:
                after = (datetime.fromisoformat(str(key[0])), int(key[1]))
            except (ValueError, IndexError):
                raise invalid_cursor() from None
        async with self._transaction(access) as db:
            project_zone = await self._keyword(db, access, project_id, tracked_keyword_id)
            zone = ZoneInfo(project_zone.timezone)
            since = None if start is None else instants(start, start, zone)[0]
            until = None if end is None else instants(end, end, zone)[1]
            found = await repository.snapshots_of(
                db,
                access.workspace_id,
                project_id,
                tracked_keyword_id,
                since=since,
                until=until,
                depth_requested=depth_requested,
                has_ai_overview=has_ai_overview,
                after=after,
                limit=page.limit + 1,
            )
            shown = found[: page.limit]
            summaries = await self._summaries(db, access, tracked_keyword_id, shown)
        next_cursor = None
        if len(found) > page.limit:
            last = shown[-1]
            next_cursor = encode_cursor([last.observed_at.isoformat(), last.id], scope=scope)
        return SnapshotPageResult(rows=summaries, next_cursor=next_cursor)

    async def _summaries(
        self,
        db: AsyncSession,
        access: WorkspaceAccess,
        tracked_keyword_id: UUID,
        snapshots: Sequence[SnapshotRow],
    ) -> list[SerpSnapshotSummary]:
        if not snapshots:
            return []
        since = min(s.observed_at for s in snapshots)
        until = max(s.observed_at for s in snapshots) + timedelta(seconds=1)
        own = await repository.observations(
            db,
            access.workspace_id,
            tracked_keyword_id,
            since=since,
            until=until,
            snapshot_ids={s.id for s in snapshots},
            roles=("own",),
        )
        urls = await rank_repository.urls_by_id(
            db, {o.ranking_url_id for o in own if o.ranking_url_id is not None}
        )
        per_snapshot: dict[int, list[Observation]] = defaultdict(list)
        for observation in own:
            per_snapshot[observation.snapshot_id].append(observation)
        return [_summary(s, _own_cell(per_snapshot.get(s.id, []), urls)) for s in snapshots]

    async def serp_current(
        self, access: WorkspaceAccess, project_id: UUID, tracked_keyword_id: UUID
    ) -> SerpCurrent:
        async with self._transaction(access) as db:
            await self._keyword(db, access, project_id, tracked_keyword_id)
            results, observed_at = await repository.current_results(
                db, access.workspace_id, tracked_keyword_id
            )
            urls = await rank_repository.urls_by_id(db, {r.url_id for r in results})
            domains = await repository.domains_by_id(db, {r.domain_id for r in results})
            entities = await self._entities_of_urls(
                db,
                access,
                project_id,
                tracked_keyword_id,
                results[0].snapshot_id if results else None,
                observed_at,
            )
        return SerpCurrent(
            serp_snapshot_id=str(results[0].snapshot_id) if results else None,
            observed_at=observed_at if results else None,
            results=[
                SerpResult(
                    organic_rank=r.organic_rank,
                    absolute_rank=r.absolute_rank,
                    url=url_ref_required(urls[r.url_id]),
                    domain=SerpDomain(
                        domain_id=r.domain_id,
                        host=domains[r.domain_id][0],
                        registrable_domain=domains[r.domain_id][1],
                    ),
                    title=r.title,
                    snippet=r.snippet,
                    entity=entities.get(r.url_id),
                )
                for r in results
                if r.url_id in urls and r.domain_id in domains
            ],
        )

    @staticmethod
    async def _entities_of_urls(
        db: AsyncSession,
        access: WorkspaceAccess,
        project_id: UUID,
        tracked_keyword_id: UUID,
        snapshot_id: int | None,
        observed_at: datetime | None,
    ) -> dict[int, EntityRef]:
        """Which own or competitor entity each URL of a snapshot belongs to, from its
        observations (the rules in force when it was checked)."""
        if snapshot_id is None or observed_at is None:
            return {}
        rows = await repository.observations(
            db,
            access.workspace_id,
            tracked_keyword_id,
            since=observed_at,
            until=observed_at + timedelta(seconds=1),
            snapshot_ids=[snapshot_id],
        )
        refs = await repository.entities_by_ids(
            db, access.workspace_id, project_id, {o.entity_id for o in rows}
        )
        found: dict[int, EntityRef] = {}
        for observation in rows:
            record = refs.get(observation.entity_id)
            if record is None:
                continue
            for url_id in observation.all_url_ids:
                found.setdefault(url_id, _entity(record, observation.role))
        return found

    async def snapshot_detail(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        snapshot_id: int,
        observed_at: datetime | None,
        *,
        titles: bool,
    ) -> SerpSnapshotDetail:
        async with self._transaction(access) as db:
            snapshot = await repository.snapshot_by_id(
                db, access.workspace_id, project_id, snapshot_id, observed_at
            )
            if snapshot is None:
                raise NotFoundError
            around = (snapshot.observed_at, snapshot.observed_at + timedelta(seconds=1))
            rows = await repository.observations(
                db,
                access.workspace_id,
                snapshot.tracked_keyword_id,
                since=around[0],
                until=around[1],
                snapshot_ids=[snapshot.id],
            )
            features = await repository.features_in(
                db,
                access.workspace_id,
                snapshot.tracked_keyword_id,
                [snapshot.id],
                since=around[0],
                until=around[1],
            )
            current, _ = await repository.current_results(
                db, access.workspace_id, snapshot.tracked_keyword_id
            )
            wanted_urls = (
                set(snapshot.organic_url_ids)
                | {u for o in rows for u in o.all_url_ids}
                | {u for f in features for u in f.source_url_ids}
            )
            urls = await rank_repository.urls_by_id(db, wanted_urls)
            domains = await repository.domains_by_id(db, set(snapshot.organic_domain_ids))
            refs = await repository.entities_by_ids(
                db,
                access.workspace_id,
                project_id,
                {o.entity_id for o in rows}
                | {c for f in features for c in f.competitor_entity_ids},
            )
        return _detail(snapshot, rows, features, current, urls, domains, refs, titles=titles)

    async def raw_answer(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        snapshot_id: int,
        observed_at: datetime | None,
    ) -> RawAnswer:
        """The provider's answer as received. The snapshot must be one of the project in the
        path: the registry function checks the workspace only."""
        async with self._transaction(access) as db:
            snapshot = await repository.snapshot_by_id(
                db, access.workspace_id, project_id, snapshot_id, observed_at
            )
            if snapshot is None:
                raise NotFoundError
            row = await repository.raw_payload(db, snapshot_id)
        if row is None:
            raise NotFoundError
        if row.expires_at is not None and row.expires_at <= datetime.now(UTC):
            raise RawExpiredError("The raw answer of this snapshot is past its retention.")
        if row.object_key is None:
            if row.inline_body is None:
                raise RawExpiredError("The raw answer of this snapshot is no longer kept.")
            try:
                body = await asyncio.to_thread(
                    _unpack_inline, bytes(row.inline_body), str(row.compression)
                )
            except (RawStorageError, OSError, EOFError):
                raise RawUnavailableError("The stored answer could not be read.") from None
            if digest(body) != bytes(row.sha256):
                raise RawUnavailableError("The stored answer could not be read.")
            return RawAnswer(body)
        if self._raw_store is None:
            raise RawUnavailableError("Raw answers need object storage, which is not set up.")
        try:
            return RawAnswer(await read_payload(self._raw_store, row.object_key, bytes(row.sha256)))
        except (RawStorageError, KeyError):
            raise RawUnavailableError("The stored answer could not be read. Try again.") from None

    # Features and AI Overview history.

    async def serp_features(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        tracked_keyword_id: UUID,
        *,
        start: date | None,
        end: date | None,
        feature_types: Sequence[str] | None,
        limit_checks: int,
    ) -> SerpFeatureHistory:
        async with self._transaction(access) as db:
            project_zone = await self._keyword(db, access, project_id, tracked_keyword_id)
            zone = ZoneInfo(project_zone.timezone)
            first, last = window_dates(
                start=start,
                end=end,
                window=None,
                zone=zone,
                today=datetime.now(UTC).astimezone(zone).date(),
            )
            since, until = instants(first, last, zone)
            checks = await repository.effective_check_ids(
                db,
                access.workspace_id,
                project_id,
                tracked_keyword_id,
                since=since,
                until=until,
                limit=limit_checks,
            )
            rows = await repository.features_in(
                db,
                access.workspace_id,
                tracked_keyword_id,
                [snapshot_id for snapshot_id, _, _ in checks],
                since=since,
                until=until,
            )
            urls = await rank_repository.urls_by_id(
                db, {u for row in rows for u in row.source_url_ids}
            )
        wanted = None if feature_types is None else set(feature_types)
        per_check: dict[int, list[repository.FeatureRow]] = defaultdict(list)
        for row in rows:
            if wanted is None or row.feature.feature_type in wanted:
                per_check[row.snapshot_id].append(row)
        total = len(checks)
        types = sorted({row.feature.feature_type for rows_ in per_check.values() for row in rows_})
        presence = []
        for feature_type in types:
            with_feature = [
                [
                    r
                    for r in per_check.get(snapshot_id, [])
                    if r.feature.feature_type == feature_type
                ]
                for snapshot_id, _, _ in checks
            ]
            present = sum(1 for found in with_feature if found)
            owned = sum(
                1 for found in with_feature if any(r.feature.owned_by_project for r in found)
            )
            presence.append(
                FeaturePresence(
                    feature_type=feature_type,
                    presence_rate=_ratio(
                        "seo.serp_feature_presence",
                        present,
                        total,
                        first,
                        last,
                        project_zone.timezone,
                    ),
                    own_ownership_rate=_ratio(
                        "seo.serp_feature_ownership",
                        owned,
                        present,
                        first,
                        last,
                        project_zone.timezone,
                    ),
                )
            )
        return SerpFeatureHistory(
            checks=[
                FeatureCheck(
                    observed_at=observed_at,
                    serp_snapshot_id=str(snapshot_id),
                    depth_requested=depth,
                    features=[_feature_out(r, urls) for r in per_check.get(snapshot_id, [])],
                )
                for snapshot_id, observed_at, depth in checks
            ],
            presence=presence,
        )

    async def aio_history(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        tracked_keyword_id: UUID,
        *,
        start: date | None,
        end: date | None,
    ) -> list[AioHistoryItem]:
        async with self._transaction(access) as db:
            project_zone = await self._keyword(db, access, project_id, tracked_keyword_id)
            zone = ZoneInfo(project_zone.timezone)
            first, last = window_dates(
                start=start,
                end=end,
                window=None,
                zone=zone,
                today=datetime.now(UTC).astimezone(zone).date(),
            )
            since, until = instants(first, last, zone)
            snapshots = await repository.snapshots_of(
                db,
                access.workspace_id,
                project_id,
                tracked_keyword_id,
                since=since,
                until=until,
                depth_requested=None,
                has_ai_overview=None,
                after=None,
                limit=AIO_HISTORY_MAX,
            )
            ids = {s.id for s in snapshots}
            rows = await repository.observations(
                db,
                access.workspace_id,
                tracked_keyword_id,
                since=since,
                until=until,
                snapshot_ids=ids,
            )
            features = await repository.features_in(
                db, access.workspace_id, tracked_keyword_id, ids, since=since, until=until
            )
            refs = await repository.entities_by_ids(
                db, access.workspace_id, project_id, {o.entity_id for o in rows}
            )
            urls = await rank_repository.urls_by_id(
                db, {o.ranking_url_id for o in rows if o.ranking_url_id is not None}
            )
        by_snapshot: dict[int, list[Observation]] = defaultdict(list)
        for observation in rows:
            by_snapshot[observation.snapshot_id].append(observation)
        sources = {
            f.snapshot_id: len(f.source_url_ids)
            for f in features
            if f.feature.feature_type == "ai_overview"
        }
        return [
            _aio_item(s, by_snapshot.get(s.id, []), refs, urls, sources.get(s.id, 0))
            for s in snapshots
        ]

    # Rank events.

    async def event_page(
        self,
        access: WorkspaceAccess,
        project_id: UUID,
        *,
        start: datetime | date | None,
        end: datetime | date | None,
        event_types: Sequence[str] | None,
        tracked_keyword_id: UUID | None,
        entity_id: UUID | None,
        group_id: UUID | None,
        term_id: UUID | None,
        page: CursorParams,
    ) -> EventPageResult:
        """`start` and `end` are instants (timestamps with a zone) or project-local days (dates,
        `end` included). Without a keyword filter a request covers at most 90 days; with none
        given it covers the last 90."""
        async with self._transaction(access) as db:
            zone_row = await repository.project_zone(db, access.workspace_id, project_id)
        if zone_row is None:
            raise NotFoundError
        since, until = _event_bounds(start, end, ZoneInfo(zone_row.timezone))
        if tracked_keyword_id is None:
            if since is None:
                since = (until or datetime.now(UTC)) - EVENTS_MAX_WINDOW
            elif (until or datetime.now(UTC)) - since > EVENTS_MAX_WINDOW:
                raise WindowTooLargeError(
                    "Without a keyword, a request covers at most 90 days.",
                    limit_days=EVENTS_MAX_WINDOW.days,
                )
        scope: dict[str, object] = {
            "project_id": str(project_id),
            "from": start,
            "to": end,
            "types": list(event_types or []),
            "keyword": tracked_keyword_id,
            "entity": entity_id,
            "group": group_id,
            "term": term_id,
        }
        after: tuple[datetime, int] | None = None
        if page.cursor is not None:
            key = decode_cursor(page.cursor, scope=scope)
            try:
                after = (datetime.fromisoformat(str(key[0])), int(key[1]))
            except (ValueError, IndexError):
                raise invalid_cursor() from None
        async with self._transaction(access) as db:
            rows = await repository.project_events(
                db,
                access.workspace_id,
                project_id,
                since=since,
                until=until,
                event_types=event_types,
                tracked_keyword_id=tracked_keyword_id,
                entity_id=entity_id,
                group_id=group_id,
                term_id=term_id,
                after=after,
                limit=page.limit + 1,
            )
            shown = rows[: page.limit]
            refs = await repository.entities_by_ids(
                db,
                access.workspace_id,
                project_id,
                {r.entity_id for r in shown}
                | {r.other_entity_id for r in shown if r.other_entity_id},
            )
            urls = await rank_repository.urls_by_id(
                db,
                {u for r in shown for u in (r.from_url_id, r.to_url_id) if u is not None},
            )
        next_cursor = None
        if len(rows) > page.limit:
            last = shown[-1]
            next_cursor = encode_cursor([last.occurred_at.isoformat(), last.id], scope=scope)
        return EventPageResult(rows=[_event(r, refs, urls) for r in shown], next_cursor=next_cursor)


def url_ref_required(record: UrlRecord) -> UrlRef:
    ref = url_ref(record)
    assert ref is not None
    return ref


def _summary(s: SnapshotRow, own: RankCell) -> SerpSnapshotSummary:
    return SerpSnapshotSummary.model_validate(
        {
            "serp_snapshot_id": str(s.id),
            "observed_at": s.observed_at,
            "observed_date": s.observed_date,
            "config_version": s.config_version,
            "provider_code": s.provider_code,
            "provider_endpoint": s.provider_endpoint,
            "se_domain": s.se_domain,
            "location_id": s.location_id,
            "language_code": s.language_code,
            "device": s.device,
            "os": s.os,
            "depth_requested": s.depth_requested,
            "depth_returned": s.depth_returned,
            "se_results_count": s.se_results_count,
            "item_types": s.item_types,
            "has_ai_overview": s.has_ai_overview,
            "ai_overview_state": s.ai_overview_state,
            "has_ai_mode_link": s.has_ai_mode_link,
            "served_from_cache": s.served_from_cache,
            "cost_usd": None if s.cost_usd is None else Decimal(s.cost_usd),
            "own": own,
        }
    )


def _feature_out(row: repository.FeatureRow, urls: dict[int, UrlRecord]) -> SerpFeatureOut:
    return SerpFeatureOut(
        feature_type=row.feature.feature_type,
        ordinal=row.feature.ordinal,
        rank_absolute=row.feature.rank_absolute,
        source_urls=[url_ref_required(urls[u]) for u in row.source_url_ids if u in urls],
        owned_by_project=row.feature.owned_by_project,
        owned_position=row.feature.owned_position,
        competitor_entity_ids=[str(c) for c in row.competitor_entity_ids],
        payload=row.payload,
    )


def _detail(
    snapshot: SnapshotRow,
    observations: Sequence[Observation],
    features: Sequence[repository.FeatureRow],
    current: Sequence[repository.CurrentResult],
    urls: dict[int, UrlRecord],
    domains: dict[int, tuple[str, str]],
    refs: dict[UUID, CompetitorRecord],
    *,
    titles: bool,
) -> SerpSnapshotDetail:
    owner: dict[int, EntityRef] = {}
    titled: dict[int, tuple[str | None, str | None]] = {}
    for observation in observations:
        record = refs.get(observation.entity_id)
        for url_id in observation.all_url_ids:
            if record is not None:
                owner.setdefault(url_id, _entity(record, observation.role))
        if observation.ranking_url_id is not None:
            titled.setdefault(
                observation.ranking_url_id,
                (observation.ranking_title, observation.ranking_snippet),
            )
    is_current = bool(current) and current[0].snapshot_id == snapshot.id
    current_titles = {r.url_id: (r.title, r.snippet) for r in current} if is_current else {}
    source: str = "unavailable"
    organic = []
    for position, url_id in enumerate(snapshot.organic_url_ids):
        if url_id not in urls:
            continue
        domain_id = snapshot.organic_domain_ids[position]
        title, snippet = current_titles.get(url_id) or titled.get(url_id) or (None, None)
        if not titles:
            title, snippet = None, None
        elif title is not None or snippet is not None:
            source = (
                "serp_current_results" if url_id in current_titles else "domain_rank_observations"
            )
        organic.append(
            SerpOrganicItem(
                organic_rank=position + 1,
                absolute_rank=snapshot.organic_abs_positions[position],
                url=url_ref_required(urls[url_id]),
                domain=SerpDomain(
                    domain_id=domain_id,
                    host=domains.get(domain_id, ("", ""))[0],
                    registrable_domain=domains.get(domain_id, ("", ""))[1],
                ),
                entity=owner.get(url_id),
                title=title,
                snippet=snippet,
            )
        )
    summary = _summary(snapshot, _own_cell(list(observations), urls))
    return SerpSnapshotDetail.model_validate(
        {
            **summary.model_dump(),
            "own": summary.own,
            "organic": organic,
            "titles_source": source,
            "features": [_feature_out(f, urls) for f in features],
            "ai_overview_observation_id": None,
            "provenance": SerpProvenance(
                raw_payload_id=str(snapshot.raw_payload_id),
                parser_version=snapshot.parser_version,
                canonicalizer_version=snapshot.canonicalizer_version,
                provider_task_id=snapshot.provider_task_id,
                collection_task_id=None
                if snapshot.collection_task_id is None
                else str(snapshot.collection_task_id),
            ),
        }
    )


def _aio_item(
    snapshot: SnapshotRow,
    observations: Sequence[Observation],
    refs: dict[UUID, CompetitorRecord],
    urls: dict[int, UrlRecord],
    source_count: int,
) -> AioHistoryItem:
    own = [o for o in observations if o.role == "own"]
    cited = [o for o in own if o.cited_in_ai_overview]
    positions = [o.citation_position for o in cited if o.citation_position is not None]
    state: str
    match snapshot.ai_overview_state:
        case None | "absent":
            state = "absent"
        case "present_not_loaded":
            state = "not_loaded"
        case _:
            state = "present_cited" if cited else "present_not_cited"
    rivals = [
        _entity(refs[o.entity_id], o.role)
        for o in observations
        if o.role == "competitor" and o.cited_in_ai_overview and o.entity_id in refs
    ]
    return AioHistoryItem.model_validate(
        {
            "observed_at": snapshot.observed_at,
            "serp_snapshot_id": str(snapshot.id),
            "device": snapshot.device,
            "location_id": snapshot.location_id,
            "ai_overview_state": state,
            "own_cited": None if state in ("absent", "not_loaded") else bool(cited),
            "own_citation_position": min(positions) if positions else None,
            "competitors_cited": rivals,
            "source_count": source_count,
            "organic_rank": _own_cell(observations, urls),
            "observation_id": None,
        }
    )


def _event(
    row: EventRow, refs: dict[UUID, CompetitorRecord], urls: dict[int, UrlRecord]
) -> RankEventOut:
    entity = refs.get(row.entity_id)
    if entity is None:
        entity = CompetitorRecord(row.entity_id, "(removed)", "brand", None, None)
    other = refs.get(row.other_entity_id) if row.other_entity_id is not None else None
    return RankEventOut.model_validate(
        {
            "rank_event_id": str(row.id),
            "occurred_at": row.occurred_at,
            "tracked_keyword_id": str(row.tracked_keyword_id),
            "keyword": row.keyword,
            "entity": _entity(entity),
            "event_type": row.event_type,
            "feature_type": row.feature_type,
            "from_rank": row.from_rank,
            "to_rank": row.to_rank,
            "from_url": None if row.from_url_id is None else url_ref(urls.get(row.from_url_id)),
            "to_url": None if row.to_url_id is None else url_ref(urls.get(row.to_url_id)),
            "other_entity": None if other is None else _entity(other),
            "serp_snapshot_id": str(row.snapshot_id),
        }
    )
