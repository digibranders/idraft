"""The Citations page routes (WP-76) against Postgres: the repository reads, then each route.
Numbers are worked out by hand from the answers in each test."""

from __future__ import annotations

import time
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

import httpx
import pytest

from idraft.api.ai import citation_board_repository as repository
from idraft.api.ai.source_repository import SourceScope
from idraft.api.resources import Resources
from idraft.db.engine import workspace_transaction
from tests.api.ai.citation_board_support import make_run, run_answer
from tests.api.ai.sources_support import GUIDE, OWN, RIVAL, Cite, World, full_project, make_world
from tests.api.auth.support import execute, fetch
from tests.api.entities.support import problem
from tests.collectors.ai_support import Prompt, add_prompt
from tests.collectors.rank_support import _entity
from tests.conftest import PostgresServer


def scope_of(
    world: World, prompt_ids: tuple[UUID, ...], *, days: int = repository.LOOKBACK_DAYS
) -> SourceScope:
    now = datetime.now(UTC)
    return SourceScope(
        workspace_id=world.project.workspace_id,
        project_id=world.project.id,
        since=now - timedelta(days=days),
        until=now + timedelta(seconds=1),
        engine_codes=("chatgpt_web", "gemini_web", "google_ai_mode"),
        prompt_ids=prompt_ids,
    )


def days_ago_of(moment: datetime) -> float:
    return (datetime.now(UTC) - moment).total_seconds() / 86400.0


async def test_lookback_answers_carry_their_run_and_mentions(
    resources: Resources, migrated: PostgresServer
) -> None:
    world = await make_world(resources, migrated)
    prompt = await add_prompt(migrated, world.project, "Best managed SOC providers?")
    run = await make_run(migrated, world, days_ago=1)
    await run_answer(
        migrated,
        world,
        prompt,
        run=run,
        days_ago=1,
        cites=[world.own_cite()],
        own_mentioned=True,
        mentions=[world.rival],
    )
    # Outside a 5 day lookback, inside the partitions the test database keeps
    await run_answer(migrated, world, prompt, run=None, days_ago=20)

    async with workspace_transaction(
        resources.sessions, world.project.workspace_id, user_id=world.owner.user_id
    ) as db:
        answers = await repository.lookback_answers(db, scope_of(world, (prompt.id,), days=5))

    (only,) = answers
    assert (only.run_id, only.run_key, only.own_mentioned) == (run, str(run), True)
    assert only.competitors_mentioned == frozenset({world.rival})


async def test_lookback_answers_come_newest_first(
    resources: Resources, migrated: PostgresServer
) -> None:
    world = await make_world(resources, migrated)
    prompt = await add_prompt(migrated, world.project, "Best managed SOC providers?")
    run = await make_run(migrated, world, days_ago=3)
    ids = [
        await run_answer(migrated, world, prompt, run=run, days_ago=days) for days in (3, 1, 2, 0.5)
    ]

    async with workspace_transaction(
        resources.sessions, world.project.workspace_id, user_id=world.owner.user_id
    ) as db:
        answers = await repository.lookback_answers(db, scope_of(world, (prompt.id,)))

    assert [a.observation_id for a in answers] == [ids[3], ids[1], ids[2], ids[0]]


async def test_units_are_one_per_url_per_answer_and_skip_flagged_citations(
    resources: Resources, migrated: PostgresServer
) -> None:
    world = await make_world(resources, migrated)
    prompt = await add_prompt(migrated, world.project, "Best managed SOC providers?")
    run = await make_run(migrated, world, days_ago=1)
    oid = await run_answer(
        migrated,
        world,
        prompt,
        run=run,
        days_ago=1,
        cites=[world.own_cite(), world.own_cite(), Cite(GUIDE)],
    )
    await execute(
        migrated,
        "UPDATE ai.citations SET flags = ARRAY['unresolved_redirect'] "
        "WHERE observation_id = $1 AND raw_url = $2",
        oid,
        GUIDE,
    )
    scope = replace(scope_of(world, (prompt.id,)), excluded_flags=("unresolved_redirect",))

    async with workspace_transaction(
        resources.sessions, world.project.workspace_id, user_id=world.owner.user_id
    ) as db:
        answers = await repository.lookback_answers(db, scope)
        units = await repository.units_of(db, scope, answers)

    assert [(u.url, u.domain_role) for u in units[oid]] == [(OWN, "own")]


