"""Lost prompts of the competitors read (contract C5, `include=lost_prompts`): per competitor and
engine, the prompts where the competitor is named and the own brand is not. The expected numbers
are worked out by hand from the seeded world of `test_prompts_summary` (see the docstring of its
`summary` fixture). ChatGPT, default scope (the prompts `providers`, `pricing` and `misc`):

    providers  answers 1 to 6: 5 valid and a refusal; the rival is named in 1 (with the own brand)
               and in 4 (alone), so one answer is lost: 1 of 5 valid, 6 answers
    pricing    one valid answer that names nobody
    misc       one valid answer that names the own brand alone
    Gemini     one answer on `providers` that names both brands

The rival is therefore lost on `providers` of ChatGPT only. A prompt has at least 4 valid answers on
the engine for `lost_prompts_with_min_answers`: only `providers` on ChatGPT."""

from __future__ import annotations

import uuid
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest

from idraft.api.ai import competitor_repository
from idraft.api.ai.source_repository import SourceScope
from idraft.api.resources import Resources
from idraft.collectors.ai_prompt_ingest import ingest
from idraft.db.engine import workspace_transaction
from tests.api.ai import summary_support
from tests.api.ai.competitors_support import (
    competitors_body,
    counts,
    entry,
    get_competitors,
    row_of,
)
from tests.api.ai.summary_support import (
    CHATGPT,
    GEMINI,
    REFUSAL,
    Answer,
    Summary,
    answer_in_another_project,
    ingested,
    new_prompts,
    new_world,
    prompt_row,
    summary_data,
)
from tests.api.ai.test_prompts_summary import BOTH, NEITHER, RIVAL_ONLY, RIVAL_PAGE
from tests.api.auth.support import execute, fetchrow, make_workspace
from tests.api.entities.support import problem
from tests.api.keywords.test_tracked_keyword_ranks import Ledger
from tests.api.workspaces.support import make_project
from tests.collectors.ai_support import RIVAL_NAME, enable_engine
from tests.collectors.rank_support import _entity
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer

seeded = summary_support.seeded

LOST = {"include": "lost_prompts"}
LOST_KEYS = ("lost_prompts", "lost_prompts_total", "lost_prompts_with_min_answers")
PROVIDERS_TEXT = "Best managed SOC providers in India?"


def _lost(body: dict[str, Any], entity: uuid.UUID, engine: str = CHATGPT) -> dict[str, Any]:
    return entry(row_of(body, entity), engine)


def _ids(item: dict[str, Any]) -> list[str]:
    return [lost["prompt_id"] for lost in item["lost_prompts"]]


async def _lost_world(resources: Resources, migrated: PostgresServer, names: list[str]) -> Summary:
    """The own brand and the rival, ChatGPT enabled, and one prompt for each of `names`
    (`Question <name> about SOC services?`)."""
    world = await new_world(resources, migrated)
    return replace(world, prompts=await new_prompts(migrated, world, names))


async def _importance(migrated: PostgresServer, world: Summary, **by_name: int) -> None:
    for name, value in by_name.items():
        await execute(
            migrated,
            "UPDATE ai.prompts SET importance = $2 WHERE id = $1",
            world.prompts[name].id,
            value,
        )


def _rival_only(prompt: str, count: int, first_day: int = 1) -> list[Answer]:
    """`count` answers of the prompt that name the rival alone, on different days."""
    return [Answer(prompt, RIVAL_ONLY, (), first_day + n) for n in range(count)]


