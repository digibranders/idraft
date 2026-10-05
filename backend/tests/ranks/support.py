"""Builders for the rank rules' tests: a parsed SERP from a list of URLs, domain rules, checks."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sightline.extraction.domains import DomainResolver, DomainRule, MatchScope, ProjectRole
from sightline.extraction.urls import normalize_host
from sightline.providers.dataforseo.serp_parse import NormalizedSerp, parse_serp
from sightline.ranks.resolve import AioState
from sightline.ranks.state import Check

START = datetime(2026, 10, 1, 2, 0, tzinfo=UTC)

OWN = uuid.UUID("00000000-0000-0000-0000-0000000000a1")
OWN_BLOG = uuid.UUID("00000000-0000-0000-0000-0000000000a2")
RIVAL = uuid.UUID("00000000-0000-0000-0000-0000000000b1")
OTHER_RIVAL = uuid.UUID("00000000-0000-0000-0000-0000000000b2")
WATCHED = uuid.UUID("00000000-0000-0000-0000-0000000000c1")


def organic(rank: int, url: str, **more: Any) -> dict[str, Any]:
    return {
        "type": "organic",
        "rank_group": rank,
        "rank_absolute": rank,
        "position": "left",
        "title": f"Result {rank}",
        "description": "A snippet.",
        "url": url,
        **more,
    }


def serp_of(
    *urls: str,
    extra: list[dict[str, Any]] | None = None,
    more: dict[int, dict[str, Any]] | None = None,
) -> NormalizedSerp:
    """A SERP with these URLs at ranks 1, 2, 3, and any other items after them; `more` adds
    fields to the organic item at a rank."""
    items: list[dict[str, Any]] = [
        organic(i, url, **(more or {}).get(i, {})) for i, url in enumerate(urls, start=1)
    ]
    items.extend(extra or [])
    return parse_serp(
        {
            "tasks": [
                {
                    "status_code": 20000,
                    "result": [
                        {
                            "keyword": "crm",
                            "datetime": "2026-10-01 09:12:44 +00:00",
                            "items": items,
                        }
                    ],
                }
            ]
        }
    )


def rule(
    entity_id: uuid.UUID,
    role: ProjectRole,
    host: str,
    scope: MatchScope = "registrable",
    path_prefix: str | None = None,
) -> DomainRule:
    return DomainRule(entity_id, role, scope, normalize_host(host), path_prefix)


def resolver(*rules: DomainRule) -> DomainResolver:
    return DomainResolver(rules)


def check(
    *,
    day: int = 0,
    rank: int | None,
    depth: int = 20,
    url_id: int | None = None,
    snapshot_id: int | None = None,
    owned: tuple[str, ...] = (),
    aio: AioState = "absent",
    cited: bool | None = None,
) -> Check:
    return Check(
        snapshot_id=snapshot_id if snapshot_id is not None else day + 1,
        observed_at=START + timedelta(days=day),
        depth_requested=depth,
        rank=rank,
        absolute_rank=rank,
        url_id=(url_id if url_id is not None else 1) if rank is not None else None,
        feature_types=(),
        owned_feature_types=owned,
        aio_state=aio,
        cited_in_ai_overview=cited,
        aio_citation_position=None,
        target_url_match=None,
    )
