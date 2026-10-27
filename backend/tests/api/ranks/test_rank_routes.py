"""Rank history, SERP snapshots, features, AI Overview history and rank events (plan Task 8,
docs/19 section 3.6.4). The data is made by the ingest itself."""

from __future__ import annotations

import gzip
import hashlib
import uuid
from typing import Any

import httpx
import pytest

from idraft.api.resources import Resources
from tests.api.auth.support import Workspace, execute, fetchrow
from tests.api.entities.support import Caller, member
from tests.api.keywords.support import errors, keyword_project, project_url, tracked_id
from tests.api.keywords.test_tracked_keyword_ranks import (
    DAY,
    Ledger,
    _check,
    _results,
    _world,
    worker_db,
)
from tests.collectors.rank_support import OWN_HOST, RIVAL_HOST, World
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer

__all__ = ["worker_db"]


async def _get(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project: uuid.UUID,
    caller: Caller,
    *parts: object,
    **params: Any,
) -> httpx.Response:
    return await api.get(
        project_url(workspace, project, *parts), params=params, headers=caller.headers
    )


@pytest.fixture
async def history(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
) -> tuple[Workspace, uuid.UUID, Caller, World, str]:
    """One keyword with four checks over four days: deep, beyond, ranked (with a video and an
    AI Overview that cites the project), and a daily rank; a fifth check that failed."""
    workspace, project, owner, world = await _world(resources, migrated)
    tracked = await tracked_id(api, workspace, project, owner, "crm")
    video = {
        "type": "video",
        "rank_absolute": 2,
        "position": "left",
        "items": [{"url": f"https://www.{OWN_HOST}/video"}, {"url": f"https://{RIVAL_HOST}/v"}],
    }
    aio = {
        "type": "ai_overview",
        "rank_absolute": 1,
        "position": "left",
        "asynchronous_ai_overview": False,
        "references": [
            {"url": f"https://www.{OWN_HOST}/pricing"},
            {"url": f"https://{RIVAL_HOST}/crm"},
        ],
        "items": [{"type": "ai_overview_element", "text": "x"}],
    }
    await _check(
        worker_db,
        migrated,
        world,
        tracked,
        _results(30, 9, total=40),
        days_ago=3,
        depth=100,
        store=import_store,
    )
    await _check(
        worker_db, migrated, world, tracked, _results(None, 9), days_ago=2, store=import_store
    )
    await _check(
        worker_db, migrated, world, tracked, _results(None, 7), days_ago=1, store=import_store
    )
    await _check(
        worker_db, migrated, world, tracked, _results(6, 7), extra=[video, aio], store=import_store
    )
    return workspace, project, owner, world, tracked


async def test_a_history_is_one_point_per_check_with_beyond_depth_never_ranked(
    api: httpx.AsyncClient, history: tuple[Workspace, uuid.UUID, Caller, World, str]
) -> None:
    workspace, project, owner, world, tracked = history

    response = await _get(
        api,
        workspace,
        project,
        owner,
        "tracked-keywords",
        tracked,
        "rank-history",
        include="absolute,url,events",
    )

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    own, rival = data["series"]
    assert own["entity"]["entity_id"] == str(world.own)
    assert rival["entity"]["entity_id"] == str(world.rival)
    assert [(p["state"], p["rank"], p["depth_requested"]) for p in own["points"]] == [
        ("ranked", 30, 100),
        ("beyond_depth", None, 20),
        ("beyond_depth", None, 20),
        ("ranked", 6, 20),
    ]
    assert all(p["rank"] is None for p in own["points"] if p["state"] != "ranked")
    assert own["points"][3]["absolute_rank"] == 6
    assert own["points"][3]["url_id"] in data["urls"]
    assert [p["rank"] for p in rival["points"]] == [9, 9, 7, 7]
    assert data["bands"] == [
        {
            "entity_id": str(world.own),
            "from": own["points"][1]["date"],
            "to": own["points"][2]["date"],
            "kind": "beyond_depth",
            "depth_requested": 20,
            "label": "not in top 20",
        }
    ]
    assert data["summary"]["checks"] == 4
    assert (data["summary"]["ranked_checks"], data["summary"]["beyond_depth_checks"]) == (2, 2)
    assert data["summary"]["average_rank"]["value"] == 18.0
    assert data["summary"]["average_rank"]["numerator"] == 36.0
    assert data["deep_check_weekday"] == 1
    types = {e["event_type"] for e in data["events"]}
    assert {"entered_top_10", "entered_top_20"} <= types
    # The deep check saw it at 30; the daily check cannot see below 20, so nothing was lost.
    assert "lost_top_20" not in types
    assert data["window"]["timezone"] == "UTC"
    assert data["columns"] is None


