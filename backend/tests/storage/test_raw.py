"""Raw payloads in object storage (docs/23-backup-disaster-recovery.md section 9). The storage
tests run against a real S3 API that checks signatures."""

from __future__ import annotations

import hashlib
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pytest
import zstandard

from idraft.storage import raw
from idraft.storage.raw import (
    RETENTION,
    RawStorageError,
    RawStore,
    compress,
    decompress,
    digest,
    object_key,
    open_raw_store,
    read_payload,
    s3_client,
)
from tests.conftest import ObjectServer
from tests.providers.dataforseo.support import fixture_bytes
from tests.storage.support import fresh_store, object_keys

BODY = fixture_bytes("task_get_advanced")
FETCHED = datetime(2026, 9, 29, 23, 30, tzinfo=UTC)


@pytest.fixture
async def store(object_server: ObjectServer) -> AsyncIterator[RawStore]:
    async with fresh_store(object_server) as opened:
        yield opened


def test_a_payload_is_named_by_the_hash_of_its_exact_bytes() -> None:
    assert digest(BODY) == hashlib.sha256(BODY).digest()


def test_a_payload_is_compressed_at_level_six_and_read_back_exactly() -> None:
    packed = compress(BODY)

    assert packed != BODY
    assert len(packed) < len(BODY)
    assert zstandard.ZstdDecompressor().decompress(packed) == BODY
    assert decompress(packed) == BODY
    # The level is what doc 06 section 4.3 says, not the library's default, and the frame
    # carries a checksum of its content.
    assert packed == zstandard.ZstdCompressor(level=6, write_checksum=True).compress(BODY)


def test_what_is_not_a_compressed_payload_is_refused() -> None:
    with pytest.raises(RawStorageError, match="not a compressed payload"):
        decompress(b"{}")


def test_a_payload_damaged_after_its_header_is_refused() -> None:
    packed = compress(BODY)
    damaged = packed[:20] + bytes(len(packed) - 20)

    with pytest.raises(RawStorageError, match="not a compressed payload"):
        decompress(damaged)


