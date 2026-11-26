"""Files for a page note: upload, attach to a note, and download (spec 9.8.5, 9.8.6)."""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass, replace
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from starlette.datastructures import UploadFile

from idraft.api.internal_links.page_note_files import PageNoteFileService, file_path
from idraft.api.resources import Resources
from idraft.storage.file_sniff import NOTE_FILE_MAX_BYTES
from idraft.storage.note_files import get_note_file, put_note_file
from tests.api.ai.sources_support import statements
from tests.api.auth.support import Workspace, execute, fetch, make_workspace
from tests.api.entities.support import Caller, member, problem
from tests.api.internal_links.support import audit_rows, read_site
from tests.api.keywords.support import keyword_project, project_url
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer

PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR" + b"\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00"
)
JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xff\xd9"
GIF = b"GIF89a\x01\x00\x01\x00\x00\x00\x00;"
WEBP = b"RIFF\x1a\x00\x00\x00WEBPVP8 \x0e\x00\x00\x00" + b"\x00" * 14
PDF = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n"
CSV = b"a,b\n1,2\n"
TEXT = "A plain note, with café.\n".encode()
ACCEPTED = [
    ("a.png", PNG, "image/png"),
    ("a.jpg", JPEG, "image/jpeg"),
    ("a.gif", GIF, "image/gif"),
    ("a.webp", WEBP, "image/webp"),
    ("a.pdf", PDF, "application/pdf"),
    ("a.csv", CSV, "text/csv"),
    ("a.txt", TEXT, "text/plain"),
]
HOSTILE = [
    ("a.png", b'<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>'),
    ("a.txt", b"<!DOCTYPE html><html><body>hi</body></html>"),
    ("a.pdf", b"\xef\xbb\xbf<?xml version='1.0'?><a/>"),
    ("a.jpg", b"PK\x03\x04" + b"\x00" * 30),
    ("a.png", b"MZ\x90\x00" + b"\x00" * 30),
    ("a.html", b"just text"),
    ("a.svg​", b"just text"),
]
ACTION = "page_note.file_uploaded"


@dataclass(frozen=True)
class Site:
    workspace: Workspace
    project: uuid.UUID
    ids: dict[str, int]

    def page(self, path: str = "/pricing") -> str:
        return project_url(self.workspace, self.project, "internal-links", "pages", self.ids[path])

    @property
    def uploads(self) -> str:
        return f"{self.page()}/note-attachments"


async def _site(pg: PostgresServer) -> Site:
    workspace = await make_workspace(pg)
    project = await keyword_project(pg, workspace)
    _, ids, _ = await read_site(pg, workspace, project)
    return Site(workspace, project, ids)


async def _send(
    api: httpx.AsyncClient,
    url: str,
    caller: Caller,
    data: bytes,
    name: str = "a.txt",
    content_type: str = "application/octet-stream",
) -> httpx.Response:
    return await api.post(url, files={"file": (name, data, content_type)}, headers=caller.headers)


async def _rows(pg: PostgresServer, site: Site) -> list[dict[str, object]]:
    rows = await fetch(
        pg,
        "SELECT id, project_id, url_id, note_id, uploaded_by, storage_key, original_name, "
        "size_bytes, content_type, removed_at FROM core.page_note_attachments "
        "WHERE workspace_id = $1 ORDER BY created_at",
        site.workspace.id,
    )
    return [dict(row) for row in rows]


async def _set_quota(pg: PostgresServer, site: Site, limit: int) -> None:
    await execute(
        pg,
        "INSERT INTO core.workspace_quotas (workspace_id, max_note_file_bytes) VALUES ($1, $2) "
        "ON CONFLICT (workspace_id) DO UPDATE SET "
        "max_note_file_bytes = EXCLUDED.max_note_file_bytes",
        site.workspace.id,
        limit,
    )


