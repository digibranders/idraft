"""Cannibalization and Switching reads over checks made by the ingest itself (docs/33)."""

from __future__ import annotations

import uuid
from typing import Any

import httpx
import pytest

from idraft.api.cannibalization.model import Result, Window, analyse_all, conflicts_by_page
from idraft.api.cannibalization.repository import KeywordSeries
from idraft.api.resources import Resources
from idraft.ranks.cannibalization import Check
from tests.api.auth.support import Workspace
from tests.api.entities.support import Caller
from tests.api.keywords.support import project_url, tracked_id
from tests.api.keywords.test_tracked_keyword_ranks import Ledger, _check, _world, worker_db
from tests.collectors.rank_support import OWN_HOST
from tests.conftest import PostgresServer

__all__ = ["worker_db"]

PRICING = f"https://www.{OWN_HOST}/pricing"
GUIDE = f"https://www.{OWN_HOST}/guide"
CHECKS = 12


def _serp(*placed: tuple[str, int]) -> list[str]:
    urls = [f"https://elsewhere-{i}.example/page" for i in range(1, 21)]
    for url, rank in placed:
        urls[rank - 1] = url
    return urls


async def _get(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project: uuid.UUID,
    caller: Caller,
    *parts: object,
    **params: Any,
) -> httpx.Response:
    return await api.get(
        project_url(workspace, project, "cannibalization", *parts),
        params=params,
        headers=caller.headers,
    )


@pytest.fixture
async def world(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    worker_db: Ledger,
) -> tuple[Workspace, uuid.UUID, Caller, dict[str, str]]:
    """`crm`: the pricing page ranks 3 then the guide takes over at 12, in turns of three
    days. `crm tools`: both pages in the top 20 on every check. `crm quote`: one page."""
    workspace, project, owner, w = await _world(resources, migrated)
    ids = {
        text: await tracked_id(api, workspace, project, owner, text)
        for text in ("crm", "crm tools", "crm quote")
    }
    for age in range(CHECKS - 1, -1, -1):
        on_pricing = ((CHECKS - 1 - age) // 3) % 2 == 0
        page = (PRICING, 3) if on_pricing else (GUIDE, 12)
        await _check(worker_db, migrated, w, ids["crm"], _serp(page), days_ago=age)
        await _check(
            worker_db, migrated, w, ids["crm tools"], _serp((PRICING, 4), (GUIDE, 9)), days_ago=age
        )
        await _check(worker_db, migrated, w, ids["crm quote"], _serp((PRICING, 5)), days_ago=age)
    return workspace, project, owner, ids


async def test_verdicts_and_the_headline(
    api: httpx.AsyncClient, world: tuple[Workspace, uuid.UUID, Caller, dict[str, str]]
) -> None:
    workspace, project, owner, ids = world

    response = await _get(api, workspace, project, owner, days="14", verdict="all")

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    by_text = {row["keyword"]: row for row in data["items"]}
    assert by_text["crm"]["verdict"] == "likely"
    assert by_text["crm tools"]["verdict"] == "co_ranking"
    assert by_text["crm quote"]["verdict"] == "none"
    assert by_text["crm"]["rank_gap"] == 9
    assert by_text["crm"]["pages"][0]["letter"] == "A"
    assert by_text["crm"]["pages"][0]["path"] == "/pricing"
    assert len(by_text["crm"]["strip"]) == CHECKS
    assert data["counts"]["conflicts"] == 2
    assert data["headline"]["likely"]["value"] == 1
    assert data["headline"]["conflicts"]["value"] == 2
    assert data["meta"]["has_previous"] is False
    assert ids["crm"] == by_text["crm"]["tracked_keyword_id"]


async def test_the_default_filter_lists_conflicts_only(
    api: httpx.AsyncClient, world: tuple[Workspace, uuid.UUID, Caller, dict[str, str]]
) -> None:
    workspace, project, owner, _ = world

    rows = (await _get(api, workspace, project, owner, days="14")).json()["data"]["items"]

    assert {row["keyword"] for row in rows} == {"crm", "crm tools"}
    assert rows[0]["keyword"] == "crm"  # likely comes before co-ranking


async def test_switches_and_weeks(
    api: httpx.AsyncClient, world: tuple[Workspace, uuid.UUID, Caller, dict[str, str]]
) -> None:
    workspace, project, owner, _ = world

    data = (await _get(api, workspace, project, owner, "switches", days="14")).json()["data"]

    assert data["headline"]["switches"]["value"] == len(data["items"]) == 3
    assert data["headline"]["improved"] == 1
    assert data["headline"]["dropped"] == 2
    assert sum(w["improved"] + w["same"] + w["dropped"] for w in data["weeks"]) == 3
    flops = await _get(api, workspace, project, owner, "switches", days="14", kind="flip_flop")
    assert [r["event"]["is_flip_flop"] for r in flops.json()["data"]["items"]] == [True, True]


async def test_pairs(
    api: httpx.AsyncClient, world: tuple[Workspace, uuid.UUID, Caller, dict[str, str]]
) -> None:
    workspace, project, owner, _ = world

    (pair,) = (await _get(api, workspace, project, owner, "pairs", days="14")).json()["data"][
        "items"
    ]

    assert {pair["a"]["path"], pair["b"]["path"]} == {"/pricing", "/guide"}
    assert pair["keywords"] == 2
    assert pair["likely"] == 1


async def test_one_keyword_with_every_check(
    api: httpx.AsyncClient, world: tuple[Workspace, uuid.UUID, Caller, dict[str, str]]
) -> None:
    workspace, project, owner, ids = world

    data = (await _get(api, workspace, project, owner, "keywords", ids["crm"], days="14")).json()[
        "data"
    ]

    assert data["keyword"]["verdict"] == "likely"
    assert len(data["checks"]) == CHECKS
    assert {u["path"] for u in data["urls"]} == {"/pricing", "/guide"}
    missing = await _get(api, workspace, project, owner, "keywords", uuid.uuid4())
    assert missing.status_code == 404


async def test_a_project_of_another_workspace_is_not_found(
    api: httpx.AsyncClient,
    world: tuple[Workspace, uuid.UUID, Caller, dict[str, str]],
) -> None:
    workspace, _, owner, _ = world

    response = await _get(api, workspace, uuid.uuid4(), owner)

    assert response.status_code == 404


def test_conflicts_by_page_counts_each_page_of_a_conflict() -> None:
    checks = tuple(Check(day=100 + d, readable=True, ranks=((1, 4), (2, 9))) for d in range(CHECKS))
    series = KeywordSeries(uuid.uuid4(), "k", 100, None, (), checks)
    results: list[Result] = analyse_all([series], Window(today=100 + CHECKS - 1, days=30))

    found = conflicts_by_page(results)

    assert {page: (c.keywords, c.co_ranking, c.likely) for page, c in found.items()} == {
        1: (1, 1, 0),
        2: (1, 1, 0),
    }