def test_a_single_flipped_bit_anywhere_in_the_content_is_found() -> None:
    packed = compress(BODY)
    header = 10
    for position in range(header, len(packed), max(1, (len(packed) - header) // 60)):
        flipped = bytearray(packed)
        flipped[position] ^= 0x01
        with pytest.raises(RawStorageError):
            decompress(bytes(flipped))


@pytest.mark.parametrize("extra", [compress(b'{"another": "frame"}'), b"trailing bytes", b"\x00"])
def test_anything_after_the_one_frame_is_refused(extra: bytes) -> None:
    with pytest.raises(RawStorageError, match="one whole frame"):
        decompress(compress(BODY) + extra)


def test_a_frame_that_does_not_say_its_size_is_refused() -> None:
    unsized = zstandard.ZstdCompressor(write_content_size=False).compress(BODY)

    with pytest.raises(RawStorageError, match="does not say its size"):
        decompress(unsized)


def test_a_key_is_made_only_for_a_retention_class() -> None:
    with pytest.raises(ValueError, match="retention class"):
        object_key("forever", "dataforseo", "serp", FETCHED, digest(b"x"))  # type: ignore[arg-type]


def test_a_payload_that_would_unpack_past_the_limit_is_refused(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(raw, "UNPACKED_MAX", len(BODY) - 1)

    with pytest.raises(RawStorageError, match="larger"):
        decompress(compress(BODY))


def test_a_key_names_the_class_the_provider_the_endpoint_the_day_and_the_hash() -> None:
    sha = digest(BODY)

    key = object_key("serp_raw", "dataforseo", "serp_google_organic_advanced", FETCHED, sha)

    assert key == (
        f"raw/v1/serp_raw/dataforseo/serp_google_organic_advanced/2026/09/29/{sha.hex()}.json.zst"
    )


def test_the_day_in_a_key_is_the_utc_day() -> None:
    kolkata = FETCHED.astimezone(ZoneInfo("Asia/Kolkata"))
    assert kolkata.day == 30

    key = object_key("ai_raw", "dataforseo", "chatgpt_llm_scraper", kolkata, digest(b"x"))

    assert "/2026/09/29/" in key


@pytest.mark.parametrize(
    ("provider", "slug"),
    [("DataForSEO", "serp"), ("dataforseo", "serp/google"), ("", "serp"), ("dataforseo", "..")],
)
def test_a_key_is_made_only_of_safe_parts(provider: str, slug: str) -> None:
    with pytest.raises(ValueError, match="key"):
        object_key("serp_raw", provider, slug, FETCHED, digest(b"x"))


def test_a_key_needs_a_whole_hash_and_a_time_with_its_zone() -> None:
    with pytest.raises(ValueError, match="sha256"):
        object_key("serp_raw", "dataforseo", "serp", FETCHED, b"short")
    with pytest.raises(ValueError, match="time zone"):
        object_key("serp_raw", "dataforseo", "serp", datetime(2026, 9, 29), digest(b"x"))


def test_each_class_is_kept_as_long_as_doc_23_says() -> None:
    assert dict(RETENTION) == {
        "serp_raw": timedelta(days=400),
        "ai_raw": None,
        "first_party_raw": timedelta(days=90),
        "error": timedelta(days=30),
    }


async def test_an_object_is_written_and_read_back_byte_for_byte(
    store: RawStore, object_server: ObjectServer
) -> None:
    packed = compress(BODY)
    key = object_key(
        "serp_raw", "dataforseo", "serp_google_organic_advanced", FETCHED, digest(BODY)
    )

    await store.put(key, packed)

    assert await store.get(key) == packed
    assert await object_keys(object_server, store.bucket) == [key]


async def test_an_object_that_is_not_there_is_an_error(store: RawStore) -> None:
    with pytest.raises(RawStorageError, match="NoSuchKey"):
        await store.get("raw/v1/error/none/x/2026/09/29/missing.json.zst")


async def test_a_bucket_that_is_not_there_is_an_error(object_server: ObjectServer) -> None:
    async with open_raw_store(
        endpoint=object_server.endpoint,
        bucket="no-such-bucket",
        access_key_id=object_server.access_key_id,
        secret_access_key=object_server.secret_access_key,
    ) as store:
        with pytest.raises(RawStorageError, match="NoSuchBucket"):
            await store.put("raw/v1/error/x.json.zst", b"x")


async def test_wrong_credentials_are_an_error_that_does_not_quote_them(
    object_server: ObjectServer, store: RawStore
) -> None:
    async with open_raw_store(
        endpoint=object_server.endpoint,
        bucket=store.bucket,
        access_key_id=object_server.access_key_id,
        secret_access_key="not-the-secret",
    ) as wrong:
        with pytest.raises(RawStorageError) as caught:
            await wrong.put("raw/v1/error/x.json.zst", b"x")

    # The error code and nothing more: no request detail can carry a credential.
    assert str(caught.value) == "storing a payload failed: SignatureDoesNotMatch"


async def test_a_payload_is_read_back_only_as_the_bytes_it_was_registered_with(
    store: RawStore,
) -> None:
    key = object_key("serp_raw", "dataforseo", "serp", FETCHED, digest(BODY))
    await store.put(key, compress(BODY))

    assert await read_payload(store, key, digest(BODY)) == BODY
    with pytest.raises(RawStorageError, match="not the one that was stored"):
        await read_payload(store, key, digest(b"something else"))


async def test_an_object_too_large_to_be_a_payload_is_not_read(
    store: RawStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    key = "raw/v1/error/x/y/2026/09/29/big.json.zst"
    await store.put(key, b"x" * 100)
    monkeypatch.setattr(raw, "STORED_MAX", 99)

    with pytest.raises(RawStorageError, match="larger"):
        await store.get(key)


async def test_an_upload_is_signed_for_region_auto_with_its_md5_and_no_other_checksum(
    object_server: ObjectServer, store: RawStore
) -> None:
    """What R2 expects: region `auto`, and no trailing checksum it might refuse."""
    seen: list[dict[str, str]] = []

    def capture(request: Any, **_: Any) -> None:
        seen.append({name.lower(): str(value) for name, value in request.headers.items()})

    async with s3_client(
        endpoint=object_server.endpoint,
        access_key_id=object_server.access_key_id,
        secret_access_key=object_server.secret_access_key,
        max_connections=24,
    ) as client:
        client.meta.events.register("before-send.s3.PutObject", capture)
        await RawStore(client, store.bucket).put("raw/v1/error/x.json.zst", compress(BODY))
        # A connection for each handler that may use the store at once. The stubs do not
        # declare the setting, so it is read untyped.
        config: Any = client.meta.config
        assert config.max_pool_connections == 24

    (headers,) = seen
    assert "/auto/s3/aws4_request" in headers["authorization"]
    assert headers["content-md5"]
    assert not [name for name in headers if name.startswith("x-amz-checksum")]
    assert "x-amz-trailer" not in headers
    assert "aws-chunked" not in headers.get("content-encoding", "")


async def test_a_server_that_cannot_be_reached_is_an_error() -> None:
    async with open_raw_store(
        endpoint="http://127.0.0.1:1",
        bucket="seo-raw",
        access_key_id="key",
        secret_access_key="secret",
    ) as store:
        with pytest.raises(RawStorageError, match="EndpointConnectionError"):
            await store.put("raw/v1/error/x.json.zst", b"x")
