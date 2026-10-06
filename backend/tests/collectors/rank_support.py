"""A world for the rank ingest tests: a project with an own brand and a rival, tracked keywords,
and fetched rank tasks holding a stored SERP answer."""

from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.collectors import ledger
from sightline.collectors.fetching import RETENTION_CLASS
from sightline.collectors.ledger import NewTask
from sightline.collectors.raw_payloads import RawPayload, store_raw_payload
from sightline.domain.workloads import TaskWorkload
from sightline.providers.dataforseo import serp as serp_endpoint
from tests.api.auth.support import execute, fetchrow
from tests.api.keywords.support import LOCATION, ensure_locations
from tests.collectors.support import NOW, Project, make_tenant
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer

Ledger = async_sessionmaker[AsyncSession]
DAY = timedelta(days=1)
OWN_HOST = "acme-rank.example"
RIVAL_HOST = "rival-rank.example"


@dataclass(frozen=True)
class World:
    project: Project
    own: uuid.UUID
    rival: uuid.UUID


async def _entity(
    pg: PostgresServer, project: Project, name: str, host: str, role: str, *, primary: bool = False
) -> uuid.UUID:
    entity = await fetchrow(
        pg,
        "INSERT INTO core.entities (workspace_id, entity_type, canonical_name) "
        "VALUES ($1, 'brand', $2) RETURNING id",
        project.workspace_id,
        name,
    )
    domain = await fetchrow(
        pg,
        "INSERT INTO core.domains (host, registrable_domain, public_suffix) "
        "VALUES ($1, $1, 'example') "
        "ON CONFLICT (host) DO UPDATE SET host = excluded.host RETURNING id",
        host,
    )
    await execute(
        pg,
        "INSERT INTO core.entity_domains (entity_id, workspace_id, domain_id) VALUES ($1, $2, $3)",
        entity["id"],
        project.workspace_id,
        domain["id"],
    )
    await execute(
        pg,
        "INSERT INTO core.project_entities (project_id, entity_id, workspace_id, role, is_primary) "
        "VALUES ($1, $2, $3, $4, $5)",
        project.id,
        entity["id"],
        project.workspace_id,
        role,
        primary,
    )
    entity_id: uuid.UUID = entity["id"]
    return entity_id


async def make_world(pg: PostgresServer) -> World:
    """A project that owns `OWN_HOST` and competes with `RIVAL_HOST`."""
    project = await make_tenant(pg)
    await ensure_locations(pg)
    own = await _entity(pg, project, "Acme", OWN_HOST, "own", primary=True)
    rival = await _entity(pg, project, "Rival", RIVAL_HOST, "competitor")
    return World(project, own, rival)


async def add_competitor(pg: PostgresServer, world: World, host: str) -> uuid.UUID:
    """Another competitor of the world's project."""
    return await _entity(pg, world.project, host, host, "competitor")


async def track(
    pg: PostgresServer,
    project: Project,
    text: str = "best crm",
    *,
    device: str = "desktop",
    deleted: bool = False,
) -> uuid.UUID:
    keyword = await fetchrow(
        pg,
        "INSERT INTO seo.keywords (workspace_id, text, normalized_text, language_code) "
        "VALUES ($1, $2, $2, 'en') ON CONFLICT (workspace_id, normalized_text, language_code) "
        "DO UPDATE SET text = seo.keywords.text RETURNING id",
        project.workspace_id,
        text,
    )
    tracked = await fetchrow(
        pg,
        "INSERT INTO seo.tracked_keywords (workspace_id, project_id, keyword_id, location_id, "
        "language_code, device, deleted_at) VALUES ($1, $2, $3, $4, 'en', $5, $6) RETURNING id",
        project.workspace_id,
        project.id,
        keyword["id"],
        LOCATION,
        device,
        NOW if deleted else None,
    )
    tracked_id: uuid.UUID = tracked["id"]
    return tracked_id


def answer(
    urls: list[str],
    *,
    depth: int = 20,
    when: datetime | None = None,
    device: str = "desktop",
    echo: bool = True,
    extra: list[dict[str, Any]] | None = None,
    ranks: list[int] | None = None,
) -> bytes:
    """A `task_get/advanced` answer listing these URLs from rank 1 (or at `ranks`)."""
    items: list[dict[str, Any]] = [
        {
            "type": "organic",
            "rank_group": rank,
            "rank_absolute": rank,
            "position": "left",
            "title": f"Result {rank}",
            "description": "A snippet.",
            "url": url,
        }
        for rank, url in zip(ranks or range(1, len(urls) + 1), urls, strict=True)
    ]
    items.extend(extra or [])
    task: dict[str, Any] = {
        "status_code": 20000,
        "result": [
            {
                "keyword": "best crm",
                "se_domain": "google.com",
                "datetime": (when or NOW).strftime("%Y-%m-%d %H:%M:%S +00:00"),
                "item_types": ["organic"],
                "se_results_count": 1000,
                "items": items,
            }
        ],
    }
    if echo:
        task["data"] = {"depth": depth, "device": device, "language_code": "en", "os": "windows"}
    return json.dumps({"status_code": 20000, "tasks": [task]}).encode()


async def fetched_task(
    sessions: Ledger,
    pg: PostgresServer,
    world: World,
    tracked_id: uuid.UUID | str,
    body: bytes,
    store: MemoryStore,
    *,
    fetched_at: datetime | None = None,
    cost: str = "0.0006",
) -> int:
    """A run of one task, fetched, with `body` as its stored answer. Returns the task id."""
    project = world.project
    run = ledger.NewRun(
        workspace_id=project.workspace_id,
        project_id=project.id,
        schedule_id=None,
        workload=TaskWorkload.SEO_RANK,
        window_start=NOW,
        window_end=NOW + timedelta(hours=1),
        trigger="manual",
        config_snapshot={},
    )
    async with sessions() as db, db.begin():
        run_id = await ledger.create_run(db, run, now=NOW)
        assert run_id is not None
        subject = f"{tracked_id}:20" if isinstance(tracked_id, uuid.UUID) else str(tracked_id)
        await ledger.insert_tasks(
            db,
            run_id,
            [
                NewTask(
                    subject_type="tracked_keyword",
                    subject_id=subject,
                    engine_code=None,
                    location_id=LOCATION,
                    replicate_index=1,
                    depth=20,
                    request_fingerprint=hashlib.sha256(uuid.uuid4().bytes).digest(),
                    provider_code="dataforseo",
                    provider_endpoint=serp_endpoint.SERP_ORGANIC,
                    scheduled_for=NOW,
                )
            ],
        )
        await ledger.start_run(db, run_id, tasks_total=1, estimated_cost_usd=Decimal(0))
    payload_id = await store_raw_payload(
        sessions,
        store,
        RawPayload(
            body=body,
            content_type="application/json",
            provider_code="dataforseo",
            provider_endpoint=serp_endpoint.SERP_ORGANIC,
            endpoint_slug=serp_endpoint.ENDPOINT.payload_slug,
            retention_class=RETENTION_CLASS[TaskWorkload.SEO_RANK],
        ),
    )
    row = await fetchrow(
        pg,
        "UPDATE ops.collection_tasks SET status = 'fetched', raw_payload_id = $2, "
        "ready_source = 'poll', ready_at = $3, provider_task_id = 'p-' || id::text, "
        "cost_usd = $4 WHERE run_id = $1 RETURNING id",
        run_id,
        payload_id,
        fetched_at or NOW,
        Decimal(cost),
    )
    task_id: int = row["id"]
    return task_id
