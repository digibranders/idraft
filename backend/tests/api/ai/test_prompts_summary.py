"""The prompts summary (spec section 4.5; docs/16 sections 3 to 5): per prompt, engine and topic
over a window, Mentioned, Cited, the four outcomes and Share of voice, each as counts of valid,
current answers. The expected numbers are worked out by hand from the answers seeded below."""

from __future__ import annotations

import hashlib
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime, timedelta
from typing import Any

import httpx
import pytest
from sqlalchemy import event

from idraft.api.resources import Resources
from idraft.collectors.ai_prompt_ingest import ingest
from tests.api.auth.support import Workspace, execute, fetch, fetchrow, make_workspace
from tests.api.entities.support import Caller, member, problem
from tests.api.keywords.support import ensure_locations, project_url
from tests.api.keywords.test_tracked_keyword_ranks import Ledger, worker_db
from tests.api.workspaces.support import make_project
from tests.collectors.ai_support import (
    OWN_HOST,
    OWN_NAME,
    RIVAL_HOST,
    RIVAL_NAME,
    Prompt,
    add_prompt,
    at_now,
    chatgpt_answer,
    enable_engine,
    fetched_ai_task,
)
from tests.collectors.rank_support import _entity
from tests.collectors.support import Project
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer
from tests.providers.dataforseo.support import FIXTURES

__all__ = ["worker_db"]

OWN_PAGE = f"https://{OWN_HOST}/managed-soc"
RIVAL_PAGE = f"https://{RIVAL_HOST}/soc"
OTHER_PAGE = "https://news.example/soc-guide"
# Long enough not to read as refusals.
BOTH = f"{OWN_NAME} and {RIVAL_NAME} both run managed SOC services in India today."
OWN_ONLY = f"{OWN_NAME} runs a managed SOC service in Mumbai with 24x7 monitoring."
RIVAL_ONLY = f"{RIVAL_NAME} runs a managed SOC service in Mumbai with 24x7 monitoring."
NEITHER = "Several firms run managed SOC services in India with 24x7 monitoring."
REFUSAL = "I'm sorry, but I can't help with that one."
CHATGPT = "chatgpt_web"
GEMINI = "gemini_web"
ENGINES = ("chatgpt_web", "gemini_web", "google_ai_mode")
OUTCOMES = ("mentioned_and_cited", "mentioned_only", "cited_only", "neither")


@dataclass(frozen=True)
class Summary:
    workspace: Workspace
    project: Project
    owner: Caller
    prompts: dict[str, Prompt]
    topics: dict[str, uuid.UUID]
    own: uuid.UUID
    rival: uuid.UUID


async def _topic(pg: PostgresServer, project: Project, name: str) -> uuid.UUID:
    vocabulary = await fetchrow(
        pg,
        "INSERT INTO core.taxonomy_vocabularies (workspace_id, project_id, kind, name) "
        "VALUES ($1, $2, 'topic', $3) RETURNING id",
        project.workspace_id,
        project.id,
        f"Topics {uuid.uuid4().hex[:6]}",
    )
    term = await fetchrow(
        pg,
        "INSERT INTO core.taxonomy_terms (workspace_id, vocabulary_id, name, slug, path) "
        "VALUES ($1, $2, $3::text, $4::text, $4::text) RETURNING id",
        project.workspace_id,
        vocabulary["id"],
        name,
        name.lower().replace(" ", "-"),
    )
    term_id: uuid.UUID = term["id"]
    return term_id


async def _observation_of(pg: PostgresServer, task_id: int) -> int:
    row = await fetchrow(
        pg, "SELECT id FROM ai.observations WHERE collection_task_id = $1", task_id
    )
    observation_id: int = row["id"]
    return observation_id


