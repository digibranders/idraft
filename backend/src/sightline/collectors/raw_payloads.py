"""The registry of raw payloads, `ops.raw_payloads` (docs/04-data-model.md section 11.3).

A payload is written to object storage first and registered after, so a row always names an
object that was stored: when storage fails, nothing is registered and the fetch is tried again
(the provider keeps results for 30 days). The same bytes are stored and registered once. Two
workers keeping the same bytes at once may both write the object, under the same key on the
same day, or under two keys across midnight; the registry keeps one row and the other object
expires with its class.

No transaction is held open while the object is written.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.db.tables import raw_payloads
from sightline.storage.raw import (
    RETENTION,
    ObjectStore,
    RetentionClass,
    compress,
    digest,
    object_key,
)


@dataclass(frozen=True, slots=True)
class RawPayload:
    """A provider's answer, exactly as received, and where it belongs."""

    body: bytes
    content_type: str
    provider_code: str
    # The ledger's name for the endpoint, as `ops.collection_tasks.provider_endpoint` has it.
    provider_endpoint: str
    # Its name in object keys (doc 23 section 9.1): `serp_google_organic_advanced`.
    endpoint_slug: str
    retention_class: RetentionClass


async def store_raw_payload(
    sessions: async_sessionmaker[AsyncSession], store: ObjectStore, payload: RawPayload
) -> int:
    """Store the payload unless it is stored already, and return its registry id. Raises
    `RawStorageError` when storage fails; nothing is registered then."""
    if not payload.body:
        raise ValueError("an empty payload is not kept: there is nothing to read back")
    sha256 = digest(payload.body)
    async with sessions() as db:
        known = await _registered(db, sha256)
        if known is not None:
            return known
        fetched_at = (await db.execute(select(func.now()))).scalar_one()

    key = object_key(
        payload.retention_class,
        payload.provider_code,
        payload.endpoint_slug,
        fetched_at,
        sha256,
    )
    # Compressing a large payload takes milliseconds of CPU: off the event loop.
    data = await asyncio.to_thread(compress, payload.body)
    await store.put(key, data)

    retention = RETENTION[payload.retention_class]
    async with sessions() as db, db.begin():
        inserted = await db.execute(
            insert(raw_payloads)
            .values(
                storage="r2",
                object_key=key,
                sha256=sha256,
                bytes_raw=len(payload.body),
                bytes_stored=len(data),
                compression="zstd",
                content_type=payload.content_type,
                provider_code=payload.provider_code,
                provider_endpoint=payload.provider_endpoint,
                fetched_at=fetched_at,
                retention_class=payload.retention_class,
                expires_at=None if retention is None else fetched_at + retention,
            )
            .on_conflict_do_nothing(index_elements=[raw_payloads.c.sha256])
            .returning(raw_payloads.c.id)
        )
        payload_id: int | None = inserted.scalar_one_or_none()
        if payload_id is None:
            # Registered by another worker in the meantime.
            payload_id = await _registered(db, sha256)
    if payload_id is None:  # pragma: no cover - a registered row is never deleted here
        raise RuntimeError("a payload registered at the same moment is gone")
    return payload_id


async def _registered(db: AsyncSession, sha256: bytes) -> int | None:
    found: int | None = (
        await db.execute(select(raw_payloads.c.id).where(raw_payloads.c.sha256 == sha256))
    ).scalar_one_or_none()
    return found
