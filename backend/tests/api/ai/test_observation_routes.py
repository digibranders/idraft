"""Reading AI answers (docs/19 section 3.7.6): the project's observations newest first with
their facts, one answer with its citations and marked mentions, and the raw answer. The answers
are the S-04 captures, ingested by the worker's own ingest."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest

from idraft.api.resources import Resources
from idraft.collectors.ai_prompt_ingest import ingest
from tests.api.ai.sources_support import AT, forged_cursor
from tests.api.auth.support import Workspace, execute, fetchrow, make_workspace
from tests.api.entities.support import Caller, member, problem
from tests.api.keywords.support import ensure_locations, errors, project_url
from tests.api.keywords.test_tracked_keyword_ranks import Ledger, worker_db
from tests.api.workspaces.support import make_project
from tests.collectors.ai_support import (
    OWN_HOST,
    OWN_NAME,
    RIVAL_HOST,
    RIVAL_NAME,
    AiWorld,
    Prompt,
    add_prompt,
    at_now,
    chatgpt_answer,
    fetched_ai_task,
)
from tests.collectors.rank_support import _entity
from tests.collectors.support import Project
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer
from tests.providers.dataforseo.support import FIXTURES

__all__ = ["worker_db"]

CAPTURED = FIXTURES / "captured"
QUESTION = "What are the best managed SOC providers in India?"
Answers = tuple[Workspace, AiWorld, Caller, Prompt, dict[str, int], dict[str, bytes]]

# Written as code points so the file stays ASCII: a rocket (two UTF-16 code units) and the
# Devanagari word "suraksha" (one unit per character).
ROCKET = chr(0x1F680)
HINDI = "".join(chr(code) for code in (0x938, 0x941, 0x930, 0x915, 0x94D, 0x937, 0x93E))


async def _get(
    api: httpx.AsyncClient,
    workspace: Workspace,
    project: Project,
    caller: Caller,
    *parts: object,
    **params: Any,
) -> httpx.Response:
    return await api.get(
        project_url(workspace, project.id, "ai", "observations", *parts),
        params=params,
        headers=caller.headers,
    )


async def _task_observation(pg: PostgresServer, task_id: int) -> int:
    row = await fetchrow(
        pg, "SELECT id FROM ai.observations WHERE collection_task_id = $1", task_id
    )
    observation_id: int = row["id"]
    return observation_id


@pytest.fixture
async def answers(
    resources: Resources,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
) -> Answers:
    """Three answers to one prompt, an hour apart, newest first: Gemini (own and rival named and
    cited), ChatGPT (neither) and a ChatGPT refusal."""
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    await ensure_locations(migrated)
    project = Project(workspace.id, await make_project(migrated, workspace.id))
    world = AiWorld(
        project,
        own=await _entity(migrated, project, OWN_NAME, OWN_HOST, "own", primary=True),
        rival=await _entity(migrated, project, RIVAL_NAME, RIVAL_HOST, "competitor"),
    )
    prompt = await add_prompt(migrated, project, QUESTION)
    now = datetime.now(UTC).replace(microsecond=0)
    bodies = {
        "gemini": at_now(CAPTURED / "gemini_scraper_answer.json", now),
        "chatgpt": chatgpt_answer(
            "Several firms run managed SOCs in India, with 24x7 monitoring and response.",
            ["https://news.example/soc"],
            when=now - timedelta(hours=1),
        ),
        "refused": chatgpt_answer(
            "I'm sorry, but I can't help with comparing vendors.", when=now - timedelta(hours=2)
        ),
    }
    tasks = {
        name: await fetched_ai_task(
            worker_db,
            migrated,
            project,
            prompt,
            body,
            import_store,
            engine_code="gemini_web" if name == "gemini" else "chatgpt_web",
        )
        for name, body in bodies.items()
    }
    await ingest(worker_db, import_store)
    ids = {name: await _task_observation(migrated, task_id) for name, task_id in tasks.items()}
    return workspace, world, owner, prompt, ids, bodies


async def test_the_answers_are_listed_newest_first_with_their_facts(
    api: httpx.AsyncClient, answers: Answers
) -> None:
    workspace, world, owner, prompt, ids, _ = answers

    response = await _get(api, workspace, world.project, owner)

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert [row["observation_id"] for row in data] == [
        str(ids["gemini"]),
        str(ids["chatgpt"]),
        str(ids["refused"]),
    ]
    gemini = data[0]
    assert gemini["subject"] == {
        "type": "prompt",
        "prompt_id": str(prompt.id),
        "prompt_version_id": str(prompt.version_id),
        "version_no": 1,
    }
    assert (gemini["engine_code"], gemini["status"], gemini["citation_count"]) == (
        "gemini_web",
        "complete",
        5,
    )
    assert gemini["facts"]["outcome"] == "mentioned_and_cited"
    assert gemini["facts"]["competitor_mentions"] == [str(world.rival)]
    assert data[1]["facts"]["outcome"] == "neither"
    assert (data[2]["status"], data[2]["facts"]["is_valid"]) == ("refused", False)
    # An answer that is not valid has no outcome: it is neither mentioning nor ignoring the brand.
    assert data[2]["facts"]["outcome"] is None
    assert response.json()["page"] == {"limit": 50, "next_cursor": None, "has_more": False}


@pytest.mark.parametrize(
    ("params", "expected"),
    [
        ({"filter[engine_code_in]": "chatgpt_web"}, ["chatgpt", "refused"]),
        ({"filter[status_in]": "refused,empty"}, ["refused"]),
        ({"filter[is_valid]": "true"}, ["gemini", "chatgpt"]),
        ({"filter[outcome_in]": "mentioned_and_cited,cited_only"}, ["gemini"]),
        # The refusal has both own flags false too, but an outcome is a valid answer's.
        ({"filter[outcome_in]": "neither"}, ["chatgpt"]),
    ],
)
async def test_the_list_filters_by_engine_status_validity_and_outcome(
    api: httpx.AsyncClient, answers: Answers, params: dict[str, str], expected: list[str]
) -> None:
    workspace, world, owner, _, ids, _ = answers

    response = await _get(api, workspace, world.project, owner, **params)

    assert response.status_code == 200, response.text
    assert [row["observation_id"] for row in response.json()["data"]] == [
        str(ids[name]) for name in expected
    ]


async def test_the_list_pages_with_a_cursor_bound_to_its_filters(
    api: httpx.AsyncClient, answers: Answers
) -> None:
    workspace, world, owner, _, ids, _ = answers

    first = await _get(api, workspace, world.project, owner, limit=2)
    cursor = first.json()["page"]["next_cursor"]
    second = await _get(api, workspace, world.project, owner, limit=2, cursor=cursor)
    other_filter = await _get(
        api, workspace, world.project, owner, limit=2, cursor=cursor, **{"filter[is_valid]": "true"}
    )

    assert [row["observation_id"] for row in second.json()["data"]] == [str(ids["refused"])]
    assert second.json()["page"]["has_more"] is False
    assert problem(other_filter) == (400, "invalid_cursor")


@pytest.mark.parametrize(
    "key",
    [
        [AT],
        [AT, 5, 1],
        [AT, "5"],
        [AT, -1],
        [5, 5],
        ["2026-01-01T00:00:00", 5],
        ["yesterday", 5],
        ["0001-01-01T00:00:00+01:00", 5],
        ["9999-12-31T23:59:59-01:00", 5],
    ],
    ids=[
        "one value",
        "three values",
        "a string id",
        "a negative id",
        "a number for the time",
        "a time with no offset",
        "a time that is no time",
        "year 1 that overflows in UTC",
        "year 9999 that overflows in UTC",
    ],
)
async def test_a_forged_cursor_is_refused_before_the_query(
    api: httpx.AsyncClient, answers: Answers, key: list[Any]
) -> None:
    workspace, world, owner, _, _, _ = answers
    first = await _get(api, workspace, world.project, owner, limit=1)
    cursor = first.json()["page"]["next_cursor"]

    forged = await _get(
        api, workspace, world.project, owner, limit=1, cursor=forged_cursor(cursor, key)
    )

    assert problem(forged) == (400, "invalid_cursor")


async def test_a_window_over_92_days_is_refused(api: httpx.AsyncClient, answers: Answers) -> None:
    workspace, world, owner, _, _, _ = answers

    response = await _get(
        api, workspace, world.project, owner, **{"from": "2026-01-01", "to": "2026-06-01"}
    )

    assert problem(response) == (422, "window_too_large")


async def test_a_superseded_answer_is_never_listed(
    api: httpx.AsyncClient, answers: Answers, migrated: PostgresServer
) -> None:
    workspace, world, owner, _, ids, _ = answers
    await execute(
        migrated,
        "UPDATE ai.observations SET superseded_by = $2 WHERE id = $1",
        ids["chatgpt"],
        ids["gemini"],
    )

    response = await _get(api, workspace, world.project, owner)

    assert [row["observation_id"] for row in response.json()["data"]] == [
        str(ids["gemini"]),
        str(ids["refused"]),
    ]


async def test_an_answer_is_read_with_its_citations_and_marked_mentions(
    api: httpx.AsyncClient, answers: Answers
) -> None:
    workspace, world, owner, _, ids, _ = answers

    response = await _get(api, workspace, world.project, owner, ids["gemini"])

    assert response.status_code == 200, response.text
    detail = response.json()["data"]
    text = detail["answer_text"]
    assert detail["offsets_unit"] == "utf16"
    assert [c["domain_role"] for c in detail["citations"]] == [
        "competitor",
        "third_party",
        "third_party",
        "own",
        "third_party",
    ]
    assert detail["citations"][3]["host"] == "eventussecurity.com"
    assert detail["citations"][3]["role_entity_id"] == str(world.own)
    names = {mention["name"]: mention for mention in detail["mentions"]}
    own = names[OWN_NAME]
    assert (own["role"], own["mention_status"], own["mention_order"]) == ("own", "accepted", 2)
    start, end = own["evidence_spans"][0]
    assert text[start:end] == OWN_NAME
    assert names[RIVAL_NAME]["role"] == "competitor"


async def test_evidence_offsets_count_utf16_code_units(
    api: httpx.AsyncClient,
    answers: Answers,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
) -> None:
    workspace, world, owner, prompt, _, _ = answers
    text = (
        f"{ROCKET} {HINDI} {ROCKET} Our pick for managed SOC in India is {OWN_NAME}, per the news."
    )
    task_id = await fetched_ai_task(
        worker_db,
        migrated,
        world.project,
        prompt,
        chatgpt_answer(text, when=datetime.now(UTC).replace(microsecond=0)),
        import_store,
    )
    await ingest(worker_db, import_store)
    observation_id = await _task_observation(migrated, task_id)

    response = await _get(api, workspace, world.project, owner, observation_id)

    assert response.status_code == 200, response.text
    detail = response.json()["data"]
    own = next(mention for mention in detail["mentions"] if mention["name"] == OWN_NAME)
    start, end = own["evidence_spans"][0]
    units = detail["answer_text"].encode("utf-16-le")
    # Read as a JavaScript string reads it: by code unit, two bytes each.
    assert units[2 * start : 2 * end].decode("utf-16-le") == OWN_NAME
    code_point_start = text.index(OWN_NAME)
    assert start == code_point_start + 2  # one extra unit for each of the two rockets
    assert own["first_char_offset"] == start


@pytest.mark.parametrize("tail", [(), ("raw",)])
async def test_an_observation_of_another_project_is_not_found(
    api: httpx.AsyncClient, answers: Answers, migrated: PostgresServer, tail: tuple[str, ...]
) -> None:
    """Another project of the same workspace: the registry function checks the workspace only,
    so the service must check the project before it reads the raw answer."""
    workspace, _, owner, _, ids, _ = answers
    elsewhere = await fetchrow(
        migrated,
        "INSERT INTO core.projects (workspace_id, name, slug) VALUES ($1, 'Other', $2) "
        "RETURNING id",
        workspace.id,
        f"p-{uuid.uuid4().hex[:12]}",
    )
    other = Project(workspace.id, elsewhere["id"])

    response = await _get(api, workspace, other, owner, ids["gemini"], *tail)

    assert problem(response) == (404, "not_found")


async def test_the_raw_answer_is_returned_as_received(
    api: httpx.AsyncClient, answers: Answers, import_store: MemoryStore, migrated: PostgresServer
) -> None:
    workspace, world, owner, _, ids, bodies = answers

    response = await _get(api, workspace, world.project, owner, ids["gemini"], "raw")
    stored = dict(import_store.objects)
    import_store.objects.clear()
    lost = await _get(api, workspace, world.project, owner, ids["chatgpt"], "raw")
    import_store.objects.update(stored)
    await execute(
        migrated,
        "UPDATE ops.raw_payloads SET expires_at = now() - interval '1 day' "
        "WHERE id = (SELECT raw_payload_id FROM ai.observations WHERE id = $1)",
        ids["refused"],
    )
    expired = await _get(api, workspace, world.project, owner, ids["refused"], "raw")

    assert response.status_code == 200, response.text
    assert response.content == bodies["gemini"]
    assert response.headers["content-disposition"].startswith("attachment")
    assert response.headers["content-security-policy"] == "sandbox"
    assert problem(lost) == (503, "raw_unavailable")
    assert problem(expired) == (410, "raw_expired")


async def test_a_viewer_reads_answers_but_not_the_raw_answer(
    api: httpx.AsyncClient, answers: Answers, resources: Resources, migrated: PostgresServer
) -> None:
    workspace, world, _, _, ids, _ = answers
    viewer = await member(resources, migrated, workspace, "viewer")

    listed = await _get(api, workspace, world.project, viewer)
    raw = await _get(api, workspace, world.project, viewer, ids["gemini"], "raw")

    assert listed.status_code == 200
    assert problem(raw) == (403, "forbidden")


@pytest.mark.parametrize("tail", [(), ("raw",)])
async def test_an_observation_of_a_deleted_project_is_not_found(
    api: httpx.AsyncClient, answers: Answers, migrated: PostgresServer, tail: tuple[str, ...]
) -> None:
    workspace, world, owner, _, ids, _ = answers
    assert (
        await _get(api, workspace, world.project, owner, ids["gemini"], *tail)
    ).status_code == 200
    await execute(
        migrated, "UPDATE core.projects SET deleted_at = now() WHERE id = $1", world.project.id
    )

    response = await _get(api, workspace, world.project, owner, ids["gemini"], *tail)

    assert problem(response) == (404, "not_found")


async def test_the_observed_at_hint_finds_the_month_and_a_wrong_one_finds_nothing(
    api: httpx.AsyncClient, answers: Answers
) -> None:
    workspace, world, owner, _, ids, _ = answers
    listed = (await _get(api, workspace, world.project, owner)).json()["data"][0]
    hint = listed["observed_at"]
    far = (datetime.fromisoformat(hint) - timedelta(days=60)).isoformat()

    found = await _get(api, workspace, world.project, owner, ids["gemini"], observed_at=hint)
    raw = await _get(api, workspace, world.project, owner, ids["gemini"], "raw", observed_at=hint)
    missed = await _get(api, workspace, world.project, owner, ids["gemini"], observed_at=far)
    missed_raw = await _get(
        api, workspace, world.project, owner, ids["gemini"], "raw", observed_at=far
    )

    assert (found.status_code, raw.status_code) == (200, 200)
    assert problem(missed) == (404, "not_found")
    assert problem(missed_raw) == (404, "not_found")


@pytest.mark.parametrize("tail", [(), ("raw",)])
@pytest.mark.parametrize("hint", ["9999-12-31T23:00:00Z", "0001-01-01T00:00:00Z", "0001-01-01"])
async def test_a_far_away_hint_is_a_not_found_and_never_a_crash(
    api: httpx.AsyncClient, answers: Answers, hint: str, tail: tuple[str, ...]
) -> None:
    workspace, world, owner, _, ids, _ = answers

    response = await _get(
        api, workspace, world.project, owner, ids["gemini"], *tail, observed_at=hint
    )

    assert problem(response) == (404, "not_found")


@pytest.mark.parametrize(
    ("params", "field"),
    [
        ({"to": "0001-01-05"}, "to"),
        ({"to": "9999-12-31"}, "to"),
        ({"from": "9999-12-30", "to": "9999-12-31"}, "to"),
    ],
)
async def test_a_window_at_the_edge_of_time_is_a_validation_error_never_a_crash(
    api: httpx.AsyncClient, answers: Answers, params: dict[str, str], field: str
) -> None:
    workspace, world, owner, _, _, _ = answers

    response = await _get(api, workspace, world.project, owner, **params)

    assert response.status_code == 422, response.text
    assert response.json()["code"] == "validation_failed"
    assert [path for path, _ in errors(response)] == [field]


async def test_a_window_of_92_days_is_listed_and_one_of_93_is_not(
    api: httpx.AsyncClient, answers: Answers
) -> None:
    workspace, world, owner, _, _, _ = answers

    exact = await _get(
        api,
        workspace,
        world.project,
        owner,
        **{"from": "2026-08-01T00:00:00Z", "to": "2026-11-01T00:00:00Z"},
    )
    over = await _get(
        api,
        workspace,
        world.project,
        owner,
        **{"from": "2026-08-01T00:00:00Z", "to": "2026-11-02T00:00:00Z"},
    )

    assert exact.status_code == 200, exact.text
    assert problem(over) == (422, "window_too_large")


async def test_a_check_link_is_given_only_when_it_is_a_web_address(
    api: httpx.AsyncClient, answers: Answers, migrated: PostgresServer
) -> None:
    workspace, world, owner, _, ids, _ = answers
    for name, link in (
        ("gemini", "https://www.google.com/search?q=soc"),
        ("chatgpt", "javascript:alert(1)"),
    ):
        await execute(
            migrated,
            "UPDATE ai.observations "
            "SET provider_extras = jsonb_build_object('check_url', $2::text) WHERE id = $1",
            ids[name],
            link,
        )

    web = await _get(api, workspace, world.project, owner, ids["gemini"])
    script = await _get(api, workspace, world.project, owner, ids["chatgpt"])

    assert web.json()["data"]["check_url"] == "https://www.google.com/search?q=soc"
    assert script.json()["data"]["check_url"] is None


async def test_citation_offsets_count_utf16_code_units(
    api: httpx.AsyncClient,
    answers: Answers,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
) -> None:
    workspace, world, owner, prompt, _, _ = answers
    url = "https://news.example/soc-guide"
    text = f"{ROCKET} Read {url} for the managed SOC picks in India today."
    task_id = await fetched_ai_task(
        worker_db,
        migrated,
        world.project,
        prompt,
        chatgpt_answer(text, [url], when=datetime.now(UTC).replace(microsecond=0)),
        import_store,
    )
    await ingest(worker_db, import_store)
    observation_id = await _task_observation(migrated, task_id)

    response = await _get(api, workspace, world.project, owner, observation_id)

    assert response.status_code == 200, response.text
    detail = response.json()["data"]
    offset = detail["citations"][0]["first_char_offset"]
    units = detail["answer_text"].encode("utf-16-le")
    assert units[2 * offset : 2 * (offset + len(url))].decode("utf-16-le") == url
    assert offset == text.index(url) + 1  # the rocket is two units, one more than a code point
