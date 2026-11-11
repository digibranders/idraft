"""The prompts summary (spec section 4.5; docs/16 sections 3 to 5): per prompt, engine and topic
over a window, Mentioned, Cited, the four outcomes and Share of voice, each as counts of valid,
current answers. The expected numbers are worked out by hand from the answers seeded below."""

from __future__ import annotations

import hashlib
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any

import httpx
import pytest
from sqlalchemy import event

from idraft.api.resources import Resources
from idraft.collectors.ai_prompt_ingest import ingest
from tests.api.auth.support import Workspace, execute, fetchrow, make_workspace
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
    assert set(cell) == {"value", "numerator", "denominator", "n_observations"}


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
    # `providers` are in both rows and the topics do not add up to anything.
    assert _cell(compliance["engines"][0]["mentioned"]) == (2, 5, 6)
    assert _cell(soc["engines"][0]["mentioned"]) == (2, 6, 7)
    assert _cell(soc["engines"][0]["cited"]) == (2, 6, 7)
    assert _outcomes(soc["engines"][0]) == [1, 1, 1, 3]
    assert _cell(soc["engines"][0]["share_of_voice"]) == (1.5, 3, 7)
    assert _cell(soc["engines"][1]["mentioned"]) == (1, 1, 1)
    # `misc` alone, own named and cited: the archived prompt of the same topic is not in it.
    assert _cell(untopiced["engines"][0]["mentioned"]) == (1, 1, 1)
    assert _outcomes(untopiced["engines"][0]) == [1, 0, 0, 0]


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


async def test_a_full_project_is_a_handful_of_statements(
    api: httpx.AsyncClient,
    resources: Resources,
    migrated: PostgresServer,
) -> None:
    """The base plan: 150 prompts, each with an answer. The summary reads them with one grouped
    query per level, not one per prompt."""
    workspace = await make_workspace(migrated)
    owner = await member(resources, migrated, workspace, "owner")
    await ensure_locations(migrated)
    project = Project(workspace.id, await make_project(migrated, workspace.id))
    await _entity(migrated, project, OWN_NAME, OWN_HOST, "own", primary=True)
    await enable_engine(migrated, project, CHATGPT)
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
        "SELECT now(), current_date, p.workspace_id, p.project_id, 'chatgpt_web', "
        "(SELECT observation_class FROM ai.engines WHERE code = 'chatgpt_web'), p.id, "
        "p.current_version_id, 'q', 'dataforseo', 'ai_optimization/chat_gpt/llm_scraper', "
        "'complete', false, $2, 1, 1, 1 FROM ai.prompts p WHERE p.project_id = $1",
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
    world = Summary(workspace, project, owner, {}, {}, uuid.uuid4(), uuid.uuid4())

    with _statements(resources) as seen:
        response = await _summary(world, api)

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert len(data["prompts"]) == 150
    assert _cell(data["topics"][0]["engines"][0]["mentioned"]) == (150, 150, 150)
    assert _cell(data["topics"][0]["engines"][0]["share_of_voice"]) == (150, 150, 150)
    # The count does not depend on the number of prompts (a query per prompt would be 150 or more).
    assert len(seen) <= 20, seen