async def _orphan(
    pg: PostgresServer, site: Site, caller: Caller, size: int, *, removed: bool
) -> None:
    """A stored file of the workspace that no live note holds: an orphan, or a removed one."""
    attachment_id = uuid.uuid4()
    note_id = None
    if removed:
        note_id = (
            await fetch(
                pg,
                "INSERT INTO core.page_notes (workspace_id, project_id, url_id, author_id, body) "
                "VALUES ($1, $2, $3, $4, 'n') RETURNING id",
                site.workspace.id,
                site.project,
                site.ids["/pricing"],
                caller.user_id,
            )
        )[0]["id"]
    await execute(
        pg,
        "INSERT INTO core.page_note_attachments (id, workspace_id, project_id, url_id, note_id, "
        "uploaded_by, storage_key, original_name, size_bytes, content_type, removed_at) "
        "VALUES ($1, $2, $3, $4, $5, $6, $7, 'old.txt', $8, 'text/plain', "
        "CASE WHEN $9 THEN now() END)",
        attachment_id,
        site.workspace.id,
        site.project,
        site.ids["/pricing"],
        note_id,
        caller.user_id,
        f"notes/v1/{site.workspace.id}/{site.project}/{attachment_id}.zst",
        size,
        removed,
    )


@pytest.fixture
def reads(monkeypatch: pytest.MonkeyPatch) -> list[int | None]:
    """The size each read of an uploaded part asked for."""
    asked: list[int | None] = []
    original = UploadFile.read

    async def spy(self: UploadFile, size: int = -1) -> bytes:
        asked.append(size)
        return await original(self, size)

    monkeypatch.setattr(UploadFile, "read", spy)
    return asked


@pytest.mark.parametrize(("name", "data", "content_type"), ACCEPTED, ids=[a[0] for a in ACCEPTED])
async def test_each_accepted_type_is_stored_by_its_content(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    import_store: MemoryStore,
    name: str,
    data: bytes,
    content_type: str,
) -> None:
    site = await _site(migrated)
    editor = await member(resources, migrated, site.workspace, "editor")

    # The browser's type and the name are no part of the decision (a wrong type is sent).
    response = await _send(api, site.uploads, editor, data, name, "application/x-whatever")

    assert response.status_code == 201, response.text
    body = response.json()["data"]
    assert (body["name"], body["size"], body["content_type"]) == (name, len(data), content_type)
    assert body["is_image"] == content_type.startswith("image/")
    assert body["url"] == file_path(
        site.workspace.id, site.project, site.ids["/pricing"], uuid.UUID(body["id"])
    )
    assert body["url"].startswith("/api/v1/")
    [row] = await _rows(migrated, site)
    assert row["note_id"] is None
    assert row["uploaded_by"] == editor.user_id
    assert row["storage_key"] == f"notes/v1/{site.workspace.id}/{site.project}/{body['id']}.zst"
    assert list(import_store.objects) == [row["storage_key"]]
    assert await get_note_file(import_store, str(row["storage_key"])) == data


async def test_the_name_is_cleaned_for_display_and_never_enters_the_key(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    import_store: MemoryStore,
) -> None:
    site = await _site(migrated)
    editor = await member(resources, migrated, site.workspace, "editor")

    response = await _send(api, site.uploads, editor, TEXT, "../../etc/pass​wd.txt")

    assert response.status_code == 201, response.text
    assert response.json()["data"]["name"] == "passwd.txt"
    assert all("passwd" not in key for key in import_store.objects)


@pytest.mark.parametrize(
    ("name", "data"), HOSTILE, ids=[f"{i}-{h[0]!r}" for i, h in enumerate(HOSTILE)]
)
async def test_a_hostile_file_is_415_and_nothing_is_written(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    import_store: MemoryStore,
    name: str,
    data: bytes,
) -> None:
    site = await _site(migrated)
    editor = await member(resources, migrated, site.workspace, "editor")

    response = await _send(api, site.uploads, editor, data, name, "image/png")

    assert problem(response) == (415, "unsupported_media_type")
    assert import_store.objects == {}
    assert await _rows(migrated, site) == []
    assert await audit_rows(migrated, site.workspace, ACTION) == []


