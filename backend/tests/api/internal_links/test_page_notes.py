"""Notes on a page: reads, writes, who may do what, and the audit entries (spec 9.7.2)."""

from __future__ import annotations

import uuid
from dataclasses import dataclass

import httpx
import pytest

from idraft.api.resources import Resources
from tests.api.auth.support import Workspace, execute, fetch, fetchrow, make_workspace
from tests.api.entities.support import Caller, member, problem
from tests.api.internal_links.support import audit_rows, read_site, seed_crawl
from tests.api.keywords.support import keyword_project, project_url
from tests.conftest import PostgresServer

ACTIONS = ("page_note.created", "page_note.updated", "page_note.deleted", "page_note.restored")


@dataclass(frozen=True)
class Site:
    workspace: Workspace
    project: uuid.UUID
    run_id: uuid.UUID
    ids: dict[str, int]

    def page(self, path: str = "/pricing") -> str:
        return project_url(self.workspace, self.project, "internal-links", "pages", self.ids[path])

    def notes(self, *parts: object, path: str = "/pricing") -> str:
        return "/".join([self.page(path), "notes", *map(str, parts)])


async def _site(pg: PostgresServer) -> Site:
    workspace = await make_workspace(pg)
    project = await keyword_project(pg, workspace)
    run_id, ids, _ = await read_site(pg, workspace, project)
    return Site(workspace, project, run_id, ids)


async def _add(api: httpx.AsyncClient, site: Site, caller: Caller, body: str = "A note") -> str:
    response = await api.post(site.notes(), json={"body": body}, headers=caller.headers)
    assert response.status_code == 201, response.text
    note_id: str = response.json()["data"]["id"]
    return note_id


async def _listed(api: httpx.AsyncClient, site: Site, caller: Caller) -> list[dict[str, object]]:
    response = await api.get(site.notes(), headers=caller.headers)
    assert response.status_code == 200, response.text
    notes: list[dict[str, object]] = response.json()["data"]
    return notes


async def _count(api: httpx.AsyncClient, site: Site, caller: Caller, **params: str) -> object:
    response = await api.get(site.page(), params=params, headers=caller.headers)
    assert response.status_code == 200, response.text
    return response.json()["data"]["notes_count"]


async def _audited(pg: PostgresServer, site: Site) -> int:
    return sum([len(await audit_rows(pg, site.workspace, action)) for action in ACTIONS])


