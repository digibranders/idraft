"""Files attached to page notes, in the raw bucket (spec 9.8.5, decision D22).

Kept through the same `ObjectStore` and compressed the same way as screenshots. The key is built
from server-made ids only, never from the file's name, and sits under `notes/`, outside the
`raw/v1/<class>/` prefixes the bucket's lifecycle rules expire.
"""

from __future__ import annotations

import asyncio
from uuid import UUID

from idraft.storage.raw import ObjectStore, compress, decompress


def note_file_key(workspace_id: UUID, project_id: UUID, attachment_id: UUID) -> str:
    # The annotations are not enough: a str that is not a UUID must not reach a key.
    for part in (workspace_id, project_id, attachment_id):
        if not isinstance(part, UUID):
            raise TypeError("a note file's key is built from UUIDs only")
    return f"notes/v1/{workspace_id}/{project_id}/{attachment_id}.zst"


async def put_note_file(
    store: ObjectStore, workspace_id: UUID, project_id: UUID, attachment_id: UUID, data: bytes
) -> str:
    key = note_file_key(workspace_id, project_id, attachment_id)
    # Compressing megabytes takes a moment: off the event loop, as screenshots do.
    await store.put(key, await asyncio.to_thread(compress, data))
    return key


async def get_note_file(store: ObjectStore, key: str) -> bytes:
    return await asyncio.to_thread(decompress, await store.get(key))
