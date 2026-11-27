"""Migration 0042: notes on a page (Pages spec 9.7.1)."""

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
    "INSERT INTO core.page_notes (workspace_id, project_id, url_id, author_id, body) "
    "VALUES ($1, $2, $3, $4, $5)"
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
        "SELECT sha256(convert_to($1, 'UTF8')), 'https://' || $1, d.id, '/notes', 1 "
        "FROM core.domains d ORDER BY d.id LIMIT 1 RETURNING id",
        f"notes-{uuid.uuid4().hex}.example/notes",
    )
    return url_id


async def _note_id(db: Db, tenant: Tenant, url_id: int) -> uuid.UUID:
    note_id: uuid.UUID = await db.fetchval(
        _INSERT + " RETURNING id",
        tenant.workspace_id,
        tenant.project_id,
        url_id,
        tenant.owner_id,
        "A note",
    )
    return note_id


async def test_a_body_of_1_and_of_2000_characters_is_stored(migrated: PostgresServer) -> None:
    tenant = await seed_tenant(migrated, "notes-length")
    async with connection(migrated) as db:
        url_id = await _url_id(db)
        for body in ("x", "x" * 2000):
            await db.execute(
                _INSERT, tenant.workspace_id, tenant.project_id, url_id, tenant.owner_id, body
            )
        stored = await db.fetchval("SELECT count(*) FROM core.page_notes WHERE url_id = $1", url_id)
    assert stored == 2


async def test_an_empty_body_is_stored_because_a_note_may_hold_only_files(
    migrated: PostgresServer,
) -> None:
    tenant = await seed_tenant(migrated, "notes-empty")
    async with connection(migrated) as db:
        url_id = await _url_id(db)
        await db.execute(
            _INSERT, tenant.workspace_id, tenant.project_id, url_id, tenant.owner_id, ""
        )
        stored = await db.fetchval("SELECT count(*) FROM core.page_notes WHERE url_id = $1", url_id)
    assert stored == 1


@pytest.mark.parametrize("body", ["x" * 2001, " x", "x "])
async def test_a_too_long_or_untrimmed_body_is_refused(migrated: PostgresServer, body: str) -> None:
    tenant = await seed_tenant(migrated, "notes-body")
    async with connection(migrated) as db:
        url_id = await _url_id(db)
        with pytest.raises(asyncpg.CheckViolationError):
            await db.execute(
                _INSERT, tenant.workspace_id, tenant.project_id, url_id, tenant.owner_id, body
            )


async def test_deleted_at_and_deleted_by_are_set_together(migrated: PostgresServer) -> None:
    tenant = await seed_tenant(migrated, "notes-deleted")
    async with connection(migrated) as db:
        note_id = await _note_id(db, tenant, await _url_id(db))
        async with refused(db, asyncpg.CheckViolationError):
            await db.execute("UPDATE core.page_notes SET deleted_at = now() WHERE id = $1", note_id)
        async with refused(db, asyncpg.CheckViolationError):
            await db.execute(
                "UPDATE core.page_notes SET deleted_by = $2 WHERE id = $1", note_id, tenant.owner_id
            )
        await db.execute(
            "UPDATE core.page_notes SET deleted_at = now(), deleted_by = $2 WHERE id = $1",
            note_id,
            tenant.owner_id,
        )


async def test_mentions_default_to_an_empty_list_and_hold_at_most_20(
    migrated: PostgresServer,
) -> None:
    tenant = await seed_tenant(migrated, "notes-mentions")
    entry = '{"type": "page", "label": "@/a", "target": "1"}'
    async with connection(migrated) as db:
        note_id = await _note_id(db, tenant, await _url_id(db))
        assert (
            await db.fetchval("SELECT mentions::text FROM core.page_notes WHERE id = $1", note_id)
            == "[]"
        )
        for count in (1, 20):
            await db.execute(
                "UPDATE core.page_notes SET mentions = $2::jsonb WHERE id = $1",
                note_id,
                "[" + ", ".join([entry] * count) + "]",
            )
        for refused_value in ('"text"', '{"type": "page"}', "[" + ", ".join([entry] * 21) + "]"):
            async with refused(db, asyncpg.CheckViolationError):
                await db.execute(
                    "UPDATE core.page_notes SET mentions = $2::jsonb WHERE id = $1",
                    note_id,
                    refused_value,
                )


