"""Migration 0044: files of a page note and the workspace's file quota (Pages spec 9.8.5)."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import asyncpg
import pytest

from tests.conftest import PostgresServer
from tests.db.support import Tenant, connection, scoped, seed_tenant

type Db = asyncpg.Connection[asyncpg.Record]

_INSERT = (
    "INSERT INTO core.page_note_attachments (id, workspace_id, project_id, url_id, uploaded_by, "
    "storage_key, original_name, size_bytes, content_type) "
    "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)"
)


@asynccontextmanager
async def refused(db: Db, error: type[Exception]) -> AsyncIterator[None]:
    """The statements inside are refused with `error`, and the transaction goes on."""
    with pytest.raises(error):
        async with db.transaction():
            yield


async def _url_id(db: Db) -> int:
    url_id: int = await db.fetchval(
        "INSERT INTO core.urls (url_hash, canonical_url, domain_id, path, canonicalizer_version) "
        "SELECT sha256(convert_to($1, 'UTF8')), 'https://' || $1, d.id, '/files', 1 "
        "FROM core.domains d ORDER BY d.id LIMIT 1 RETURNING id",
        f"files-{uuid.uuid4().hex}.example/files",
    )
    return url_id


async def _file(
    db: Db,
    tenant: Tenant,
    url_id: int,
    *,
    name: str = "brief.pdf",
    size: int = 1024,
    content_type: str = "application/pdf",
    project_id: uuid.UUID | None = None,
) -> uuid.UUID:
    attachment_id = uuid.uuid4()
    project = project_id or tenant.project_id
    await db.execute(
        _INSERT,
        attachment_id,
        tenant.workspace_id,
        project,
        url_id,
        tenant.owner_id,
        f"notes/v1/{tenant.workspace_id}/{project}/{attachment_id}.zst",
        name,
        size,
        content_type,
    )
    return attachment_id


async def _note(db: Db, tenant: Tenant, url_id: int, body: str = "A note") -> uuid.UUID:
    note_id: uuid.UUID = await db.fetchval(
        "INSERT INTO core.page_notes (workspace_id, project_id, url_id, author_id, body) "
        "VALUES ($1, $2, $3, $4, $5) RETURNING id",
        tenant.workspace_id,
        tenant.project_id,
        url_id,
        tenant.owner_id,
        body,
    )
    return note_id


@pytest.mark.parametrize("size", [1, 10_485_760])
async def test_a_file_of_1_byte_and_of_10_mb_is_stored(migrated: PostgresServer, size: int) -> None:
    tenant = await seed_tenant(migrated, f"files-size-{size}")
    async with connection(migrated) as db:
        await _file(db, tenant, await _url_id(db), size=size)


@pytest.mark.parametrize("size", [0, 10_485_761, -1])
async def test_a_file_of_0_bytes_or_over_10_mb_is_refused(
    migrated: PostgresServer, size: int
) -> None:
    tenant = await seed_tenant(migrated, f"files-bad-size-{size}")
    async with connection(migrated) as db:
        with pytest.raises(asyncpg.CheckViolationError):
            await _file(db, tenant, await _url_id(db), size=size)


@pytest.mark.parametrize(
    "content_type",
    [
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/webp",
        "application/pdf",
        "text/plain",
        "text/csv",
    ],
)
async def test_each_accepted_content_type_is_stored(
    migrated: PostgresServer, content_type: str
) -> None:
    tenant = await seed_tenant(migrated, "files-types")
    async with connection(migrated) as db:
        await _file(db, tenant, await _url_id(db), content_type=content_type)


@pytest.mark.parametrize("content_type", ["image/svg+xml", "text/html", "application/zip", ""])
async def test_an_unknown_content_type_is_refused(
    migrated: PostgresServer, content_type: str
) -> None:
    tenant = await seed_tenant(migrated, "files-bad-type")
    async with connection(migrated) as db:
        with pytest.raises(asyncpg.CheckViolationError):
            await _file(db, tenant, await _url_id(db), content_type=content_type)


@pytest.mark.parametrize("name", ["", "x" * 256])
async def test_a_name_of_0_or_256_characters_is_refused(
    migrated: PostgresServer, name: str
) -> None:
    tenant = await seed_tenant(migrated, "files-bad-name")
    async with connection(migrated) as db:
        with pytest.raises(asyncpg.CheckViolationError):
            await _file(db, tenant, await _url_id(db), name=name)


async def test_a_name_of_1_and_of_255_characters_is_stored(migrated: PostgresServer) -> None:
    tenant = await seed_tenant(migrated, "files-name-bounds")
    async with connection(migrated) as db:
        url_id = await _url_id(db)
        for name in ("x", "x" * 255):
            await _file(db, tenant, url_id, name=name)


async def test_removed_at_needs_a_note(migrated: PostgresServer) -> None:
    tenant = await seed_tenant(migrated, "files-removed")
    async with connection(migrated) as db:
        url_id = await _url_id(db)
        file_id = await _file(db, tenant, url_id)
        async with refused(db, asyncpg.CheckViolationError):
            await db.execute(
                "UPDATE core.page_note_attachments SET removed_at = now() WHERE id = $1", file_id
            )
        note_id = await _note(db, tenant, url_id)
        await db.execute(
            "UPDATE core.page_note_attachments SET note_id = $2, removed_at = now() WHERE id = $1",
            file_id,
            note_id,
        )


async def test_a_storage_key_is_unique(migrated: PostgresServer) -> None:
    tenant = await seed_tenant(migrated, "files-key")
    async with connection(migrated) as db:
        url_id = await _url_id(db)
        key = f"notes/v1/{tenant.workspace_id}/{tenant.project_id}/{uuid.uuid4()}.zst"
        row = (
            uuid.uuid4(),
            tenant.workspace_id,
            tenant.project_id,
            url_id,
            tenant.owner_id,
            key,
            "a.txt",
            1,
            "text/plain",
        )
        await db.execute(_INSERT, *row)
        async with refused(db, asyncpg.UniqueViolationError):
            await db.execute(_INSERT, uuid.uuid4(), *row[1:])


async def test_a_file_for_an_address_that_does_not_exist_is_refused(
    migrated: PostgresServer,
) -> None:
    tenant = await seed_tenant(migrated, "files-missing-url")
    async with connection(migrated) as db:
        missing: int = await db.fetchval("SELECT coalesce(max(id), 0) + 1000 FROM core.urls")
        with pytest.raises(asyncpg.ForeignKeyViolationError):
            await _file(db, tenant, missing)


async def test_deleting_the_project_removes_its_file_rows(migrated: PostgresServer) -> None:
    tenant = await seed_tenant(migrated, "files-cascade")
    async with connection(migrated) as db:
        # A project of its own: the seeded one has crawl runs and schedules that block a delete.
        project_id: uuid.UUID = await db.fetchval(
            "INSERT INTO core.projects (workspace_id, name, slug, created_by) "
            "VALUES ($1, 'Second', 'second', $2) RETURNING id",
            tenant.workspace_id,
            tenant.owner_id,
        )
        await _file(db, tenant, await _url_id(db), project_id=project_id)
        before = await db.fetchval(
            "SELECT count(*) FROM core.page_note_attachments WHERE project_id = $1", project_id
        )
        await db.execute("DELETE FROM core.projects WHERE id = $1", project_id)
        after = await db.fetchval(
            "SELECT count(*) FROM core.page_note_attachments WHERE project_id = $1", project_id
        )
    assert (before, after) == (1, 0)


async def test_the_api_attaches_and_removes_but_cannot_delete_or_change_the_rest(
    migrated: PostgresServer,
) -> None:
    tenant = await seed_tenant(migrated, "files-grants")
    async with connection(migrated) as db:
        url_id = await _url_id(db)
        await _file(db, tenant, url_id)
        note_id = await _note(db, tenant, url_id)
    async with scoped(migrated, "app_api", workspace_id=tenant.workspace_id) as db:
        async with refused(db, asyncpg.InsufficientPrivilegeError):
            await db.execute("DELETE FROM core.page_note_attachments")
        for column, value in (
            ("storage_key", "'other'"),
            ("size_bytes", "1"),
            ("content_type", "'text/plain'"),
            ("url_id", str(url_id)),
            ("uploaded_by", f"'{tenant.owner_id}'"),
            ("original_name", "'x'"),
        ):
            async with refused(db, asyncpg.InsufficientPrivilegeError):
                await db.execute(f"UPDATE core.page_note_attachments SET {column} = {value}")
        attached = await db.execute(
            "UPDATE core.page_note_attachments SET note_id = $1, removed_at = now()", note_id
        )
    assert attached != "UPDATE 0"


async def test_the_worker_has_no_access(migrated: PostgresServer) -> None:
    tenant = await seed_tenant(migrated, "files-worker")
    async with connection(migrated) as db:
        await _file(db, tenant, await _url_id(db))
    async with scoped(migrated, "app_worker", workspace_id=tenant.workspace_id) as db:
        with pytest.raises(asyncpg.InsufficientPrivilegeError):
            await db.fetch("SELECT id FROM core.page_note_attachments")


async def test_another_workspace_sees_no_file_of_this_one(migrated: PostgresServer) -> None:
    first = await seed_tenant(migrated, "files-first")
    second = await seed_tenant(migrated, "files-second")
    async with connection(migrated) as db:
        url_id = await _url_id(db)
        await _file(db, first, url_id)
        await _file(db, second, url_id)
    async with scoped(migrated, "app_api", workspace_id=second.workspace_id) as db:
        rows = await db.fetch("SELECT workspace_id FROM core.page_note_attachments")
    assert rows
    assert {row["workspace_id"] for row in rows} == {second.workspace_id}


async def test_the_file_quota_defaults_to_1_gib_and_refuses_a_negative_value(
    migrated: PostgresServer,
) -> None:
    tenant = await seed_tenant(migrated, "files-quota")
    async with connection(migrated) as db:
        await db.execute(
            "INSERT INTO core.workspace_quotas (workspace_id) VALUES ($1) "
            "ON CONFLICT (workspace_id) DO NOTHING",
            tenant.workspace_id,
        )
        default = await db.fetchval(
            "SELECT max_note_file_bytes FROM core.workspace_quotas WHERE workspace_id = $1",
            tenant.workspace_id,
        )
        with pytest.raises(asyncpg.CheckViolationError):
            await db.execute(
                "UPDATE core.workspace_quotas SET max_note_file_bytes = -1 WHERE workspace_id = $1",
                tenant.workspace_id,
            )
        await db.execute(
            "UPDATE core.workspace_quotas SET max_note_file_bytes = 0 WHERE workspace_id = $1",
            tenant.workspace_id,
        )
    assert default == 1_073_741_824
