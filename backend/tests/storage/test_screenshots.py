"""A screenshot is kept in the raw bucket, compressed like a payload, under its own prefix."""

from __future__ import annotations

import threading
from uuid import UUID

import pytest

from idraft.storage.raw import compress as compress_bytes
from idraft.storage.raw import decompress as decompress_bytes
from idraft.storage.screenshots import get_screenshot, put_screenshot, screenshot_key

WORKSPACE = UUID("11111111-1111-1111-1111-111111111111")
PROJECT = UUID("22222222-2222-2222-2222-222222222222")


class MemoryStore:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    async def put(self, key: str, data: bytes) -> None:
        self.objects[key] = data

    async def get(self, key: str) -> bytes:
        return self.objects[key]


def test_the_key_names_workspace_project_and_observation() -> None:
    key = screenshot_key(WORKSPACE, PROJECT, 4242)
    assert key == f"screenshots/v1/{WORKSPACE}/{PROJECT}/4242.png.zst"
    # Not under raw/v1/<class>/, which the bucket's lifecycle rules expire by prefix.
    assert not key.startswith("raw/")


async def test_what_is_stored_comes_back_unchanged() -> None:
    store = MemoryStore()
    png = b"\x89PNG\r\n\x1a\n" + b"x" * 5000
    key = await put_screenshot(store, WORKSPACE, PROJECT, 4242, png)
    assert key in store.objects
    assert store.objects[key] != png  # compressed
    assert await get_screenshot(store, key) == png


async def test_compression_runs_off_the_event_loop(monkeypatch: pytest.MonkeyPatch) -> None:
    loop_thread = threading.get_ident()
    seen: list[int] = []

    def compress(data: bytes) -> bytes:
        seen.append(threading.get_ident())
        return compress_bytes(data)

    def decompress(data: bytes) -> bytes:
        seen.append(threading.get_ident())
        return decompress_bytes(data)

    monkeypatch.setattr("idraft.storage.screenshots.compress", compress)
    monkeypatch.setattr("idraft.storage.screenshots.decompress", decompress)
    store = MemoryStore()
    key = await put_screenshot(store, WORKSPACE, PROJECT, 1, b"\x89PNG" + b"x" * 100)
    await get_screenshot(store, key)
    assert len(seen) == 2
    assert loop_thread not in seen
