"""Project roles, project domains and the alias test (docs/19 section 3.4)."""

from __future__ import annotations

import uuid
from typing import Any

import httpx

from sightline.api.resources import Resources
from tests.api.auth.support import Workspace, fetch, make_workspace
from tests.api.entities.support import (
    Caller,
    attach,
    config_version,
    entities_url,
    member,
    problem,
)
from tests.api.workspaces.support import make_project
from tests.conftest import PostgresServer


def _project_url(workspace: Workspace, project_id: uuid.UUID, *parts: object) -> str:
    return "/".join([f"/api/v1/workspaces/{workspace.id}/projects/{project_id}", *map(str, parts)])


async def _entity(
    api: httpx.AsyncClient, workspace: Workspace, caller: Caller, name: str, **body: Any
) -> str:
    response = await api.post(
        entities_url(workspace),
        json={"entity_type": "brand", "canonical_name": name, **body},
        headers=caller.headers,
    )
    assert response.status_code == 201, response.text
    entity_id: str = response.json()["data"]["entity_id"]
    return entity_id


async def _give(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project_id: uuid.UUID,
    caller: Caller,
    entity_id: str,
    **body: Any,
) -> httpx.Response:
    return await api.post(
        _project_url(workspace, project_id, "entities"),
        json={"entity_id": entity_id, "role": "competitor", **body},
        headers=caller.headers,
    )


# Roles.


