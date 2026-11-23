"""Screenshots of AI answer pages, in the raw bucket.

Kept through the same `ObjectStore` as raw payloads and compressed the same way (`raw.compress`),
so the store has one interface. The key is not under `raw/v1/<retention_class>/`: the bucket's
lifecycle rules expire by that prefix, and a screenshot is kept for good (it cannot be captured
again after DataForSEO's 7 days).
"""

from __future__ import annotations

from uuid import UUID

from idraft.storage.raw import ObjectStore, compress, decompress


def screenshot_key(workspace_id: UUID, project_id: UUID, observation_id: int) -> str:
    return f"screenshots/v1/{workspace_id}/{project_id}/{observation_id}.png.zst"


async def put_screenshot(
    store: ObjectStore, workspace_id: UUID, project_id: UUID, observation_id: int, png: bytes
) -> str:
    key = screenshot_key(workspace_id, project_id, observation_id)
    await store.put(key, compress(png))
    return key


async def get_screenshot(store: ObjectStore, key: str) -> bytes:
    return decompress(await store.get(key))
