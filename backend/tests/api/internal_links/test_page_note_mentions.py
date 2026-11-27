"""Mentions on a page note: checked by type on every write, derived on every read (spec 9.8.1)."""

from __future__ import annotations

import json
import uuid
from collections.abc import Collection, Iterator
from dataclasses import dataclass

import httpx
import pytest
from fastapi import FastAPI

from idraft.api.internal_links.page_note_routes import get_page_notes
from idraft.api.internal_links.page_notes import PageNoteService
from idraft.api.resources import Resources
from tests.api.auth.support import Workspace, execute, fetchrow, make_user, make_workspace
from tests.api.entities.support import Caller, member, problem
from tests.api.internal_links.support import audit_rows, read_site, seed_crawl
from tests.api.internal_links.support_changes import track_keyword
from tests.api.keywords.support import errors, keyword_project, project_url
from tests.conftest import PostgresServer


@dataclass(frozen=True)
class Site:
    workspace: Workspace
    project: uuid.UUID
    ids: dict[str, int]
    editor: Caller
    teammate: Caller

    def notes(self, *parts: object) -> str:
        page = project_url(
            self.workspace, self.project, "internal-links", "pages", self.ids["/pricing"]
        )
        return "/".join([page, "notes", *map(str, parts)])


async def _site(pg: PostgresServer, resources: Resources) -> Site:
    workspace = await make_workspace(pg)
    project = await keyword_project(pg, workspace)
    _, ids, _ = await read_site(pg, workspace, project)
    await track_keyword(
        pg, workspace, project, "blue shoes", ids["/pricing"], rank=3, change=0, volume=None
    )
    editor = await member(resources, pg, workspace, "editor")
    teammate = await member(resources, pg, workspace, "viewer")
    return Site(workspace, project, ids, editor, teammate)


def _page(site: Site, label: str = "@/blog/a", path: str = "/blog/a") -> dict[str, str]:
    return {"type": "page", "label": label, "target": str(site.ids[path])}


def _user(caller: Caller, label: str = "@Jane Doe") -> dict[str, str]:
    return {"type": "user", "label": label, "target": str(caller.user_id)}


def _keyword(label: str = '@"blue shoes"', text: str = "blue shoes") -> dict[str, str]:
    return {"type": "keyword", "label": label, "target": text}


async def _post(
    api: httpx.AsyncClient, site: Site, body: str, mentions: list[dict[str, str]] | None
) -> httpx.Response:
    payload: dict[str, object] = {"body": body}
    if mentions is not None:
        payload["mentions"] = mentions
    return await api.post(site.notes(), json=payload, headers=site.editor.headers)


async def _stored(pg: PostgresServer, note_id: str) -> object:
    row = await fetchrow(
        pg, "SELECT mentions FROM core.page_notes WHERE id = $1", uuid.UUID(note_id)
    )
    return json.loads(row["mentions"])  # asyncpg gives jsonb as text


class _Checks:
    """An Issues catalogue that knows two checks."""

    async def known(self, check_ids: Collection[str]) -> frozenset[str] | None:
        return frozenset(check_ids) & {"missing_title", "thin_content"}


@pytest.fixture
def with_issues(auth_app: FastAPI, resources: Resources) -> Iterator[None]:
    service = PageNoteService(sessions=resources.sessions, issues=_Checks())
    auth_app.dependency_overrides[get_page_notes] = lambda: service
    yield
    auth_app.dependency_overrides.pop(get_page_notes)