async def test_an_editor_gives_an_entity_a_role(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await make_project(migrated, workspace.id)
    entity_id = await _entity(
        api,
        workspace,
        editor,
        "HubSpot",
        aliases=[{"alias": "Hub Spot"}],
        domains=[{"domain": "hubspot.com"}],
    )

    response = await _give(api, workspace, project, editor, entity_id, color_index=2)

    assert response.status_code == 201
    data = response.json()["data"]
    assert data["entity"] == {
        "entity_id": entity_id,
        "canonical_name": "HubSpot",
        "entity_type": "brand",
        "role": "competitor",
        "color_index": 2,
    }
    assert (data["role"], data["is_primary"], data["track_seo"], data["track_ai"]) == (
        "competitor",
        False,
        True,
        True,
    )
    assert (data["alias_count"], data["removed_at"]) == (1, None)
    assert [d["domain"]["host"] for d in data["domains"]] == ["hubspot.com"]
    assert await config_version(migrated, project) == 2
    listed = await api.get(_project_url(workspace, project, "entities"), headers=editor.headers)
    assert listed.json()["data"] == [data]


async def test_an_unknown_or_unseen_entity_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    other = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    mine, theirs_project = (
        await make_project(migrated, workspace.id),
        await make_project(migrated, workspace.id),
    )
    theirs = await _entity(api, other, await member(resources, migrated, other, "owner"), "X")
    hidden = await _entity(api, workspace, owner, "Hidden")
    await attach(migrated, workspace, theirs_project, hidden)
    scoped = await member(resources, migrated, workspace, "editor", project_ids=[mine])

    for caller, entity_id in ((owner, theirs), (owner, str(uuid.uuid4())), (scoped, hidden)):
        response = await _give(api, workspace, mine, caller, entity_id)
        assert response.status_code == 422
        assert response.json()["errors"][0]["code"] == "entity_unknown"


async def test_a_live_role_is_a_duplicate_and_a_removed_one_comes_back_on_its_row(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = await make_project(migrated, workspace.id)
    entity_id = await _entity(api, workspace, owner, "Rival")
    await _give(api, workspace, project, owner, entity_id)

    assert problem(await _give(api, workspace, project, owner, entity_id)) == (409, "duplicate")
    removed = await api.delete(
        _project_url(workspace, project, "entities", entity_id), headers=owner.headers
    )
    assert removed.status_code == 200
    assert removed.json()["data"]["removed_at"] is not None
    back = await _give(api, workspace, project, owner, entity_id, role="watch")
    assert back.status_code == 201
    assert (back.json()["data"]["role"], back.json()["data"]["removed_at"]) == ("watch", None)
    rows = await fetch(
        migrated,
        "SELECT count(*) AS n FROM core.project_entities WHERE project_id = $1",
        project,
    )
    assert rows[0]["n"] == 1


async def test_a_project_has_one_primary_own_entity(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = await make_project(migrated, workspace.id)
    first = await _entity(api, workspace, owner, "Acme")
    second = await _entity(api, workspace, owner, "Acme Labs")
    assert (
        await _give(api, workspace, project, owner, first, role="own", is_primary=True)
    ).status_code == 201

    taken = await _give(api, workspace, project, owner, second, role="own", is_primary=True)
    assert problem(taken) == (409, "primary_own_exists")
    competitor = await _give(api, workspace, project, owner, second, is_primary=True)
    assert competitor.status_code == 422
    assert competitor.json()["errors"][0]["code"] == "primary_needs_own"

    url = _project_url(workspace, project, "entities", first)
    for body in ({"role": "competitor"},):
        assert problem(await api.patch(url, json=body, headers=owner.headers)) == (
            409,
            "cannot_remove_primary_own",
        )
    assert problem(await api.delete(url, headers=owner.headers)) == (
        409,
        "cannot_remove_primary_own",
    )
    # Not primary any more, it can go.
    await api.patch(url, json={"is_primary": False}, headers=owner.headers)
    assert (await api.delete(url, headers=owner.headers)).status_code == 200


async def test_a_project_tracks_up_to_ten_competitors_in_seo(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = await make_project(migrated, workspace.id)
    for index in range(10):
        entity_id = await _entity(api, workspace, owner, f"Rival {index}")
        assert (await _give(api, workspace, project, owner, entity_id)).status_code == 201
    eleventh = await _entity(api, workspace, owner, "Eleventh")

    over = await _give(api, workspace, project, owner, eleventh)
    assert problem(over) == (422, "competitor_limit")
    assert over.json()["limit"] == 10
    # Not tracked in SEO, or watched, it fits; switching it to SEO does not.
    assert (
        await _give(api, workspace, project, owner, eleventh, track_seo=False)
    ).status_code == 201
    switch = await api.patch(
        _project_url(workspace, project, "entities", eleventh),
        json={"track_seo": True},
        headers=owner.headers,
    )
    assert problem(switch) == (422, "competitor_limit")


async def test_a_role_change_writes_only_what_differs(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = await make_project(migrated, workspace.id)
    entity_id = await _entity(api, workspace, owner, "Rival")
    await _give(api, workspace, project, owner, entity_id)
    url = _project_url(workspace, project, "entities", entity_id)

    changed = await api.patch(
        url, json={"color_index": 3, "track_ai": False}, headers=owner.headers
    )
    same = await api.patch(url, json={"color_index": 3}, headers=owner.headers)
    cleared = await api.patch(url, json={"color_index": None}, headers=owner.headers)

    assert (changed.json()["data"]["color_index"], changed.json()["data"]["track_ai"]) == (3, False)
    assert same.status_code == 200
    assert cleared.json()["data"]["color_index"] is None
    rows = await fetch(
        migrated,
        "SELECT action FROM ops.audit_logs WHERE workspace_id = $1 AND action LIKE "
        "'project_entity.%' ORDER BY id",
        workspace.id,
    )
    assert [row["action"] for row in rows] == [
        "project_entity.created",
        "project_entity.updated",
        "project_entity.updated",
    ]
    assert await config_version(migrated, project) == 4


async def test_a_removed_role_is_listed_only_when_asked_and_cannot_be_changed(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = await make_project(migrated, workspace.id)
    kept = await _entity(api, workspace, owner, "Kept")
    gone = await _entity(api, workspace, owner, "Gone")
    await _give(api, workspace, project, owner, kept, role="watch")
    await _give(api, workspace, project, owner, gone)
    url = _project_url(workspace, project, "entities")
    await api.delete(f"{url}/{gone}", headers=owner.headers)

    async def names(params: dict[str, str]) -> list[str]:
        response = await api.get(url, params=params, headers=owner.headers)
        return [row["entity"]["canonical_name"] for row in response.json()["data"]]

    assert await names({}) == ["Kept"]
    assert await names({"filter[include_removed]": "true"}) == ["Gone", "Kept"]
    assert await names({"filter[role]": "watch"}) == ["Kept"]
    for method, body in (("PATCH", {"track_ai": False}), ("DELETE", None)):
        response = await api.request(method, f"{url}/{gone}", json=body, headers=owner.headers)
        assert problem(response) == (404, "not_found")


async def test_a_member_limited_to_the_project_manages_its_roles(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = await make_project(migrated, workspace.id)
    entity_id = await _entity(api, workspace, owner, "Rival")
    await _give(api, workspace, project, owner, entity_id, role="watch")
    scoped = await member(resources, migrated, workspace, "editor", project_ids=[project])

    response = await api.patch(
        _project_url(workspace, project, "entities", entity_id),
        json={"role": "competitor"},
        headers=scoped.headers,
    )
    assert response.status_code == 200
    viewer = await member(resources, migrated, workspace, "viewer")
    refused = await api.patch(
        _project_url(workspace, project, "entities", entity_id),
        json={"role": "watch"},
        headers=viewer.headers,
    )
    assert problem(refused) == (403, "forbidden")


# Project domains.


async def test_project_domains_come_from_live_roles(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = await make_project(migrated, workspace.id)
    acme = await _entity(api, workspace, owner, "Acme", domains=[{"domain": "acme.com"}])
    rival = await _entity(
        api,
        workspace,
        owner,
        "Rival",
        domains=[{"domain": "medium.com", "match_scope": "path_prefix", "path_prefix": "/@rival"}],
    )
    gone = await _entity(api, workspace, owner, "Gone", domains=[{"domain": "gone.com"}])
    await _give(api, workspace, project, owner, acme, role="own", is_primary=True, color_index=1)
    await _give(api, workspace, project, owner, rival)
    await _give(api, workspace, project, owner, gone)
    await api.delete(_project_url(workspace, project, "entities", gone), headers=owner.headers)

    url = _project_url(workspace, project, "domains")
    every = (await api.get(url, headers=owner.headers)).json()["data"]
    own = (await api.get(url, params={"filter[role]": "own"}, headers=owner.headers)).json()["data"]

    assert [
        (
            row["entity"]["canonical_name"],
            row["domain"]["host"],
            row["match_scope"],
            row["path_prefix"],
        )
        for row in every
    ] == [
        ("Acme", "acme.com", "registrable", None),
        ("Rival", "medium.com", "path_prefix", "/@rival"),
    ]
    assert own[0]["entity"]["color_index"] == 1
    assert len(own) == 1


# The alias test.


async def _alias_project(
    api: httpx.AsyncClient, resources: Resources, pg: PostgresServer
) -> tuple[Workspace, uuid.UUID, Caller, str]:
    workspace = await make_workspace(pg)
    owner = await member(resources, pg, workspace, "owner")
    project = await make_project(pg, workspace.id)
    acme = await _entity(
        api,
        workspace,
        owner,
        "Acme",
        aliases=[{"alias": "Acme CRM"}, {"alias": "acme pie", "is_negative": True}],
        domains=[{"domain": "acme.io"}],
    )
    await _give(api, workspace, project, owner, acme, role="own", is_primary=True, color_index=1)
    return workspace, project, owner, acme


async def test_the_alias_test_shows_what_extraction_would_count(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner, acme = await _alias_project(api, resources, migrated)
    text = "Try Acme CRM at acme.io, not acme pie."

    response = await api.post(
        _project_url(workspace, project, "alias-test"), json={"text": text}, headers=owner.headers
    )

    assert response.status_code == 200
    data = response.json()["data"]
    ((mention,),) = (data["mentions"],)
    assert mention["entity"] == {
        "entity_id": acme,
        "canonical_name": "Acme",
        "entity_type": "brand",
        "role": "own",
        "color_index": 1,
    }
    assert [
        (text[span["start"] : span["end"]], span["match_method"], span["status"])
        for span in mention["spans"]
    ] == [("Acme CRM", "alias_word", "accepted"), ("acme.io", "alias_domain", "accepted")]
    assert (mention["confidence"], mention["status"]) == (0.95, "accepted")
    assert [(n["start"], n["end"]) for n in data["negatives_applied"]] == [(29, 37)]
    assert data["skipped_alias_ids"] == []


async def test_alias_test_offsets_are_utf16_code_units(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """An emoji is one code point and two UTF-16 units, as JavaScript counts them."""
    workspace, project, owner, _ = await _alias_project(api, resources, migrated)
    text = "\N{GRINNING FACE} Acme"

    response = await api.post(
        _project_url(workspace, project, "alias-test"),
        json={"markdown": text},
        headers=owner.headers,
    )

    (span,) = response.json()["data"]["mentions"][0]["spans"]
    assert (span["start"], span["end"]) == (3, 7)
    assert (
        text.encode("utf-16-le")[span["start"] * 2 : span["end"] * 2].decode("utf-16-le") == "Acme"
    )


async def test_the_alias_test_refuses_too_much_text_or_too_many_matches(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, project, owner, acme = await _alias_project(api, resources, migrated)
    url = _project_url(workspace, project, "alias-test")

    big = await api.post(url, json={"text": "a" * (100 * 1024 + 1)}, headers=owner.headers)
    assert problem(big) == (413, "payload_too_large")
    both = await api.post(url, json={"text": "a", "markdown": "a"}, headers=owner.headers)
    assert both.status_code == 422

    await api.post(
        entities_url(workspace, acme, "aliases"),
        json={"items": [{"alias": "a" * n, "match_mode": "substring"} for n in range(1, 4)]},
        headers=owner.headers,
    )
    many = await api.post(url, json={"text": "a" * 100_000}, headers=owner.headers)
    assert problem(many) == (422, "too_many_matches")


async def test_the_alias_test_reports_a_stored_pattern_it_cannot_run(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """One accepted under an older limit; the database holds it, the matcher leaves it out."""
    workspace, project, owner, acme = await _alias_project(api, resources, migrated)
    row = await fetch(
        migrated,
        "INSERT INTO core.entity_aliases (workspace_id, entity_id, alias, match_mode) "
        "VALUES ($1, $2, '(a)\\1', 'regex') RETURNING id",
        workspace.id,
        uuid.UUID(acme),
    )

    response = await api.post(
        _project_url(workspace, project, "alias-test"), json={"text": "Acme"}, headers=owner.headers
    )

    assert response.json()["data"]["skipped_alias_ids"] == [str(row[0]["id"])]
    assert len(response.json()["data"]["mentions"]) == 1
