"""Files for a page note: the upload (spec 9.8.5, 9.8.6). The attach and the download are 5i's."""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass, replace

import httpx
import pytest
from fastapi import FastAPI
from starlette.datastructures import UploadFile

from idraft.api.internal_links.page_note_files import PageNoteFileService, file_path
from idraft.api.resources import Resources
from idraft.storage.file_sniff import NOTE_FILE_MAX_BYTES
from idraft.storage.note_files import get_note_file
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
