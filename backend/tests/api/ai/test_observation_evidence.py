"""What the answer viewer reads from an observation (WP-26): where each citation sits in the
text (CF-25, built before; these tests pin it), the two hashes (CF-26) and the quote of each
source (BE-SOURCES-21). The answers are the S-04 captures, ingested by the worker's own ingest."""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest

from idraft.api.ai import observation_repository
from idraft.api.resources import Resources
from idraft.collectors.ai_prompt_ingest import ingest
from tests.api.ai.test_observation_routes import (
    Answers,
    _get,
    _task_observation,
    answers,
)
from tests.api.auth.support import execute, fetchrow
from tests.api.entities.support import member, problem
from tests.collectors.ai_support import Prompt, at_now, chatgpt_answer, fetched_ai_task
from tests.collectors.rank_support import Ledger
from tests.collectors.support import Project
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer
from tests.providers.dataforseo.support import FIXTURES

__all__ = ["answers"]

CAPTURED = FIXTURES / "captured"
AI = FIXTURES / "ai"
SHA256_HEX = 64


async def _add(
    worker_db: Ledger,
    migrated: PostgresServer,
    import_store: MemoryStore,
    project: Project,
    prompt: Prompt,
    body: bytes,
    *,
    engine_code: str = "chatgpt_web",
) -> int:
    """The body fetched and ingested as one more answer to the prompt; its observation id."""
    task_id = await fetched_ai_task(
        worker_db, migrated, project, prompt, body, import_store, engine_code=engine_code
    )
    await ingest(worker_db, import_store)
    return await _task_observation(migrated, task_id)


def _read_as_utf16(text: str, start: int, length: int) -> str:
    """`length` code units of `text` from `start`, as a JavaScript string reads it."""
    units = text.encode("utf-16-le")
    return units[2 * start : 2 * (start + length)].decode("utf-16-le")


def _with_listed_only(body: bytes, url: str) -> bytes:
    """The answer with one more source in its list that no block cites."""
    document = json.loads(body)
    result = document["tasks"][0]["result"][0]
    result["sources"].append({"type": "chat_gpt_source", "url": url, "title": "Listed only"})
    return json.dumps(document).encode()


def _with_snippet(body: bytes, snippet: str) -> bytes:
    document = json.loads(body)
    result = document["tasks"][0]["result"][0]
    result["items"][0]["sources"][0]["snippet"] = snippet
    return json.dumps(document).encode()


async def test_the_captured_chatgpt_answer_gives_an_offset_for_every_inline_source(
    api: httpx.AsyncClient,
    answers: Answers,
    worker_db: Ledger,
    migrated: PostgresServer,
    import_store: MemoryStore,
) -> None:
    workspace, world, owner, prompt, _, _ = answers
    body = at_now(CAPTURED / "chatgpt_scraper_answer.json", datetime.now(UTC) - timedelta(hours=3))
    observation_id = await _add(worker_db, migrated, import_store, world.project, prompt, body)

    response = await _get(api, workspace, world.project, owner, observation_id)

    assert response.status_code == 200, response.text
    detail = response.json()["data"]
    text = detail["answer_text"]
    citations = detail["citations"]
    assert len(citations) == 8
    placed = 0
    for citation in citations:
        offset = citation["first_char_offset"]
        if citation["raw_url"] in text:
            assert offset is not None, citation["raw_url"]
        if offset is None:
            continue
        placed += 1
        raw, canonical = citation["raw_url"], citation["url"]
        assert _read_as_utf16(text, offset, len(raw)) == raw or (
            _read_as_utf16(text, offset, len(canonical)) == canonical
        )
        # Every source of this capture is cited by a block of the answer.
        assert citation["answer_block_index"] is not None
    assert placed == len(citations)