async def test_the_api_may_update_mentions(migrated: PostgresServer) -> None:
    tenant = await seed_tenant(migrated, "notes-mentions-grant")
    async with connection(migrated) as db:
        await _note_id(db, tenant, await _url_id(db))
    async with scoped(migrated, "app_api", workspace_id=tenant.workspace_id) as db:
        changed = await db.execute("UPDATE core.page_notes SET mentions = '[]'::jsonb")
    assert changed != "UPDATE 0"


async def test_a_note_for_an_address_that_does_not_exist_is_refused(
    migrated: PostgresServer,
) -> None:
    tenant = await seed_tenant(migrated, "notes-missing-url")
    async with connection(migrated) as db:
        missing: int = await db.fetchval("SELECT coalesce(max(id), 0) + 1000 FROM core.urls")
        with pytest.raises(asyncpg.ForeignKeyViolationError):
            await db.execute(
                _INSERT, tenant.workspace_id, tenant.project_id, missing, tenant.owner_id, "Note"
            )


async def test_deleting_the_project_removes_its_notes(migrated: PostgresServer) -> None:
    tenant = await seed_tenant(migrated, "notes-cascade")
    async with connection(migrated) as db:
        # A project of its own: the seeded one has crawl runs and schedules that block a delete.
        project_id: uuid.UUID = await db.fetchval(
            "INSERT INTO core.projects (workspace_id, name, slug, created_by) "
            "VALUES ($1, 'Second', 'second', $2) RETURNING id",
            tenant.workspace_id,
            tenant.owner_id,
        )
        await db.execute(
            _INSERT,
            tenant.workspace_id,
            project_id,
            await _url_id(db),
            tenant.owner_id,
            "A note",
        )
        before = await db.fetchval(
            "SELECT count(*) FROM core.page_notes WHERE project_id = $1", project_id
        )
        await db.execute("DELETE FROM core.projects WHERE id = $1", project_id)
        after = await db.fetchval(
            "SELECT count(*) FROM core.page_notes WHERE project_id = $1", project_id
        )
    assert before == 1
    assert after == 0


async def test_the_api_cannot_delete_a_row_or_change_who_wrote_it(
    migrated: PostgresServer,
) -> None:
    tenant = await seed_tenant(migrated, "notes-grants")
    async with connection(migrated) as db:
        await _note_id(db, tenant, await _url_id(db))
    async with scoped(migrated, "app_api", workspace_id=tenant.workspace_id) as db:
        async with refused(db, asyncpg.InsufficientPrivilegeError):
            await db.execute("DELETE FROM core.page_notes")
        async with refused(db, asyncpg.InsufficientPrivilegeError):
            await db.execute("UPDATE core.page_notes SET author_id = $1", tenant.owner_id)
        async with refused(db, asyncpg.InsufficientPrivilegeError):
            await db.execute("UPDATE core.page_notes SET created_at = now()")
        edited = await db.execute("UPDATE core.page_notes SET body = 'Changed', edited_at = now()")
    assert edited != "UPDATE 0"


async def test_another_workspace_sees_no_note_of_this_one(migrated: PostgresServer) -> None:
    first = await seed_tenant(migrated, "notes-first")
    second = await seed_tenant(migrated, "notes-second")
    async with scoped(migrated, "app_api", workspace_id=second.workspace_id) as db:
        rows = await db.fetch("SELECT workspace_id FROM core.page_notes")
    assert rows
    assert {row["workspace_id"] for row in rows} == {second.workspace_id}
    assert first.workspace_id not in {row["workspace_id"] for row in rows}
