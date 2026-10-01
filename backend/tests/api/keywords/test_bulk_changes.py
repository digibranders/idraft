"""Bulk update and bulk archive of tracked keywords (docs/19 section 3.6.1)."""

from __future__ import annotations

import uuid
from typing import Any

import httpx
import pytest

from sightline.api.keywords import service
from sightline.api.resources import Resources
from tests.api.auth.support import Workspace, execute, fetch, make_workspace
from tests.api.entities.support import Caller, member, problem
from tests.api.keywords.support import (
    errors,
    group,
    keyword_project,
    project_url,
    term,
    tracked_id,
    vocabulary,
)
from tests.conftest import PostgresServer


async def _owner(resources: Resources, pg: PostgresServer) -> tuple[Workspace, uuid.UUID, Caller]:
    workspace = await make_workspace(pg)
    owner = await member(resources, pg, workspace, "owner")
    return workspace, await keyword_project(pg, workspace), owner


async def _bulk(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project: uuid.UUID,
    caller: Caller,
    action: str,
    body: dict[str, Any],
) -> httpx.Response:
    return await api.post(
        project_url(workspace, project, "tracked-keywords", action),
        json=body,
        headers=caller.headers,
    )


async def _rows(pg: PostgresServer, project: uuid.UUID) -> dict[str, dict[str, Any]]:
    rows = await fetch(
        pg,
        "SELECT k.text, t.priority, t.depth_profile, t.config_version, t.is_active "
        "FROM seo.tracked_keywords t JOIN seo.keywords k ON k.id = t.keyword_id "
        "WHERE t.project_id = $1",
        project,
    )
    return {row["text"]: dict(row) for row in rows}