async def test_an_answer_without_a_run_is_its_own_run_per_utc_day(
    resources: Resources, migrated: PostgresServer
) -> None:
    world = await make_world(resources, migrated)
    prompt = await add_prompt(migrated, world.project, "Best managed SOC providers?")
    yesterday = (datetime.now(UTC) - timedelta(days=1)).replace(
        hour=12, minute=0, second=0, microsecond=0
    )
    moments = [
        yesterday - timedelta(days=1),
        yesterday,
        yesterday + timedelta(minutes=5),
    ]
    for moment in moments:
        await run_answer(migrated, world, prompt, run=None, days_ago=days_ago_of(moment))

    async with workspace_transaction(
        resources.sessions, world.project.workspace_id, user_id=world.owner.user_id
    ) as db:
        answers = await repository.lookback_answers(db, scope_of(world, (prompt.id,)))

    keys = [a.run_key for a in answers]
    assert all(a.run_key.startswith("day:") and a.run_id is None for a in answers)
    # newest first: the two replicates of yesterday share a key, the day before has its own
    assert keys[0] == keys[1] == f"day:{yesterday.date()}"
    assert keys[2] == f"day:{(yesterday - timedelta(days=1)).date()}"


async def test_tracked_competitors_entity_names_and_run_number(
    resources: Resources, migrated: PostgresServer
) -> None:
    world = await make_world(resources, migrated)
    workspace_id, project_id = world.project.workspace_id, world.project.id
    await execute(
        migrated,
        "UPDATE core.project_entities SET color_index = 3 WHERE project_id = $1 AND entity_id = $2",
        project_id,
        world.rival,
    )
    first = await make_run(migrated, world, days_ago=10)
    second = await make_run(migrated, world, days_ago=5)
    third = await make_run(migrated, world, days_ago=1)
    failed = await make_run(migrated, world, days_ago=3)
    await execute(
        migrated, "UPDATE ops.collection_runs SET status = 'failed' WHERE id = $1", failed
    )

    async with workspace_transaction(
        resources.sessions, workspace_id, user_id=world.owner.user_id
    ) as db:
        competitors = await repository.tracked_competitors(db, workspace_id, project_id)
        names = await repository.entity_names(
            db, workspace_id, project_id, {world.rival, world.own}
        )
        nothing = await repository.entity_names(db, workspace_id, project_id, set())
        numbers = [
            await repository.run_number(db, workspace_id, project_id, run)
            for run in (first, second, third, failed, None)
        ]

    (rival,) = competitors
    assert (rival.entity_id, rival.name, rival.color_index) == (world.rival, "CyberNX", 3)
    assert rival.domain == "cybernx.com"
    assert names == {world.rival: ("CyberNX", 3), world.own: ("Eventus Security", None)}
    assert nothing == {}
    # The failed run is not counted, but its own number is the completed runs up to its start
    assert numbers == [1, 2, 3, 2, None]


async def _get(
    world: World, api: httpx.AsyncClient, *path: object, **params: object
) -> httpx.Response:
    """GET `.../ai/<path>`; every parameter is sent as its text, so ids and numbers pass as is."""
    query = {key: str(value) for key, value in params.items()}
    return await api.get(world.url("ai", *path), params=query, headers=world.owner.headers)


@pytest.fixture
async def two_runs(resources: Resources, migrated: PostgresServer) -> tuple[World, Prompt, Prompt]:
    """Prompt A: run 2 (1 day ago) cites the own page and the guide on ChatGPT and only the rival
    on Gemini; run 1 (8 days ago) cites the own page on ChatGPT. Prompt B: run 2 only, names the
    rival without a link."""
    world = await make_world(resources, migrated)
    a = await add_prompt(migrated, world.project, "Best managed SOC providers?")
    b = await add_prompt(migrated, world.project, "How much does a SOC cost?")
    r1 = await make_run(migrated, world, days_ago=8)
    r2 = await make_run(migrated, world, days_ago=1)
    await run_answer(migrated, world, a, run=r2, days_ago=1, cites=[world.own_cite(), Cite(GUIDE)])
    await run_answer(
        migrated, world, a, run=r2, days_ago=1, engine="gemini_web", cites=[world.rival_cite()]
    )
    await run_answer(migrated, world, a, run=r1, days_ago=8, cites=[world.own_cite()])
    await run_answer(migrated, world, b, run=r2, days_ago=1, mentions=[world.rival])
    return world, a, b