@pytest.fixture
async def summary(
    resources: Resources,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
) -> Summary:
    """Six prompts, ChatGPT answers (days before now in brackets) and one Gemini answer.

    `providers` (topics Managed SOC and Compliance), ChatGPT:
      1  (1) both brands named, an outside page cited         valid  mentioned only   tracked 2
      2  (4) own brand named, own page cited                  valid  mentioned+cited  tracked 1
      3  (8) nobody named, an outside page cited              valid  neither          tracked 0
      4  (9) rival named, rival page cited                    valid  neither          tracked 1
      5 (10) nobody named, own page cited                     valid  cited only       tracked 0
      6 (11) a refusal                                        not valid
      7  (5) like 2, but superseded by a newer answer         left out
      8  (6) like 2, but its facts are no longer current      left out
      9 (28) like 2, a day before the window opens            left out
    `providers`, Gemini: 1 (2) the captured answer: both brands named, own page cited.
    `pricing` (Managed SOC), ChatGPT: 1 (2) nobody named, rival page cited.
    `misc` (no topic), ChatGPT: 1 (3) own brand named, own page cited.
    `brand` (branded, no topic), ChatGPT: 1 (3) own brand named, nothing cited.
    `archived` (not active, Managed SOC), ChatGPT: 1 (3) own brand named, own page cited."""
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    await ensure_locations(migrated)
    project = Project(workspace.id, await make_project(migrated, workspace.id))
    own = await _entity(migrated, project, OWN_NAME, OWN_HOST, "own", primary=True)
    rival = await _entity(migrated, project, RIVAL_NAME, RIVAL_HOST, "competitor")
    await enable_engine(migrated, project, CHATGPT)
    await enable_engine(migrated, project, GEMINI)
    prompts = {
        "providers": await add_prompt(migrated, project, "Best managed SOC providers in India?"),
        "pricing": await add_prompt(migrated, project, "How much does a managed SOC cost?"),
        "misc": await add_prompt(migrated, project, "Who offers SOC services in Pune?"),
        "brand": await add_prompt(
            migrated, project, "Is Eventus Security a good SOC provider?", branded=True
        ),
        "archived": await add_prompt(migrated, project, "An old SOC question?", active=False),
    }
    topics = {
        "soc": await _topic(migrated, project, "Managed SOC"),
        "compliance": await _topic(migrated, project, "Compliance"),
    }
    for prompt, topic in (
        ("providers", "soc"),
        ("providers", "compliance"),
        ("pricing", "soc"),
        ("archived", "soc"),
    ):
        await execute(
            migrated,
            "INSERT INTO ai.prompt_terms (prompt_id, term_id, workspace_id) VALUES ($1, $2, $3)",
            prompts[prompt].id,
            topics[topic],
            project.workspace_id,
        )
    now = datetime.now(UTC).replace(microsecond=0)

    def ago(days: int) -> datetime:
        return now - timedelta(days=days)

    def chat(
        prompt: str, text: str, urls: list[str], days: int
    ) -> tuple[str, bytes, str, datetime]:
        return prompt, chatgpt_answer(text, urls, when=ago(days)), CHATGPT, ago(days)

    # Each answer is fetched when it was given: a provider time more than a week before the
    # fetch is not believed, and the answer would be dated by the fetch (R19).
    answers: dict[str, tuple[str, bytes, str, datetime]] = {
        "p1": chat("providers", BOTH, [OTHER_PAGE], 1),
        "p2": chat("providers", OWN_ONLY, [OWN_PAGE], 4),
        "p3": chat("providers", NEITHER, [OTHER_PAGE], 8),
        "p4": chat("providers", RIVAL_ONLY, [RIVAL_PAGE], 9),
        "p5": chat("providers", NEITHER, [OWN_PAGE], 10),
        "p6": chat("providers", REFUSAL, [], 11),
        "p7": chat("providers", OWN_ONLY, [OWN_PAGE], 5),
        "p8": chat("providers", OWN_ONLY, [OWN_PAGE], 6),
        # The partitions reach one month back only, so the day before the window is 28 days.
        "p9": chat("providers", OWN_ONLY, [OWN_PAGE], 28),
        "g1": (
            "providers",
            at_now(FIXTURES / "captured" / "gemini_scraper_answer.json", ago(2)),
            GEMINI,
            ago(2),
        ),
        "r1": chat("pricing", NEITHER, [RIVAL_PAGE], 2),
        "m1": chat("misc", OWN_ONLY, [OWN_PAGE], 3),
        "b1": chat("brand", OWN_ONLY, [], 3),
        "a1": chat("archived", OWN_ONLY, [OWN_PAGE], 3),
    }
    tasks = {
        name: await fetched_ai_task(
            worker_db,
            migrated,
            project,
            prompts[prompt],
            body,
            import_store,
            engine_code=engine,
            fetched_at=when,
        )
        for name, (prompt, body, engine, when) in answers.items()
    }
    await ingest(worker_db, import_store)
    superseded = await _observation_of(migrated, tasks["p7"])
    await execute(
        migrated,
        "UPDATE ai.observations SET superseded_by = $2 WHERE id = $1",
        superseded,
        await _observation_of(migrated, tasks["p2"]),
    )
    await execute(
        migrated,
        "UPDATE ai.observation_facts SET is_current = false WHERE observation_id = $1",
        await _observation_of(migrated, tasks["p8"]),
    )
    return Summary(workspace, project, owner, prompts, topics, own, rival)


async def _summary(world: Summary, api: httpx.AsyncClient, **params: Any) -> httpx.Response:
    return await api.get(
        project_url(world.workspace, world.project.id, "ai", "prompts-summary"),
        params=params,
        headers=world.owner.headers,
    )


def _cell(cell: dict[str, Any]) -> tuple[Any, Any, Any]:
    return cell["numerator"], cell["denominator"], cell["n_observations"]


def _pooled(cell: dict[str, Any]) -> tuple[Any, Any]:
    return cell["pooled"]["successes"], cell["pooled"]["trials"]


def _outcomes(engine: dict[str, Any]) -> list[Any]:
    return [engine["outcomes"][name]["numerator"] for name in OUTCOMES]


def _by(rows: list[dict[str, Any]], key: str) -> dict[Any, dict[str, Any]]:
    return {row[key]: row for row in rows}


async def test_each_prompt_has_its_counts_per_engine(
    api: httpx.AsyncClient, summary: Summary
) -> None:
    response = await _summary(summary, api)

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["engine_codes"] == [CHATGPT, GEMINI]
    assert data["include_branded"] is False
    rows = _by(data["prompts"], "prompt_id")
    # The branded prompt is left out unless asked for, and the archived one never shown.
    assert set(rows) == {str(summary.prompts[name].id) for name in ("providers", "pricing", "misc")}
    providers = rows[str(summary.prompts["providers"].id)]
    assert providers["topic_term_ids"] == sorted(
        str(summary.topics[name]) for name in ("soc", "compliance")
    )
    chatgpt, gemini = providers["engines"]
    assert (chatgpt["engine_code"], gemini["engine_code"]) == (CHATGPT, GEMINI)
    # Answers 1 to 6 count: five are valid (the refusal is not) and nothing else is current.
    assert _cell(chatgpt["mentioned"]) == (2, 5, 6)
    assert chatgpt["mentioned"]["value"] == pytest.approx(2 / 5)
    assert _cell(chatgpt["cited"]) == (2, 5, 6)
    assert _outcomes(chatgpt) == [1, 1, 1, 2]
    for name in OUTCOMES:
        assert chatgpt["outcomes"][name]["denominator"] == 5
    # Three answers name a tracked entity (1, 2 and 4): 1/2 + 1/1 + 0 over 3.
    assert _cell(chatgpt["share_of_voice"]) == (1.5, 3, 6)
    assert chatgpt["share_of_voice"]["value"] == pytest.approx(0.5)
    # One Gemini answer: both brands named, own page cited.
    assert _cell(gemini["mentioned"]) == (1, 1, 1)
    assert _cell(gemini["cited"]) == (1, 1, 1)
    assert _outcomes(gemini) == [1, 0, 0, 0]
    assert _cell(gemini["share_of_voice"]) == (0.5, 1, 1)
    # Nothing was asked on Gemini for pricing: counts of zero and no value, not a zero rate.
    pricing_chatgpt, pricing_gemini = rows[str(summary.prompts["pricing"].id)]["engines"]
    assert _cell(pricing_gemini["mentioned"]) == (0, 0, 0)
    assert pricing_gemini["mentioned"]["value"] is None
    assert pricing_gemini["share_of_voice"]["value"] is None
    # One answer that names nobody: it counts as a valid answer, and not for Share of voice.
    assert _cell(pricing_chatgpt["mentioned"]) == (0, 1, 1)
    assert pricing_chatgpt["mentioned"]["value"] == 0
    assert _outcomes(pricing_chatgpt) == [0, 0, 0, 1]
    assert _cell(pricing_chatgpt["share_of_voice"]) == (0, 0, 1)
    assert pricing_chatgpt["share_of_voice"]["value"] is None