async def test_bulk_update_by_ids_sets_fields_and_versions_the_configuration(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    crm = await tracked_id(api, workspace, project, owner, "crm")
    erp = await tracked_id(api, workspace, project, owner, "erp", depth_profile="deep")
    await tracked_id(api, workspace, project, owner, "hr")

    response = await _bulk(
        api,
        workspace,
        project,
        owner,
        "bulk-update",
        {"ids": [crm, erp], "set": {"priority": 1, "depth_profile": "deep"}},
    )

    assert response.status_code == 200, response.text
    assert response.json()["data"] == {"matched": 2, "updated": 2, "config_versions_created": 1}
    rows = await _rows(migrated, project)
    assert {
        text: (r["priority"], r["depth_profile"], r["config_version"]) for text, r in rows.items()
    } == {
        "crm": (1, "deep", 2),
        "erp": (1, "deep", 1),
        "hr": (3, "standard", 1),
    }
    history = await fetch(
        migrated,
        "SELECT config_version, valid_to IS NULL AS open FROM seo.tracked_keyword_config_history "
        "WHERE tracked_keyword_id = $1 ORDER BY config_version",
        uuid.UUID(crm),
    )
    assert [(h["config_version"], h["open"]) for h in history] == [(1, False), (2, True)]
    audited = await fetch(
        migrated,
        "SELECT target_id FROM ops.audit_logs WHERE workspace_id = $1 "
        "AND action = 'tracked_keyword.updated' ORDER BY target_id",
        workspace.id,
    )
    assert sorted(row["target_id"] for row in audited) == sorted([crm, erp])


async def test_bulk_update_by_filter_adds_and_removes_groups_and_terms(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    old_group = await group(migrated, workspace, project, "Old")
    new_group = await group(migrated, workspace, project, "New")
    topics = await vocabulary(migrated, workspace)
    old_term = await term(migrated, workspace, topics, "old")
    new_term = await term(migrated, workspace, topics, "new")
    mobile = await tracked_id(
        api,
        workspace,
        project,
        owner,
        "crm",
        device="mobile",
        group_ids=[old_group],
        term_ids=[old_term],
    )
    desktop = await tracked_id(
        api, workspace, project, owner, "crm", group_ids=[old_group], term_ids=[old_term]
    )

    response = await _bulk(
        api,
        workspace,
        project,
        owner,
        "bulk-update",
        {
            "filter": {"device": "mobile"},
            "add_group_ids": [new_group],
            "remove_group_ids": [old_group],
            "add_term_ids": [new_term],
            "remove_term_ids": [old_term],
        },
    )

    assert response.json()["data"] == {"matched": 1, "updated": 1, "config_versions_created": 0}
    links = await fetch(
        migrated,
        "SELECT tracked_keyword_id::text AS id, group_id::text AS link "
        "FROM seo.keyword_group_members WHERE workspace_id = $1 UNION ALL "
        "SELECT tracked_keyword_id::text, term_id::text FROM seo.tracked_keyword_terms "
        "WHERE workspace_id = $1 ORDER BY 1, 2",
        workspace.id,
    )
    assert sorted((row["id"], row["link"]) for row in links) == sorted(
        [(mobile, new_group), (mobile, new_term), (desktop, old_group), (desktop, old_term)]
    )


async def test_a_single_valued_term_added_in_bulk_replaces_the_one_there(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    stages = await vocabulary(migrated, workspace, single=True)
    early = await term(migrated, workspace, stages, "early")
    late = await term(migrated, workspace, stages, "late")
    created = await tracked_id(api, workspace, project, owner, "crm", term_ids=[early])

    response = await _bulk(
        api, workspace, project, owner, "bulk-update", {"ids": [created], "add_term_ids": [late]}
    )
    two = await _bulk(
        api,
        workspace,
        project,
        owner,
        "bulk-update",
        {"ids": [created], "add_term_ids": [early, late]},
    )

    assert response.status_code == 200, response.text
    terms = await fetch(
        migrated,
        "SELECT term_id::text AS id FROM seo.tracked_keyword_terms WHERE tracked_keyword_id = $1",
        uuid.UUID(created),
    )
    assert [row["id"] for row in terms] == [late]
    assert two.status_code == 422
    assert errors(two) == [("add_term_ids", "single_valued_vocabulary")]


async def test_bulk_references_are_checked(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    other = await keyword_project(migrated, workspace)
    foreign_group = await group(migrated, workspace, other, "Elsewhere")
    created = await tracked_id(api, workspace, project, owner, "crm")

    cases: list[tuple[dict[str, Any], tuple[str, str]]] = [
        ({"add_group_ids": [foreign_group]}, ("add_group_ids", "group_unknown")),
        ({"add_term_ids": [str(uuid.uuid4())]}, ("add_term_ids", "term_unknown")),
        ({"set": {"target_url": "ftp://acme.io"}}, ("set.target_url", "invalid_url")),
        ({"set": {"schedule_id": str(uuid.uuid4())}}, ("set.schedule_id", "schedule_unknown")),
        ({}, ("", "nothing_to_change")),
    ]
    for body, expected in cases:
        response = await _bulk(
            api, workspace, project, owner, "bulk-update", {"ids": [created], **body}
        )
        assert response.status_code == 422, body
        assert errors(response) == [expected], body


async def test_ids_or_a_filter_and_never_both(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    created = await tracked_id(api, workspace, project, owner, "crm")

    both = await _bulk(
        api,
        workspace,
        project,
        owner,
        "bulk-archive",
        {"ids": [created], "filter": {}, "archive": True},
    )
    neither = await _bulk(api, workspace, project, owner, "bulk-archive", {"archive": True})

    assert both.status_code == neither.status_code == 422


async def test_a_filter_matching_too_many_is_refused(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    for text in ("a", "b", "c"):
        await tracked_id(api, workspace, project, owner, text)
    monkeypatch.setattr(service, "SUBJECTS_MAX", 2)

    response = await _bulk(
        api, workspace, project, owner, "bulk-update", {"filter": {}, "set": {"priority": 1}}
    )

    assert problem(response) == (422, "too_many_subjects")
    assert response.json()["limit"] == 2
    assert {r["priority"] for r in (await _rows(migrated, project)).values()} == {3}


async def test_ids_of_other_projects_and_deleted_keywords_are_not_matched(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    other = await keyword_project(migrated, workspace)
    foreign = await tracked_id(api, workspace, other, owner, "erp")
    deleted = await tracked_id(api, workspace, project, owner, "hr")
    await api.delete(
        project_url(workspace, project, "tracked-keywords", deleted), headers=owner.headers
    )
    created = await tracked_id(api, workspace, project, owner, "crm")

    response = await _bulk(
        api,
        workspace,
        project,
        owner,
        "bulk-update",
        {"ids": [created, foreign, deleted, str(uuid.uuid4())], "set": {"priority": 5}},
    )

    assert response.json()["data"]["matched"] == 1
    priorities = await fetch(
        migrated, "SELECT priority FROM seo.tracked_keywords WHERE id = $1", uuid.UUID(foreign)
    )
    assert priorities[0]["priority"] == 3


async def test_bulk_archive_and_unarchive_within_the_quota(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    await execute(
        migrated,
        "INSERT INTO core.workspace_quotas (workspace_id, max_tracked_keywords) VALUES ($1, 2)",
        workspace.id,
    )
    crm = await tracked_id(api, workspace, project, owner, "crm")
    erp = await tracked_id(api, workspace, project, owner, "erp")

    archived = await _bulk(
        api, workspace, project, owner, "bulk-archive", {"ids": [crm, erp], "archive": True}
    )
    again = await _bulk(
        api, workspace, project, owner, "bulk-archive", {"ids": [crm, erp], "archive": True}
    )
    await tracked_id(api, workspace, project, owner, "hr")
    refused = await _bulk(
        api,
        workspace,
        project,
        owner,
        "bulk-archive",
        {"filter": {"is_active": False}, "archive": False},
    )
    one_back = await _bulk(
        api, workspace, project, owner, "bulk-archive", {"ids": [crm], "archive": False}
    )

    assert archived.json()["data"] == {"matched": 2, "updated": 2}
    assert again.json()["data"] == {"matched": 2, "updated": 0}
    assert problem(refused) == (422, "quota_exceeded")
    assert (refused.json()["used"], refused.json()["requested"]) == (1, 2)
    assert one_back.json()["data"] == {"matched": 1, "updated": 1}
    rows = await _rows(migrated, project)
    assert {text: r["is_active"] for text, r in rows.items()} == {
        "crm": True,
        "erp": False,
        "hr": True,
    }


async def test_a_viewer_cannot_change_in_bulk(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    created = await tracked_id(api, workspace, project, owner, "crm")
    viewer = await member(resources, migrated, workspace, "viewer")

    for action, body in (
        ("bulk-update", {"ids": [created], "set": {"priority": 1}}),
        ("bulk-archive", {"ids": [created], "archive": True}),
    ):
        assert problem(await _bulk(api, workspace, project, viewer, action, body)) == (
            403,
            "forbidden",
        )


# Review of step 5 task 4.


async def test_a_new_target_url_in_bulk_versions_each_row_without_a_gap(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    crm = await tracked_id(api, workspace, project, owner, "crm")
    erp = await tracked_id(api, workspace, project, owner, "erp", target_url="https://acme.io/x")

    response = await _bulk(
        api,
        workspace,
        project,
        owner,
        "bulk-update",
        {"ids": [crm, erp], "set": {"target_url": "https://acme.io/x"}},
    )

    assert response.json()["data"] == {"matched": 2, "updated": 1, "config_versions_created": 1}
    history = await fetch(
        migrated,
        "SELECT config_version, valid_from, valid_to, target_url_id IS NOT NULL AS targeted "
        "FROM seo.tracked_keyword_config_history WHERE tracked_keyword_id = $1 "
        "ORDER BY config_version",
        uuid.UUID(crm),
    )
    first, second = history
    assert (first["targeted"], second["targeted"]) == (False, True)
    assert first["valid_to"] == second["valid_from"]
    assert second["valid_to"] is None


async def test_unarchiving_through_set_respects_the_quota(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    await execute(
        migrated,
        "INSERT INTO core.workspace_quotas (workspace_id, max_tracked_keywords) VALUES ($1, 1)",
        workspace.id,
    )
    crm = await tracked_id(api, workspace, project, owner, "crm")
    await _bulk(api, workspace, project, owner, "bulk-archive", {"ids": [crm], "archive": True})
    await tracked_id(api, workspace, project, owner, "erp")

    response = await _bulk(
        api, workspace, project, owner, "bulk-update", {"ids": [crm], "set": {"is_active": True}}
    )

    assert problem(response) == (422, "quota_exceeded")


async def test_a_body_filter_takes_archived_keywords_unless_it_says_otherwise(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    pricing = await group(migrated, workspace, project, "Pricing")
    crm = await tracked_id(api, workspace, project, owner, "crm", group_ids=[pricing])
    await tracked_id(api, workspace, project, owner, "erp", group_ids=[pricing])
    await _bulk(api, workspace, project, owner, "bulk-archive", {"ids": [crm], "archive": True})

    back = await _bulk(
        api,
        workspace,
        project,
        owner,
        "bulk-archive",
        {"filter": {"group": pricing}, "archive": False},
    )

    assert back.json()["data"] == {"matched": 2, "updated": 1}


async def test_a_change_that_matches_nothing_writes_nothing(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    other = await keyword_project(migrated, workspace)
    foreign_group = await group(migrated, workspace, other, "Elsewhere")
    created = await tracked_id(api, workspace, project, owner, "crm")

    nothing = await _bulk(
        api,
        workspace,
        project,
        owner,
        "bulk-update",
        {"filter": {"q": "no such keyword"}, "set": {"priority": 1}},
    )
    foreign = await _bulk(
        api,
        workspace,
        project,
        owner,
        "bulk-update",
        {"ids": [created], "remove_group_ids": [foreign_group]},
    )

    assert nothing.json()["data"] == {"matched": 0, "updated": 0, "config_versions_created": 0}
    assert foreign.json()["data"] == {"matched": 1, "updated": 0, "config_versions_created": 0}
    entries = await fetch(
        migrated,
        "SELECT action, after FROM ops.audit_logs WHERE workspace_id = $1 "
        "AND action LIKE 'tracked_keyword.%' AND action <> 'tracked_keyword.created' ORDER BY id",
        workspace.id,
    )
    assert [row["action"] for row in entries] == ["tracked_keyword.bulk_changed"] * 2


async def test_links_times_rows_are_capped(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    topics = await vocabulary(migrated, workspace)
    terms = [await term(migrated, workspace, topics, slug) for slug in ("a", "b")]
    for text in ("crm", "erp"):
        await tracked_id(api, workspace, project, owner, text)
    monkeypatch.setattr(service, "LINK_CHANGES_MAX", 3)

    response = await _bulk(
        api, workspace, project, owner, "bulk-update", {"filter": {}, "add_term_ids": terms}
    )

    assert problem(response) == (422, "too_many_subjects")
    assert response.json()["limit"] == 1
