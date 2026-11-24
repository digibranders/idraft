"""`{P}/keyword-prompt-links`: linking a keyword to a prompt, listing and unlinking. Linking
tracks nothing, so it costs no rank checks."""

from __future__ import annotations

import uuid

import httpx

from tests.api.ai.screenshot_support import ShotWorld
from tests.api.auth.support import fetch, fetchrow
from tests.api.keywords.support import project_url
from tests.conftest import PostgresServer


def _url(world: ShotWorld) -> str:
    return project_url(world.workspace, world.project.id, "keyword-prompt-links")


async def _ids(pg: PostgresServer, world: ShotWorld, text: str) -> tuple[uuid.UUID, uuid.UUID]:
    prompt = await fetchrow(
        pg, "SELECT id FROM ai.prompts WHERE project_id = $1 LIMIT 1", world.project.id
    )
    keyword = await fetchrow(
        pg,
        "INSERT INTO seo.keywords (workspace_id, text, normalized_text, language_code) "
        "VALUES ($1, $2, $2, 'en') RETURNING id",
        world.workspace.id,
        text,
    )
    return prompt["id"], keyword["id"]


async def test_a_keyword_is_linked_listed_and_unlinked_without_being_tracked(
    api: httpx.AsyncClient, recent_world: ShotWorld, migrated: PostgresServer
) -> None:
    prompt_id, keyword_id = await _ids(migrated, recent_world, "managed soc")
    url = _url(recent_world)
    body = {"keyword_id": str(keyword_id), "prompt_id": str(prompt_id)}

    created = await api.post(url, json=body, headers=recent_world.writer.headers)
    assert created.status_code == 201, created.text
    link = created.json()["data"]
    assert link["keyword"]["text"] == "managed soc"
    assert (link["link_type"], link["status"], link["is_primary"]) == ("manual", "active", True)

    again = await api.post(url, json=body, headers=recent_world.writer.headers)
    assert again.status_code == 409
    assert again.json()["code"] == "duplicate"

    listed = await api.get(
        url, params={"filter[prompt_id]": str(prompt_id)}, headers=recent_world.reader.headers
    )
    assert [row["link_id"] for row in listed.json()["data"]] == [link["link_id"]]
    tracked = await fetch(
        migrated,
        "SELECT 1 FROM seo.tracked_keywords WHERE project_id = $1",
        recent_world.project.id,
    )
    assert tracked == []

    removed = await api.delete(f"{url}/{link['link_id']}", headers=recent_world.writer.headers)
    assert removed.status_code == 204
    gone = await api.delete(f"{url}/{link['link_id']}", headers=recent_world.writer.headers)
    assert gone.status_code == 404


async def test_a_new_primary_link_replaces_the_old_primary(
    api: httpx.AsyncClient, recent_world: ShotWorld, migrated: PostgresServer
) -> None:
    prompt_id, first = await _ids(migrated, recent_world, "managed soc")
    _, second = await _ids(migrated, recent_world, "soc provider")
    url = _url(recent_world)
    for keyword_id, primary in ((first, None), (second, True)):
        body = {"keyword_id": str(keyword_id), "prompt_id": str(prompt_id), "is_primary": primary}
        sent = await api.post(url, json=body, headers=recent_world.writer.headers)
        assert sent.status_code == 201, sent.text
    rows = await fetch(
        migrated, "SELECT keyword_id, is_primary FROM core.keyword_prompt_links ORDER BY created_at"
    )
    assert [(row["keyword_id"], row["is_primary"]) for row in rows] == [
        (first, False),
        (second, True),
    ]


async def test_a_reader_cannot_link_and_an_unknown_keyword_or_prompt_is_not_found(
    api: httpx.AsyncClient, recent_world: ShotWorld, migrated: PostgresServer
) -> None:
    prompt_id, keyword_id = await _ids(migrated, recent_world, "managed soc")
    url = _url(recent_world)
    body = {"keyword_id": str(keyword_id), "prompt_id": str(prompt_id)}
    denied = await api.post(url, json=body, headers=recent_world.reader.headers)
    assert denied.status_code == 403
    for wrong in (
        {**body, "keyword_id": str(uuid.uuid4())},
        {**body, "prompt_id": str(uuid.uuid4())},
    ):
        missing = await api.post(url, json=wrong, headers=recent_world.writer.headers)
        assert missing.status_code == 404