async def test_the_overview_counts_the_last_run_against_the_run_before(
    api: httpx.AsyncClient, two_runs: tuple[World, Prompt, Prompt]
) -> None:
    world, _, _ = two_runs
    body = (await _get(world, api, "citation-overview", runs=1)).json()

    assert (body["citations"], body["previous_citations"]) == (1, 1)
    assert (body["matched_citations"], body["matched_previous_citations"]) == (1, 1)
    # Own page; the own, guide (example.org) and rival domains
    assert (body["own_urls"], body["domains"]) == (1, 3)
    assert body["window"]["answers"] == 3
    assert [s["slot"] for s in body["window"]["trend"]] == [2, 1]
    chatgpt = next(e for e in body["engines"] if e["engine_code"] == "chatgpt_web")
    counts = (
        chatgpt["answers"],
        chatgpt["answers_citing"],
        chatgpt["prompts"],
        chatgpt["prompts_citing"],
    )
    assert counts == (2, 1, 2, 1)


async def test_cited_pages_filter_by_role_search_and_count_owners(
    api: httpx.AsyncClient, two_runs: tuple[World, Prompt, Prompt]
) -> None:
    world, _, _ = two_runs
    body = (
        await _get(world, api, "cited-pages", runs=1, **{"filter[domain_role_in]": "own"})
    ).json()

    (row,) = body["data"]
    assert (row["url"], row["citations"], row["previous_citations"], row["prompts"]) == (
        OWN,
        1,
        1,
        1,
    )
    assert body["meta"]["owners"] == {"own": 1, "competitor": 1, "third_party": 1, "all": 3}
    guide = await _get(world, api, "cited-pages", runs=1, q="guide.example")
    assert guide.json()["page"]["total"] == 1


async def test_the_gap_analysis_marks_the_gemini_loss(
    api: httpx.AsyncClient, two_runs: tuple[World, Prompt, Prompt]
) -> None:
    world, a, b = two_runs
    body = (
        await _get(world, api, "citation-gaps", runs=1, **{"filter[competitor_id_in]": world.rival})
    ).json()

    rows = {row["prompt_id"]: row for row in body["data"]}
    assert rows[str(a.id)]["lost_on"] == ["gemini_web"]
    assert rows[str(b.id)]["competitors"][0]["total"]["state"] == "mentioned"
    assert (body["meta"]["prompts"], body["meta"]["gaps"]) == (2, 1)


async def test_an_untracked_competitor_is_refused(
    api: httpx.AsyncClient, two_runs: tuple[World, Prompt, Prompt]
) -> None:
    world, _, _ = two_runs
    response = await _get(world, api, "citation-gaps", **{"filter[competitor_id_in]": world.own})

    assert problem(response) == (422, "competitor_not_tracked")


async def test_a_page_not_cited_in_the_window_is_not_found(
    api: httpx.AsyncClient, two_runs: tuple[World, Prompt, Prompt]
) -> None:
    world, _, _ = two_runs
    assert (await _get(world, api, "cited-pages", "999999999", runs=1)).status_code == 404


async def test_runs_other_than_1_2_or_4_are_refused(
    api: httpx.AsyncClient, two_runs: tuple[World, Prompt, Prompt]
) -> None:
    world, _, _ = two_runs
    assert (await _get(world, api, "citation-overview", runs=3)).status_code == 422


async def test_a_repeated_competitor_is_one_column(
    api: httpx.AsyncClient, two_runs: tuple[World, Prompt, Prompt]
) -> None:
    world, _, _ = two_runs
    body = (
        await _get(
            world,
            api,
            "citation-gaps",
            runs=1,
            **{"filter[competitor_id_in]": f"{world.rival},{world.rival}"},
        )
    ).json()

    assert [c["entity_id"] for c in body["meta"]["competitors"]] == [str(world.rival)]
    assert all(len(row["competitors"]) == 1 for row in body["data"])