async def test_an_editor_adds_a_note_and_it_is_listed_and_counted(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(migrated)
    editor = await member(resources, migrated, site.workspace, "editor")

    before = await _count(api, site, editor)
    created = await api.post(site.notes(), json={"body": "Check again"}, headers=editor.headers)

    assert before == 0
    assert created.status_code == 201, created.text
    note = created.json()["data"]
    assert note["author"] == {"id": str(editor.user_id), "name": "Jane Doe"}
    assert note["body"] == "Check again"
    assert note["created_at"] is not None
    assert note["edited_at"] is None
    assert (note["can_edit"], note["can_delete"]) == (True, True)
    assert await _listed(api, site, editor) == [note]
    assert await _count(api, site, editor) == 1


async def test_notes_are_listed_newest_first_in_pages_stable_over_equal_instants(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(migrated)
    editor = await member(resources, migrated, site.workspace, "editor")
    first = await _add(api, site, editor, "one")
    second = await _add(api, site, editor, "two")
    third = await _add(api, site, editor, "three")
    # Two notes of the same instant: the id breaks the tie.
    await execute(
        migrated,
        "UPDATE core.page_notes SET created_at = (SELECT created_at FROM core.page_notes "
        "WHERE id = $1) WHERE id = $2",
        uuid.UUID(first),
        uuid.UUID(second),
    )

    every = await api.get(site.notes(), headers=editor.headers)
    page_one = await api.get(site.notes(), params={"limit": 2}, headers=editor.headers)
    cursor = page_one.json()["meta"]["next_cursor"]
    page_two = await api.get(
        site.notes(), params={"limit": 2, "cursor": cursor}, headers=editor.headers
    )

    assert [note["id"] for note in every.json()["data"]] == [third, second, first]
    assert every.json()["meta"] == {"limit": 50, "next_cursor": None, "has_more": False, "total": 3}
    assert [note["id"] for note in page_one.json()["data"]] == [third, second]
    assert page_one.json()["meta"]["has_more"] is True
    assert page_one.json()["meta"]["total"] == 3
    assert [note["id"] for note in page_two.json()["data"]] == [first]
    assert page_two.json()["meta"]["next_cursor"] is None
    for limit in (0, 101):
        refused = await api.get(site.notes(), params={"limit": limit}, headers=editor.headers)
        assert refused.status_code == 422, limit


async def test_the_body_is_trimmed_and_kept_as_written(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(migrated)
    editor = await member(resources, migrated, site.workspace, "editor")
    markup = "<b>x</b> & <script>"

    for sent, stored in (
        ("  a\r\nb  ", "a\nb"),
        ("\n\t a\nb \t\n", "a\nb"),
        ("x" * 2000, "x" * 2000),
        (markup, markup),
    ):
        note_id = await _add(api, site, editor, sent)
        row = await fetchrow(
            migrated, "SELECT body FROM core.page_notes WHERE id = $1", uuid.UUID(note_id)
        )
        assert row["body"] == stored, sent
    assert (await _listed(api, site, editor))[0]["body"] == markup


@pytest.mark.parametrize(
    "body",
    ["", "   ", "\n\n", "\t\n \r\n", "a\x00b", "x" * 2001],
    ids=["empty", "spaces", "newlines", "tabs and newlines", "null character", "2,001 characters"],
)
async def test_a_body_that_is_empty_too_long_or_holds_a_null_character_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, body: str
) -> None:
    site = await _site(migrated)
    editor = await member(resources, migrated, site.workspace, "editor")
    note_id = await _add(api, site, editor, "kept")

    created = await api.post(site.notes(), json={"body": body}, headers=editor.headers)
    changed = await api.patch(site.notes(note_id), json={"body": body}, headers=editor.headers)

    assert problem(created) == (422, "validation_failed")
    assert problem(changed) == (422, "validation_failed")
    assert [note["body"] for note in await _listed(api, site, editor)] == ["kept"]
    assert await _audited(migrated, site) == 1


async def test_only_the_author_changes_a_note(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(migrated)
    author = await member(resources, migrated, site.workspace, "editor")
    note_id = await _add(api, site, author, "first")
    created = (await _listed(api, site, author))[0]

    changed = await api.patch(
        site.notes(note_id), json={"body": " second "}, headers=author.headers
    )
    again = await api.patch(site.notes(note_id), json={"body": "second"}, headers=author.headers)

    assert changed.status_code == 200, changed.text
    note = changed.json()["data"]
    assert note["body"] == "second"
    assert note["edited_at"] is not None
    assert note["created_at"] == created["created_at"]
    assert again.json()["data"] == note
    for role in ("editor", "admin", "owner", "viewer"):
        other = await member(resources, migrated, site.workspace, role)
        refused = await api.patch(site.notes(note_id), json={"body": "x"}, headers=other.headers)
        assert problem(refused) == (403, "forbidden"), role
    assert await _listed(api, site, author) == [note]
    assert len(await audit_rows(migrated, site.workspace, "page_note.updated")) == 1


async def test_the_author_an_owner_and_an_admin_delete_a_note_and_nobody_else(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(migrated)
    author = await member(resources, migrated, site.workspace, "editor")
    own = await _add(api, site, author, "own")
    for_admin = await _add(api, site, author, "for the admin")
    for_owner = await _add(api, site, author, "for the owner")

    for role in ("editor", "viewer"):
        other = await member(resources, migrated, site.workspace, role)
        refused = await api.delete(site.notes(own), headers=other.headers)
        assert problem(refused) == (403, "forbidden"), role
    assert await _count(api, site, author) == 3
    assert await _audited(migrated, site) == 3

    deleted = await api.delete(site.notes(own), headers=author.headers)
    second = await api.delete(site.notes(own), headers=author.headers)
    changed = await api.patch(site.notes(own), json={"body": "x"}, headers=author.headers)
    for role, note_id in (("admin", for_admin), ("owner", for_owner)):
        manager = await member(resources, migrated, site.workspace, role)
        by_manager = await api.delete(site.notes(note_id), headers=manager.headers)
        assert by_manager.status_code == 204, role

    assert deleted.status_code == 204, deleted.text
    assert deleted.content == b""
    assert problem(second) == (404, "not_found")
    assert problem(changed) == (404, "not_found")
    assert await _listed(api, site, author) == []
    assert await _count(api, site, author) == 0
    # A delete is soft: every row is still there.
    rows = await fetch(
        migrated,
        "SELECT id, deleted_at, deleted_by FROM core.page_notes WHERE project_id = $1",
        site.project,
    )
    assert len(rows) == 3
    assert all(row["deleted_at"] is not None for row in rows)
    assert {row["id"]: row["deleted_by"] for row in rows}[uuid.UUID(own)] == author.user_id


async def test_the_one_who_deleted_a_note_brings_it_back(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(migrated)
    author = await member(resources, migrated, site.workspace, "editor")
    other = await member(resources, migrated, site.workspace, "editor")
    admin = await member(resources, migrated, site.workspace, "admin")
    own = await _add(api, site, author, "first")
    await api.patch(site.notes(own), json={"body": "own"}, headers=author.headers)
    by_admin = await _add(api, site, author, "deleted by the admin")
    written = {note["id"]: note for note in await _listed(api, site, author)}

    not_deleted = await api.post(site.notes(own, "restore"), headers=author.headers)
    await api.delete(site.notes(own), headers=author.headers)
    await api.delete(site.notes(by_admin), headers=admin.headers)
    by_other = await api.post(site.notes(own, "restore"), headers=other.headers)
    by_author = await api.post(site.notes(by_admin, "restore"), headers=author.headers)
    restored = await api.post(site.notes(own, "restore"), headers=author.headers)
    admin_restored = await api.post(site.notes(by_admin, "restore"), headers=admin.headers)

    assert problem(not_deleted) == (404, "not_found")
    assert problem(by_other) == (403, "forbidden")
    assert problem(by_author) == (403, "forbidden")
    assert restored.status_code == 200, restored.text
    assert restored.json()["data"] == written[own]
    assert written[own]["edited_at"] is not None
    assert admin_restored.status_code == 200, admin_restored.text
    assert admin_restored.json()["data"]["author"]["id"] == str(author.user_id)
    assert {note["id"]: note for note in await _listed(api, site, author)} == written
    assert await _count(api, site, author) == 2
    rows = await fetch(
        migrated,
        "SELECT deleted_at, deleted_by FROM core.page_notes WHERE project_id = $1",
        site.project,
    )
    assert [(row["deleted_at"], row["deleted_by"]) for row in rows] == [(None, None)] * 2


async def test_a_reader_is_told_what_they_may_do_with_each_note(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(migrated)
    author = await member(resources, migrated, site.workspace, "editor")
    await _add(api, site, author)

    async def may(role: str) -> tuple[object, object]:
        reader = await member(resources, migrated, site.workspace, role)
        (note,) = await _listed(api, site, reader)
        return note["can_edit"], note["can_delete"]

    assert await may("viewer") == (False, False)
    assert await may("editor") == (False, False)
    assert await may("admin") == (False, True)
    assert await may("owner") == (False, True)
    viewer = await member(resources, migrated, site.workspace, "viewer")
    refused = await api.post(site.notes(), json={"body": "x"}, headers=viewer.headers)
    assert problem(refused) == (403, "forbidden")
    assert await _audited(migrated, site) == 1
    # The author leaves the workspace: the note stays under their name, and an admin may delete it.
    await execute(
        migrated,
        "DELETE FROM auth.memberships WHERE workspace_id = $1 AND user_id = $2",
        site.workspace.id,
        author.user_id,
    )
    admin = await member(resources, migrated, site.workspace, "admin")
    (left,) = await _listed(api, site, admin)
    assert left["author"] == {"id": str(author.user_id), "name": "Jane Doe"}
    assert (left["can_edit"], left["can_delete"]) == (False, True)


async def test_a_note_belongs_to_one_page_of_one_project_of_one_workspace(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(migrated)
    editor = await member(resources, migrated, site.workspace, "editor")
    sibling = await keyword_project(migrated, site.workspace)
    _, elsewhere = await seed_crawl(migrated, site.workspace, sibling, [("/only-there", 200)])
    other = await make_workspace(migrated, name="Other")
    outsider = await member(resources, migrated, other, "owner")
    note_id = await _add(api, site, editor)
    not_crawled = project_url(
        site.workspace, site.project, "internal-links", "pages", elsewhere["/only-there"], "notes"
    )
    not_digits = project_url(
        site.workspace, site.project, "internal-links", "pages", "abc", "notes"
    )
    body = {"body": "x"}

    assert problem(await api.get(not_crawled, headers=editor.headers)) == (404, "not_found")
    assert problem(await api.post(not_crawled, json=body, headers=editor.headers)) == (
        404,
        "not_found",
    )
    assert (await api.get(not_digits, headers=editor.headers)).status_code == 422
    assert (await api.post(not_digits, json=body, headers=editor.headers)).status_code == 422
    # The note is on /pricing: under /blog it does not exist.
    blog = site.notes(note_id, path="/blog")
    assert problem(await api.patch(blog, json=body, headers=editor.headers)) == (404, "not_found")
    assert problem(await api.delete(blog, headers=editor.headers)) == (404, "not_found")
    await api.delete(site.notes(note_id), headers=editor.headers)
    restore = await api.post(f"{blog}/restore", headers=editor.headers)
    assert problem(restore) == (404, "not_found")
    await api.post(site.notes(note_id, "restore"), headers=editor.headers)
    for response in (
        await api.get(site.notes(), headers=outsider.headers),
        await api.post(site.notes(), json=body, headers=outsider.headers),
        await api.patch(site.notes(note_id), json=body, headers=outsider.headers),
        await api.delete(site.notes(note_id), headers=outsider.headers),
        await api.post(site.notes(note_id, "restore"), headers=outsider.headers),
    ):
        assert response.status_code == 404, response.request.method
    assert [note["body"] for note in await _listed(api, site, editor)] == ["A note"]
    assert await _listed(api, site, editor) == await _listed(api, site, editor)
    assert (await api.get(site.notes(path="/blog"), headers=editor.headers)).json()["data"] == []


async def test_a_note_stays_across_crawls_and_on_a_page_that_now_redirects(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(migrated)
    editor = await member(resources, migrated, site.workspace, "editor")
    note_id = await _add(api, site, editor)

    second_run, _ = await seed_crawl(
        migrated, site.workspace, site.project, [("/", 200), ("/pricing", 200)]
    )
    await execute(
        migrated,
        "UPDATE seo.crawl_pages SET status_code = 301, resource_type = 'redirect' "
        "WHERE run_id = $1 AND url_id = $2",
        second_run,
        site.ids["/pricing"],
    )

    assert [note["id"] for note in await _listed(api, site, editor)] == [note_id]
    assert await _count(api, site, editor) == 1
    assert await _count(api, site, editor, run=str(site.run_id)) == 1


async def test_every_write_is_audited_with_its_bodies(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(migrated)
    editor = await member(resources, migrated, site.workspace, "editor")
    url_id = str(site.ids["/pricing"])

    note_id = await _add(api, site, editor, "first")
    await api.patch(site.notes(note_id), json={"body": "second"}, headers=editor.headers)
    await api.patch(site.notes(note_id), json={"body": "second"}, headers=editor.headers)
    await api.delete(site.notes(note_id), headers=editor.headers)
    await api.post(site.notes(note_id, "restore"), headers=editor.headers)

    rows = await fetch(
        migrated,
        "SELECT action, target_type, target_id, actor_id FROM ops.audit_logs "
        "WHERE workspace_id = $1 AND action LIKE 'page_note.%' ORDER BY id",
        site.workspace.id,
    )
    assert [row["action"] for row in rows] == list(ACTIONS)
    assert {(row["target_type"], row["target_id"], row["actor_id"]) for row in rows} == {
        ("page_note", note_id, str(editor.user_id))
    }
    snapshots = {
        action: (await audit_rows(migrated, site.workspace, action))[0] for action in ACTIONS
    }
    assert snapshots == {
        "page_note.created": {"before": None, "after": {"url_id": url_id, "body": "first"}},
        "page_note.updated": {"before": {"body": "first"}, "after": {"body": "second"}},
        "page_note.deleted": {
            "before": {"url_id": url_id, "body": "second", "author_id": str(editor.user_id)},
            "after": None,
        },
        "page_note.restored": {"before": None, "after": None},
    }