async def test_page_user_and_keyword_mentions_are_stored_and_read_back(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(migrated, resources)
    mentions = [_page(site), _user(site.teammate), _keyword()]

    created = await _post(api, site, 'See @/blog/a, ask @Jane Doe about @"blue shoes".', mentions)

    assert created.status_code == 201, created.text
    note = created.json()["data"]
    assert note["mentions"] == [
        {**mentions[0], "path": "/blog/a"},
        {**mentions[1], "path": None},
        {**mentions[2], "path": None},
    ]
    listed = await api.get(site.notes(), headers=site.editor.headers)
    assert listed.json()["data"] == [note]
    # The path is derived on read: the column holds the three fields and nothing else.
    assert await _stored(migrated, note["id"]) == mentions


async def test_a_note_without_mentions_reads_an_empty_list(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(migrated, resources)

    created = await _post(api, site, "Plain", None)

    assert created.json()["data"]["mentions"] == []


async def test_a_target_the_database_does_not_know_for_this_project_is_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(migrated, resources)
    other_workspace = await make_workspace(migrated)
    outsider = await member(resources, migrated, other_workspace, "editor")
    stranger = await make_user(migrated)
    other_project = await keyword_project(migrated, site.workspace)
    _, other_ids = await seed_crawl(migrated, site.workspace, other_project, [("/other-only", 200)])
    await track_keyword(
        migrated, site.workspace, other_project, "red hats", None, rank=1, change=0, volume=None
    )
    await track_keyword(
        migrated, site.workspace, site.project, "stale", None, rank=1, change=0, volume=None
    )
    await track_keyword(
        migrated, site.workspace, site.project, "gone", None, rank=1, change=0, volume=None
    )
    await execute(
        migrated,
        "UPDATE seo.tracked_keywords SET is_active = false WHERE keyword_id IN "
        "(SELECT id FROM seo.keywords WHERE text = 'stale')",
    )
    await execute(
        migrated,
        "UPDATE seo.tracked_keywords SET deleted_at = now() WHERE keyword_id IN "
        "(SELECT id FROM seo.keywords WHERE text = 'gone')",
    )
    cases = {
        "a page of another project": (
            {"type": "page", "label": "@/other-only", "target": str(other_ids["/other-only"])},
            "mention_target_unknown",
        ),
        "a page no crawl holds": (
            {"type": "page", "label": "@/none", "target": "999999999999"},
            "mention_target_unknown",
        ),
        "a user of another workspace": (_user(outsider), "mention_target_unknown"),
        "a user in no workspace": (
            {"type": "user", "label": "@Nobody", "target": str(stranger.id)},
            "mention_target_unknown",
        ),
        "a keyword nobody tracks": (_keyword("@nope", "nope"), "mention_target_unknown"),
        "a keyword of another project": (_keyword("@red", "red hats"), "mention_target_unknown"),
        "an inactive keyword": (_keyword("@stale", "stale"), "mention_target_unknown"),
        "a deleted keyword": (_keyword("@gone", "gone"), "mention_target_unknown"),
    }

    for name, (mention, code) in cases.items():
        refused = await _post(api, site, f"x {mention['label']}", [mention])
        assert problem(refused) == (422, "validation_failed"), name
        assert errors(refused) == [("mentions[0].target", code)], name
    listed = await api.get(site.notes(), headers=site.editor.headers)
    assert listed.json()["data"] == []
    assert await audit_rows(migrated, site.workspace, "page_note.created") == []


@pytest.mark.parametrize(
    "mention",
    [
        {"type": "page", "label": "@/x", "target": "12a"},
        {"type": "page", "label": "@/x", "target": "-1"},
        {"type": "user", "label": "@x", "target": "not-a-uuid"},
    ],
    ids=["page not digits", "page negative", "user not a uuid"],
)
async def test_a_target_of_the_wrong_shape_is_refused(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    mention: dict[str, str],
) -> None:
    site = await _site(migrated, resources)

    refused = await _post(api, site, f"x {mention['label']}", [mention])

    assert problem(refused) == (422, "validation_failed")
    assert [path for path, _ in errors(refused)] == ["mentions[0].target"]


@pytest.mark.parametrize(
    "mention",
    [
        {"type": "page", "label": "/x", "target": "1"},
        {"type": "page", "label": "@", "target": "1"},
        {"type": "page", "label": "@/a\nb", "target": "1"},
        {"type": "page", "label": "@/" + "a" * 199, "target": "1"},
        {"type": "page", "label": "@/x", "target": ""},
        {"type": "page", "label": "@/x", "target": "1" * 201},
        {"type": "tag", "label": "@/x", "target": "1"},
    ],
    ids=[
        "no @",
        "only @",
        "line break",
        "201 characters",
        "no target",
        "long target",
        "unknown type",
    ],
)
async def test_a_malformed_entry_is_refused(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    mention: dict[str, str],
) -> None:
    site = await _site(migrated, resources)

    refused = await _post(api, site, f"x {mention['label']}", [mention])

    assert problem(refused) == (422, "validation_failed")


@pytest.fixture
def without_issues(auth_app: FastAPI, resources: Resources) -> Iterator[None]:
    service = PageNoteService(sessions=resources.sessions)
    auth_app.dependency_overrides[get_page_notes] = lambda: service
    yield
    auth_app.dependency_overrides.pop(get_page_notes)


@pytest.mark.usefixtures("without_issues")
async def test_an_issue_mention_is_unavailable_without_a_catalogue(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(migrated, resources)
    issue = {"type": "issue", "label": "@Missing title", "target": "missing_title"}

    refused = await _post(api, site, "See @Missing title", [issue])

    assert problem(refused) == (422, "validation_failed")
    assert errors(refused) == [("mentions[0].type", "mention_type_unavailable")]
    assert await audit_rows(migrated, site.workspace, "page_note.created") == []


async def test_the_app_checks_an_issue_mention_against_the_issues_catalogue(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(migrated, resources)
    known = {"type": "issue", "label": "@Broken pages", "target": "status-4xx"}
    unknown = {"type": "issue", "label": "@Made up", "target": "made-up"}

    refused = await _post(api, site, "See @Made up", [unknown])
    created = await _post(api, site, "See @Broken pages", [known])

    assert errors(refused) == [("mentions[0].target", "mention_target_unknown")]
    assert created.status_code == 201, created.text
    assert created.json()["data"]["mentions"] == [{**known, "path": None}]


@pytest.mark.usefixtures("with_issues")
async def test_an_issue_mention_is_checked_against_the_catalogue_when_there_is_one(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(migrated, resources)
    known = {"type": "issue", "label": "@Missing title", "target": "missing_title"}
    unknown = {"type": "issue", "label": "@Made up", "target": "made_up"}

    refused = await _post(api, site, "See @Made up", [unknown])
    created = await _post(api, site, "See @Missing title", [known])

    assert errors(refused) == [("mentions[0].target", "mention_target_unknown")]
    assert created.status_code == 201, created.text
    assert created.json()["data"]["mentions"] == [{**known, "path": None}]


async def test_20_entries_pass_and_21_are_refused(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(migrated, resources)

    def many(count: int) -> tuple[str, list[dict[str, str]]]:
        mentions = [_page(site, f"@/p{number}") for number in range(count)]
        return " ".join(mention["label"] for mention in mentions), mentions

    ok = await _post(api, site, *many(20))
    too_many = await _post(api, site, *many(21))

    assert ok.status_code == 201, ok.text
    assert len(ok.json()["data"]["mentions"]) == 20
    assert problem(too_many) == (422, "validation_failed")


async def test_a_label_not_in_the_text_is_dropped_and_a_repeated_label_keeps_the_first(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(migrated, resources)
    first = _page(site, "@/same", "/blog/a")
    repeated = _page(site, "@/same", "/blog/b")
    absent = _user(site.teammate, "@Absent")

    created = await _post(api, site, "Look at @/same", [first, repeated, absent])

    assert created.json()["data"]["mentions"] == [{**first, "path": "/blog/a"}]


async def test_an_entry_dropped_for_its_label_is_not_checked(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(migrated, resources)
    unknown = {"type": "page", "label": "@/none", "target": "999999999999"}

    created = await _post(api, site, "No mention here", [unknown])

    assert created.status_code == 201, created.text
    assert created.json()["data"]["mentions"] == []


async def test_a_change_drops_the_entries_whose_label_left_the_text_and_keeps_the_rest(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(migrated, resources)
    page, user = _page(site), _user(site.teammate)
    note_id = (await _post(api, site, "See @/blog/a and @Jane Doe", [page, user])).json()["data"][
        "id"
    ]

    omitted = await api.patch(
        site.notes(note_id), json={"body": "Only @/blog/a now"}, headers=site.editor.headers
    )
    sent = await api.patch(
        site.notes(note_id),
        json={"body": "Only @Jane Doe now", "mentions": [page, user]},
        headers=site.editor.headers,
    )

    assert omitted.json()["data"]["mentions"] == [{**page, "path": "/blog/a"}]
    assert sent.json()["data"]["mentions"] == [{**user, "path": None}]
    assert await _stored(migrated, note_id) == [user]


async def test_a_change_without_mentions_keeps_a_stored_one_even_when_its_user_has_left(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(migrated, resources)
    user = _user(site.teammate)
    note_id = (await _post(api, site, "Ask @Jane Doe", [user])).json()["data"]["id"]
    await execute(
        migrated,
        "DELETE FROM auth.memberships WHERE workspace_id = $1 AND user_id = $2",
        site.workspace.id,
        site.teammate.user_id,
    )

    changed = await api.patch(
        site.notes(note_id), json={"body": "Ask @Jane Doe soon"}, headers=site.editor.headers
    )
    resent = await api.patch(
        site.notes(note_id),
        json={"body": "Ask @Jane Doe now", "mentions": [user]},
        headers=site.editor.headers,
    )

    assert changed.json()["data"]["mentions"] == [{**user, "path": None}]
    assert errors(resent) == [("mentions[0].target", "mention_target_unknown")]


async def test_edited_at_is_set_when_only_the_mentions_changed_and_not_when_they_are_equal(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(migrated, resources)
    page = _page(site)
    note_id = (await _post(api, site, "See @/blog/a and more", [page])).json()["data"]["id"]
    body = "See @/blog/a and more"

    same = await api.patch(
        site.notes(note_id), json={"body": body, "mentions": [page]}, headers=site.editor.headers
    )
    removed = await api.patch(
        site.notes(note_id), json={"body": body, "mentions": []}, headers=site.editor.headers
    )

    assert same.json()["data"]["edited_at"] is None
    assert removed.json()["data"]["edited_at"] is not None
    assert removed.json()["data"]["mentions"] == []
    assert len(await audit_rows(migrated, site.workspace, "page_note.updated")) == 1


async def test_a_page_chip_shows_the_current_path_of_the_address(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(migrated, resources)
    moved = f"/moved-{uuid.uuid4().hex[:8]}"
    _, moved_ids = await seed_crawl(migrated, site.workspace, site.project, [(moved, 200)])
    mention = {"type": "page", "label": "@/old", "target": str(moved_ids[moved])}
    await _post(api, site, "Was @/old", [mention])
    await _post(api, site, "No chip", None)

    await execute(
        migrated, "UPDATE core.urls SET path = '/new-home' WHERE id = $1", moved_ids[moved]
    )
    listed = await api.get(site.notes(), headers=site.editor.headers)

    notes = {note["body"]: note for note in listed.json()["data"]}
    assert notes["Was @/old"]["mentions"] == [{**mention, "path": "/new-home"}]
    assert notes["No chip"]["mentions"] == []


async def test_a_viewer_cannot_write_mentions_and_a_refused_write_changes_nothing(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(migrated, resources)
    page = _page(site)
    note_id = (await _post(api, site, "See @/blog/a", [page])).json()["data"]["id"]

    by_viewer = await api.post(
        site.notes(),
        json={"body": "See @/blog/a", "mentions": [page]},
        headers=site.teammate.headers,
    )
    refused = await api.patch(
        site.notes(note_id),
        json={
            "body": "Changed @/none",
            "mentions": [{"type": "page", "label": "@/none", "target": "999999999999"}],
        },
        headers=site.editor.headers,
    )

    assert problem(by_viewer) == (403, "forbidden")
    assert refused.status_code == 422
    assert await _stored(migrated, note_id) == [page]
    assert len(await audit_rows(migrated, site.workspace, "page_note.created")) == 1
    assert await audit_rows(migrated, site.workspace, "page_note.updated") == []


async def test_the_audit_entries_hold_the_mentions(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(migrated, resources)
    page, user = _page(site), _user(site.teammate)
    note_id = (await _post(api, site, "See @/blog/a", [page])).json()["data"]["id"]
    await api.patch(
        site.notes(note_id),
        json={"body": "See @/blog/a and @Jane Doe", "mentions": [page, user]},
        headers=site.editor.headers,
    )

    created = (await audit_rows(migrated, site.workspace, "page_note.created"))[0]
    updated = (await audit_rows(migrated, site.workspace, "page_note.updated"))[0]

    assert created["after"] == {
        "url_id": str(site.ids["/pricing"]),
        "body": "See @/blog/a",
        "mentions": [page],
        "attachment_ids": [],
    }
    assert updated["before"] == {"body": "See @/blog/a", "mentions": [page], "attachment_ids": []}
    assert updated["after"] == {
        "body": "See @/blog/a and @Jane Doe",
        "mentions": [page, user],
        "attachment_ids": [],
    }