async def test_10_mb_passes_and_one_byte_more_is_413_after_a_read_bounded_by_the_cap_plus_one(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    import_store: MemoryStore,
    reads: list[int | None],
) -> None:
    site = await _site(migrated)
    editor = await member(resources, migrated, site.workspace, "editor")

    fits = await _send(api, site.uploads, editor, b"a" * NOTE_FILE_MAX_BYTES, "big.txt")
    over = await _send(api, site.uploads, editor, b"a" * (NOTE_FILE_MAX_BYTES + 1), "big.txt")

    assert fits.status_code == 201, fits.text
    assert fits.json()["data"]["size"] == NOTE_FILE_MAX_BYTES
    assert problem(over) == (413, "payload_too_large")
    assert over.json()["limit_bytes"] == NOTE_FILE_MAX_BYTES
    assert len(import_store.objects) == 1
    # The part is never read whole: each read asks for the cap plus one byte at most.
    assert reads == [NOTE_FILE_MAX_BYTES + 1, NOTE_FILE_MAX_BYTES + 1]
    assert len(await _rows(migrated, site)) == 1


async def test_an_empty_file_and_a_missing_part_are_422(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    import_store: MemoryStore,
) -> None:
    site = await _site(migrated)
    editor = await member(resources, migrated, site.workspace, "editor")

    empty = await _send(api, site.uploads, editor, b"", "empty.txt")
    missing = await api.post(
        site.uploads, files={"other": ("a.txt", TEXT, "text/plain")}, headers=editor.headers
    )
    no_body = await api.post(site.uploads, headers=editor.headers)

    assert empty.status_code == 422
    assert empty.json()["errors"][0]["path"] == "file"
    assert empty.json()["errors"][0]["code"] == "file_empty"
    assert missing.status_code == 422
    assert no_body.status_code == 422
    assert import_store.objects == {}
    assert await _rows(migrated, site) == []


async def test_the_quota_counts_every_row_of_the_workspace_and_says_how_much(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    import_store: MemoryStore,
) -> None:
    site = await _site(migrated)
    editor = await member(resources, migrated, site.workspace, "editor")
    await _orphan(migrated, site, editor, 400, removed=False)
    await _orphan(migrated, site, editor, 300, removed=True)
    await _set_quota(migrated, site, 1000)

    fits = await _send(api, site.uploads, editor, b"x" * 300, "fits.txt")
    over = await _send(api, site.uploads, editor, b"x" * 1, "over.txt")

    assert fits.status_code == 201, fits.text
    assert problem(over) == (422, "quota_exceeded")
    assert (over.json()["limit"], over.json()["used"], over.json()["requested"]) == (1000, 1000, 1)
    assert len(import_store.objects) == 1
    assert len(await _rows(migrated, site)) == 3


