"""A note's file is kept in the raw bucket, compressed, under a key made of ids only."""

from __future__ import annotations

from uuid import UUID

import pytest

from idraft.storage.note_files import get_note_file, note_file_key, put_note_file
from idraft.storage.raw import decompress

WORKSPACE = UUID("11111111-1111-1111-1111-111111111111")
PROJECT = UUID("22222222-2222-2222-2222-222222222222")
ATTACHMENT = UUID("33333333-3333-3333-3333-333333333333")


class MemoryStore:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    async def put(self, key: str, data: bytes) -> None:
        self.objects[key] = data

    async def get(self, key: str) -> bytes:
        return self.objects[key]


def test_the_key_names_workspace_project_and_attachment() -> None:
    key = note_file_key(WORKSPACE, PROJECT, ATTACHMENT)
    assert key == f"notes/v1/{WORKSPACE}/{PROJECT}/{ATTACHMENT}.zst"
    # Outside raw/v1/<class>/, which the bucket's lifecycle rules expire by prefix.
    assert not key.startswith("raw/")


@pytest.mark.parametrize("position", [0, 1, 2])
def test_an_argument_that_is_not_a_uuid_is_refused(position: int) -> None:
    ids: list[object] = [WORKSPACE, PROJECT, ATTACHMENT]
    ids[position] = "../../etc/passwd"
    with pytest.raises(TypeError):
        note_file_key(*ids)  # type: ignore[arg-type]


async def test_what_is_stored_comes_back_unchanged_and_is_compressed() -> None:
    store = MemoryStore()
    data = b"\x89PNG\r\n\x1a\n" + b"x" * 5000
    key = await put_note_file(store, WORKSPACE, PROJECT, ATTACHMENT, data)
    assert key == note_file_key(WORKSPACE, PROJECT, ATTACHMENT)
    assert store.objects[key] != data
    assert decompress(store.objects[key]) == data
    assert await get_note_file(store, key) == data


async def test_a_missing_key_raises_the_stores_error() -> None:
    with pytest.raises(KeyError):
        await get_note_file(MemoryStore(), "notes/v1/missing.zst")