async def test_the_page_drawer_lists_its_prompts_engines_and_neighbours(
    api: httpx.AsyncClient, two_runs: tuple[World, Prompt, Prompt]
) -> None:
    world, a, _ = two_runs
    listed = await _get(world, api, "cited-pages", runs=1, **{"filter[domain_role_in]": "own"})
    url_id = listed.json()["data"][0]["url_id"]

    body = (await _get(world, api, "cited-pages", url_id, runs=1)).json()

    assert body["page"]["url"] == OWN
    # Only prompt A cites the page; it has two current answers (ChatGPT, Gemini), one citing
    (prompt,) = body["prompts"]
    assert (prompt["prompt_id"], prompt["cited"], prompt["answers"]) == (str(a.id), 1, 2)
    per_engine = {e["engine_code"]: (e["cited"], e["answers"]) for e in prompt["engines"]}
    assert per_engine == {"chatgpt_web": (1, 1), "gemini_web": (0, 1), "google_ai_mode": (0, 0)}
    # The guide (example.org) is listed in the answer that cites the page; the rival is not
    (beside,) = body["alongside"]
    assert (beside["registrable_domain"], beside["domain_role"], beside["answers"]) == (
        "example.org",
        "third_party",
        1,
    )
    assert body["window"]["runs"] == 1


async def test_the_gap_drawer_lists_the_pages_behind_the_prompt(
    api: httpx.AsyncClient, two_runs: tuple[World, Prompt, Prompt]
) -> None:
    world, a, _ = two_runs
    competitors = {"filter[competitor_id_in]": world.rival}
    body = (await _get(world, api, "citation-gaps", a.id, runs=1, **competitors)).json()

    assert (body["row"]["prompt_id"], body["row"]["gap"], body["answers"]) == (str(a.id), 1, 2)
    assert [(p["url"], p["citations"], p["engines"]) for p in body["competitor_pages"]] == [
        (RIVAL, 1, ["gemini_web"])
    ]
    assert [(p["url"], p["engines"]) for p in body["own_pages"]] == [(OWN, ["chatgpt_web"])]
    assert [p["url"] for p in body["third_party_pages"]] == [GUIDE]
    # The prompts have no topic, so no other prompt is a neighbour
    assert body["closest_pages"] == []
    missing = await _get(world, api, "citation-gaps", uuid4(), runs=1, **competitors)
    assert missing.status_code == 404


async def test_one_engine_filter_leaves_the_other_engines_out_of_every_row(
    api: httpx.AsyncClient, two_runs: tuple[World, Prompt, Prompt]
) -> None:
    world, a, _ = two_runs
    body = (
        await _get(
            world,
            api,
            "citation-gaps",
            runs=1,
            **{"filter[competitor_id_in]": world.rival, "filter[engine_code_in]": "chatgpt_web"},
        )
    ).json()

    row = next(r for r in body["data"] if r["prompt_id"] == str(a.id))
    # Gemini is not counted, so the prompt is not lost anywhere: you are cited on ChatGPT
    assert [e["engine_code"] for e in row["you"]["engines"]] == ["chatgpt_web"]
    assert (row["lost_on"], row["gap"]) == ([], 0)
    assert (body["meta"]["prompts"], body["meta"]["gaps"]) == (2, 0)
    overview = (
        await _get(
            world, api, "citation-overview", runs=1, **{"filter[engine_code_in]": "chatgpt_web"}
        )
    ).json()
    assert [e["engine_code"] for e in overview["engines"]] == ["chatgpt_web"]
    assert overview["window"]["answers"] == 2


@pytest.mark.parametrize(("runs", "own_citations"), [(1, 1), (2, 2), (4, 2)])
async def test_the_strip_equals_the_sum_of_the_own_pages(
    api: httpx.AsyncClient, two_runs: tuple[World, Prompt, Prompt], runs: int, own_citations: int
) -> None:
    world, _, _ = two_runs
    strip = (await _get(world, api, "citation-overview", runs=runs)).json()
    pages = (
        await _get(world, api, "cited-pages", runs=runs, **{"filter[domain_role_in]": "own"})
    ).json()

    assert strip["citations"] == own_citations
    assert strip["citations"] == sum(row["citations"] for row in pages["data"])
    assert strip["citations"] == pages["meta"]["citations"]


