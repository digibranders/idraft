"""Raw payloads in the `seo-raw` bucket (docs/23-backup-disaster-recovery.md section 9).

A payload is kept exactly as the provider sent it: named by the SHA-256 of those bytes,
compressed with zstd at level 6, under a key that starts with its retention class so the
bucket's lifecycle rules can expire each class by prefix:

    raw/v1/<retention_class>/<provider>/<endpoint_slug>/<yyyy>/<mm>/<dd>/<sha256>.json.zst

R2 speaks the S3 API; any server that does, and checks signatures, stands in for it in tests.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import re
from collections.abc import AsyncIterator, Mapping
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from types import MappingProxyType
from typing import TYPE_CHECKING, Final, Literal, Protocol

import aiohttp
import zstandard
from aiobotocore.config import AioConfig
from aiobotocore.session import get_session
from botocore.exceptions import BotoCoreError, ClientError

if TYPE_CHECKING:
    from types_aiobotocore_s3 import S3Client

RetentionClass = Literal["serp_raw", "ai_raw", "first_party_raw", "error"]
# How long each class is kept (doc 23 section 9.2). None: for ever.
RETENTION: Final[Mapping[RetentionClass, timedelta | None]] = MappingProxyType(
    {
        "serp_raw": timedelta(days=400),
        "ai_raw": None,
        "first_party_raw": timedelta(days=90),
        "error": timedelta(days=30),
    }
)
ZSTD_LEVEL: Final = 6
# The most a stored payload may unpack to. The largest answer the DataForSEO client keeps is
# 64 MiB; this is room above it, and a bound on what a bad object can cost to read.
UNPACKED_MAX: Final = 256 * 1024 * 1024
# A stored object is compressed, so never larger than what it unpacks to.
STORED_MAX: Final = UNPACKED_MAX
CONTENT_TYPE: Final = "application/zstd"
DEFAULT_CONNECTIONS: Final = 10
_PART: Final = re.compile(r"[a-z0-9_]{1,64}")


def _client_config(max_connections: int) -> AioConfig:
    return AioConfig(
        connect_timeout=5,
        read_timeout=30,
        retries={"max_attempts": 3, "mode": "standard"},
        signature_version="s3v4",
        s3={"addressing_style": "path"},
        # Checksums only where the API requires them. Each upload carries its MD5 instead,
        # which every S3 server checks.
        request_checksum_calculation="when_required",
        response_checksum_validation="when_required",
        max_pool_connections=max_connections,
    )


class RawStorageError(Exception):
    """Object storage failed or refused. Never quotes credentials."""


def digest(body: bytes) -> bytes:
    return hashlib.sha256(body).digest()


def compress(body: bytes) -> bytes:
    # The frame records the payload's size, so reading it back needs no guess, and a checksum
    # of its content, so damage is found when it is read.
    return zstandard.ZstdCompressor(level=ZSTD_LEVEL, write_checksum=True).compress(body)


def decompress(data: bytes) -> bytes:
    """The payload a stored object holds: one whole frame, and nothing after it."""
    try:
        size = zstandard.frame_content_size(data)
    except zstandard.ZstdError:
        raise RawStorageError("not a compressed payload") from None
    if size < 0:
        raise RawStorageError("the compressed payload does not say its size")
    if size > UNPACKED_MAX:
        raise RawStorageError(f"the payload would be larger than {UNPACKED_MAX} bytes")
    reader = zstandard.ZstdDecompressor().decompressobj()
    try:
        body = reader.decompress(data)
    except zstandard.ZstdError:
        raise RawStorageError("not a compressed payload") from None
    if not reader.eof or reader.unused_data or len(body) != size:
        raise RawStorageError("the compressed payload is not one whole frame")
    return body


def _md5(data: bytes) -> str:
    return base64.b64encode(hashlib.md5(data, usedforsecurity=False).digest()).decode()


def object_key(
    retention_class: RetentionClass,
    provider: str,
    endpoint_slug: str,
    fetched_at: datetime,
    sha256: bytes,
) -> str:
    for part in (provider, endpoint_slug):
        if not _PART.fullmatch(part):
            raise ValueError(f"{part!r} cannot be part of a key: lowercase letters, digits, _")
    if retention_class not in RETENTION:
        raise ValueError(f"{retention_class!r} is not a retention class")
    if len(sha256) != 32:
        raise ValueError("a key names the whole sha256 of the payload")
    if fetched_at.tzinfo is None or fetched_at.utcoffset() is None:
        raise ValueError("a key's day is taken from a time with its time zone")
    day = fetched_at.astimezone(UTC)
    return (
        f"raw/v1/{retention_class}/{provider}/{endpoint_slug}/"
        f"{day:%Y}/{day:%m}/{day:%d}/{sha256.hex()}.json.zst"
    )


# botocore's errors, and aiohttp's for a body cut off while it is read.
_FAILURES: Final = (ClientError, BotoCoreError, aiohttp.ClientError)


def _failure(action: str, error: Exception) -> RawStorageError:
    """What went wrong, by the server's error code or the client's error type only."""
    if isinstance(error, ClientError):
        code = error.response.get("Error", {}).get("Code", "unknown")
        return RawStorageError(f"{action} failed: {code}")
    return RawStorageError(f"{action} failed: {type(error).__name__}")


class ObjectStore(Protocol):
    async def put(self, key: str, data: bytes) -> None: ...

    async def get(self, key: str) -> bytes: ...


class RawStore:
    """One bucket, through one S3 client."""

    def __init__(self, client: S3Client, bucket: str) -> None:
        self._client = client
        self.bucket = bucket

    async def put(self, key: str, data: bytes) -> None:
        # Hashing megabytes takes milliseconds: off the event loop.
        md5 = await asyncio.to_thread(_md5, data)
        try:
            await self._client.put_object(
                Bucket=self.bucket, Key=key, Body=data, ContentType=CONTENT_TYPE, ContentMD5=md5
            )
        except _FAILURES as error:
            raise _failure("storing a payload", error) from None

    async def get(self, key: str) -> bytes:
        try:
            response = await self._client.get_object(Bucket=self.bucket, Key=key)
            async with response["Body"] as stream:
                if response["ContentLength"] > STORED_MAX:
                    raise RawStorageError(f"the object is larger than {STORED_MAX} bytes")
                data: bytes = await stream.read()
        except _FAILURES as error:
            raise _failure("reading a payload", error) from None
        return data


async def read_payload(store: ObjectStore, key: str, sha256: bytes) -> bytes:
    """The payload stored under `key`, checked against the hash it was registered with."""
    data = await store.get(key)
    body, found = await asyncio.to_thread(_unpack, data)
    if found != sha256:
        raise RawStorageError("the payload read back is not the one that was stored")
    return body


def _unpack(data: bytes) -> tuple[bytes, bytes]:
    body = decompress(data)
    return body, digest(body)


@asynccontextmanager
async def s3_client(
    *,
    endpoint: str,
    access_key_id: str,
    secret_access_key: str,
    max_connections: int = DEFAULT_CONNECTIONS,
) -> AsyncIterator[S3Client]:
    session = get_session()
    async with session.create_client(
        "s3",
        endpoint_url=endpoint,
        region_name="auto",
        aws_access_key_id=access_key_id,
        aws_secret_access_key=secret_access_key,
        config=_client_config(max_connections),
    ) as client:
        yield client


@asynccontextmanager
async def open_raw_store(
    *,
    endpoint: str,
    bucket: str,
    access_key_id: str,
    secret_access_key: str,
    max_connections: int = DEFAULT_CONNECTIONS,
) -> AsyncIterator[RawStore]:
    """One store for a process, with a connection for each handler that may use it at once:
    the worker passes its concurrency."""
    async with s3_client(
        endpoint=endpoint,
        access_key_id=access_key_id,
        secret_access_key=secret_access_key,
        max_connections=max_connections,
    ) as client:
        yield RawStore(client, bucket)