async def test_a_history_in_columns_has_the_same_data_as_parallel_arrays(
    api: httpx.AsyncClient, history: tuple[Workspace, uuid.UUID, Caller, World, str]
) -> None:
    workspace, project, owner, _, tracked = history

    points = (
        await _get(api, workspace, project, owner, "tracked-keywords", tracked, "rank-history")
    ).json()["data"]["series"]
    columns = (
        await _get(
            api,
            workspace,
            project,
            owner,
            "tracked-keywords",
            tracked,
            "rank-history",
            format="columns",
        )
    ).json()["data"]

    assert columns["series"] is None
    for series, column in zip(points, columns["columns"], strict=True):
        assert column["rank"] == [p["rank"] for p in series["points"]]
        assert column["state"] == [p["state"] for p in series["points"]]
        assert column["serp_snapshot_id"] == [p["serp_snapshot_id"] for p in series["points"]]
        assert column["absolute_rank"] == [None] * len(series["points"])


async def test_a_failed_check_is_a_point_and_a_chosen_entity_narrows_the_series(
    api: httpx.AsyncClient,
    history: tuple[Workspace, uuid.UUID, Caller, World, str],
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
) -> None:
    workspace, project, owner, world, tracked = history
    await _check(
        worker_db,
        migrated,
        world,
        tracked,
        _results(6),
        days_ago=1,
        store=import_store,
        ingest_it=False,
    )
    await execute(
        migrated,
        "UPDATE ops.collection_tasks SET status = 'failed' "
        "WHERE subject_id LIKE $1 || ':%' AND status = 'fetched'",
        tracked,
    )

    data = (
        await _get(
            api,
            workspace,
            project,
            owner,
            "tracked-keywords",
            tracked,
            "rank-history",
            entity_ids=str(world.rival),
        )
    ).json()["data"]

    (rival,) = data["series"]
    assert rival["entity"]["canonical_name"] == "Rival"
    failed = [p for p in rival["points"] if p["state"] == "failed"]
    assert len(failed) == 1
    assert failed[0]["rank"] is None
    assert failed[0]["depth_requested"] is None
    # The summary is the project\'s own: a rival alone has none, the own series has the failure.
    assert data["summary"]["failed_checks"] == 0
    own = (
        await _get(
            api,
            workspace,
            project,
            owner,
            "tracked-keywords",
            tracked,
            "rank-history",
            entity_ids="own",
        )
    ).json()["data"]
    assert own["summary"]["failed_checks"] == 1


async def test_the_window_is_bounded_and_named(
    api: httpx.AsyncClient, history: tuple[Workspace, uuid.UUID, Caller, World, str]
) -> None:
    workspace, project, owner, _, tracked = history

    async def ask(**params: Any) -> httpx.Response:
        return await _get(
            api, workspace, project, owner, "tracked-keywords", tracked, "rank-history", **params
        )

    too_large = await ask(**{"from": "2024-01-01", "to": "2026-10-01"})
    inverted = await ask(**{"from": "2026-10-03", "to": "2026-10-01"})
    unknown = await ask(window="last_9y")
    week = await ask(window="last_7d")

    assert too_large.status_code == 422
    assert too_large.json()["code"] == "window_too_large"
    assert errors(inverted) == [("from", "range_invalid")]
    assert errors(unknown) == [("window", "invalid_window")]
    assert week.status_code == 200
    assert week.json()["data"]["window"]["from"] < week.json()["data"]["window"]["to"]


