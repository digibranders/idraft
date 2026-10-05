"""The rows of one SERP check, built from the parsed and resolved answer with no database in
sight (plan decisions R17 to R22 of docs/superpowers/plans/2026-10-05-rank-ingest.md). The
writer in `seo_rank_ingest` inserts them."""

from __future__ import annotations

import uuid
from collections import Counter
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any, Final

from sightline.db.dictionaries import UrlRow
from sightline.extraction.urls import CANONICALIZER_VERSION, CanonicalUrl
from sightline.providers.dataforseo.serp_parse import PARSER_VERSION, NormalizedSerp, RequestEcho
from sightline.ranks.resolve import OwnSide, ResolvedSerp
from sightline.ranks.state import Check

# The provider's own time for the check is believed inside this window around the fetch.
TIME_BEFORE: Final = timedelta(days=7)
TIME_AFTER: Final = timedelta(hours=1)
CURRENT_RESULTS: Final = 20
FEATURE_CODE_MAX: Final = 100
DEVICES: Final = frozenset({"desktop", "mobile"})
DEPTH_MAX: Final = 700
SMALLINT_MAX: Final = 32767


class UnusableCheckError(ValueError):
    """The answer is readable but cannot be a row: the task fails, its payload kept."""


@dataclass(frozen=True, slots=True)
class KeywordRef:
    """The tracked keyword a check belongs to."""

    workspace_id: uuid.UUID
    project_id: uuid.UUID
    tracked_keyword_id: uuid.UUID
    location_id: int
    config_version: int
    target_url_hash: bytes | None


@dataclass(frozen=True, slots=True)
class TaskFacts:
    """What the ledger knows about the task."""

    task_id: int
    raw_payload_id: int
    fetched_at: datetime
    provider_code: str
    provider_endpoint: str
    provider_task_id: str | None
    location_id: int | None
    cost_usd: Decimal | None


@dataclass(frozen=True, slots=True)
class SerpRows:
    """A check as rows. The children carry no snapshot id yet: `children` adds it once the
    snapshot is inserted."""

    snapshot: dict[str, Any]
    features: list[dict[str, Any]]
    observations: list[dict[str, Any]]
    current: list[dict[str, Any]]
    feature_codes: tuple[str, ...]  # every feature type used, for the registry

    def children(self, snapshot_id: int) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """The feature and observation rows of the snapshot `snapshot_id`."""
        key = {
            "serp_snapshot_id": snapshot_id,
            "observed_at": self.snapshot["observed_at"],
            "workspace_id": self.snapshot["workspace_id"],
            "project_id": self.snapshot["project_id"],
            "tracked_keyword_id": self.snapshot["tracked_keyword_id"],
        }
        return (
            [{**key, **row} for row in self.features],
            [
                {**key, "observed_date": self.snapshot["observed_date"], **row}
                for row in self.observations
            ],
        )


def snapshot_time(provider: datetime | None, fetched_at: datetime) -> datetime:
    """When the check happened: the provider's crawl time when it is believable, else the time
    the answer was fetched. Both are fixed by the stored task and payload, so ingesting twice
    gives the same value, which the one-snapshot-per-task key needs (R19)."""
    if provider is not None and fetched_at - TIME_BEFORE <= provider <= fetched_at + TIME_AFTER:
        return provider.astimezone(UTC)
    return fetched_at.astimezone(UTC)


def feature_code(feature_type: str) -> str:
    """The registry code of a feature; an unknown provider type that is too long for it
    becomes `other:unknown`."""
    return feature_type if len(feature_type) <= FEATURE_CODE_MAX else "other:unknown"


def urls_of(serp: NormalizedSerp, resolved: ResolvedSerp) -> list[CanonicalUrl]:
    """Every URL the rows name: the organic results, the sources of the features and the URLs
    the entities hold (a grouped sub-result is one of them)."""
    found = [result.url for result in serp.organic]
    for feature in serp.features:
        found.extend(feature.source_urls)
    for entity in resolved.entities:
        found.extend(entity.all_urls)
    return found


def smallint(value: int | None) -> int | None:
    """A value a `smallint` column holds; one it cannot (a position the provider should not
    send) is left out rather than failing the check."""
    return value if value is not None and 0 <= value <= SMALLINT_MAX else None


def echo_of(serp: NormalizedSerp) -> RequestEcho:
    """The request the answer echoes; a check without it, or with values the tables refuse,
    cannot be stored."""
    echo = serp.request
    if echo is None:
        raise UnusableCheckError("the answer does not say what the task asked for")
    if echo.device not in DEVICES:
        raise UnusableCheckError(f"unknown device {echo.device!r}")
    if not 1 <= echo.depth <= DEPTH_MAX:
        raise UnusableCheckError(f"depth {echo.depth} is outside 1 to {DEPTH_MAX}")
    return echo


