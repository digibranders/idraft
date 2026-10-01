"""Term assignments of tracked keywords, the keyword counts of terms, and single-valued
vocabularies (docs/19 section 3.5)."""

from __future__ import annotations

import uuid
from typing import Any

import httpx
import pytest

from sightline.api.keywords import service
from sightline.api.resources import Resources
from tests.api.auth.support import Workspace, fetch, make_workspace
from tests.api.entities.support import Caller, member, problem
from tests.api.keywords.support import (
    errors,
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


async def _assign(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project: uuid.UUID,
    caller: Caller,
    body: dict[str, Any],
) -> httpx.Response:
    return await api.post(
        project_url(workspace, project, "term-assignments"),
        json={"subject_type": "tracked_keyword", **body},
        headers=caller.headers,
    )


async def _terms_of(pg: PostgresServer, tracked_keyword_id: str) -> list[str]:
    rows = await fetch(
        pg,
        "SELECT term_id::text AS id FROM seo.tracked_keyword_terms "
        "WHERE tracked_keyword_id = $1 ORDER BY term_id",
        uuid.UUID(tracked_keyword_id),
    )
    return [row["id"] for row in rows]


async def test_terms_are_added_and_removed_by_ids(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    topics = await vocabulary(migrated, workspace)
    crm_term = await term(migrated, workspace, topics, "crm")
    sales = await term(migrated, workspace, topics, "sales")
    crm = await tracked_id(api, workspace, project, owner, "crm", term_ids=[crm_term])
    erp = await tracked_id(api, workspace, project, owner, "erp")

    added = await _assign(
        api,
        workspace,
        project,
        owner,
        {"op": "add", "subject_ids": [crm, erp], "term_ids": [crm_term, sales]},
    )
    removed = await _assign(
        api, workspace, project, owner, {"op": "remove", "subject_ids": [crm], "term_ids": [sales]}
    )

    assert added.status_code == 200, added.text
    assert added.json()["data"] == {
        "subjects_matched": 2,
        "assignments_added": 3,
        "assignments_removed": 0,
    }
    assert removed.json()["data"] == {
        "subjects_matched": 1,
        "assignments_added": 0,
        "assignments_removed": 1,
    }
    assert await _terms_of(migrated, crm) == [crm_term]
    assert await _terms_of(migrated, erp) == sorted([crm_term, sales])


async def test_replace_changes_only_the_vocabularies_of_the_given_terms(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    topics = await vocabulary(migrated, workspace)
    stages = await vocabulary(migrated, workspace)
    old_topic = await term(migrated, workspace, topics, "old")
    new_topic = await term(migrated, workspace, topics, "new")
    stage = await term(migrated, workspace, stages, "buying")
    created = await tracked_id(api, workspace, project, owner, "crm", term_ids=[old_topic, stage])

    response = await _assign(
        api,
        workspace,
        project,
        owner,
        {"op": "replace", "subject_filter": {"q": "crm"}, "term_ids": [new_topic]},
    )

    assert response.json()["data"] == {
        "subjects_matched": 1,
        "assignments_added": 1,
        "assignments_removed": 1,
    }
    assert await _terms_of(migrated, created) == sorted([new_topic, stage])


async def test_a_single_valued_term_replaces_the_one_there_and_two_are_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    stages = await vocabulary(migrated, workspace, single=True)
    early = await term(migrated, workspace, stages, "early")
    late = await term(migrated, workspace, stages, "late")
    created = await tracked_id(api, workspace, project, owner, "crm", term_ids=[early])

    added = await _assign(
        api, workspace, project, owner, {"op": "add", "subject_ids": [created], "term_ids": [late]}
    )
    two = await _assign(
        api,
        workspace,
        project,
        owner,
        {"op": "add", "subject_ids": [created], "term_ids": [early, late]},
    )

    assert added.json()["data"] == {
        "subjects_matched": 1,
        "assignments_added": 1,
        "assignments_removed": 1,
    }
    assert await _terms_of(migrated, created) == [late]
    assert two.status_code == 422
    assert errors(two) == [("term_ids", "single_valued_vocabulary")]


@pytest.mark.parametrize(
    ("body", "expected"),
    [
        ({"subject_type": "prompt"}, ("subject_type", "subject_type_not_supported")),
        ({"term_ids": ["00000000-0000-0000-0000-000000000000"]}, ("term_ids", "term_unknown")),
    ],
)
async def test_an_assignment_that_cannot_apply_is_refused(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    body: dict[str, Any],
    expected: tuple[str, str],
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    created = await tracked_id(api, workspace, project, owner, "crm")
    topic = await term(migrated, workspace, await vocabulary(migrated, workspace), "crm")

    response = await _assign(
        api,
        workspace,
        project,
        owner,
        {"op": "add", "subject_ids": [created], "term_ids": [topic], **body},
    )

    assert response.status_code == 422
    assert errors(response) == [expected]


async def test_a_filter_matching_too_many_subjects_is_refused(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    topic = await term(migrated, workspace, await vocabulary(migrated, workspace), "crm")
    for text in ("a", "b"):
        await tracked_id(api, workspace, project, owner, text)
    monkeypatch.setattr(service, "SUBJECTS_MAX", 1)

    response = await _assign(
        api, workspace, project, owner, {"op": "add", "subject_filter": {}, "term_ids": [topic]}
    )

    assert problem(response) == (422, "too_many_subjects")


async def test_a_term_counts_the_live_keywords_of_its_subtree(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    other = await keyword_project(migrated, workspace)
    topics = await vocabulary(migrated, workspace)
    software = await term(migrated, workspace, topics, "software")
    crm_term = await term(migrated, workspace, topics, "crm", parent=software)
    await tracked_id(api, workspace, project, owner, "crm", term_ids=[crm_term, software])
    await tracked_id(api, workspace, project, owner, "erp", term_ids=[software])
    await tracked_id(api, workspace, other, owner, "hr", term_ids=[crm_term])
    archived = await tracked_id(api, workspace, project, owner, "pos", term_ids=[crm_term])
    await api.patch(
        project_url(workspace, project, "tracked-keywords", archived),
        json={"is_active": False},
        headers=owner.headers,
    )
    scoped = await member(resources, migrated, workspace, "editor", project_ids=[project])
    url = f"/api/v1/workspaces/{workspace.id}/vocabularies/{topics}/terms"

    tree = await api.get(url, headers=owner.headers)
    flat = await api.get(url, params={"format": "flat"}, headers=scoped.headers)

    (root,) = tree.json()["data"]
    assert (root["keyword_count"], root["children"][0]["keyword_count"]) == (3, 2)
    # Only the keywords of the member's projects.
    assert {t["slug"]: t["keyword_count"] for t in flat.json()["data"]} == {
        "software": 2,
        "crm": 1,
    }


async def test_a_vocabulary_becomes_single_valued_only_when_no_keyword_has_two_of_its_terms(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner = await _owner(resources, migrated)
    topics = await vocabulary(migrated, workspace)
    first = await term(migrated, workspace, topics, "first")
    second = await term(migrated, workspace, topics, "second")
    created = await tracked_id(api, workspace, project, owner, "crm", term_ids=[first, second])
    url = f"/api/v1/workspaces/{workspace.id}/vocabularies/{topics}"

    refused = await api.patch(url, json={"is_single_valued": True}, headers=owner.headers)
    await _assign(
        api,
        workspace,
        project,
        owner,
        {"op": "remove", "subject_ids": [created], "term_ids": [second]},
    )
    allowed = await api.patch(url, json={"is_single_valued": True}, headers=owner.headers)

    assert problem(refused) == (409, "single_valued_violation")
    assert allowed.json()["data"]["is_single_valued"] is True
