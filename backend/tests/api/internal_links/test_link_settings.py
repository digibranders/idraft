"""The project's internal links settings (spec 7.8)."""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from idraft.api.resources import Resources
from tests.api.auth.support import fetch, make_workspace
from tests.api.entities.support import member, problem
from tests.api.internal_links.support import set_website
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer


async def test_the_settings_default_to_weekly_without_javascript(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)

    response = await api.get(project_url(workspace, project, "settings"), headers=viewer.headers)

    assert response.json()["data"]["internal_links"] == {
        "schedule": "weekly",
        "render_javascript": False,
        "allowed_subdomains": [],
    }


async def test_a_patch_of_the_internal_links_part_keeps_the_seo_part(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await keyword_project(migrated, workspace)
    await set_website(migrated, project)
    url = project_url(workspace, project, "settings")
    await api.patch(url, json={"seo": {"default_device": "mobile"}}, headers=editor.headers)

    response = await api.patch(
        url,
        json={
            "internal_links": {"schedule": "monthly", "allowed_subdomains": ["Blog.Example.com"]}
        },
        headers=editor.headers,
    )
    bad = await api.patch(
        url, json={"internal_links": {"schedule": "daily"}}, headers=editor.headers
    )

    data = response.json()["data"]
    assert data["seo"]["default_device"] == "mobile"
    assert data["internal_links"] == {
        "schedule": "monthly",
        "render_javascript": False,
        "allowed_subdomains": ["blog.example.com"],
    }
    assert problem(bad) == (422, "validation_failed")
    again = await api.get(url, headers=editor.headers)
    assert again.json()["data"]["internal_links"]["schedule"] == "monthly"


async def test_one_patch_can_change_both_parts(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await keyword_project(migrated, workspace)
    url = project_url(workspace, project, "settings")

    response = await api.patch(
        url,
        json={
            "seo": {"default_device": "both"},
            "internal_links": {"schedule": "every_two_weeks", "render_javascript": True},
        },
        headers=editor.headers,
    )
    again = await api.get(url, headers=editor.headers)

    assert response.status_code == 200, response.text
    for data in (response.json()["data"], again.json()["data"]):
        assert data["seo"]["default_device"] == "both"
        assert data["internal_links"] == {
            "schedule": "every_two_weeks",
            "render_javascript": True,
            "allowed_subdomains": [],
        }


async def test_a_change_is_audited_with_both_parts(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await keyword_project(migrated, workspace)

    await api.patch(
        project_url(workspace, project, "settings"),
        json={"internal_links": {"render_javascript": True}},
        headers=editor.headers,
    )

    (entry,) = await fetch(
        migrated,
        "SELECT before, after FROM ops.audit_logs WHERE workspace_id = $1 "
        "AND action = 'project.settings_updated'",
        workspace.id,
    )
    before, after = json.loads(entry["before"]), json.loads(entry["after"])
    assert before["internal_links.render_javascript"] is False
    assert after["internal_links.render_javascript"] is True
    assert after["seo.default_device"] == "desktop"


@pytest.mark.parametrize(
    "patch",
    [
        {"schedule": None},
        {"render_javascript": None},
        {"allowed_subdomains": None},
        {},
        {"schedule": "daily"},
        {"render_javascript": "sometimes"},
        {"allowed_subdomains": ["a b"]},
        {"allowed_subdomains": [f"s{n}.example.com" for n in range(11)]},
        {"allowed_subdomains": [""]},
    ],
)
async def test_bad_internal_links_values_are_refused_not_failed(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    patch: dict[str, Any],
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await keyword_project(migrated, workspace)
    await set_website(migrated, project)

    response = await api.patch(
        project_url(workspace, project, "settings"),
        json={"internal_links": patch},
        headers=editor.headers,
    )

    assert problem(response) == (422, "validation_failed")


async def test_a_subdomain_must_belong_to_the_projects_site(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await keyword_project(migrated, workspace)
    url = project_url(workspace, project, "settings")
    body = {"internal_links": {"allowed_subdomains": ["blog.example.com"]}}

    without_site = await api.patch(url, json=body, headers=editor.headers)
    await set_website(migrated, project)
    other_site = await api.patch(
        url,
        json={"internal_links": {"allowed_subdomains": ["blog.other.com"]}},
        headers=editor.headers,
    )
    lookalike = await api.patch(
        url,
        json={"internal_links": {"allowed_subdomains": ["notexample.com"]}},
        headers=editor.headers,
    )
    fine = await api.patch(url, json=body, headers=editor.headers)

    assert problem(without_site) == (422, "validation_failed")
    assert problem(other_site) == (422, "validation_failed")
    assert problem(lookalike) == (422, "validation_failed")
    assert fine.status_code == 200
    assert fine.json()["data"]["internal_links"]["allowed_subdomains"] == ["blog.example.com"]


async def test_a_viewer_reads_the_settings_and_cannot_change_them(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    project = await keyword_project(migrated, workspace)

    response = await api.patch(
        project_url(workspace, project, "settings"),
        json={"internal_links": {"schedule": "off"}},
        headers=viewer.headers,
    )

    assert response.status_code == 403
