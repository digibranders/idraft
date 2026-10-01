"""The registry of raw payloads, `ops.raw_payloads` (docs/04-data-model.md section 11.3).

A payload is written to object storage first and registered after, so a row always names an
object that was stored: when storage fails, nothing is registered and the fetch is tried again
(the provider keeps results for 30 days). The same bytes are stored and registered once per
retention class, since the class is part of the key and decides how long the object lives.

When the same bytes come again after a while, the object may be near the end of its life: the
bucket's lifecycle counts from when the object was written. It is then written again under its
own key, which starts its life anew, and its row's expiry moved to match.

Two workers keeping the same new bytes at once may both write the object, under the same key
on the same day, or under two keys across midnight; the registry keeps one row. The other
object is not registered: in classes with a lifetime it expires, and in `ai_raw` it stays until
the reconciliation of the registry with the bucket (doc 23 section 9.2) removes it.

No transaction is held open while an object is written.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Final

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sightline.db.tables import raw_payloads
from sightline.storage.raw import (
    RETENTION,
    ObjectStore,
    RawStorageError,
    RetentionClass,
    compress,
    digest,
    object_key,
)

_table = raw_payloads
# How much of its life an object may have used before the same bytes coming again write it anew.
RENEW_SLACK: Final = timedelta(days=1)


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


@dataclass(frozen=True, slots=True)
class _Registered:
    id: int
    object_key: str
    expires_at: datetime | None


async def store_raw_payload(
    sessions: async_sessionmaker[AsyncSession], store: ObjectStore, payload: RawPayload
) -> int:
    """Store the payload unless it is stored already, and return its registry id. Raises
    `RawStorageError` when storage fails; nothing is registered then."""
    if not payload.body:
        raise ValueError("an empty payload is not kept: there is nothing to read back")
    # Hashing megabytes takes milliseconds of CPU: off the event loop.
    sha256 = await asyncio.to_thread(digest, payload.body)
    retention = RETENTION[payload.retention_class]
    async with sessions() as db:
        now: datetime = (await db.execute(select(func.now()))).scalar_one()
        known = await _registered(db, payload.retention_class, sha256)
    if known is not None:
        if known.expires_at is not None and retention is not None:
            await _renew(sessions, store, payload, known, until=now + retention)
        return known.id

    key = object_key(
        payload.retention_class, payload.provider_code, payload.endpoint_slug, now, sha256
    )
    data = await asyncio.to_thread(compress, payload.body)
    await store.put(key, data)

    async with sessions() as db, db.begin():
        inserted = await db.execute(
            insert(_table)
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
                fetched_at=now,
                retention_class=payload.retention_class,
                expires_at=None if retention is None else now + retention,
            )
            .on_conflict_do_nothing(index_elements=[_table.c.retention_class, _table.c.sha256])
            .returning(_table.c.id)
        )
        payload_id: int | None = inserted.scalar_one_or_none()
        if payload_id is not None:
            return payload_id
        # Registered by another worker in the meantime.
        other = await _registered(db, payload.retention_class, sha256)
    if other is None:
        raise RawStorageError("a payload registered at the same moment is no longer registered")
    return other.id


async def _renew(
    sessions: async_sessionmaker[AsyncSession],
    store: ObjectStore,
    payload: RawPayload,
    known: _Registered,
    *,
    until: datetime,
) -> None:
    """Keep the object until about `until`: written again, then its row's expiry moved.
    Nothing to do when it is kept within a day of that already, so bytes that come often are
    written again at most once a day."""
    if known.expires_at is not None and known.expires_at >= until - RENEW_SLACK:
        return
    data = await asyncio.to_thread(compress, payload.body)
    await store.put(known.object_key, data)
    async with sessions() as db, db.begin():
        await db.execute(
            update(_table)
            .where(_table.c.id == known.id)
            .values(expires_at=func.greatest(_table.c.expires_at, until))
        )


async def _registered(
    db: AsyncSession, retention_class: RetentionClass, sha256: bytes
) -> _Registered | None:
    row = (
        await db.execute(
            select(_table.c.id, _table.c.object_key, _table.c.expires_at).where(
                _table.c.retention_class == retention_class, _table.c.sha256 == sha256
            )
        )
    ).one_or_none()
    if row is None:
        return None
    return _Registered(id=row.id, object_key=row.object_key, expires_at=row.expires_at)