async def test_a_workspace_without_a_quota_row_has_the_default_gib(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(migrated)
    editor = await member(resources, migrated, site.workspace, "editor")
    await execute(
        migrated, "DELETE FROM core.workspace_quotas WHERE workspace_id = $1", site.workspace.id
    )

    response = await _send(api, site.uploads, editor, TEXT)

    assert response.status_code == 201, response.text


async def test_two_uploads_at_the_edge_of_the_quota_cannot_both_pass(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    import_store: MemoryStore,
) -> None:
    site = await _site(migrated)
    editor = await member(resources, migrated, site.workspace, "editor")
    await _set_quota(migrated, site, 1000)

    first, second = await asyncio.gather(
        _send(api, site.uploads, editor, b"a" * 600, "one.txt"),
        _send(api, site.uploads, editor, b"b" * 600, "two.txt"),
    )

    assert sorted([first.status_code, second.status_code]) == [201, 422]
    assert len(await _rows(migrated, site)) == 1
    assert len(import_store.objects) == 1


async def test_without_storage_the_answer_is_503_and_nothing_is_recorded(
    api: httpx.AsyncClient, auth_app: FastAPI, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(migrated)
    editor = await member(resources, migrated, site.workspace, "editor")
    auth_app.state.resources = replace(
        resources, page_note_files=PageNoteFileService(sessions=resources.sessions, store=None)
    )

    response = await _send(api, site.uploads, editor, TEXT)

    assert problem(response) == (503, "storage_unavailable")
    assert await _rows(migrated, site) == []
    assert await audit_rows(migrated, site.workspace, ACTION) == []


async def test_a_failing_store_is_503_and_records_no_row(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    import_store: MemoryStore,
) -> None:
    site = await _site(migrated)
    editor = await member(resources, migrated, site.workspace, "editor")
    import_store.fails = True

    response = await _send(api, site.uploads, editor, TEXT)

    assert problem(response) == (503, "storage_unavailable")
    assert await _rows(migrated, site) == []
    assert await audit_rows(migrated, site.workspace, ACTION) == []
    import_store.fails = False
    assert (await _send(api, site.uploads, editor, TEXT)).status_code == 201


async def test_a_viewer_cannot_upload_and_another_workspace_finds_nothing(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    import_store: MemoryStore,
) -> None:
    site = await _site(migrated)
    viewer = await member(resources, migrated, site.workspace, "viewer")
    other = await _site(migrated)
    stranger = await member(resources, migrated, other.workspace, "owner")

    refused = await _send(api, site.uploads, viewer, TEXT)
    hidden = await _send(api, site.uploads, stranger, TEXT)

    assert problem(refused) == (403, "forbidden")
    assert problem(hidden) == (404, "not_found")
    assert import_store.objects == {}
    assert await _rows(migrated, site) == []


async def test_an_address_no_crawl_holds_is_404_and_writes_nothing(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    import_store: MemoryStore,
) -> None:
    site = await _site(migrated)
    editor = await member(resources, migrated, site.workspace, "editor")
    unknown = f"{site.page()[: site.page().rindex('/')]}/{max(site.ids.values()) + 100000}"

    response = await _send(api, f"{unknown}/note-attachments", editor, TEXT)

    assert problem(response) == (404, "not_found")
    assert import_store.objects == {}
    assert await _rows(migrated, site) == []


async def test_each_upload_is_one_audit_row_without_the_bytes(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(migrated)
    editor = await member(resources, migrated, site.workspace, "editor")

    first = await _send(api, site.uploads, editor, TEXT, "one.txt")
    second = await _send(api, site.uploads, editor, PNG, "two.png")

    assert first.status_code == second.status_code == 201
    entries = await audit_rows(migrated, site.workspace, ACTION)
    assert len(entries) == 2
    assert entries[0]["after"] == {
        "url_id": str(site.ids["/pricing"]),
        "name": "one.txt",
        "size": len(TEXT),
        "content_type": "text/plain",
    }
    targets = await fetch(
        migrated,
        "SELECT target_type, target_id FROM ops.audit_logs WHERE workspace_id = $1 AND action = $2 "
        "ORDER BY id",
        site.workspace.id,
        ACTION,
    )
    assert [(row["target_type"], row["target_id"]) for row in targets] == [
        ("page_note_attachment", first.json()["data"]["id"]),
        ("page_note_attachment", second.json()["data"]["id"]),
    ]


# Attaching, answering and serving (spec 9.8.5, 9.8.6).


def _notes(site: Site, *parts: object, path: str = "/pricing") -> str:
    return "/".join([site.page(path), "notes", *map(str, parts)])


def _download(site: Site, file_id: object, path: str = "/pricing") -> str:
    return f"{site.page(path)}/note-attachments/{file_id}"


async def _upload(
    api: httpx.AsyncClient,
    site: Site,
    caller: Caller,
    data: bytes = TEXT,
    name: str = "a.txt",
    path: str = "/pricing",
) -> dict[str, Any]:
    response = await _send(api, f"{site.page(path)}/note-attachments", caller, data, name)
    assert response.status_code == 201, response.text
    uploaded: dict[str, Any] = response.json()["data"]
    return uploaded


async def _write(
    api: httpx.AsyncClient,
    site: Site,
    caller: Caller,
    body: str,
    ids: list[str] | None,
    note_id: str | None = None,
) -> httpx.Response:
    payload: dict[str, Any] = {"body": body}
    if ids is not None:
        payload["attachment_ids"] = ids
    if note_id is None:
        return await api.post(_notes(site), json=payload, headers=caller.headers)
    return await api.patch(_notes(site, note_id), json=payload, headers=caller.headers)


async def _note_with(
    api: httpx.AsyncClient, site: Site, caller: Caller, *files: dict[str, Any], body: str = "n"
) -> str:
    response = await _write(api, site, caller, body, [file["id"] for file in files])
    assert response.status_code == 201, response.text
    note_id: str = response.json()["data"]["id"]
    return note_id


async def _seed_file(
    pg: PostgresServer,
    store: MemoryStore,
    site: Site,
    caller: Caller,
    *,
    name: str,
    data: bytes,
    content_type: str,
    note_id: str | None,
    project: uuid.UUID | None = None,
    stored: bool = True,
) -> uuid.UUID:
    """A file row written directly, for the names and states an upload cannot make."""
    attachment_id = uuid.uuid4()
    project_id = project or site.project
    key = f"notes/v1/{site.workspace.id}/{project_id}/{attachment_id}.zst"
    if stored:
        await put_note_file(store, site.workspace.id, project_id, attachment_id, data)
    await execute(
        pg,
        "INSERT INTO core.page_note_attachments (id, workspace_id, project_id, url_id, note_id, "
        "uploaded_by, storage_key, original_name, size_bytes, content_type) "
        "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
        attachment_id,
        site.workspace.id,
        project_id,
        site.ids["/pricing"],
        None if note_id is None else uuid.UUID(note_id),
        caller.user_id,
        key,
        name,
        len(data),
        content_type,
    )
    return attachment_id


async def test_a_note_is_created_with_its_files_and_every_answer_carries_them(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    import_store: MemoryStore,
) -> None:
    site = await _site(migrated)
    editor = await member(resources, migrated, site.workspace, "editor")
    png = await _upload(api, site, editor, PNG, "shot.png")
    text = await _upload(api, site, editor, TEXT, "notes.txt")

    created = await _write(api, site, editor, "With files", [png["id"], text["id"]])
    plain = await _write(api, site, editor, "Without", None)

    assert created.status_code == 201, created.text
    note = created.json()["data"]
    assert note["attachments"] == [png, text]
    assert plain.json()["data"]["attachments"] == []
    rows = await _rows(migrated, site)
    assert {str(row["id"]): str(row["note_id"]) for row in rows} == {
        png["id"]: note["id"],
        text["id"]: note["id"],
    }
    listed = (await api.get(_notes(site), headers=editor.headers)).json()["data"]
    assert [item["attachments"] for item in listed] == [[], [png, text]]
    assert not any(key in str(listed) for key in import_store.objects)


async def test_a_note_may_be_files_only_and_is_never_empty(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(migrated)
    editor = await member(resources, migrated, site.workspace, "editor")
    file = await _upload(api, site, editor)

    only_file = await _write(api, site, editor, "  ", [file["id"]])
    nothing = await _write(api, site, editor, "", None)
    empty_list = await _write(api, site, editor, "", [])

    assert only_file.status_code == 201, only_file.text
    assert only_file.json()["data"]["body"] == ""
    assert problem(nothing) == (422, "validation_failed")
    assert nothing.json()["errors"][0]["path"] == "body"
    assert problem(empty_list) == (422, "validation_failed")
    note_id = only_file.json()["data"]["id"]
    # A change that leaves no text and no live file is refused and changes nothing.
    emptied = await _write(api, site, editor, "", [], note_id)
    assert problem(emptied) == (422, "validation_failed")
    assert emptied.json()["errors"][0]["path"] == "body"
    assert [row["removed_at"] for row in await _rows(migrated, site)] == [None]
    # Text with a file may lose its text and keep the file.
    with_text = await _note_with(api, site, editor, await _upload(api, site, editor))
    kept = await _write(api, site, editor, "", None, with_text)
    assert kept.status_code == 200, kept.text
    assert kept.json()["data"]["body"] == ""
    assert len(kept.json()["data"]["attachments"]) == 1


async def test_the_sixth_file_is_refused_with_its_own_code(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(migrated)
    editor = await member(resources, migrated, site.workspace, "editor")
    files = [await _upload(api, site, editor, TEXT, f"{n}.txt") for n in range(6)]
    ids = [file["id"] for file in files]

    six = await _write(api, site, editor, "Six", ids)
    five = await _write(api, site, editor, "Five", ids[:5])
    changed = await _write(api, site, editor, "Six", ids, five.json()["data"]["id"])

    assert problem(six) == (422, "validation_failed")
    assert six.json()["errors"][0]["code"] == "too_many_attachments"
    assert six.json()["errors"][0]["path"] == "attachment_ids"
    assert five.status_code == 201, five.text
    assert problem(changed) == (422, "validation_failed")
    assert changed.json()["errors"][0]["code"] == "too_many_attachments"
    assert len(await _listed_notes(api, site, editor)) == 1


async def _listed_notes(api: httpx.AsyncClient, site: Site, caller: Caller) -> list[dict[str, Any]]:
    response = await api.get(_notes(site), headers=caller.headers)
    assert response.status_code == 200, response.text
    notes: list[dict[str, Any]] = response.json()["data"]
    return notes


async def test_an_id_that_is_not_the_callers_pending_file_of_this_page_is_refused(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    import_store: MemoryStore,
) -> None:
    site = await _site(migrated)
    editor = await member(resources, migrated, site.workspace, "editor")
    other = await member(resources, migrated, site.workspace, "editor")
    other_project = await keyword_project(migrated, site.workspace)
    good = await _upload(api, site, editor)
    theirs = await _upload(api, site, other)
    elsewhere = await _upload(api, site, editor, path="/blog/a")
    attached = await _upload(api, site, editor)
    await _note_with(api, site, editor, attached)
    dropped = await _upload(api, site, editor)
    holder = await _note_with(api, site, editor, dropped)
    await _write(api, site, editor, "n", [], holder)
    foreign_project = await _seed_file(
        migrated,
        import_store,
        site,
        editor,
        name="p.txt",
        data=TEXT,
        content_type="text/plain",
        note_id=None,
        project=other_project,
    )
    wrong = {
        "another uploader": theirs["id"],
        "another page": elsewhere["id"],
        "another project": str(foreign_project),
        "already attached": attached["id"],
        "removed": dropped["id"],
        "unknown": str(uuid.uuid4()),
    }

    for what, bad in wrong.items():
        refused = await _write(api, site, editor, "Bad", [good["id"], bad])
        assert problem(refused) == (422, "validation_failed"), what
        assert refused.json()["errors"][0]["path"] == "attachment_ids[1]", what
    twice = await _write(api, site, editor, "Twice", [good["id"], good["id"]])

    assert problem(twice) == (422, "validation_failed")
    assert twice.json()["errors"][0]["path"] == "attachment_ids[1]"
    notes = await _listed_notes(api, site, editor)
    assert [note["body"] for note in notes] == ["n", "n"]
    pending = [row for row in await _rows(migrated, site) if str(row["id"]) == good["id"]]
    assert [row["note_id"] for row in pending] == [None]


async def test_a_change_with_a_shorter_list_removes_files_and_frees_a_slot(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(migrated)
    editor = await member(resources, migrated, site.workspace, "editor")
    files = [await _upload(api, site, editor, TEXT, f"{n}.txt") for n in range(5)]
    note_id = await _note_with(api, site, editor, *files)
    first = (await _listed_notes(api, site, editor))[0]
    assert first["edited_at"] is None

    same = await _write(api, site, editor, "n", [file["id"] for file in files], note_id)
    omitted = await _write(api, site, editor, "n", None, note_id)
    shorter = await _write(api, site, editor, "n", [file["id"] for file in files[:4]], note_id)

    assert same.json()["data"]["edited_at"] is None
    assert omitted.json()["data"]["edited_at"] is None
    assert len(omitted.json()["data"]["attachments"]) == 5
    assert shorter.status_code == 200, shorter.text
    assert shorter.json()["data"]["attachments"] == files[:4]
    assert shorter.json()["data"]["edited_at"] is not None
    removed = {str(r["id"]): r["removed_at"] for r in await _rows(migrated, site)}
    assert removed[files[4]["id"]] is not None
    assert [removed[file["id"]] for file in files[:4]] == [None] * 4
    # The slot is free again.
    extra = await _upload(api, site, editor, TEXT, "extra.txt")
    refilled = await _write(
        api, site, editor, "n", [file["id"] for file in files[:4]] + [extra["id"]], note_id
    )
    assert refilled.status_code == 200, refilled.text
    assert len(refilled.json()["data"]["attachments"]) == 5
    # A removed file does not come back.
    again = await _write(api, site, editor, "n", [files[4]["id"]], note_id)
    assert problem(again) == (422, "validation_failed")


async def test_only_the_author_changes_the_files_of_a_note(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(migrated)
    editor = await member(resources, migrated, site.workspace, "editor")
    other = await member(resources, migrated, site.workspace, "editor")
    note_id = await _note_with(api, site, editor, await _upload(api, site, editor))
    theirs = await _upload(api, site, other)

    refused = await _write(api, site, other, "n", [theirs["id"]], note_id)

    assert problem(refused) == (403, "forbidden")
    assert [row["note_id"] for row in await _rows(migrated, site)][1] is None


@pytest.mark.parametrize(("name", "data", "content_type"), ACCEPTED, ids=[a[0] for a in ACCEPTED])
async def test_a_file_is_served_with_its_bytes_and_safe_headers(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    name: str,
    data: bytes,
    content_type: str,
) -> None:
    site = await _site(migrated)
    editor = await member(resources, migrated, site.workspace, "editor")
    viewer = await member(resources, migrated, site.workspace, "viewer")
    file = await _upload(api, site, editor, data, name)
    await _note_with(api, site, editor, file)

    response = await api.get(_download(site, file["id"]), headers=viewer.headers)

    assert response.status_code == 200, response.text
    assert response.content == data
    assert response.headers["content-type"].split(";")[0] == content_type
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["content-security-policy"] == "default-src 'none'; sandbox"
    assert response.headers["cache-control"] == "private, max-age=3600"
    assert response.headers["content-length"] == str(len(data))
    if content_type.startswith("image/"):
        assert response.headers["content-disposition"] == "inline"
    else:
        assert response.headers["content-disposition"].startswith(f'attachment; filename="{name}"')


async def test_a_name_with_a_quote_a_line_break_and_non_ascii_is_escaped(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    import_store: MemoryStore,
) -> None:
    site = await _site(migrated)
    editor = await member(resources, migrated, site.workspace, "editor")
    note_id = await _note_with(api, site, editor)
    shown = 'q"uote\r\nnew; café.txt'
    seeded = await _seed_file(
        migrated, import_store, site, editor, name=shown, data=TEXT,
        content_type="text/plain", note_id=note_id,
    )  # fmt: skip

    response = await api.get(_download(site, seeded), headers=editor.headers)

    assert response.status_code == 200, response.text
    assert response.headers["content-disposition"] == (
        'attachment; filename="q_uotenew_ caf_.txt"; '
        "filename*=UTF-8''q%22uotenew%3B%20caf%C3%A9.txt"
    )


async def test_a_file_is_served_only_while_it_is_attached_to_a_live_note_of_this_page(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    import_store: MemoryStore,
) -> None:
    site = await _site(migrated)
    editor = await member(resources, migrated, site.workspace, "editor")
    other = await _site(migrated)
    stranger = await member(resources, migrated, other.workspace, "owner")
    pending = await _upload(api, site, editor)
    kept = await _upload(api, site, editor, PNG, "k.png")
    dropped = await _upload(api, site, editor)
    note_id = await _note_with(api, site, editor, kept, dropped)
    await _write(api, site, editor, "n", [kept["id"]], note_id)
    lost = await _seed_file(
        migrated, import_store, site, editor, name="l.txt", data=TEXT,
        content_type="text/plain", note_id=note_id, stored=False,
    )  # fmt: skip

    async def status(file_id: object, caller: Caller = editor, path: str = "/pricing") -> int:
        return (await api.get(_download(site, file_id, path), headers=caller.headers)).status_code

    assert await status(kept["id"]) == 200
    assert await status(pending["id"]) == 404
    assert await status(dropped["id"]) == 404
    assert await status(kept["id"], path="/blog/a") == 404
    assert await status(uuid.uuid4()) == 404
    # The row exists but its object is gone: not found, and nothing else is said.
    gone = await api.get(_download(site, lost), headers=editor.headers)
    assert problem(gone) == (404, "not_found")
    assert "notes/v1" not in gone.text
    # Another workspace's member finds nothing, with the same answer as for an unknown id.
    foreign = await api.get(_download(site, kept["id"]), headers=stranger.headers)
    assert problem(foreign) == (404, "not_found")
    # A deleted note hides its file at once, and restoring brings it back.
    before = await _rows(migrated, site)
    await api.delete(_notes(site, note_id), headers=editor.headers)
    assert await status(kept["id"]) == 404
    assert await _rows(migrated, site) == before
    await api.post(_notes(site, note_id, "restore"), headers=editor.headers)
    assert await status(kept["id"]) == 200
    assert await _rows(migrated, site) == before


async def test_the_list_costs_the_same_statements_whatever_it_holds(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(migrated)
    editor = await member(resources, migrated, site.workspace, "editor")
    await _note_with(api, site, editor, await _upload(api, site, editor))

    with statements(resources) as few:
        await api.get(_notes(site), headers=editor.headers)
    for _ in range(4):
        files = [await _upload(api, site, editor) for _ in range(2)]
        await _note_with(api, site, editor, *files)
    with statements(resources) as many:
        listed = await api.get(_notes(site), headers=editor.headers)

    assert len(listed.json()["data"]) == 5
    assert len(many) == len(few)


async def test_the_audit_entries_hold_the_files_with_their_names_and_sizes(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    site = await _site(migrated)
    editor = await member(resources, migrated, site.workspace, "editor")
    png = await _upload(api, site, editor, PNG, "shot.png")
    note_id = await _note_with(api, site, editor, png)
    await _write(api, site, editor, "n", [], note_id)

    created = (await audit_rows(migrated, site.workspace, "page_note.created"))[0]
    updated = (await audit_rows(migrated, site.workspace, "page_note.updated"))[0]

    held = [{"id": png["id"], "name": "shot.png", "size": len(PNG)}]
    assert created["after"] == {
        "url_id": str(site.ids["/pricing"]),
        "body": "n",
        "mentions": [],
        "attachment_ids": held,
    }
    assert updated["before"] == {"body": "n", "mentions": [], "attachment_ids": held}
    assert updated["after"] == {"body": "n", "mentions": [], "attachment_ids": []}