async def test_the_outcomes_add_up_to_the_valid_answers(
    api: httpx.AsyncClient, summary: Summary
) -> None:
    response = await _summary(summary, api, include_branded="true")

    data = response.json()["data"]
    for row in [*data["prompts"], *data["topics"]]:
        for engine in row["engines"]:
            assert sum(_outcomes(engine)) == engine["mentioned"]["denominator"]


async def test_the_response_states_its_window_and_entity_set_once(
    api: httpx.AsyncClient, summary: Summary
) -> None:
    response = await _summary(summary, api)

    data = response.json()["data"]
    today = datetime.now(UTC).date()
    assert data["window"]["to"] == today.isoformat()
    assert data["window"]["from"] == (today - timedelta(days=27)).isoformat()
    assert {(entity["entity_id"], entity["role"]) for entity in data["entities"]} == {
        (str(summary.own), "own"),
        (str(summary.rival), "competitor"),
    }
    assert data["entity_config_versions"] == [1]
    # A cell is compact: no window, filters or method repeated.
    cell = data["prompts"][0]["engines"][0]["mentioned"]
    assert set(cell) == {"value", "numerator", "denominator", "n_observations", "pooled"}
    # How each metric is aggregated is stated once, for the prompt rows and for the topic rows.
    context = data["metric_context"]
    assert set(context) == {"mentioned", "cited", "outcomes", "share_of_voice"}
    assert {name: entry["prompt_rows"] for name, entry in context.items()} == dict.fromkeys(
        context, "observation_weighted"
    )
    assert {name: entry["topic_rows"] for name, entry in context.items()} == {
        "mentioned": "prompt_weighted",
        "cited": "prompt_weighted",
        "outcomes": "prompt_weighted",
        "share_of_voice": "observation_weighted",
    }
    assert context["mentioned"]["metric"] == "ai.mention_rate"
    assert "prompt" in context["mentioned"]["method"]


async def test_topics_count_a_prompt_in_each_of_its_topics(
    api: httpx.AsyncClient, summary: Summary
) -> None:
    response = await _summary(summary, api)

    topics = response.json()["data"]["topics"]
    assert [(topic["name"], topic["prompt_count"]) for topic in topics] == [
        ("Compliance", 1),
        ("Managed SOC", 2),
        (None, 1),
    ]
    compliance, soc, untopiced = topics
    assert compliance["term_id"] == str(summary.topics["compliance"])
    assert untopiced["term_id"] is None
    # Compliance holds `providers` alone; Managed SOC holds it with `pricing`, so the answers of
    # `providers` are in both rows and the topics do not add up to anything. A topic rate counts
    # each prompt once: `providers` is 2 of 5 valid answers, `pricing` 0 of 1.
    assert _cell(compliance["engines"][0]["mentioned"]) == (pytest.approx(0.4), 1, 6)
    assert _cell(soc["engines"][0]["mentioned"]) == (pytest.approx(0.4), 2, 7)
    assert soc["engines"][0]["mentioned"]["value"] == pytest.approx(0.2)
    assert _pooled(soc["engines"][0]["mentioned"]) == (2, 6)
    assert _cell(soc["engines"][0]["cited"]) == (pytest.approx(0.4), 2, 7)
    assert _pooled(soc["engines"][0]["cited"]) == (2, 6)
    # The four shares of each prompt add to 1, so the topic's add to its prompts: 2.
    assert _outcomes(soc["engines"][0]) == pytest.approx([0.2, 0.2, 0.2, 1.4])
    assert _pooled(soc["engines"][0]["outcomes"]["neither"]) == (3, 6)
    # Share of voice stays one answer, one weight: 1/2 + 1 + 0 over the 3 answers naming a brand.
    assert _cell(soc["engines"][0]["share_of_voice"]) == (1.5, 3, 7)
    assert soc["engines"][0]["share_of_voice"]["pooled"] is None
    # Only `providers` was asked on Gemini: `pricing` has no valid answer and is not in the count.
    assert _cell(soc["engines"][1]["mentioned"]) == (1, 1, 1)
    assert _pooled(soc["engines"][1]["mentioned"]) == (1, 1)
    # `misc` alone, own named and cited: the archived prompt of the same topic is not in it.
    assert _cell(untopiced["engines"][0]["mentioned"]) == (1, 1, 1)
    assert _outcomes(untopiced["engines"][0]) == [1, 0, 0, 0]
    # A prompt row is plain counts, with no pooled counts behind it.
    assert (
        _by(response.json()["data"]["prompts"], "prompt_id")[str(summary.prompts["misc"].id)][
            "engines"
        ][0]["mentioned"]["pooled"]
        is None
    )


async def test_branded_prompts_count_when_asked_for(
    api: httpx.AsyncClient, summary: Summary
) -> None:
    response = await _summary(summary, api, include_branded="true")

    data = response.json()["data"]
    assert data["include_branded"] is True
    rows = _by(data["prompts"], "prompt_id")
    brand = rows[str(summary.prompts["brand"].id)]
    assert brand["is_branded"] is True
    assert _cell(brand["engines"][0]["mentioned"]) == (1, 1, 1)
    assert _outcomes(brand["engines"][0]) == [0, 1, 0, 0]
    # The row without a topic now holds `misc` and `brand`: two answers, both naming the own
    # brand, one citing its page; each names one tracked entity, itself.
    untopiced = data["topics"][-1]
    assert (untopiced["term_id"], untopiced["prompt_count"]) == (None, 2)
    chatgpt = untopiced["engines"][0]
    assert _cell(chatgpt["mentioned"]) == (2, 2, 2)
    assert _cell(chatgpt["cited"]) == (1, 2, 2)
    assert _cell(chatgpt["share_of_voice"]) == (2, 2, 2)


