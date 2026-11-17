"""Free tags on pages through `tag` vocabularies (spec 5.3; decision D18)."""

from __future__ import annotations

import uuid

import httpx

from idraft.api.resources import Resources
from tests.api.auth.support import fetch, fetchrow, make_workspace
from tests.api.entities.support import member, problem
from tests.api.internal_links.support import audit_rows, seed_crawl, seed_tiers
from tests.api.keywords.support import errors, keyword_project, project_url
from tests.conftest import PostgresServer


async def _term(
    pg: PostgresServer,
    workspace_id: uuid.UUID,
    kind: str,
    name: str,
    project_id: uuid.UUID | None = None,
) -> uuid.UUID:
    vocabulary = await fetchrow(
        pg,
        "INSERT INTO core.taxonomy_vocabularies (workspace_id, project_id, kind, name) "
        "VALUES ($1, $2, $3, $4) RETURNING id",
        workspace_id,
        project_id,
        kind,
        f"{name} {uuid.uuid4().hex[:6]}",
    )
    slug = name.lower().replace(" ", "-")
    term = await fetchrow(
        pg,
        "INSERT INTO core.taxonomy_terms (workspace_id, vocabulary_id, name, slug, path) "
        "VALUES ($1, $2, $3, $4, $5) RETURNING id",
        workspace_id,
        vocabulary["id"],
        name,
        slug,
        slug,
    )
    term_id: uuid.UUID = term["id"]
    return term_id


async def test_tags_are_added_and_removed_in_bulk(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await keyword_project(migrated, workspace)
    await seed_tiers(migrated, workspace)
    _, ids = await seed_crawl(migrated, workspace, project, [("/a", 200), ("/b", 200)])
    launch = await _term(migrated, workspace.id, "tag", "Launch")
    url = project_url(workspace, project, "pages", "tags")
    every = [str(ids["/a"]), str(ids["/b"])]

    added = await api.put(
        url, json={"url_ids": every, "add": [str(launch)], "remove": []}, headers=editor.headers
    )
    again = await api.put(
        url, json={"url_ids": every, "add": [str(launch)], "remove": []}, headers=editor.headers
    )
    removed = await api.put(
        url,
        json={"url_ids": [str(ids["/a"])], "add": [], "remove": [str(launch)]},
        headers=editor.headers,
    )

    assert added.json()["data"] == {"matched": 2, "added": 2, "removed": 0}
    assert again.json()["data"] == {"matched": 2, "added": 0, "removed": 0}
    assert removed.json()["data"] == {"matched": 1, "added": 0, "removed": 1}
    rows = await fetch(
        migrated, "SELECT url_id FROM core.page_terms WHERE project_id = $1", project
    )
    assert [row["url_id"] for row in rows] == [ids["/b"]]
    assert len(await audit_rows(migrated, workspace, "page_tags.changed")) == 3


async def test_a_term_that_is_not_a_tag_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await keyword_project(migrated, workspace)
    await seed_tiers(migrated, workspace)
    _, ids = await seed_crawl(migrated, workspace, project, [("/a", 200)])
    topic = await _term(migrated, workspace.id, "topic", "Pricing")

    response = await api.put(
        project_url(workspace, project, "pages", "tags"),
        json={"url_ids": [str(ids["/a"])], "add": [str(topic)], "remove": []},
        headers=editor.headers,
    )

    assert problem(response) == (422, "validation_failed")
    assert errors(response) == [("add", "not_a_tag")]
    written = await fetch(migrated, "SELECT 1 FROM core.page_terms WHERE project_id = $1", project)
    assert written == []


async def test_a_tag_of_another_workspace_or_project_or_none_is_refused_and_nothing_is_written(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await keyword_project(migrated, workspace)
    sibling = await keyword_project(migrated, workspace)
    other = await make_workspace(migrated, name="Other")
    await seed_tiers(migrated, workspace)
    _, ids = await seed_crawl(migrated, workspace, project, [("/a", 200)])
    own = await _term(migrated, workspace.id, "tag", "Own")
    foreign = await _term(migrated, other.id, "tag", "Theirs")
    sibling_only = await _term(migrated, workspace.id, "tag", "Sibling", sibling)
    url = project_url(workspace, project, "pages", "tags")
    page = [str(ids["/a"])]

    for wrong in (foreign, sibling_only, uuid.uuid4()):
        refused = await api.put(
            url,
            json={"url_ids": page, "add": [str(own), str(wrong)], "remove": []},
            headers=editor.headers,
        )
        assert problem(refused) == (422, "validation_failed"), wrong
        assert errors(refused) == [("add", "not_a_tag")], wrong
    removed = await api.put(
        url, json={"url_ids": page, "add": [], "remove": [str(foreign)]}, headers=editor.headers
    )

    assert errors(removed) == [("remove", "not_a_tag")]
    written = await fetch(migrated, "SELECT 1 FROM core.page_terms WHERE project_id = $1", project)
    assert written == []


async def test_a_project_tag_and_a_filter_selection_work_and_urls_outside_the_crawl_do_not_tag(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    editor = await member(resources, migrated, workspace, "editor")
    project = await keyword_project(migrated, workspace)
    other_project = await keyword_project(migrated, workspace)
    await seed_tiers(migrated, workspace)
    _, ids = await seed_crawl(migrated, workspace, project, [("/blog/a", 200), ("/blog/b", 200)])
    _, elsewhere = await seed_crawl(migrated, workspace, other_project, [("/only-there", 200)])
    mine = await _term(migrated, workspace.id, "tag", "Mine", project)
    url = project_url(workspace, project, "pages", "tags")

    by_filter = await api.put(
        url,
        json={"filter": {"q": "/blog/"}, "add": [str(mine)], "remove": []},
        headers=editor.headers,
    )
    strange = await api.put(
        url,
        json={"url_ids": [str(elsewhere["/only-there"])], "add": [str(mine)], "remove": []},
        headers=editor.headers,
    )

    assert by_filter.json()["data"] == {"matched": 2, "added": 2, "removed": 0}
    assert strange.json()["data"] == {"matched": 0, "added": 0, "removed": 0}
    rows = await fetch(
        migrated, "SELECT url_id FROM core.page_terms WHERE project_id = $1", project
    )
    assert {row["url_id"] for row in rows} == {ids["/blog/a"], ids["/blog/b"]}
    assert (
        await fetch(migrated, "SELECT 1 FROM core.page_terms WHERE project_id = $1", other_project)
        == []
    )