async def test_a_config_change_is_a_version_boundary(
    api: httpx.AsyncClient, history: tuple[Workspace, uuid.UUID, Caller, World, str]
) -> None:
    workspace, project, owner, _, tracked = history
    changed = await api.patch(
        project_url(workspace, project, "tracked-keywords", tracked),
        json={"depth_profile": "deep"},
        headers=owner.headers,
    )
    assert changed.status_code == 200

    data = (
        await _get(api, workspace, project, owner, "tracked-keywords", tracked, "rank-history")
    ).json()["data"]

    assert [c["config_version"] for c in data["config_history"]] == [1, 2]
    assert [(b["from"], b["to"], b["component"]) for b in data["version_boundaries"]] == [
        (1, 2, "tracked_keyword_config")
    ]


async def test_snapshots_page_newest_first_with_the_own_rank_and_filters(
    api: httpx.AsyncClient, history: tuple[Workspace, uuid.UUID, Caller, World, str]
) -> None:
    workspace, project, owner, _, tracked = history

    first = await _get(
        api, workspace, project, owner, "tracked-keywords", tracked, "serp-snapshots", limit=3
    )
    second = await _get(
        api,
        workspace,
        project,
        owner,
        "tracked-keywords",
        tracked,
        "serp-snapshots",
        limit=3,
        cursor=first.json()["page"]["next_cursor"],
    )
    deep = await _get(
        api,
        workspace,
        project,
        owner,
        "tracked-keywords",
        tracked,
        "serp-snapshots",
        **{"filter[depth_requested]": 100},
    )
    with_aio = await _get(
        api,
        workspace,
        project,
        owner,
        "tracked-keywords",
        tracked,
        "serp-snapshots",
        **{"filter[has_ai_overview]": "true"},
    )
    stolen = await _get(
        api,
        workspace,
        project,
        owner,
        "tracked-keywords",
        tracked,
        "serp-snapshots",
        limit=3,
        cursor=first.json()["page"]["next_cursor"],
        **{"filter[depth_requested]": 20},
    )

    rows = first.json()["data"] + second.json()["data"]
    assert [r["own"]["rank"] for r in rows] == [6, None, None, 30]
    assert [r["own"]["state"] for r in rows] == ["ranked", "beyond_depth", "beyond_depth", "ranked"]
    assert rows == sorted(rows, key=lambda r: r["observed_at"], reverse=True)
    assert first.json()["page"]["has_more"] is True
    assert second.json()["page"]["has_more"] is False
    assert [r["depth_requested"] for r in deep.json()["data"]] == [100]
    assert [r["own"]["rank"] for r in with_aio.json()["data"]] == [6]
    assert stolen.status_code == 400


async def test_the_current_top_results_name_their_entities(
    api: httpx.AsyncClient, history: tuple[Workspace, uuid.UUID, Caller, World, str]
) -> None:
    workspace, project, owner, _, tracked = history

    data = (
        await _get(api, workspace, project, owner, "tracked-keywords", tracked, "serp-current")
    ).json()["data"]

    by_rank = {r["organic_rank"]: r for r in data["results"]}
    assert len(by_rank) == 12
    assert by_rank[6]["entity"]["canonical_name"] == "Acme"
    assert by_rank[7]["entity"]["canonical_name"] == "Rival"
    assert by_rank[1]["entity"] is None
    assert by_rank[6]["domain"]["host"] == f"www.{OWN_HOST}"
    assert data["serp_snapshot_id"] is not None


async def test_a_snapshot_detail_has_its_organic_features_and_provenance(
    api: httpx.AsyncClient, history: tuple[Workspace, uuid.UUID, Caller, World, str]
) -> None:
    workspace, project, owner, _, tracked = history
    latest = (
        await _get(
            api, workspace, project, owner, "tracked-keywords", tracked, "serp-snapshots", limit=1
        )
    ).json()["data"][0]

    plain = await _get(api, workspace, project, owner, "serp-snapshots", latest["serp_snapshot_id"])
    titled = await _get(
        api,
        workspace,
        project,
        owner,
        "serp-snapshots",
        latest["serp_snapshot_id"],
        include="titles",
    )

    detail = titled.json()["data"]
    assert detail["own"]["rank"] == 6
    assert len(detail["organic"]) == 12
    assert detail["organic"][5]["entity"]["canonical_name"] == "Acme"
    assert detail["organic"][5]["title"] == "Result 6"
    assert detail["titles_source"] in ("serp_current_results", "domain_rank_observations")
    assert {f["feature_type"] for f in detail["features"]} == {"video", "ai_overview"}
    assert detail["provenance"]["parser_version"] == 1
    assert detail["provenance"]["raw_payload_id"] is not None
    assert plain.json()["data"]["organic"][5]["title"] is None
    assert plain.json()["data"]["titles_source"] == "unavailable"