async def test_a_source_only_in_the_list_has_no_block_index(
    api: httpx.AsyncClient,
    answers: Answers,
    worker_db: Ledger,
    migrated: PostgresServer,
    import_store: MemoryStore,
) -> None:
    workspace, world, owner, prompt, _, _ = answers
    cited, listed = "https://news.example/soc-guide", "https://listed.example/only"
    text = f"Read {cited} for the managed SOC picks in India today, with pricing."
    body = _with_listed_only(
        chatgpt_answer(text, [cited], when=datetime.now(UTC) - timedelta(hours=4)), listed
    )
    observation_id = await _add(worker_db, migrated, import_store, world.project, prompt, body)

    response = await _get(api, workspace, world.project, owner, observation_id)

    assert response.status_code == 200, response.text
    by_url = {c["raw_url"]: c for c in response.json()["data"]["citations"]}
    assert by_url[cited]["answer_block_index"] == 0
    assert by_url[cited]["first_char_offset"] == text.index(cited)
    assert by_url[listed]["answer_block_index"] is None
    assert by_url[listed]["first_char_offset"] is None


async def test_the_detail_carries_the_answer_hash(api: httpx.AsyncClient, answers: Answers) -> None:
    workspace, world, owner, _, ids, _ = answers

    response = await _get(api, workspace, world.project, owner, ids["gemini"])

    detail = response.json()["data"]
    expected = hashlib.sha256(detail["answer_text"].encode()).hexdigest()
    assert detail["answer_sha256"] == expected
    assert len(detail["answer_sha256"]) == SHA256_HEX
    assert detail["answer_sha256"] == detail["answer_sha256"].lower()


async def test_the_detail_carries_the_raw_hash(
    api: httpx.AsyncClient, answers: Answers, migrated: PostgresServer
) -> None:
    workspace, world, owner, _, ids, bodies = answers

    detail = (await _get(api, workspace, world.project, owner, ids["gemini"])).json()["data"]
    raw = await _get(api, workspace, world.project, owner, ids["gemini"], "raw")

    registered = await fetchrow(
        migrated,
        "SELECT r.sha256 FROM ops.raw_payloads r JOIN ai.observations o "
        "ON o.raw_payload_id = r.id WHERE o.id = $1",
        ids["gemini"],
    )
    assert detail["raw_sha256"] == bytes(registered["sha256"]).hex()
    assert detail["raw_sha256"] == hashlib.sha256(raw.content).hexdigest()
    assert detail["raw_sha256"] == hashlib.sha256(bodies["gemini"]).hexdigest()
    assert detail["raw_sha256"] != detail["answer_sha256"]


async def test_an_answer_without_text_has_no_answer_hash_and_never_zeros(
    api: httpx.AsyncClient,
    answers: Answers,
    worker_db: Ledger,
    migrated: PostgresServer,
    import_store: MemoryStore,
) -> None:
    workspace, world, owner, prompt, _, _ = answers
    observation_id = await _add(
        worker_db, migrated, import_store, world.project, prompt, at_now(AI / "task_error.json")
    )

    response = await _get(api, workspace, world.project, owner, observation_id)

    assert response.status_code == 200, response.text
    detail = response.json()["data"]
    assert (detail["status"], detail["answer_text"]) == ("error", None)
    assert detail["answer_sha256"] is None
    # The provider's body is still registered, so its hash is given.
    assert len(detail["raw_sha256"]) == SHA256_HEX
    assert set(detail["raw_sha256"]) != {"0"}


async def test_a_payload_row_that_is_gone_gives_a_null_raw_hash(
    api: httpx.AsyncClient, answers: Answers, monkeypatch: pytest.MonkeyPatch
) -> None:
    workspace, world, owner, _, ids, _ = answers

    async def gone(*_: object, **__: object) -> None:
        return None

    monkeypatch.setattr(observation_repository, "raw_payload", gone)

    response = await _get(api, workspace, world.project, owner, ids["gemini"])

    assert response.status_code == 200, response.text
    detail = response.json()["data"]
    assert detail["raw_sha256"] is None
    assert len(detail["answer_sha256"]) == SHA256_HEX


