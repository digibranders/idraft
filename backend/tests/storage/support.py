"""A bucket of its own for each test, on the test object server."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sightline.storage.raw import RawStore, open_raw_store, s3_client
from tests.conftest import ObjectServer


@asynccontextmanager
async def fresh_store(server: ObjectServer) -> AsyncIterator[RawStore]:
    bucket = f"raw-{uuid.uuid4().hex[:12]}"
    async with s3_client(
        endpoint=server.endpoint,
        access_key_id=server.access_key_id,
        secret_access_key=server.secret_access_key,
    ) as client:
        await client.create_bucket(Bucket=bucket)
    async with open_raw_store(
        endpoint=server.endpoint,
        bucket=bucket,
        access_key_id=server.access_key_id,
        secret_access_key=server.secret_access_key,
    ) as store:
        yield store


async def object_keys(server: ObjectServer, bucket: str) -> list[str]:
    async with s3_client(
        endpoint=server.endpoint,
        access_key_id=server.access_key_id,
        secret_access_key=server.secret_access_key,
    ) as client:
        listed = await client.list_objects_v2(Bucket=bucket)
    return sorted(item["Key"] for item in listed.get("Contents", []))