async def test_an_engine_filter_narrows_the_engines(
    api: httpx.AsyncClient, summary: Summary
) -> None:
    response = await _summary(summary, api, **{"filter[engine_code_in]": GEMINI})

    data = response.json()["data"]
    assert data["engine_codes"] == [GEMINI]
    soc = _by(data["topics"], "name")["Managed SOC"]
    assert [engine["engine_code"] for engine in soc["engines"]] == [GEMINI]
    assert _cell(soc["engines"][0]["mentioned"]) == (1, 1, 1)


async def test_the_window_is_the_projects_days(api: httpx.AsyncClient, summary: Summary) -> None:
    today = datetime.now(UTC).date()

    wide = await _summary(
        summary,
        api,
        **{"from": (today - timedelta(days=60)).isoformat(), "to": today.isoformat()},
    )
    one_day = await _summary(summary, api, **{"from": today.isoformat(), "to": today.isoformat()})
    too_wide = await _summary(summary, api, **{"from": "2026-01-01", "to": "2026-06-30"})
    reversed_window = await _summary(
        summary, api, **{"from": today.isoformat(), "to": "2026-01-01"}
    )
    far = await _summary(summary, api, **{"to": date.max.isoformat()})

    # The day before the default window opens is in a wider one: answer 9 is valid and counts.
    providers = _by(wide.json()["data"]["prompts"], "prompt_id")[
        str(summary.prompts["providers"].id)
    ]
    assert _cell(providers["engines"][0]["mentioned"]) == (3, 6, 7)
    assert wide.json()["data"]["window"]["from"] == (today - timedelta(days=60)).isoformat()
    # Nothing was answered today.
    assert one_day.status_code == 200
    assert _cell(one_day.json()["data"]["prompts"][0]["engines"][0]["mentioned"]) == (0, 0, 0)
    assert problem(too_wide) == (422, "window_too_large")
    assert problem(reversed_window) == (422, "validation_failed")
    assert problem(far) == (422, "validation_failed")


async def test_an_answer_after_the_window_is_left_out(
    api: httpx.AsyncClient, summary: Summary
) -> None:
    today = datetime.now(UTC).date()

    response = await _summary(
        summary,
        api,
        **{
            "from": (today - timedelta(days=30)).isoformat(),
            "to": (today - timedelta(days=5)).isoformat(),
        },
    )

    # Of `providers`, only answers 3, 4, 5, 6 and 9 are 5 or more days old (7 and 8 are not
    # counted): 3 and 4 name nobody and the rival, 5 cites the own page, 6 is a refusal and 9
    # names and cites the own brand. Answers 1 and 2, after `to`, would make it 3 of 5.
    providers = _by(response.json()["data"]["prompts"], "prompt_id")[
        str(summary.prompts["providers"].id)
    ]
    chatgpt = providers["engines"][0]
    assert _cell(chatgpt["mentioned"]) == (1, 4, 5)
    assert _cell(chatgpt["cited"]) == (2, 4, 5)


@dataclass(frozen=True)
class Answer:
    prompt: str
    text: str
    urls: tuple[str, ...]
    days: int
    engine: str = CHATGPT


async def _ingested(
    world: Summary,
    migrated: PostgresServer,
    worker_db: Ledger,
    store: MemoryStore,
    answers: list[Answer],
) -> None:
    """The answers fetched when they were given (see the `summary` fixture), then ingested."""
    now = datetime.now(UTC).replace(microsecond=0)
    for answer in answers:
        when = now - timedelta(days=answer.days)
        await fetched_ai_task(
            worker_db,
            migrated,
            world.project,
            world.prompts[answer.prompt],
            chatgpt_answer(answer.text, list(answer.urls), when=when),
            store,
            engine_code=answer.engine,
            fetched_at=when,
        )
    await ingest(worker_db, store)


async def _world(resources: Resources, migrated: PostgresServer) -> Summary:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    await ensure_locations(migrated)
    project = Project(workspace.id, await make_project(migrated, workspace.id))
    own = await _entity(migrated, project, OWN_NAME, OWN_HOST, "own", primary=True)
    rival = await _entity(migrated, project, RIVAL_NAME, RIVAL_HOST, "competitor")
    await enable_engine(migrated, project, CHATGPT)
    return Summary(workspace, project, owner, {}, {}, own, rival)


async def _prompts(migrated: PostgresServer, world: Summary, names: list[str]) -> dict[str, Prompt]:
    return {
        name: await add_prompt(migrated, world.project, f"Question {name} about SOC services?")
        for name in names
    }


async def _assign(migrated: PostgresServer, world: Summary, prompt: str, term: uuid.UUID) -> None:
    await execute(
        migrated,
        "INSERT INTO ai.prompt_terms (prompt_id, term_id, workspace_id) VALUES ($1, $2, $3)",
        world.prompts[prompt].id,
        term,
        world.workspace.id,
    )