async def test_a_manual_run_on_one_engine_moves_only_that_engines_slots(
    api: httpx.AsyncClient, migrated: PostgresServer, two_runs: tuple[World, Prompt, Prompt]
) -> None:
    """Prompt A gets a newer run on Gemini alone (its own page cited). Gemini's slot 1 is that
    run and its old run is slot 2; ChatGPT has no newer run, so its slots do not move."""
    world, a, _ = two_runs
    manual = await make_run(migrated, world, days_ago=0.5)
    await run_answer(
        migrated, world, a, run=manual, days_ago=0.5, engine="gemini_web", cites=[world.own_cite()]
    )

    body = (await _get(world, api, "citation-overview", runs=1)).json()

    # Slot 1: A on ChatGPT (run 2), A on Gemini (the manual run), B on ChatGPT (run 2)
    assert body["window"]["answers"] == 3
    assert [s["slot"] for s in body["window"]["trend"]] == [2, 1]
    by_engine = {e["engine_code"]: e for e in body["engines"]}
    assert (by_engine["chatgpt_web"]["answers"], by_engine["chatgpt_web"]["previous_answers"]) == (
        2,
        1,
    )
    assert (by_engine["gemini_web"]["answers"], by_engine["gemini_web"]["previous_answers"]) == (
        1,
        1,
    )
    # Own units: ChatGPT run 2 and the manual run now; ChatGPT run 1 before (Gemini run 2 cites
    # only the rival). A on ChatGPT and on Gemini are answered in both windows, B is not.
    assert (body["citations"], body["previous_citations"]) == (2, 1)
    assert (body["matched_citations"], body["matched_previous_citations"]) == (2, 1)
    assert body["matched_pairs"] == 2


async def test_a_full_project_reads_the_citations_page_fast_without_statistics(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """The base plan at capacity (150 prompts, three engines, eight answers each) with each
    answer in its own run, so every prompt and engine has eight runs, and three competitors. No
    ANALYZE, as in the sources timing test: 15 s is the hard limit for every route."""
    world = await full_project(resources, migrated)
    # full_project answers are 3 days apart: answer n of every pair is run n, not a weekly run
    runs = [await make_run(migrated, world, days_ago=3 * n) for n in range(8)]
    await execute(
        migrated,
        "UPDATE ai.observations o SET collection_run_id = ($2::uuid[])[1 + "
        "round(extract(epoch FROM now() - o.observed_at) / 259200)::int] WHERE o.project_id = $1",
        world.project.id,
        runs,
    )
    competitors = [
        world.rival,
        await _entity(migrated, world.project, "Rival Two", "rivaltwo.com", "competitor"),
        await _entity(migrated, world.project, "Rival Three", "rivalthree.com", "competitor"),
    ]
    # Each answer cites ten consecutive pages of 50: one page in 25 for each of the four brands
    # makes about two in five answers cite each brand
    page_ids = [
        row["url_id"]
        for row in await fetch(
            migrated,
            "SELECT DISTINCT url_id FROM ai.citations WHERE project_id = $1 ORDER BY url_id",
            world.project.id,
        )
    ]
    for offset, (role, entity) in enumerate(
        [("own", world.own), *(("competitor", rival) for rival in competitors)]
    ):
        await execute(
            migrated,
            "UPDATE ai.citations SET domain_role = $2, role_entity_id = $3 "
            "WHERE project_id = $1 AND url_id = ANY($4::bigint[])",
            world.project.id,
            role,
            entity,
            page_ids[1 + 5 * offset :: 25],
        )
    chosen = {"filter[competitor_id_in]": ",".join(str(rival) for rival in competitors)}

    async def timed(*path: object, **params: object) -> dict[str, Any]:
        started = time.perf_counter()
        response = await _get(world, api, *path, **params)
        took = time.perf_counter() - started
        assert response.status_code == 200, response.text
        assert took < 15, (path, took)
        body: dict[str, Any] = response.json()
        return body

    overview = await timed("citation-overview", runs=4)
    pages = await timed("cited-pages", runs=4)
    await timed("cited-pages", runs=4, limit=200)
    await timed("cited-pages", runs=1)
    await timed("cited-pages", runs=4, **{"filter[domain_role_in]": "own"})
    gaps = await timed("citation-gaps", runs=4, **chosen)
    await timed("citation-gaps", runs=1, **chosen)
    page = await timed("cited-pages", pages["data"][0]["url_id"], runs=4)
    lost = next(row for row in gaps["data"] if row["gap"] > 0)
    gap = await timed("citation-gaps", lost["prompt_id"], runs=4, **chosen)

    assert overview["citations"] > 0
    assert overview["window"]["answers"] > 0
    assert pages["page"]["total"] == 50
    assert gaps["meta"]["prompts"] == 150
    assert gaps["meta"]["gaps"] > 0
    assert page["prompts"]
    assert gap["answers"] > 0