async def test_a_snapshot_of_another_project_or_workspace_is_not_found(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    history: tuple[Workspace, uuid.UUID, Caller, World, str],
) -> None:
    workspace, project, owner, _, tracked = history
    latest = (
        await _get(
            api, workspace, project, owner, "tracked-keywords", tracked, "serp-snapshots", limit=1
        )
    ).json()["data"][0]["serp_snapshot_id"]
    sibling = await keyword_project(migrated, workspace)
    stranger_workspace = await _workspace_with_owner(resources, migrated)

    in_sibling = await _get(api, workspace, sibling, owner, "serp-snapshots", latest)
    raw_in_sibling = await _get(api, workspace, sibling, owner, "serp-snapshots", latest, "raw")
    elsewhere = await _get(
        api,
        stranger_workspace[0],
        stranger_workspace[1],
        stranger_workspace[2],
        "serp-snapshots",
        latest,
    )
    unknown = await _get(api, workspace, project, owner, "serp-snapshots", 999999999)

    for response in (in_sibling, raw_in_sibling, elsewhere, unknown):
        assert response.status_code == 404


async def _workspace_with_owner(
    resources: Resources, pg: PostgresServer
) -> tuple[Workspace, uuid.UUID, Caller]:
    other = await _world(resources, pg)
    return other[0], other[1], other[2]


async def test_the_raw_answer_is_returned_as_received_and_never_inline(
    api: httpx.AsyncClient,
    history: tuple[Workspace, uuid.UUID, Caller, World, str],
    import_store: MemoryStore,
) -> None:
    workspace, project, owner, _, tracked = history
    latest = (
        await _get(
            api, workspace, project, owner, "tracked-keywords", tracked, "serp-snapshots", limit=1
        )
    ).json()["data"][0]["serp_snapshot_id"]

    response = await _get(api, workspace, project, owner, "serp-snapshots", latest, "raw")

    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("application/json")
    assert response.headers["content-disposition"].startswith("attachment")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["content-security-policy"] == "sandbox"
    assert response.json()["tasks"][0]["result"][0]["keyword"] == "best crm"
    assert import_store.objects


async def test_a_raw_answer_past_its_retention_is_gone_and_a_lost_one_is_unavailable(
    api: httpx.AsyncClient,
    history: tuple[Workspace, uuid.UUID, Caller, World, str],
    migrated: PostgresServer,
    import_store: MemoryStore,
) -> None:
    workspace, project, owner, _, tracked = history
    latest = (
        await _get(
            api, workspace, project, owner, "tracked-keywords", tracked, "serp-snapshots", limit=1
        )
    ).json()["data"][0]["serp_snapshot_id"]
    stored = dict(import_store.objects)
    import_store.objects.clear()

    lost = await _get(api, workspace, project, owner, "serp-snapshots", latest, "raw")
    import_store.objects.update(stored)
    row = await fetchrow(
        migrated, "SELECT raw_payload_id FROM seo.serp_snapshots WHERE id = $1", int(latest)
    )
    await execute(
        migrated,
        "UPDATE ops.raw_payloads SET expires_at = now() - interval '1 day' WHERE id = $1",
        row["raw_payload_id"],
    )
    expired = await _get(api, workspace, project, owner, "serp-snapshots", latest, "raw")

    assert lost.status_code == 503
    assert lost.json()["code"] == "raw_unavailable"
    assert expired.status_code == 410
    assert expired.json()["code"] == "raw_expired"


