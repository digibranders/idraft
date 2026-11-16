"""Workspace tier settings (spec 5.1; plan decisions D15 and D17)."""

from __future__ import annotations

import asyncio
import uuid

import httpx
import pytest

from idraft.api.resources import Resources
from tests.api.auth.support import Workspace, execute, fetch, fetchrow, make_workspace
from tests.api.entities.support import Caller, member, problem
from tests.api.internal_links.support import (
    SeedLink,
    audit_rows,
    seed_crawl,
    seed_tiers,
    tiers_url,
    url_id,
)
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer


async def test_any_member_reads_the_tiers_with_codes_labels_and_counts(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    t1, *_ = await seed_tiers(migrated, workspace)

    response = await api.get(tiers_url(workspace), headers=viewer.headers)

    assert response.status_code == 200, response.text
    tiers = response.json()["data"]
    assert [(tier["code"], tier["label"]) for tier in tiers] == [
        ("T1", "T1 Money pages"),
        ("T2", "T2 Supporting pages"),
        ("T3", "T3 Content pages"),
        ("T4", "T4 Utility pages"),
    ]
    assert tiers[0]["tier_id"] == str(t1)
    assert {tier["page_count"] for tier in tiers} == {0}
    assert {tier["rule_count"] for tier in tiers} == {0}


async def test_a_new_workspace_starts_with_the_four_defaults(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    owner = await member(resources, migrated, await make_workspace(migrated), "owner")
    # Whatever the registration mode of the test settings, an operator may create one.
    await execute(
        migrated, "UPDATE auth.users SET is_platform_operator = true WHERE id = $1", owner.user_id
    )
    created = await api.post(
        "/api/v1/workspaces",
        json={"name": "Tiered", "slug": "tiered-ws", "timezone": "Europe/London"},
        headers=owner.headers,
    )
    assert created.status_code == 201, created.text
    workspace_id = created.json()["data"]["workspace_id"]

    names = await fetchrow(
        migrated,
        "SELECT array_agg(name ORDER BY position) AS names FROM core.page_tier_levels "
        "WHERE workspace_id = $1",
        workspace_id,
    )

    assert names["names"] == ["Money pages", "Supporting pages", "Content pages", "Utility pages"]


async def test_owners_and_admins_add_up_to_eight(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    admin = await member(resources, migrated, workspace, "admin")
    await seed_tiers(migrated, workspace)

    for position in range(5, 9):
        added = await api.post(
            tiers_url(workspace), json={"name": f"Tier {position}"}, headers=admin.headers
        )
        assert added.status_code == 201, added.text
        assert added.json()["data"]["code"] == f"T{position}"
    refused = await api.post(tiers_url(workspace), json={"name": "Nine"}, headers=admin.headers)

    assert problem(refused) == (422, "tier_limit")
    assert len(await audit_rows(migrated, workspace, "page_tier.created")) == 4


async def test_parallel_adds_to_a_workspace_with_no_tier_take_one_position_each(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")

    answers = await asyncio.gather(
        *(
            api.post(tiers_url(workspace), json={"name": f"Tier {n}"}, headers=owner.headers)
            for n in range(4)
        )
    )

    assert [answer.status_code for answer in answers] == [201] * 4
    listed = await api.get(tiers_url(workspace), headers=owner.headers)
    assert [tier["position"] for tier in listed.json()["data"]] == [1, 2, 3, 4]


@pytest.mark.parametrize("role", ["editor", "analyst", "viewer"])
async def test_other_roles_cannot_change_tiers(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, role: str
) -> None:
    workspace = await make_workspace(migrated)
    caller = await member(resources, migrated, workspace, role)
    t1, *_ = await seed_tiers(migrated, workspace)

    added = await api.post(tiers_url(workspace), json={"name": "X"}, headers=caller.headers)
    renamed = await api.patch(tiers_url(workspace, t1), json={"name": "X"}, headers=caller.headers)
    deleted = await api.delete(tiers_url(workspace, t1), headers=caller.headers)

    assert {added.status_code, renamed.status_code, deleted.status_code} == {403}


async def test_rename_keeps_the_pages_on_their_tier(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    t1, *_ = await seed_tiers(migrated, workspace)

    response = await api.patch(
        tiers_url(workspace, t1),
        json={"name": "Revenue pages", "description": "Where the money is."},
        headers=owner.headers,
    )

    assert response.status_code == 200, response.text
    assert response.json()["data"]["label"] == "T1 Revenue pages"
    assert response.json()["data"]["tier_id"] == str(t1)
    (entry,) = await audit_rows(migrated, workspace, "page_tier.updated")
    assert entry["after"] == {"name": "Revenue pages", "description": "Where the money is."}


@pytest.mark.parametrize("body", [{"name": None}, {"description": None}, {}])
async def test_a_rename_cannot_blank_a_field_or_say_nothing(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, body: dict[str, None]
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    t1, *_ = await seed_tiers(migrated, workspace)

    response = await api.patch(tiers_url(workspace, t1), json=body, headers=owner.headers)

    assert problem(response) == (422, "validation_failed")


async def test_an_unused_tier_is_deleted_at_once_and_positions_close_up(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    _, t2, t3, _ = await seed_tiers(migrated, workspace)

    deleted = await api.delete(tiers_url(workspace, t2), headers=owner.headers)
    listed = await api.get(tiers_url(workspace), headers=owner.headers)

    assert deleted.status_code == 204, deleted.text
    codes = {tier["tier_id"]: tier["code"] for tier in listed.json()["data"]}
    assert codes[str(t3)] == "T2"
    assert len(codes) == 3


async def test_a_used_tier_asks_where_its_pages_and_rules_go(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = await keyword_project(migrated, workspace)
    t1, t2, *_ = await seed_tiers(migrated, workspace)
    await execute(
        migrated,
        "INSERT INTO core.tier_rules (workspace_id, project_id, position, match_type, value, "
        "tier_id) VALUES ($1, $2, 1, 'prefix', '/services/', $3)",
        workspace.id,
        project,
        t2,
    )

    refused = await api.delete(tiers_url(workspace, t2), headers=owner.headers)
    to_self = await api.delete(
        tiers_url(workspace, t2), params={"move_to": str(t2)}, headers=owner.headers
    )
    moved = await api.delete(
        tiers_url(workspace, t2), params={"move_to": str(t1)}, headers=owner.headers
    )

    assert problem(refused) == (422, "tier_in_use")
    assert refused.json()["rule_count"] == 1
    assert refused.json()["page_count"] == 0
    assert problem(to_self) == (422, "validation_failed")
    assert moved.status_code == 204, moved.text
    rule = await fetchrow(
        migrated, "SELECT tier_id FROM core.tier_rules WHERE project_id = $1", project
    )
    assert rule["tier_id"] == t1


async def test_deleting_to_untiered_moves_manual_pages_and_drops_the_rules(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = await keyword_project(migrated, workspace)
    t1, t2, *_ = await seed_tiers(migrated, workspace)
    manual = await url_id(migrated, "https://example.com/manual")
    await execute(
        migrated,
        "INSERT INTO core.project_pages (project_id, url_id, workspace_id, tier_id, tier_source) "
        "VALUES ($1, $2, $3, $4, 'manual')",
        project,
        manual,
        workspace.id,
        t2,
    )
    await execute(
        migrated,
        "INSERT INTO core.tier_rules (workspace_id, project_id, position, match_type, value, "
        "tier_id) VALUES ($1, $2, 1, 'prefix', '/x/', $3)",
        workspace.id,
        project,
        t2,
    )

    response = await api.delete(
        tiers_url(workspace, t2), params={"move_to": "none"}, headers=owner.headers
    )

    assert response.status_code == 204, response.text
    page = await fetchrow(
        migrated,
        "SELECT tier_id, tier_source FROM core.project_pages WHERE project_id = $1 AND url_id = $2",
        project,
        manual,
    )
    assert (page["tier_id"], page["tier_source"]) == (None, "manual")
    rules = await fetchrow(
        migrated, "SELECT count(*) AS n FROM core.tier_rules WHERE project_id = $1", project
    )
    assert rules["n"] == 0
    listed = await api.get(tiers_url(workspace), headers=owner.headers)
    assert [tier["tier_id"] for tier in listed.json()["data"]][:1] == [str(t1)]


async def test_another_workspace_cannot_see_or_change_these_tiers(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    t1, *_ = await seed_tiers(migrated, workspace)
    stranger_workspace = await make_workspace(migrated, name="Other")
    stranger = await member(resources, migrated, stranger_workspace, "owner")

    read = await api.get(tiers_url(workspace), headers=stranger.headers)
    changed = await api.patch(
        tiers_url(stranger_workspace, t1), json={"name": "Mine"}, headers=stranger.headers
    )

    assert read.status_code == 404
    assert changed.status_code == 404


async def _two_rules(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project: uuid.UUID,
    owner: Caller,
    first: uuid.UUID,
    second: uuid.UUID,
) -> None:
    url = project_url(workspace, project, "tier-rules")
    for value, tier in (("/a/", first), ("/b/", second)):
        created = await api.post(
            url,
            json={"match_type": "prefix", "value": value, "tier_id": str(tier)},
            headers=owner.headers,
        )
        assert created.status_code == 201, created.text


async def test_deleting_a_tier_moves_rule_pages_and_recomputes_the_tier_flow(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = await keyword_project(migrated, workspace)
    t1, t2, t3, _ = await seed_tiers(migrated, workspace)
    run, ids = await seed_crawl(
        migrated,
        workspace,
        project,
        [("/a/x", 200), ("/b/p", 200)],
        [SeedLink("/b/p", "/a/x", "content")],
    )
    await _two_rules(api, workspace, project, owner, t3, t2)

    moved = await api.delete(
        tiers_url(workspace, t3), params={"move_to": str(t1)}, headers=owner.headers
    )

    assert moved.status_code == 204, moved.text
    page = await fetchrow(
        migrated,
        "SELECT tier_id, tier_source FROM core.project_pages WHERE project_id = $1 AND url_id = $2",
        project,
        ids["/a/x"],
    )
    assert (page["tier_id"], page["tier_source"]) == (t1, "rule")
    cells = await fetch(
        migrated,
        "SELECT from_tier_id, to_tier_id, links FROM seo.crawl_tier_flow "
        "WHERE run_id = $1 AND scope = 'editorial'",
        run,
    )
    assert [(c["from_tier_id"], c["to_tier_id"], c["links"]) for c in cells] == [(t2, t1, 1)]
    stats = await fetch(
        migrated, "SELECT tier_id, pages FROM seo.crawl_tier_stats WHERE run_id = $1", run
    )
    assert {row["tier_id"]: row["pages"] for row in stats} == {t1: 1, t2: 1}


async def test_deleting_a_tier_to_untiered_drops_its_rules_and_the_flow_follows(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = await keyword_project(migrated, workspace)
    _, t2, t3, _ = await seed_tiers(migrated, workspace)
    run, ids = await seed_crawl(
        migrated,
        workspace,
        project,
        [("/a/x", 200), ("/b/p", 200)],
        [SeedLink("/b/p", "/a/x", "content")],
    )
    await _two_rules(api, workspace, project, owner, t2, t3)

    deleted = await api.delete(
        tiers_url(workspace, t2), params={"move_to": "none"}, headers=owner.headers
    )

    assert deleted.status_code == 204, deleted.text
    rules = await fetch(
        migrated, "SELECT position, value FROM core.tier_rules WHERE project_id = $1", project
    )
    assert [(row["position"], row["value"]) for row in rules] == [(1, "/b/")]
    pages = await fetch(
        migrated, "SELECT url_id, tier_id FROM core.project_pages WHERE project_id = $1", project
    )
    assert {row["url_id"]: row["tier_id"] for row in pages} == {ids["/b/p"]: t3}
    cells = await fetch(
        migrated,
        "SELECT from_tier_id, to_tier_id, links FROM seo.crawl_tier_flow "
        "WHERE run_id = $1 AND scope = 'editorial'",
        run,
    )
    assert [(c["from_tier_id"], c["to_tier_id"], c["links"]) for c in cells] == [(t3, None, 1)]