async def test_the_hash_of_an_expired_raw_answer_is_still_given(
    api: httpx.AsyncClient, answers: Answers, migrated: PostgresServer
) -> None:
    workspace, world, owner, _, ids, bodies = answers
    await execute(
        migrated,
        "UPDATE ops.raw_payloads SET expires_at = now() - interval '1 day' "
        "WHERE id = (SELECT raw_payload_id FROM ai.observations WHERE id = $1)",
        ids["gemini"],
    )

    detail = await _get(api, workspace, world.project, owner, ids["gemini"])
    raw = await _get(api, workspace, world.project, owner, ids["gemini"], "raw")

    assert problem(raw) == (410, "raw_expired")
    assert detail.status_code == 200, detail.text
    assert detail.json()["data"]["raw_sha256"] == hashlib.sha256(bodies["gemini"]).hexdigest()


async def test_a_viewer_sees_the_hashes_but_still_cannot_read_the_raw_answer(
    api: httpx.AsyncClient, answers: Answers, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, world, _, _, ids, _ = answers
    viewer = await member(resources, migrated, workspace, "viewer")

    detail = await _get(api, workspace, world.project, viewer, ids["gemini"])
    raw = await _get(api, workspace, world.project, viewer, ids["gemini"], "raw")

    assert detail.status_code == 200, detail.text
    assert len(detail.json()["data"]["answer_sha256"]) == SHA256_HEX
    assert len(detail.json()["data"]["raw_sha256"]) == SHA256_HEX
    assert problem(raw) == (403, "forbidden")


async def test_a_quote_is_given_per_citation_for_gemini_and_null_for_chatgpt(
    api: httpx.AsyncClient,
    answers: Answers,
    worker_db: Ledger,
    migrated: PostgresServer,
    import_store: MemoryStore,
) -> None:
    workspace, world, owner, prompt, ids, _ = answers
    captured = await _add(
        worker_db,
        migrated,
        import_store,
        world.project,
        prompt,
        at_now(CAPTURED / "chatgpt_scraper_answer.json", datetime.now(UTC) - timedelta(hours=3)),
    )

    gemini = (await _get(api, workspace, world.project, owner, ids["gemini"])).json()["data"]
    chatgpt = (await _get(api, workspace, world.project, owner, captured)).json()["data"]

    quotes = [citation["quote"] for citation in gemini["citations"]]
    # Two of the five sources are only in the answer's list, which carries no snippet.
    assert [quote is not None for quote in quotes] == [False, True, True, False, True]
    assert quotes[4].startswith("Factosecure is emerging as a startup")
    assert len(chatgpt["citations"]) == 8
    assert [citation["quote"] for citation in chatgpt["citations"]] == [None] * 8


async def test_a_quote_is_plain_text_even_when_hostile(
    api: httpx.AsyncClient,
    answers: Answers,
    worker_db: Ledger,
    migrated: PostgresServer,
    import_store: MemoryStore,
) -> None:
    workspace, world, owner, prompt, _, _ = answers
    hostile = "<script>alert(1)</script>  [x](javascript:alert(1))\n<img src=x onerror=y>"
    body = _with_snippet(
        chatgpt_answer(
            "Several firms run managed SOCs in India, with 24x7 monitoring and response.",
            ["https://news.example/soc"],
            when=datetime.now(UTC) - timedelta(hours=5),
        ),
        hostile,
    )
    observation_id = await _add(
        worker_db, migrated, import_store, world.project, prompt, body, engine_code="gemini_web"
    )

    response = await _get(api, workspace, world.project, owner, observation_id)

    assert response.status_code == 200, response.text
    quote: Any = response.json()["data"]["citations"][0]["quote"]
    assert quote == "<script>alert(1)</script> [x](javascript:alert(1)) <img src=x onerror=y>"