async def test_a_viewer_cannot_read_a_raw_answer_but_can_read_the_facts(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    history: tuple[Workspace, uuid.UUID, Caller, World, str],
) -> None:
    workspace, project, _, _, tracked = history
    viewer = await member(resources, migrated, workspace, "viewer")
    latest = (
        await _get(
            api, workspace, project, viewer, "tracked-keywords", tracked, "serp-snapshots", limit=1
        )
    ).json()["data"][0]["serp_snapshot_id"]

    facts = await _get(api, workspace, project, viewer, "serp-snapshots", latest)
    raw = await _get(api, workspace, project, viewer, "serp-snapshots", latest, "raw")

    assert facts.status_code == 200
    assert raw.status_code == 403


async def test_features_are_listed_per_check_with_presence_and_ownership_rates(
    api: httpx.AsyncClient, history: tuple[Workspace, uuid.UUID, Caller, World, str]
) -> None:
    workspace, project, owner, _, tracked = history

    data = (
        await _get(api, workspace, project, owner, "tracked-keywords", tracked, "serp-features")
    ).json()["data"]
    only_video = (
        await _get(
            api,
            workspace,
            project,
            owner,
            "tracked-keywords",
            tracked,
            "serp-features",
            **{"filter[feature_type_in]": "video"},
        )
    ).json()["data"]

    assert len(data["checks"]) == 4
    assert [len(c["features"]) for c in data["checks"]] == [2, 0, 0, 0]
    presence = {p["feature_type"]: p for p in data["presence"]}
    assert presence["video"]["presence_rate"]["value"] == 0.25
    assert presence["video"]["own_ownership_rate"]["value"] == 1.0
    assert [p["feature_type"] for p in only_video["presence"]] == ["video"]
    video = next(f for c in data["checks"] for f in c["features"] if f["feature_type"] == "video")
    assert video["owned_by_project"] is True
    assert len(video["source_urls"]) == 2


async def test_aio_history_says_who_was_cited(
    api: httpx.AsyncClient, history: tuple[Workspace, uuid.UUID, Caller, World, str]
) -> None:
    workspace, project, owner, _, tracked = history

    data = (
        await _get(api, workspace, project, owner, "tracked-keywords", tracked, "aio-history")
    ).json()["data"]

    newest = data[0]
    assert (newest["ai_overview_state"], newest["own_cited"]) == ("present_cited", True)
    assert newest["own_citation_position"] == 1
    assert [e["canonical_name"] for e in newest["competitors_cited"]] == ["Rival"]
    assert newest["source_count"] == 2
    assert newest["organic_rank"]["rank"] == 6
    assert {item["ai_overview_state"] for item in data[1:]} == {"absent"}
    assert all(item["own_cited"] is None for item in data[1:])


async def test_rank_events_page_newest_first_and_filter(
    api: httpx.AsyncClient, history: tuple[Workspace, uuid.UUID, Caller, World, str]
) -> None:
    workspace, project, owner, world, tracked = history

    everything = (
        await _get(api, workspace, project, owner, "seo", "rank-events", limit=200)
    ).json()
    first = await _get(api, workspace, project, owner, "seo", "rank-events", limit=2)
    second = await _get(
        api,
        workspace,
        project,
        owner,
        "seo",
        "rank-events",
        limit=2,
        cursor=first.json()["page"]["next_cursor"],
    )
    only_entered = await _get(
        api,
        workspace,
        project,
        owner,
        "seo",
        "rank-events",
        **{"filter[event_type_in]": "entered_top_10"},
    )
    other_entity = await _get(
        api,
        workspace,
        project,
        owner,
        "seo",
        "rank-events",
        **{"filter[entity_id]": str(world.rival)},
    )
    one_keyword = await _get(
        api,
        workspace,
        project,
        owner,
        "seo",
        "rank-events",
        **{"filter[tracked_keyword_id]": tracked},
    )

    ids = [e["rank_event_id"] for e in everything["data"]]
    assert ids == sorted(ids, key=int, reverse=True)
    assert [e["rank_event_id"] for e in first.json()["data"] + second.json()["data"]] == ids[:4]
    assert {e["event_type"] for e in only_entered.json()["data"]} == {"entered_top_10"}
    assert other_entity.json()["data"] == []
    assert len(one_keyword.json()["data"]) == len(ids)
    event = next(e for e in everything["data"] if e["event_type"] == "entered_top_10")
    assert event["keyword"] == "crm"
    assert event["entity"]["entity_id"] == str(world.own)
    assert event["tracked_keyword_id"] == tracked
    assert DAY.days == 1


