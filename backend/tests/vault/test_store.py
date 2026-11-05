"""Secrets in `ops.secrets` as the API role keeps them (docs/24-security.md section 5.2)."""

import uuid
from collections.abc import AsyncIterator

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from idraft.config.settings import to_sqlalchemy_url
from idraft.db.engine import workspace_transaction
from idraft.db.tables import secrets
from idraft.vault import store
from idraft.vault.envelope import EnvelopeCipher, SecretUnreadableError
from tests.api.auth.support import Workspace, make_workspace
from tests.conftest import PostgresServer

TOKEN = "1//fake-refresh-token-for-tests"


@pytest.fixture
async def sessions(migrated: PostgresServer) -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_async_engine(to_sqlalchemy_url(migrated.url("app_api")))
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@pytest.fixture
def cipher() -> EnvelopeCipher:
    return EnvelopeCipher({1: bytes(range(32))})


async def _put(
    sessions: async_sessionmaker[AsyncSession], cipher: EnvelopeCipher, workspace: Workspace
) -> uuid.UUID:
    async with workspace_transaction(sessions, workspace.id) as db:
        return await store.put(
            db, cipher, workspace_id=workspace.id, kind=store.REFRESH_TOKEN, plaintext=TOKEN
        )


async def test_a_stored_secret_reads_back_and_is_not_plaintext_in_the_database(
    migrated: PostgresServer, sessions: async_sessionmaker[AsyncSession], cipher: EnvelopeCipher
) -> None:
    workspace = await make_workspace(migrated)
    secret_id = await _put(sessions, cipher, workspace)

    async with workspace_transaction(sessions, workspace.id) as db:
        assert (
            await store.read(
                db,
                cipher,
                workspace_id=workspace.id,
                secret_id=secret_id,
                kind=store.REFRESH_TOKEN,
            )
            == TOKEN
        )
        row = (await db.execute(select(secrets).where(secrets.c.id == secret_id))).one()
        dump = await db.execute(text("SELECT s::text FROM ops.secrets s"))
    stored = b"".join(bytes(value) for value in (row.ciphertext, row.dek_wrapped))
    assert TOKEN.encode() not in stored
    assert TOKEN not in "".join(item[0] for item in dump)
    assert (row.kind, row.kek_version, len(row.fingerprint)) == (store.REFRESH_TOKEN, 1, 8)


async def test_another_workspace_cannot_read_a_secret(
    migrated: PostgresServer, sessions: async_sessionmaker[AsyncSession], cipher: EnvelopeCipher
) -> None:
    mine = await make_workspace(migrated)
    theirs = await make_workspace(migrated)
    secret_id = await _put(sessions, cipher, mine)

    async with workspace_transaction(sessions, theirs.id) as db:
        with pytest.raises(SecretUnreadableError):
            await store.read(
                db,
                cipher,
                workspace_id=theirs.id,
                secret_id=secret_id,
                kind=store.REFRESH_TOKEN,
            )


async def test_a_secret_is_read_only_as_the_kind_it_was_stored_as(
    migrated: PostgresServer, sessions: async_sessionmaker[AsyncSession], cipher: EnvelopeCipher
) -> None:
    workspace = await make_workspace(migrated)
    secret_id = await _put(sessions, cipher, workspace)
    async with workspace_transaction(sessions, workspace.id) as db:
        with pytest.raises(SecretUnreadableError):
            await store.read(
                db,
                cipher,
                workspace_id=workspace.id,
                secret_id=secret_id,
                kind="provider_api_key",
            )


async def test_a_deleted_secret_is_gone(
    migrated: PostgresServer, sessions: async_sessionmaker[AsyncSession], cipher: EnvelopeCipher
) -> None:
    workspace = await make_workspace(migrated)
    secret_id = await _put(sessions, cipher, workspace)
    async with workspace_transaction(sessions, workspace.id) as db:
        await store.delete_secret(db, workspace_id=workspace.id, secret_id=secret_id)
    async with workspace_transaction(sessions, workspace.id) as db:
        with pytest.raises(SecretUnreadableError):
            await store.read(
                db,
                cipher,
                workspace_id=workspace.id,
                secret_id=secret_id,
                kind=store.REFRESH_TOKEN,
            )