async def test_a_topic_rate_counts_each_prompt_once(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
) -> None:
    """Prompt A has 1 mention in 4 valid answers and prompt B 1 in 1: pooled that is 2 of 5
    (0.4), prompt weighted (1/4 + 1/1) / 2 = 0.625 (docs/16 section 3, docs/17 section 4.1).
    Prompt C has only a refusal: it has no rate, so it is not one of the prompts."""
    world = await _world(resources, migrated)
    prompts = await _prompts(migrated, world, ["a", "b", "c", "d", "e"])
    world = replace(world, prompts=prompts)
    topic = await _topic(migrated, world.project, "Managed SOC")
    for name in ("a", "b", "c"):
        await _assign(migrated, world, name, topic)
    await _ingested(
        world,
        migrated,
        worker_db,
        import_store,
        [
            Answer("a", OWN_ONLY, (OWN_PAGE,), 1),
            Answer("a", NEITHER, (OWN_PAGE,), 2),
            Answer("a", RIVAL_ONLY, (), 3),
            Answer("a", NEITHER, (), 4),
            Answer("b", OWN_ONLY, (), 1),
            Answer("c", REFUSAL, (), 1),
            Answer("d", OWN_ONLY, (), 1),
            Answer("d", NEITHER, (), 2),
            Answer("e", OWN_ONLY, (), 1),
        ],
    )

    response = await _summary(world, api)

    data = response.json()["data"]
    rows = _by(data["prompts"], "prompt_id")
    a = rows[str(prompts["a"].id)]["engines"][0]
    assert _cell(a["mentioned"]) == (1, 4, 4)
    topic_row, untopiced = data["topics"]
    engine = topic_row["engines"][0]
    assert topic_row["prompt_count"] == 3
    # Mentioned: A 1/4 and B 1/1 over the two prompts with a valid answer; C is out of the
    # denominator, but its answer is one of the six of the cell.
    assert _cell(engine["mentioned"]) == (1.25, 2, 6)
    assert engine["mentioned"]["value"] == pytest.approx(0.625)
    assert _pooled(engine["mentioned"]) == (2, 5)
    # Cited: A 2/4 (two answers cite the own page), B 0/1.
    assert _cell(engine["cited"]) == (0.5, 2, 6)
    assert engine["cited"]["value"] == pytest.approx(0.25)
    assert _pooled(engine["cited"]) == (2, 5)
    # Outcome shares: A is 1/4 mentioned and cited, 0 mentioned only, 1/4 cited only, 2/4
    # neither; B is all mentioned only. Each prompt adds to 1, so the topic adds to 2.
    assert _outcomes(engine) == pytest.approx([0.25, 1, 0.25, 0.5])
    assert sum(_outcomes(engine)) == pytest.approx(engine["mentioned"]["denominator"])
    assert [_pooled(engine["outcomes"][name]) for name in OUTCOMES] == [
        (1, 5),
        (1, 5),
        (1, 5),
        (2, 5),
    ]
    # Share of voice is one answer, one weight: A's first answer (own alone) is 1, its third
    # (the rival alone) 0, B's 1; two of three answers that name a brand are the own brand's.
    assert _cell(engine["share_of_voice"]) == (2, 3, 6)
    # Without a topic: D is 1/2, E 1/1, so 0.75 where pooled would say 2 of 3.
    engine = untopiced["engines"][0]
    assert (untopiced["term_id"], untopiced["prompt_count"]) == (None, 2)
    assert _cell(engine["mentioned"]) == (1.5, 2, 3)
    assert engine["mentioned"]["value"] == pytest.approx(0.75)
    assert _pooled(engine["mentioned"]) == (2, 3)
    assert _cell(engine["share_of_voice"]) == (2, 2, 3)


async def _term(
    migrated: PostgresServer,
    world: Summary,
    vocabulary_id: uuid.UUID,
    name: str,
    parent: tuple[uuid.UUID, str] | None = None,
) -> uuid.UUID:
    slug = name.lower()
    row = await fetchrow(
        migrated,
        "INSERT INTO core.taxonomy_terms (workspace_id, vocabulary_id, parent_id, name, slug, "
        "path) VALUES ($1, $2, $3, $4::text, $5::text, $6::text) RETURNING id",
        world.workspace.id,
        vocabulary_id,
        None if parent is None else parent[0],
        name,
        slug,
        slug if parent is None else f"{parent[1]}/{slug}",
    )
    term_id: uuid.UUID = row["id"]
    return term_id


@dataclass(frozen=True)
class Tree:
    world: Summary
    security: uuid.UUID
    soc: uuid.UUID
    compliance: uuid.UUID


async def _tree(
    resources: Resources, migrated: PostgresServer, worker_db: Ledger, store: MemoryStore
) -> Tree:
    """Security holds SOC and Compliance. Prompt A is in both children, B in Security itself and
    C in SOC. A and C name the own brand, B names nobody; one answer each, a day ago."""
    world = await _world(resources, migrated)
    world = replace(world, prompts=await _prompts(migrated, world, ["a", "b", "c"]))
    vocabulary = await fetchrow(
        migrated,
        "INSERT INTO core.taxonomy_vocabularies (workspace_id, project_id, kind, name) "
        "VALUES ($1, $2, 'topic', 'Tree') RETURNING id",
        world.workspace.id,
        world.project.id,
    )
    security = await _term(migrated, world, vocabulary["id"], "Security")
    soc = await _term(migrated, world, vocabulary["id"], "SOC", (security, "security"))
    compliance = await _term(
        migrated, world, vocabulary["id"], "Compliance", (security, "security")
    )
    for prompt, term in (("a", soc), ("a", compliance), ("b", security), ("c", soc)):
        await _assign(migrated, world, prompt, term)
    await _ingested(
        world,
        migrated,
        worker_db,
        store,
        [
            Answer("a", OWN_ONLY, (), 1),
            Answer("b", NEITHER, (), 1),
            Answer("c", OWN_ONLY, (), 1),
        ],
    )
    return Tree(world, security, soc, compliance)


async def test_a_parent_topic_holds_the_prompts_of_its_children(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
) -> None:
    """Each prompt is one prompt of Security however it was assigned (docs/16 section 4): see
    `_tree`."""
    tree = await _tree(resources, migrated, worker_db, import_store)

    response = await _summary(tree.world, api)

    data = response.json()["data"]
    rows = {topic["name"]: topic for topic in data["topics"]}
    assert [topic["name"] for topic in data["topics"]] == ["Compliance", "SOC", "Security"]
    assert {name: topic["prompt_count"] for name, topic in rows.items()} == {
        "Compliance": 1,
        "SOC": 2,
        "Security": 3,
    }
    assert rows["Security"]["term_id"] == str(tree.security)
    assert _cell(rows["Compliance"]["engines"][0]["mentioned"]) == (1, 1, 1)
    assert _cell(rows["SOC"]["engines"][0]["mentioned"]) == (2, 2, 2)
    # A once, not twice: (1 + 0 + 1) / 3, not (1 + 1 + 0 + 1) / 4.
    assert _cell(rows["Security"]["engines"][0]["mentioned"]) == (2, 3, 3)
    assert _pooled(rows["Security"]["engines"][0]["mentioned"]) == (2, 3)
    # A prompt row lists the terms it was given, not the ones above them.
    prompt_a = _by(data["prompts"], "prompt_id")[str(tree.world.prompts["a"].id)]
    assert prompt_a["topic_term_ids"] == sorted([str(tree.soc), str(tree.compliance)])