# Cases from the review of the routes.


async def test_the_summary_is_the_own_sites_whatever_order_the_entities_come_in(
    api: httpx.AsyncClient, history: tuple[Workspace, uuid.UUID, Caller, World, str]
) -> None:
    workspace, project, owner, world, tracked = history

    rival_first = (
        await _get(
            api,
            workspace,
            project,
            owner,
            "tracked-keywords",
            tracked,
            "rank-history",
            entity_ids=f"{world.rival},{world.own},{world.own}",
        )
    ).json()["data"]
    only_rival = (
        await _get(
            api,
            workspace,
            project,
            owner,
            "tracked-keywords",
            tracked,
            "rank-history",
            entity_ids=str(world.rival),
        )
    ).json()["data"]
    own_token = (
        await _get(
            api,
            workspace,
            project,
            owner,
            "tracked-keywords",
            tracked,
            "rank-history",
            entity_ids="own",
        )
    ).json()["data"]

    assert [s["entity"]["entity_id"] for s in rival_first["series"]] == [
        str(world.rival),
        str(world.own),
    ]
    assert rival_first["summary"]["average_rank"]["value"] == 18.0
    assert only_rival["summary"]["average_rank"] is None
    assert only_rival["summary"]["checks"] == 0
    assert [s["entity"]["entity_id"] for s in own_token["series"]] == [str(world.own)]
    assert rival_first["series"][0]["entity"]["role"] == "competitor"


async def test_the_window_error_is_a_problem_code_of_its_own(
    api: httpx.AsyncClient, history: tuple[Workspace, uuid.UUID, Caller, World, str]
) -> None:
    workspace, project, owner, _, tracked = history

    response = await _get(
        api,
        workspace,
        project,
        owner,
        "tracked-keywords",
        tracked,
        "rank-history",
        **{"from": "2024-01-01", "to": "2026-10-01"},
    )

    assert response.status_code == 422
    assert response.json()["code"] == "window_too_large"
    assert response.json()["limit_days"] == 400


async def test_a_snapshot_of_a_deleted_keyword_or_project_is_gone(
    api: httpx.AsyncClient,
    migrated: PostgresServer,
    history: tuple[Workspace, uuid.UUID, Caller, World, str],
) -> None:
    workspace, project, owner, _, tracked = history
    latest = (
        await _get(
            api, workspace, project, owner, "tracked-keywords", tracked, "serp-snapshots", limit=1
        )
    ).json()["data"][0]["serp_snapshot_id"]
    assert (await _get(api, workspace, project, owner, "serp-snapshots", latest)).status_code == 200
    events_before = (await _get(api, workspace, project, owner, "seo", "rank-events")).json()[
        "data"
    ]
    assert events_before

    await execute(
        migrated,
        "UPDATE seo.tracked_keywords SET deleted_at = now() WHERE id = $1",
        uuid.UUID(tracked),
    )

    assert (await _get(api, workspace, project, owner, "serp-snapshots", latest)).status_code == 404
    assert (
        await _get(api, workspace, project, owner, "serp-snapshots", latest, "raw")
    ).status_code == 404
    assert (await _get(api, workspace, project, owner, "seo", "rank-events")).json()["data"] == []


async def test_an_id_no_sequence_can_reach_is_a_validation_error_not_a_crash(
    api: httpx.AsyncClient, history: tuple[Workspace, uuid.UUID, Caller, World, str]
) -> None:
    workspace, project, owner, _, _ = history

    response = await _get(api, workspace, project, owner, "serp-snapshots", "100000000000000000000")

    assert response.status_code == 422


