"""Keeping a provider's answer: stored once in object storage, registered once
(docs/04-data-model.md section 11.3, docs/23-backup-disaster-recovery.md section 9). As
`app_worker`, against a real S3 API."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from datetime import UTC, timedelta

import asyncpg
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.collectors.raw_payloads import RawPayload, store_raw_payload
from sightline.storage.raw import RawStorageError, RawStore, RetentionClass, decompress, digest
from tests.api.auth.support import fetch
from tests.conftest import ObjectServer, PostgresServer
from tests.providers.dataforseo.support import fixture_bytes
from tests.storage.support import fresh_store, object_keys

Ledger = async_sessionmaker[AsyncSession]
BODY = fixture_bytes("task_get_advanced")


def _payload(body: bytes = BODY, retention_class: RetentionClass = "serp_raw") -> RawPayload:
    return RawPayload(
        body=body,
        content_type="application/json",
        provider_code="dataforseo",
        provider_endpoint="serp/google/organic",
        endpoint_slug="serp_google_organic_advanced",
        retention_class=retention_class,
    )


class CountingStore:
    """The real store, counting its writes; or failing every one."""

    def __init__(self, inner: RawStore, *, fails: bool = False) -> None:
        self.inner = inner
        self.fails = fails
        self.puts: list[str] = []

    async def put(self, key: str, data: bytes) -> None:
        self.puts.append(key)
        if self.fails:
            raise RawStorageError("storing a payload failed: InternalError")
        await self.inner.put(key, data)

    async def get(self, key: str) -> bytes:
        return await self.inner.get(key)


@pytest.fixture
async def store(object_server: ObjectServer) -> AsyncIterator[CountingStore]:
    async with fresh_store(object_server) as opened:
        yield CountingStore(opened)


async def _rows(pg: PostgresServer) -> list[asyncpg.Record]:
    return await fetch(pg, "SELECT *, now() AS now FROM ops.raw_payloads ORDER BY id")


async def test_a_payload_is_stored_compressed_and_registered(
    worker_db: Ledger, migrated: PostgresServer, store: CountingStore
) -> None:
    payload_id = await store_raw_payload(worker_db, store, _payload())

    (row,) = await _rows(migrated)
    assert row["id"] == payload_id
    key = row["object_key"]
    fetched_at = row["fetched_at"]
    assert key == (
        "raw/v1/serp_raw/dataforseo/serp_google_organic_advanced/"
        f"{fetched_at.astimezone(UTC):%Y/%m/%d}/{digest(BODY).hex()}.json.zst"
    )
    stored = await store.get(key)
    assert decompress(stored) == BODY
    assert {
        "storage": row["storage"],
        "inline_body": row["inline_body"],
        "sha256": row["sha256"],
        "bytes_raw": row["bytes_raw"],
        "bytes_stored": row["bytes_stored"],
        "compression": row["compression"],
        "content_type": row["content_type"],
        "provider_code": row["provider_code"],
        "provider_endpoint": row["provider_endpoint"],
        "retention_class": row["retention_class"],
    } == {
        "storage": "r2",
        "inline_body": None,
        "sha256": digest(BODY),
        "bytes_raw": len(BODY),
        "bytes_stored": len(stored),
        "compression": "zstd",
        "content_type": "application/json",
        "provider_code": "dataforseo",
        "provider_endpoint": "serp/google/organic",
        "retention_class": "serp_raw",
    }
    # By the database's clock, and kept as long as the class is.
    assert timedelta(0) <= row["now"] - fetched_at < timedelta(seconds=30)
    assert row["expires_at"] == fetched_at + timedelta(days=400)


async def test_the_same_bytes_are_stored_and_registered_once(
    worker_db: Ledger,
    migrated: PostgresServer,
    store: CountingStore,
    object_server: ObjectServer,
) -> None:
    first = await store_raw_payload(worker_db, store, _payload())
    second = await store_raw_payload(worker_db, store, _payload())

    assert first == second
    assert len(await _rows(migrated)) == 1
    assert len(store.puts) == 1
    assert len(await object_keys(object_server, store.inner.bucket)) == 1


async def test_two_workers_keeping_the_same_bytes_at_once_agree_on_one_row(
    worker_db: Ledger, migrated: PostgresServer, store: CountingStore
) -> None:
    ids = await asyncio.gather(*(store_raw_payload(worker_db, store, _payload()) for _ in range(4)))

    assert len(set(ids)) == 1
    assert len(await _rows(migrated)) == 1


async def test_a_class_kept_for_ever_has_no_expiry(
    worker_db: Ledger, migrated: PostgresServer, store: CountingStore
) -> None:
    await store_raw_payload(worker_db, store, _payload(b'{"answer": 1}', "ai_raw"))

    (row,) = await _rows(migrated)
    assert row["expires_at"] is None
    assert row["object_key"].startswith("raw/v1/ai_raw/")


async def test_a_storage_failure_registers_nothing(
    worker_db: Ledger, migrated: PostgresServer, store: CountingStore
) -> None:
    store.fails = True

    with pytest.raises(RawStorageError):
        await store_raw_payload(worker_db, store, _payload())

    assert await _rows(migrated) == []


async def test_an_empty_payload_is_not_kept(worker_db: Ledger, store: CountingStore) -> None:
    with pytest.raises(ValueError, match="empty"):
        await store_raw_payload(worker_db, store, _payload(b""))
    assert store.puts == []