async def test_two_own_brands_in_an_answer_both_count_for_the_own_share(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
) -> None:
    """The project owns Eventus Security and Eventus Labs and competes with CyberNX. An answer
    that names all three has three tracked entities, two of them the own brand's: the own
    share is 2/3, not 1/3 (docs/16 section 5: the shares of all entities add to 1)."""
    world = await _world(resources, migrated)
    await _entity(migrated, world.project, "Eventus Labs", "eventuslabs.example", "own")
    prompts = await _prompts(migrated, world, ["x"])
    world = replace(world, prompts=prompts)
    both = f"{OWN_NAME}, Eventus Labs and {RIVAL_NAME} all run managed SOC services in India."
    await _ingested(
        world,
        migrated,
        worker_db,
        import_store,
        [Answer("x", both, (), 1), Answer("x", OWN_ONLY, (), 2)],
    )

    response = await _summary(world, api)

    chatgpt = response.json()["data"]["prompts"][0]["engines"][0]
    assert _cell(chatgpt["mentioned"]) == (2, 2, 2)
    assert _cell(chatgpt["share_of_voice"]) == (pytest.approx(2 / 3 + 1), 2, 2)
    own = [e for e in response.json()["data"]["entities"] if e["role"] == "own"]
    assert len(own) == 2