def build_rows(
    serp: NormalizedSerp,
    resolved: ResolvedSerp,
    urls: Mapping[bytes, UrlRow],
    *,
    keyword: KeywordRef,
    task: TaskFacts,
    observed_at: datetime,
) -> SerpRows:
    echo = echo_of(serp)
    organic = serp.organic
    snapshot: dict[str, Any] = {
        "observed_at": observed_at,
        "observed_date": observed_at.astimezone(UTC).date(),
        "workspace_id": keyword.workspace_id,
        "project_id": keyword.project_id,
        "tracked_keyword_id": keyword.tracked_keyword_id,
        "config_version": keyword.config_version,
        "collection_task_id": task.task_id,
        "provider_code": task.provider_code,
        "provider_endpoint": task.provider_endpoint,
        "provider_task_id": task.provider_task_id,
        "se_domain": echo.se_domain or serp.se_domain,
        "location_id": task.location_id if task.location_id is not None else keyword.location_id,
        "language_code": echo.language_code,
        "device": echo.device,
        "os": echo.os,
        "depth_requested": echo.depth,
        "depth_returned": min(len(organic), DEPTH_MAX),
        "se_results_count": serp.se_results_count,
        "item_types": list(serp.item_types),
        "organic_url_ids": [urls[r.url.url_hash].id for r in organic],
        "organic_domain_ids": [urls[r.url.url_hash].domain_id for r in organic],
        "organic_abs_positions": [smallint(r.absolute_rank) for r in organic],
        "has_ai_overview": resolved.has_ai_overview,
        "ai_overview_state": serp.ai_overview.state,
        "raw_payload_id": task.raw_payload_id,
        "parser_version": PARSER_VERSION,
        "canonicalizer_version": CANONICALIZER_VERSION,
        "cost_usd": task.cost_usd,
        # What the parser repaired, by kind and how often: a count, not a list, which a page of
        # odd URLs could make longer than the column allows.
        "extras": {"warnings": dict(Counter(serp.warnings))} if serp.warnings else None,
    }

    features: list[dict[str, Any]] = []
    codes: dict[str, None] = {}
    for feature, ownership in zip(serp.features, resolved.features, strict=True):
        code = feature_code(feature.feature_type)
        codes.setdefault(code, None)
        features.append(
            {
                "feature_type": code,
                "ordinal": feature.ordinal,
                "rank_absolute": smallint(feature.absolute_rank),
                "source_url_ids": [urls[u.url_hash].id for u in feature.source_urls],
                "source_domain_ids": [urls[u.url_hash].domain_id for u in feature.source_urls],
                "owned_by_project": ownership.owned_by_project,
                "owned_position": ownership.owned_position,
                "competitor_entity_ids": list(ownership.competitor_entity_ids),
                "payload": feature.payload,
                "parser_version": PARSER_VERSION,
            }
        )

    observations = [
        {
            "entity_id": entity.entity_id,
            "role": entity.role,
            "organic_rank": entity.organic_rank,
            "absolute_rank": smallint(entity.absolute_rank),
            "ranking_url_id": None
            if entity.ranking_url is None
            else urls[entity.ranking_url.url_hash].id,
            "ranking_title": entity.ranking_title,
            "ranking_snippet": entity.ranking_snippet,
            "all_organic_ranks": list(entity.all_organic_ranks),
            "all_url_ids": [urls[u.url_hash].id for u in entity.all_urls],
            "result_count": entity.result_count,
            "owned_feature_types": [feature_code(t) for t in entity.owned_feature_types],
            "cited_in_ai_overview": entity.cited_in_ai_overview,
            "ai_overview_citation_position": entity.ai_overview_citation_position,
            "depth_requested": echo.depth,
        }
        for entity in resolved.entities
    ]

    current = [
        {
            "organic_rank": result.organic_rank,
            "absolute_rank": smallint(result.absolute_rank),
            "url_id": urls[result.url.url_hash].id,
            "domain_id": urls[result.url.url_hash].domain_id,
            "title": result.title,
            "snippet": result.snippet,
        }
        for result in organic
        if result.organic_rank <= min(CURRENT_RESULTS, echo.depth)
    ]
    return SerpRows(snapshot, features, observations, current, tuple(codes))


def own_check(
    side: OwnSide,
    serp: NormalizedSerp,
    urls: Mapping[bytes, UrlRow],
    *,
    snapshot_id: int,
    observed_at: datetime,
    target_matches: bool | None,
) -> Check:
    """The own side of the check, as the state rules take it."""
    echo = echo_of(serp)
    return Check(
        snapshot_id=snapshot_id,
        observed_at=observed_at,
        depth_requested=echo.depth,
        rank=side.organic_rank,
        absolute_rank=smallint(side.absolute_rank),
        url_id=None if side.ranking_url is None else urls[side.ranking_url.url_hash].id,
        feature_types=tuple(feature_code(t) for t in side.feature_types_present),
        owned_feature_types=tuple(feature_code(t) for t in side.owned_feature_types),
        aio_state=side.aio_state,
        cited_in_ai_overview=side.cited_in_ai_overview,
        aio_citation_position=side.aio_citation_position,
        target_url_match=target_matches,
    )