async def test_the_observed_at_hint_only_chooses_the_month(
    api: httpx.AsyncClient, history: tuple[Workspace, uuid.UUID, Caller, World, str]
) -> None:
    workspace, project, owner, _, tracked = history
    latest = (
        await _get(
            api, workspace, project, owner, "tracked-keywords", tracked, "serp-snapshots", limit=1
        )
    ).json()["data"][0]
    hint = latest["observed_at"][:8] + "01T00:00:00Z"
    far = "2020-01-01T00:00:00Z"

    near = await _get(
        api,
        workspace,
        project,
        owner,
        "serp-snapshots",
        latest["serp_snapshot_id"],
        observed_at=hint,
    )
    wrong = await _get(
        api,
        workspace,
        project,
        owner,
        "serp-snapshots",
        latest["serp_snapshot_id"],
        observed_at=far,
    )

    assert near.status_code == 200
    assert wrong.status_code == 404


async def test_an_inline_raw_answer_is_checked_and_a_damaged_one_is_unavailable(
    api: httpx.AsyncClient,
    migrated: PostgresServer,
    history: tuple[Workspace, uuid.UUID, Caller, World, str],
) -> None:
    workspace, project, owner, _, tracked = history
    latest = (
        await _get(
            api, workspace, project, owner, "tracked-keywords", tracked, "serp-snapshots", limit=1
        )
    ).json()["data"][0]["serp_snapshot_id"]
    body = b'{"tasks": ["inline"]}'
    row = await fetchrow(
        migrated, "SELECT raw_payload_id FROM seo.serp_snapshots WHERE id = $1", int(latest)
    )
    stored = hashlib.sha256(body).digest()

    async def keep(inline: bytes, compression: str, sha: bytes) -> httpx.Response:
        await execute(
            migrated,
            "UPDATE ops.raw_payloads SET storage = 'pg_inline', object_key = NULL, "
            "inline_body = $2, compression = $3, sha256 = $4 WHERE id = $1",
            row["raw_payload_id"],
            inline,
            compression,
            sha,
        )
        return await _get(api, workspace, project, owner, "serp-snapshots", latest, "raw")

    plain = await keep(body, "none", stored)
    zipped = await keep(gzip.compress(body), "gzip", stored)
    wrong_hash = await keep(body, "none", hashlib.sha256(b"other").digest())
    damaged = await keep(b"\x00\x01\x02", "zstd", stored)

    assert plain.status_code == 200
    assert plain.json() == {"tasks": ["inline"]}
    assert zipped.status_code == 200
    assert wrong_hash.status_code == 503
    assert damaged.status_code == 503


async def test_rank_events_take_dates_as_project_days_and_timestamps_as_instants(
    api: httpx.AsyncClient, history: tuple[Workspace, uuid.UUID, Caller, World, str]
) -> None:
    workspace, project, owner, _, _ = history
    everything = (
        await _get(api, workspace, project, owner, "seo", "rank-events", limit=200)
    ).json()["data"]
    day = everything[0]["occurred_at"][:10]

    that_day = (
        await _get(
            api,
            workspace,
            project,
            owner,
            "seo",
            "rank-events",
            limit=200,
            **{"from": day, "to": day},
        )
    ).json()["data"]
    after = (
        await _get(
            api,
            workspace,
            project,
            owner,
            "seo",
            "rank-events",
            **{"from": everything[0]["occurred_at"]},
        )
    ).json()["data"]
    naive = await _get(
        api, workspace, project, owner, "seo", "rank-events", **{"from": "2026-10-01T10:00:00"}
    )
    too_wide = await _get(
        api, workspace, project, owner, "seo", "rank-events", **{"from": "2020-01-01"}
    )

    assert {e["rank_event_id"] for e in that_day} >= {
        e["rank_event_id"] for e in everything if e["occurred_at"][:10] == day
    }
    assert all(e["occurred_at"] >= everything[0]["occurred_at"] for e in after)
    assert naive.status_code == 422
    assert too_wide.status_code == 422
    assert too_wide.json()["code"] == "window_too_large"


async def test_rank_events_of_a_project_that_is_not_there_are_not_found(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    history: tuple[Workspace, uuid.UUID, Caller, World, str],
) -> None:
    workspace, _, owner, _, _ = history

    response = await _get(api, workspace, uuid.uuid4(), owner, "seo", "rank-events")

    assert response.status_code == 404