async def test_a_project_without_prompts_has_empty_rows(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    project = Project(workspace.id, await make_project(migrated, workspace.id))
    world = Summary(workspace, project, owner, {}, {}, uuid.uuid4(), uuid.uuid4())

    response = await _summary(world, api)

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert (data["prompts"], data["topics"], data["engine_codes"]) == ([], [], [])
    assert (data["entities"], data["entity_config_versions"]) == ([], [])
    assert date.fromisoformat(data["window"]["to"]) - date.fromisoformat(
        data["window"]["from"]
    ) == timedelta(days=27)


async def test_another_projects_answers_are_not_counted(
    api: httpx.AsyncClient,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
    summary: Summary,
) -> None:
    """A second project of the same workspace, with its own prompt and answers, and a second
    workspace: neither shows in the first project's summary."""
    before = (await _summary(summary, api)).json()["data"]
    other_workspace = await make_workspace(migrated)
    for number, workspace_id in enumerate((summary.workspace.id, other_workspace.id)):
        other = Project(workspace_id, await make_project(migrated, workspace_id))
        # A brand name is the workspace's, so the same workspace needs another brand.
        brand = f"Otherco{number}"
        await _entity(migrated, other, brand, f"{brand.lower()}.example", "own", primary=True)
        await enable_engine(migrated, other, CHATGPT)
        prompt = await add_prompt(migrated, other, "Best managed SOC providers in India?")
        await fetched_ai_task(
            worker_db,
            migrated,
            other,
            prompt,
            chatgpt_answer(
                f"{brand} runs a managed SOC service in Mumbai with 24x7 monitoring.",
                [OWN_PAGE],
                when=datetime.now(UTC) - timedelta(days=1),
            ),
            import_store,
        )
    await ingest(worker_db, import_store)

    after = (await _summary(summary, api)).json()["data"]

    assert after == before


async def test_an_unknown_project_is_not_found(api: httpx.AsyncClient, summary: Summary) -> None:
    other = Summary(
        summary.workspace,
        Project(summary.workspace.id, uuid.uuid4()),
        summary.owner,
        {},
        {},
        summary.own,
        summary.rival,
    )

    response = await _summary(other, api)

    assert problem(response) == (404, "not_found")


@contextmanager
def _statements(resources: Resources) -> Iterator[list[str]]:
    seen: list[str] = []

    def record(*args: Any) -> None:
        seen.append(args[2])

    engine = resources.engine.sync_engine
    event.listen(engine, "before_cursor_execute", record)
    try:
        yield seen
    finally:
        event.remove(engine, "before_cursor_execute", record)


async def _full_project(resources: Resources, migrated: PostgresServer) -> Summary:
    """The base plan: 150 prompts in one topic, three engines, eight answers each (twice a week
    for 28 days): 3,600 facts, each naming the own brand, written straight into the tables."""
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    await ensure_locations(migrated)
    project = Project(workspace.id, await make_project(migrated, workspace.id))
    await _entity(migrated, project, OWN_NAME, OWN_HOST, "own", primary=True)
    for engine_code in ENGINES:
        await enable_engine(migrated, project, engine_code)
    topic = await _topic(migrated, project, "Managed SOC")
    for number in range(150):
        prompt = await add_prompt(migrated, project, f"Question {number} about SOC services?")
        await execute(
            migrated,
            "INSERT INTO ai.prompt_terms (prompt_id, term_id, workspace_id) VALUES ($1, $2, $3)",
            prompt.id,
            topic,
            project.workspace_id,
        )
    raw = await fetchrow(
        migrated,
        "INSERT INTO ops.raw_payloads (storage, object_key, sha256, bytes_raw, bytes_stored, "
        "compression, content_type, provider_code, provider_endpoint, fetched_at, "
        "retention_class, expires_at) VALUES ('r2', $1, $2, 10, 10, 'zstd', "
        "'application/json', 'dataforseo', 'ai_optimization/chat_gpt/llm_scraper', now(), "
        "'ai_raw', now() + interval '400 days') RETURNING id",
        f"ai/bulk/{uuid.uuid4()}",
        hashlib.sha256(uuid.uuid4().bytes).digest(),
    )
    await execute(
        migrated,
        "INSERT INTO ai.observations (observed_at, observed_date, workspace_id, project_id, "
        "engine_code, observation_class, prompt_id, prompt_version_id, query_text, "
        "provider_code, provider_endpoint, status, has_citations, raw_payload_id, "
        "adapter_version, normalizer_version, canonicalizer_version) "
        "SELECT now() - make_interval(days => 3 * n), "
        "(now() - make_interval(days => 3 * n))::date, p.workspace_id, p.project_id, e.code, "
        "e.observation_class, p.id, p.current_version_id, "
        "'q', 'dataforseo', 'ai_optimization/chat_gpt/llm_scraper', 'complete', false, $2, "
        "1, 1, 1 FROM ai.prompts p CROSS JOIN ai.engines e CROSS JOIN generate_series(0, 7) n "
        "WHERE p.project_id = $1",
        project.id,
        raw["id"],
    )
    derivation = await fetchrow(
        migrated,
        "INSERT INTO ai.derivations (workspace_id, project_id, extractor_version, "
        "entity_config_version, recommendation_version, sentiment_version) "
        "VALUES ($1, $2, 1, 1, 1, 1) RETURNING id",
        project.workspace_id,
        project.id,
    )
    await execute(
        migrated,
        "INSERT INTO ai.observation_facts (observation_id, observed_at, derivation_id, "
        "workspace_id, project_id, observed_date, engine_code, observation_class, prompt_id, "
        "prompt_version_id, replicate_index, is_valid, own_mentioned, own_domain_cited, "
        "own_citation_count, total_citation_count, tracked_entities_mentioned, "
        "had_structured_list) SELECT o.id, o.observed_at, $2, o.workspace_id, o.project_id, "
        "o.observed_date, o.engine_code, o.observation_class, o.prompt_id, o.prompt_version_id, "
        "1, true, true, false, 0, 0, 1, false FROM ai.observations o WHERE o.project_id = $1",
        project.id,
        derivation["id"],
    )
    return Summary(workspace, project, owner, {}, {}, uuid.uuid4(), uuid.uuid4())


async def test_a_full_project_is_a_handful_of_statements(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
) -> None:
    """The summary reads the 3,600 facts of a full project with one grouped query per level,
    not one per prompt."""
    world = await _full_project(resources, migrated)

    with _statements(resources) as seen:
        response = await _summary(world, api)

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert len(data["prompts"]) == 150
    assert data["engine_codes"] == sorted(ENGINES)
    for engine in data["topics"][0]["engines"]:
        # Every answer names the own brand and nothing else: 8 a prompt, 150 prompts.
        assert _cell(engine["mentioned"]) == (150, 150, 1200)
        assert _pooled(engine["mentioned"]) == (1200, 1200)
        assert _cell(engine["share_of_voice"]) == (1200, 1200, 1200)
    assert _cell(data["prompts"][0]["engines"][0]["mentioned"]) == (8, 8, 8)
    # The count does not depend on the number of prompts (a query per prompt would be 150 or more).
    assert len(seen) <= 20, seen


async def test_half_of_the_answers_superseded_are_all_left_out(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """The four oldest of each prompt's eight answers (1,800 of 3,600) are superseded: the
    summary counts the other four, and reads them as it reads a project without any."""
    world = await _full_project(resources, migrated)
    await execute(
        migrated,
        "UPDATE ai.observations SET superseded_by = id "
        "WHERE project_id = $1 AND observed_at < now() - interval '10 days'",
        world.project.id,
    )

    with _statements(resources) as seen:
        response = await _summary(world, api)

    data = response.json()["data"]
    assert _cell(data["prompts"][0]["engines"][0]["mentioned"]) == (4, 4, 4)
    for engine in data["topics"][0]["engines"]:
        assert _cell(engine["mentioned"]) == (150, 150, 600)
        assert _cell(engine["share_of_voice"]) == (600, 600, 600)
    assert len(seen) <= 20, seen


def _when(value: str) -> datetime:
    return datetime.fromisoformat(value)


async def _answer_times(migrated: PostgresServer, prompt: Prompt) -> list[datetime]:
    """When each answer to the prompt was given, newest first."""
    rows = await fetch(
        migrated,
        "SELECT observed_at FROM ai.observations WHERE prompt_id = $1 ORDER BY observed_at DESC",
        prompt.id,
    )
    return [row["observed_at"] for row in rows]


async def test_rows_say_when_the_last_answer_and_the_last_valid_answer_came(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
) -> None:
    """Prompt A: an answer today that is superseded, a refusal a day ago and a valid answer three
    days ago. Prompt B: a refusal two days ago. Prompt C: nothing. Topic T holds A and B; C has
    no topic."""
    world = await _world(resources, migrated)
    prompts = await _prompts(migrated, world, ["a", "b", "c"])
    world = replace(world, prompts=prompts)
    topic = await _topic(migrated, world.project, "Managed SOC")
    for name in ("a", "b"):
        await _assign(migrated, world, name, topic)
    await _ingested(
        world,
        migrated,
        worker_db,
        import_store,
        [
            Answer("a", OWN_ONLY, (), 0),
            Answer("a", REFUSAL, (), 1),
            Answer("a", OWN_ONLY, (), 3),
            Answer("b", REFUSAL, (), 2),
        ],
    )
    newest, refused, valid = await _answer_times(migrated, prompts["a"])
    await execute(
        migrated,
        "UPDATE ai.observations SET superseded_by = id WHERE prompt_id = $1 AND observed_at = $2",
        prompts["a"].id,
        newest,
    )
    (b_refused,) = await _answer_times(migrated, prompts["b"])

    response = await _summary(world, api)

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    rows = _by(data["prompts"], "prompt_id")
    a, b, c = (rows[str(prompts[name].id)] for name in ("a", "b", "c"))
    # The superseded answer is not counted, so it is not the last one either.
    assert (_when(a["last_observed_at"]), _when(a["last_valid_at"])) == (refused, valid)
    assert (_when(b["last_observed_at"]), b["last_valid_at"]) == (b_refused, None)
    assert (c["last_observed_at"], c["last_valid_at"]) == (None, None)
    topic_row, untopiced = data["topics"]
    assert (_when(topic_row["last_observed_at"]), _when(topic_row["last_valid_at"])) == (
        refused,
        valid,
    )
    assert (untopiced["last_observed_at"], untopiced["last_valid_at"]) == (None, None)


async def test_the_last_answer_is_of_the_engines_shown(
    api: httpx.AsyncClient, migrated: PostgresServer, summary: Summary
) -> None:
    """`providers` was last answered on ChatGPT a day ago (answer 1) and on Gemini two days ago."""
    providers = summary.prompts["providers"]
    latest: dict[str, datetime] = {}
    for engine in (CHATGPT, GEMINI):
        record = await fetchrow(
            migrated,
            "SELECT max(observed_at) AS at FROM ai.observations "
            "WHERE prompt_id = $1 AND engine_code = $2::text",
            providers.id,
            engine,
        )
        latest[engine] = record["at"]

    every = await _summary(summary, api)
    gemini = await _summary(summary, api, **{"filter[engine_code_in]": GEMINI})

    row = _by(every.json()["data"]["prompts"], "prompt_id")[str(providers.id)]
    assert (_when(row["last_observed_at"]), _when(row["last_valid_at"])) == (
        latest[CHATGPT],
        latest[CHATGPT],
    )
    row = _by(gemini.json()["data"]["prompts"], "prompt_id")[str(providers.id)]
    assert (_when(row["last_observed_at"]), _when(row["last_valid_at"])) == (
        latest[GEMINI],
        latest[GEMINI],
    )


async def test_a_country_filter_keeps_the_prompts_of_that_country(
    api: httpx.AsyncClient, migrated: PostgresServer, summary: Summary
) -> None:
    await execute(
        migrated,
        "UPDATE ai.prompts SET country_iso = 'IN' WHERE id = $1",
        summary.prompts["pricing"].id,
    )

    india = (await _summary(summary, api, **{"filter[country_iso]": "IN"})).json()["data"]
    states = (await _summary(summary, api, **{"filter[country_iso]": "US"})).json()["data"]
    lower = await _summary(summary, api, **{"filter[country_iso]": "in"})

    assert [row["prompt_id"] for row in india["prompts"]] == [str(summary.prompts["pricing"].id)]
    assert [(t["name"], t["prompt_count"]) for t in india["topics"]] == [("Managed SOC", 1)]
    # Managed SOC is `pricing` alone here: 0 of its one valid answer.
    assert _cell(india["topics"][0]["engines"][0]["mentioned"]) == (0, 1, 1)
    assert {row["prompt_id"] for row in states["prompts"]} == {
        str(summary.prompts[name].id) for name in ("providers", "misc")
    }
    assert [(t["name"], t["prompt_count"]) for t in states["topics"]] == [
        ("Compliance", 1),
        ("Managed SOC", 1),
        (None, 1),
    ]
    # Managed SOC is `providers` alone here: 2 of 5.
    soc = _by(states["topics"], "name")["Managed SOC"]
    assert _cell(soc["engines"][0]["mentioned"]) == (pytest.approx(0.4), 1, 6)
    assert problem(lower) == (422, "validation_failed")


async def test_a_term_filter_keeps_the_term_and_the_terms_below_it(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
) -> None:
    tree = await _tree(resources, migrated, worker_db, import_store)
    ids = {name: str(prompt.id) for name, prompt in tree.world.prompts.items()}

    async def scoped(term: uuid.UUID) -> dict[str, Any]:
        response = await _summary(tree.world, api, **{"filter[term]": str(term)})
        assert response.status_code == 200, response.text
        data: dict[str, Any] = response.json()["data"]
        return data

    security = await scoped(tree.security)
    soc = await scoped(tree.soc)
    compliance = await scoped(tree.compliance)
    unknown = await scoped(uuid.uuid4())

    assert {row["prompt_id"] for row in security["prompts"]} == set(ids.values())
    assert [t["name"] for t in security["topics"]] == ["Compliance", "SOC", "Security"]
    # A is in Compliance too, but under SOC the rows are SOC and the terms below it.
    assert {row["prompt_id"] for row in soc["prompts"]} == {ids["a"], ids["c"]}
    assert [(t["name"], t["prompt_count"]) for t in soc["topics"]] == [("SOC", 2)]
    assert _cell(soc["topics"][0]["engines"][0]["mentioned"]) == (2, 2, 2)
    assert [row["prompt_id"] for row in compliance["prompts"]] == [ids["a"]]
    assert [(t["name"], t["prompt_count"]) for t in compliance["topics"]] == [("Compliance", 1)]
    assert (unknown["prompts"], unknown["topics"]) == ([], [])


async def test_another_workspaces_term_holds_no_prompt(
    api: httpx.AsyncClient, migrated: PostgresServer, summary: Summary
) -> None:
    other_workspace = await make_workspace(migrated)
    other = Project(other_workspace.id, await make_project(migrated, other_workspace.id))
    term = await _topic(migrated, other, "Managed SOC")

    response = await _summary(summary, api, **{"filter[term]": str(term)})

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert (data["prompts"], data["topics"]) == ([], [])


async def test_branded_only_keeps_the_branded_prompts(
    api: httpx.AsyncClient, summary: Summary
) -> None:
    alone = (await _summary(summary, api, branded_only="true")).json()["data"]
    both = (await _summary(summary, api, branded_only="true", include_branded="true")).json()[
        "data"
    ]
    soc = (
        await _summary(
            summary, api, branded_only="true", **{"filter[term]": str(summary.topics["soc"])}
        )
    ).json()["data"]
    default = (await _summary(summary, api)).json()["data"]

    assert [row["prompt_id"] for row in alone["prompts"]] == [str(summary.prompts["brand"].id)]
    assert [(t["term_id"], t["prompt_count"]) for t in alone["topics"]] == [(None, 1)]
    assert _cell(alone["topics"][0]["engines"][0]["mentioned"]) == (1, 1, 1)
    assert (alone["branded_only"], alone["include_branded"]) == (True, True)
    assert both == alone
    # The branded prompt has no topic, so nothing is under Managed SOC.
    assert (soc["prompts"], soc["topics"]) == ([], [])
    assert (default["branded_only"], default["include_branded"]) == (False, False)