async def test_a_prompt_where_the_competitor_is_named_and_the_own_brand_is_not_is_lost(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    body = await competitors_body(seeded, api, **LOST)

    chatgpt = _lost(body, seeded.rival)
    (lost,) = chatgpt["lost_prompts"]
    assert lost["prompt_id"] == str(seeded.prompts["providers"].id)
    assert lost["text"] == PROVIDERS_TEXT
    assert 1 <= lost["importance"] <= 5
    # One of the five valid answers (answer 4); six answers in all, one of them a refusal.
    assert counts(lost["lost"]) == (1, 5, 6)
    assert lost["lost"]["value"] == pytest.approx(0.2)
    assert lost["lost"]["pooled"] is None
    assert (chatgpt["lost_prompts_total"], chatgpt["lost_prompts_with_min_answers"]) == (1, 1)
    # Gemini's one answer names both brands: nothing is lost there, and the block is still there.
    gemini = _lost(body, seeded.rival, GEMINI)
    assert (gemini["lost_prompts"], gemini["lost_prompts_total"]) == ([], 0)
    assert gemini["lost_prompts_with_min_answers"] == 0


async def test_a_prompt_naming_both_is_not_lost(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
) -> None:
    world = await _lost_world(resources, migrated, ["both"])
    await ingested(world, migrated, worker_db, import_store, [Answer("both", BOTH, (), 1)])

    item = _lost(await competitors_body(world, api, **LOST), world.rival)

    assert (item["lost_prompts"], item["lost_prompts_total"]) == ([], 0)
    # A refusal that names the rival is not an answer that counts: still nothing.
    await ingested(world, migrated, worker_db, import_store, [Answer("both", "CyberNX.", (), 2)])
    again = _lost(await competitors_body(world, api, **LOST), world.rival)
    assert (again["lost_prompts"], again["lost_prompts_total"]) == ([], 0)


async def test_BE_COMPETITORS_05_lost_prompts_are_the_prompts_the_summary_keeps_for_lost_to(  # noqa: N802
    api: httpx.AsyncClient,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
    seeded: Summary,
) -> None:
    """Prompts lost to a named competitor, with the rule of the summary's `lost_to:<id>`
    opportunity: for every scope and engine the two give the same prompts."""
    await ingested(
        seeded,
        migrated,
        worker_db,
        import_store,
        [
            # `misc` is lost once (answer 3 of 2); `pricing` names both brands: not lost.
            Answer("misc", RIVAL_ONLY, (RIVAL_PAGE,), 2),
            Answer("pricing", BOTH, (), 2),
        ],
    )

    for params in (
        {},
        {"filter[engine_code_in]": CHATGPT},
        {"filter[engine_code_in]": GEMINI},
        {"include_branded": "true"},
        {"compare": "previous_period"},
    ):
        body = await competitors_body(seeded, api, **LOST, **params)
        for code in body["meta"]["engine_codes"]:
            kept = await summary_data(
                seeded,
                api,
                **{
                    "filter[opportunity]": f"lost_to:{seeded.rival}",
                    "filter[engine_code_in]": code,
                    **{k: v for k, v in params.items() if k != "filter[engine_code_in]"},
                },
            )
            item = _lost(body, seeded.rival, code)
            assert sorted(_ids(item)) == sorted(row["prompt_id"] for row in kept["prompts"]), (
                params,
                code,
            )
            assert item["lost_prompts_total"] == len(kept["prompts"]), (params, code)
    body = await competitors_body(seeded, api, **LOST)
    assert sorted(_ids(_lost(body, seeded.rival))) == sorted(
        str(seeded.prompts[name].id) for name in ("providers", "misc")
    )
    # The lost answers of `misc` are the one that names the rival alone, of two valid answers.
    misc = next(
        row
        for row in _lost(body, seeded.rival)["lost_prompts"]
        if row["prompt_id"] == str(seeded.prompts["misc"].id)
    )
    assert counts(misc["lost"]) == (1, 2, 2)


async def test_lost_prompts_are_sorted_by_importance_then_lost_answers_then_text(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
) -> None:
    """`b_tie` is created before `a_tie`, so only the text (and not the order of creation or the
    id) puts `a_tie` first: the prompts' own order is not the one asked for."""
    world = await _lost_world(resources, migrated, ["imp", "many", "b_tie", "a_tie"])
    await _importance(migrated, world, imp=5, many=3, b_tie=3, a_tie=3)
    await ingested(
        world,
        migrated,
        worker_db,
        import_store,
        [
            *_rival_only("imp", 1),
            *_rival_only("many", 3),
            Answer("many", NEITHER, (), 5),
            *_rival_only("b_tie", 2),
            *_rival_only("a_tie", 2),
        ],
    )

    item = _lost(await competitors_body(world, api, **LOST), world.rival)

    # Importance 5 first whatever its lost answers; then 3 lost answers, then the two ties by text.
    expected = [world.prompts[name].id for name in ("imp", "many", "a_tie", "b_tie")]
    assert _ids(item) == [str(prompt) for prompt in expected]
    assert [lost["importance"] for lost in item["lost_prompts"]] == [5, 3, 3, 3]
    assert [counts(lost["lost"]) for lost in item["lost_prompts"]] == [
        (1, 1, 1),
        (3, 4, 4),
        (2, 2, 2),
        (2, 2, 2),
    ]
    assert item["lost_prompts_total"] == 4
    assert [lost["text"] for lost in item["lost_prompts"]][2:] == [
        "Question a_tie about SOC services?",
        "Question b_tie about SOC services?",
    ]


async def test_lost_limit_caps_each_entity_and_engine(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
) -> None:
    """Rival: lost on `a` and `b` (ChatGPT) and on `c` (Gemini); a second competitor, named with
    it on `a` and `b`. A cap of 1 leaves one row for each entity and engine, and the totals are the
    uncapped numbers."""
    world = await _lost_world(resources, migrated, ["a", "b", "c"])
    alpha = await _entity(migrated, world.project, "Alpha Corp", "alpha.example", "competitor")
    await enable_engine(migrated, world.project, GEMINI)
    both = f"{RIVAL_NAME} and Alpha Corp both run managed SOC services in India today."
    await ingested(
        world,
        migrated,
        worker_db,
        import_store,
        [Answer("a", both, (), 1), Answer("b", both, (), 2), Answer("c", RIVAL_ONLY, (), 3)],
    )
    # The answers of `c` were given by Gemini (the world has one fixture answer of its own).
    await execute(
        migrated,
        "UPDATE ai.observation_facts SET engine_code = $3 WHERE project_id = $1 AND prompt_id = $2",
        world.project.id,
        world.prompts["c"].id,
        GEMINI,
    )

    full = await competitors_body(world, api, **LOST)
    capped = await competitors_body(world, api, lost_limit=1, **LOST)

    for entity, chatgpt, gemini in ((world.rival, 2, 1), (alpha, 2, 0)):
        for code, total in ((CHATGPT, chatgpt), (GEMINI, gemini)):
            assert len(_lost(full, entity, code)["lost_prompts"]) == total, (entity, code)
            item = _lost(capped, entity, code)
            assert len(item["lost_prompts"]) == min(1, total), (entity, code)
            assert item["lost_prompts_total"] == total, (entity, code)
    # The default is 5, and the limit is at least 1.
    assert len(_lost(await competitors_body(world, api, **LOST), world.rival)["lost_prompts"]) == 2
    assert problem(await get_competitors(world, api, lost_limit=0, **LOST)) == (
        422,
        "validation_failed",
    )


async def test_a_refusal_is_not_a_lost_answer(
    api: httpx.AsyncClient,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
    seeded: Summary,
) -> None:
    """A short answer that names the rival is a refusal (under 40 characters): one more answer on
    `pricing`, not a valid one, and not a lost one."""
    await ingested(
        seeded, migrated, worker_db, import_store, [Answer("pricing", "CyberNX only.", (), 1)]
    )

    body = await competitors_body(seeded, api, **LOST)

    pricing = prompt_row(await summary_data(seeded, api), seeded, "pricing")["engines"][0]
    # Two answers on the prompt, one of them valid: the refusal is counted, and is not a lost one.
    assert counts(pricing["mentioned"]) == (0, 1, 2)
    item = _lost(body, seeded.rival)
    assert _ids(item) == [str(seeded.prompts["providers"].id)]
    assert counts(item["lost_prompts"][0]["lost"]) == (1, 5, 6)
    assert item["lost_prompts_total"] == 1


async def test_prompts_with_at_least_four_valid_answers_are_counted_beside_the_total(
    api: httpx.AsyncClient,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
    seeded: Summary,
) -> None:
    """`pricing` has one valid answer; two more and a refusal make four answers and three valid
    ones, which is not enough; the fourth valid one is."""

    async def at_least_four() -> tuple[int, int]:
        body = await competitors_body(seeded, api, **LOST)
        return (
            _lost(body, seeded.rival)["lost_prompts_with_min_answers"],
            _lost(body, seeded.rival)["lost_prompts_total"],
        )

    assert await at_least_four() == (1, 1)
    await ingested(
        seeded,
        migrated,
        worker_db,
        import_store,
        [
            Answer("pricing", NEITHER, (), 3),
            Answer("pricing", NEITHER, (), 4),
            Answer("pricing", REFUSAL, (), 5),
        ],
    )
    assert await at_least_four() == (1, 1)
    await ingested(seeded, migrated, worker_db, import_store, [Answer("pricing", NEITHER, (), 6)])
    assert await at_least_four() == (2, 1)
    # The same number for every competitor of an engine, and none on the other engine.
    body = await competitors_body(seeded, api, **LOST)
    assert _lost(body, seeded.rival, GEMINI)["lost_prompts_with_min_answers"] == 0


async def test_the_own_entity_has_no_lost_prompts(api: httpx.AsyncClient, seeded: Summary) -> None:
    body = await competitors_body(seeded, api, **LOST)

    for item in row_of(body, seeded.own)["by_engine"]:
        for key in LOST_KEYS:
            assert key not in item, key


async def test_lost_prompts_follow_branded_term_country_and_engine_scope(
    api: httpx.AsyncClient,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
    seeded: Summary,
) -> None:
    """The branded prompt and `misc` (no topic) are lost to the rival too. Managed SOC (the prompts
    `providers` and `pricing`) is put under a new term Security."""
    await ingested(
        seeded,
        migrated,
        worker_db,
        import_store,
        [Answer("brand", RIVAL_ONLY, (), 1), Answer("misc", RIVAL_ONLY, (), 2)],
    )
    soc = seeded.topics["soc"]
    parent = await fetchrow(
        migrated,
        "INSERT INTO core.taxonomy_terms (workspace_id, vocabulary_id, name, slug, path) "
        "SELECT workspace_id, vocabulary_id, 'Security', 'security', 'security' "
        "FROM core.taxonomy_terms WHERE id = $1 RETURNING id",
        soc,
    )
    await execute(
        migrated,
        "UPDATE core.taxonomy_terms SET parent_id = $2, path = 'security/managed-soc' "
        "WHERE id = $1",
        soc,
        parent["id"],
    )

    def prompts(body: dict[str, Any]) -> set[str]:
        return {
            name
            for name, prompt in seeded.prompts.items()
            if str(prompt.id) in _ids(_lost(body, seeded.rival))
        }

    default = await competitors_body(seeded, api, **LOST)
    branded = await competitors_body(seeded, api, include_branded="true", **LOST)
    only = await competitors_body(seeded, api, branded_only="true", **LOST)
    assert prompts(default) == {"providers", "misc"}
    assert prompts(branded) == {"providers", "misc", "brand"}
    assert prompts(only) == {"brand"}
    for term in (soc, parent["id"]):
        under = await competitors_body(seeded, api, **{"filter[term]": str(term)}, **LOST)
        # `misc` has no topic: out of the term's subtree, and so are its answers in the totals.
        assert prompts(under) == {"providers"}, term
        assert _lost(under, seeded.rival)["lost_prompts_total"] == 1, term
    await execute(
        migrated,
        "UPDATE ai.prompts SET country_iso = 'IN' WHERE id = $1",
        seeded.prompts["providers"].id,
    )
    india = await competitors_body(seeded, api, **{"filter[country_iso]": "IN"}, **LOST)
    france = await competitors_body(seeded, api, **{"filter[country_iso]": "FR"}, **LOST)
    gemini = await competitors_body(seeded, api, **{"filter[engine_code_in]": GEMINI}, **LOST)
    assert prompts(india) == {"providers"}
    assert _lost(france, seeded.rival)["lost_prompts"] == []
    assert [item["engine_code"] for item in gemini["data"][1]["by_engine"]] == [GEMINI]
    assert gemini["data"][1]["by_engine"][0]["lost_prompts"] == []


async def test_lost_prompts_are_absent_unless_asked(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    for params in ({}, {"include": "top_sources"}, {"lost_limit": 3}):
        body = await competitors_body(seeded, api, **params)

        for row in body["data"]:
            for item in row["by_engine"]:
                for key in LOST_KEYS:
                    assert key not in item, (params, key)
    asked = await competitors_body(seeded, api, **LOST)
    assert all("top_sources" not in row for row in asked["data"])


async def test_another_projects_lost_answers_are_not_counted(
    api: httpx.AsyncClient,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
    seeded: Summary,
) -> None:
    """A second project of the workspace and a second workspace each answer today; their facts are
    made to name the rival and not the own brand."""
    before = await get_competitors(seeded, api, include_branded="true", **LOST)
    other_workspace = await make_workspace(migrated)
    for number, workspace_id in enumerate((seeded.workspace.id, other_workspace.id)):
        await answer_in_another_project(
            migrated, worker_db, import_store, workspace_id, f"Otherco{number}", 1
        )
    await ingest(worker_db, import_store)
    await execute(
        migrated,
        "UPDATE ai.observation_facts SET own_mentioned = false, "
        "competitor_mentions = ARRAY[$2]::uuid[] WHERE project_id <> $1",
        seeded.project.id,
        seeded.rival,
    )
    spoofed = await fetchrow(
        migrated,
        "SELECT count(*) AS n FROM ai.observation_facts WHERE $1 = ANY(competitor_mentions) "
        "AND project_id <> $2",
        seeded.rival,
        seeded.project.id,
    )
    assert spoofed["n"] >= 2

    after = await get_competitors(seeded, api, include_branded="true", **LOST)

    assert after.json() == before.json()


async def test_a_prompt_card_names_the_current_text_and_importance(
    api: httpx.AsyncClient, migrated: PostgresServer, seeded: Summary
) -> None:
    await _importance(migrated, seeded, providers=1)

    (lost,) = _lost(await competitors_body(seeded, api, **LOST), seeded.rival)["lost_prompts"]

    current = await fetchrow(
        migrated,
        "SELECT v.text, p.importance FROM ai.prompts p "
        "JOIN ai.prompt_versions v ON v.id = p.current_version_id WHERE p.id = $1",
        seeded.prompts["providers"].id,
    )
    assert (lost["text"], lost["importance"]) == (current["text"], 1) == (PROVIDERS_TEXT, 1)


async def test_a_deleted_project_is_not_found_with_lost_prompts(
    api: httpx.AsyncClient, migrated: PostgresServer, seeded: Summary
) -> None:
    await execute(
        migrated, "UPDATE core.projects SET deleted_at = now() WHERE id = $1", seeded.project.id
    )

    assert problem(await get_competitors(seeded, api, **LOST)) == (404, "not_found")


async def test_the_lost_prompts_read_stays_in_the_project(
    resources: Resources, migrated: PostgresServer, seeded: Summary
) -> None:
    """The statement itself, over the ids of this project's prompts: given another project's id
    (or another workspace's) it reads nothing, whatever the prompts it is asked for."""
    other_project = await make_project(migrated, seeded.workspace.id)
    now = datetime.now(UTC)

    def scope(workspace_id: uuid.UUID, project_id: uuid.UUID) -> SourceScope:
        return SourceScope(
            workspace_id=workspace_id,
            project_id=project_id,
            since=now - timedelta(days=28),
            until=now + timedelta(days=1),
            engine_codes=(CHATGPT, GEMINI),
            prompt_ids=tuple(prompt.id for prompt in seeded.prompts.values()),
        )

    async with workspace_transaction(resources.sessions, seeded.workspace.id) as db:
        own = await competitor_repository.lost_counts(
            db, scope(seeded.workspace.id, seeded.project.id), [seeded.rival]
        )
        elsewhere = await competitor_repository.lost_counts(
            db, scope(seeded.workspace.id, other_project), [seeded.rival]
        )
        foreign = await competitor_repository.lost_counts(
            db, scope(uuid.uuid4(), seeded.project.id), [seeded.rival]
        )

    assert {key[:2] for key in own} == {
        (seeded.prompts["providers"].id, CHATGPT),
    }
    assert elsewhere == {}
    assert foreign == {}
