"""The card read map (BE-METRICS-24, contract C8 change log C-14): every card of the Overview has a
read that answers, with the fields the card shows. The map is the table of
`docs/ai-visibility/contracts/c8-metrics.md` ("Card read map"): each row is parsed from the note,
and each row has one check here that sends the requests the card sends (the `GET` blocks of the
row) against the seeded world of `test_prompts_summary` and reads the members the card draws. A row
added to the note without a check here fails
`test_the_card_read_table_of_the_note_is_the_test_table`, and a request of a row that the check
does not send fails the row's own test.

Hand numbers, ChatGPT, default scope (see `test_metrics_overview` and `test_competitors_core`):
own Mentioned 1.4 of 3 prompts (answers 3 of 7, in 8), valid answers 7 of 8, Share of voice 2.5
of 4; the rival Mentioned 0.4 of 3 (answers 2 of 7), Share of voice 1.5 of 4, lost on `providers`
(1 of 5 valid answers, 6 in all). Gemini has one valid answer."""

from __future__ import annotations

import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
import pytest

from idraft.api.openapi import build_openapi
from tests.api.ai import summary_support
from tests.api.ai.competitors_support import counts as entry_counts
from tests.api.ai.competitors_support import entry, names, row_of, top_of
from tests.api.ai.metrics_support import counts, engine_tiles
from tests.api.ai.summary_support import CHATGPT, GEMINI, Summary
from tests.api.auth.support import execute
from tests.collectors.ai_support import OWN_HOST, OWN_NAME, RIVAL_NAME
from tests.conftest import PostgresServer

seeded = summary_support.seeded

NOTE = Path(__file__).parents[4] / "docs" / "ai-visibility" / "contracts" / "c8-metrics.md"
PROMPT = "Best managed SOC providers in India?"
OWN_PAGE_URL = f"https://{OWN_HOST}/managed-soc"
# The numbers strip, in the words of the note: the key of each number.
STRIP = [
    "ai.valid_answers",
    "ai.mention_rate",
    "ai.citation_rate",
    "ai.mention_and_citation_rate",
    "ai.share_of_voice",
    "ai.citation_share",
    "ai.fanout_presence_rate",
]
OUTCOMES = [f"ai.outcome_mix.{name}" for name in ("mentioned_and_cited", "mentioned_only")] + [
    f"ai.outcome_mix.{name}" for name in ("cited_only", "neither")
]
POINT = {
    "t",
    "value",
    "numerator",
    "denominator",
    "n_observations",
    "n_prompts",
    "is_partial",
    "is_pooled",
}


@dataclass(frozen=True)
class NoteRow:
    """One row of the card read map: the catalog keys in the first cell and the `GET` blocks."""

    cards: tuple[str, ...]
    requests: tuple[str, ...]
    text: str


def note_rows() -> list[NoteRow]:
    """The rows of the card read map table of the note, in order."""
    text = NOTE.read_text(encoding="utf-8")
    section = text.split("## Card read map (BE-METRICS-24)", 1)[1].split("\n## ", 1)[0]
    rows: list[NoteRow] = []
    for line in section.splitlines():
        if not line.startswith("| ") or line.startswith(("| Card or number", "|---")):
            continue
        first, second = (cell.strip() for cell in line.strip().strip("|").split("|", 1))
        rows.append(
            NoteRow(
                cards=tuple(re.findall(r"`([a-z]+\.[a-z_]+)`", first)),
                requests=tuple(re.findall(r"`GET ([^`]+)`", second)),
                text=second,
            )
        )
    return rows


class Reader:
    """Sends the requests of a card as the owner of the seeded world and remembers them."""

    def __init__(self, world: Summary, api: httpx.AsyncClient) -> None:
        self.world = world
        self.api = api
        self.sent: list[tuple[str, frozenset[str]]] = []

    async def maybe(self, template: str, **params: Any) -> dict[str, Any] | None:
        """The body of a read that another package has yet to build: `501 not_implemented` is
        accepted and answers None, 200 answers the body."""
        workspace = f"/api/v1/workspaces/{self.world.workspace.id}"
        path = template.replace("{P}", f"{workspace}/projects/{self.world.project.id}").replace(
            "{W}", workspace
        )
        response = await self.api.get(path, params=params, headers=self.world.owner.headers)
        self.sent.append((template, frozenset(params)))
        if response.status_code == 501:
            assert response.json()["code"] == "not_implemented", response.text
            return None
        assert response.status_code == 200, (template, params, response.text)
        body: dict[str, Any] = response.json()
        return body

    async def get(self, template: str, **params: Any) -> dict[str, Any]:
        """The body of a read that is built: it must answer 200."""
        found = await self.maybe(template, **params)
        assert found is not None, template
        return found


def _without_query(request: str) -> tuple[str, frozenset[str]]:
    path, _, query = request.partition("?")
    return path, frozenset(pair.split("=")[0] for pair in query.split("&") if pair)


def _tile(data: dict[str, Any], engine: str, key: str) -> dict[str, Any]:
    tile: dict[str, Any] = engine_tiles(data, engine)[key]
    return tile


async def _numbers_strip(read: Reader, world: Summary) -> None:
    bodies = [
        await read.get("{P}/ai/metrics/overview", compare="previous_period"),
        await read.get("{P}/overview/ai", compare="previous_period"),
    ]
    assert bodies[0] == bodies[1]
    data = bodies[0]["data"]
    tiles = engine_tiles(data, CHATGPT)
    assert set(STRIP) <= set(tiles)
    assert data["prompts_in_scope"]["value"] == 3
    assert tiles["ai.valid_answers"]["value"] == 7
    assert tiles["ai.valid_answers"]["n_observations"] == 8
    assert counts(tiles["ai.mention_rate"]) == (pytest.approx(1.4), 3, 8)
    assert counts(tiles["ai.share_of_voice"]) == (2.5, 4, 8)
    assert tiles["ai.citation_share"]["denominator"] > 0
    # The delta of the strip: the window before had one valid answer (1 of 1).
    assert counts(tiles["ai.mention_rate"]["previous"]) == (1, 1, 1)
    assert {"ai.mention_rate.engine_average", "ai.share_of_voice.engine_average"} <= {
        value["metric"] for value in data["engine_average"]
    }
    # The fan-out number exists for the engine that exposes it, and is not 0 for the other.
    assert "ai.fanout_presence_rate" not in engine_tiles(data, GEMINI)
    assert data["topics_in_scope"] == 2


async def _engine_cards(read: Reader, world: Summary) -> None:
    data = (await read.get("{P}/ai/metrics/overview"))["data"]
    assert [engine["engine_code"] for engine in data["engines"]] == [CHATGPT, GEMINI]
    for engine in data["engines"]:
        assert engine["observation_class"]
        tiles = {tile["metric"]: tile for tile in engine["tiles"]}
        # ai.by_engine: the table columns, the recommendation one suppressed and not 0.
        assert {"ai.mention_rate", "ai.citation_rate", "ai.share_of_voice"} <= set(tiles)
        recommendation = tiles["ai.recommendation_rate"]
        assert (recommendation["value"], recommendation["suppressed_reason"]) == (
            None,
            "not_classified",
        )
        # ai.outcome_mix: four shares of one whole.
        mix = [tiles[key] for key in OUTCOMES]
        assert sum(tile["value"] for tile in mix) == pytest.approx(1)
        assert len({tile["denominator"] for tile in mix}) == 1
    tiles = engine_tiles(data, CHATGPT)
    # ai.answer_funnel: answers, valid answers, mentioned, cited, both; each step fits in the last.
    valid = tiles["ai.valid_answers"]
    mentioned = tiles["ai.mention_rate"]["pooled"]["successes"]
    cited = tiles["ai.citation_rate"]["pooled"]["successes"]
    both = tiles["ai.mention_and_citation_rate"]["pooled"]["successes"]
    assert valid["n_observations"] >= valid["value"] >= max(mentioned, cited) >= both
    assert (valid["n_observations"], valid["value"], mentioned, cited, both) == (8, 7, 3, 3, 2)
    # ai.sample_coverage: the sample behind each rate, and when the newest answer came.
    assert tiles["ai.mention_rate"]["n_prompts"] == data["prompts_in_scope"]["value"] == 3
    assert data["last_observed_at"]
    assert data["last_valid_at"]


async def _mention_trend(read: Reader, world: Summary) -> None:
    for key in ("ai.mention_rate", "ai.citation_rate", "ai.share_of_voice"):
        body = await read.get(f"{{P}}/ai/metrics/{key}/series")
        assert [(s["metric"], s["engine_code"]) for s in body["data"]] == [
            (key, CHATGPT),
            (key, GEMINI),
        ]
        for series in body["data"]:
            points = series["points"]
            assert series["granularity"] == "week"
            assert 1 <= len(points) <= 14
            assert [point["t"] for point in points] == sorted(point["t"] for point in points)
            assert all(set(point) >= POINT for point in points)
    chatgpt = (await read.get("{P}/ai/metrics/ai.mention_rate/series"))["data"][0]["points"]
    assert counts(chatgpt[-1]) == (pytest.approx(1.4), 3, 8)


async def _competitor_trend(read: Reader, world: Summary) -> None:
    own, rival = str(world.own), str(world.rival)
    mention = await read.get(
        "{P}/ai/metrics/ai.mention_rate/series", entity_ids=f"{world.own},{world.rival}"
    )
    share = await read.get("{P}/ai/metrics/ai.share_of_voice/series", entity_ids=str(world.rival))
    assert [(s["engine_code"], s["entity_id"]) for s in mention["data"]] == [
        (CHATGPT, own),
        (CHATGPT, rival),
        (GEMINI, own),
        (GEMINI, rival),
    ]
    assert [(s["engine_code"], s["entity_id"]) for s in share["data"]] == [
        (CHATGPT, rival),
        (GEMINI, rival),
    ]
    rival_mention = mention["data"][1]["points"][-1]
    assert counts(rival_mention) == (pytest.approx(0.4), 3, 8)
    assert rival_mention["pooled"] == {"successes": 2, "trials": 7}
    assert counts(share["data"][0]["points"][-1]) == (1.5, 4, 8)
    assert all(set(point) >= POINT for s in mention["data"] for point in s["points"])


async def _competitor_table(read: Reader, world: Summary) -> None:
    body = await read.get("{P}/ai/competitors", compare="previous_period")
    assert names(body) == [OWN_NAME, RIVAL_NAME]
    assert [row["entity"]["role"] for row in body["data"]] == ["own", "competitor"]
    own = entry(row_of(body, world.own), CHATGPT)
    rival = entry(row_of(body, world.rival), CHATGPT)
    assert entry_counts(own["share_of_voice"]) == (2.5, 4, 8)
    assert entry_counts(rival["share_of_voice"]) == (1.5, 4, 8)
    assert entry_counts(rival["mention_rate"]) == (pytest.approx(0.4), 3, 8)
    assert entry_counts(rival["citation_share"]) == (2, 7, 7)
    assert rival["recommendation_rate"]["suppressed_reason"] == "not_classified"
    assert top_of(body, CHATGPT) == [RIVAL_NAME]
    # The delta columns: previous on the two members that compare, and not on the citation share.
    assert "previous" in rival["share_of_voice"]
    assert "previous" in rival["mention_rate"]
    assert "previous" not in rival["citation_share"]
    assert "lost_prompts" not in rival
    assert "top_sources" not in row_of(body, world.rival)
    # The SOV columns of the Overview competitor table: both entities, per engine.
    overview = (await read.get("{P}/overview/competitors", compare="previous_period"))["data"]
    assert [row["entity"]["canonical_name"] for row in overview["rows"]] == [OWN_NAME, RIVAL_NAME]
    for row in overview["rows"]:
        assert [cell["engine_code"] for cell in row["ai"]] == [CHATGPT, GEMINI]
        assert "seo" not in row
        for cell in row["ai"]:
            assert {"share_of_voice", "mention_rate"} <= set(cell)
    rival_row = next(r for r in overview["rows"] if r["entity"]["entity_id"] == str(world.rival))
    assert entry_counts(rival_row["ai"][0]["share_of_voice"]) == (1.5, 4, 8)
    assert "seo_other_domains" not in overview


async def _lost_to_competitor(read: Reader, world: Summary) -> None:
    body = await read.get("{P}/ai/competitors", include="lost_prompts")
    rival = entry(row_of(body, world.rival), CHATGPT)
    [lost] = rival["lost_prompts"]
    # The prompt the rival is named in and the own brand is not: 1 of 5 valid answers, 6 in all.
    assert lost["text"] == PROMPT
    assert lost["prompt_id"] == str(world.prompts["providers"].id)
    assert entry_counts(lost["lost"]) == (1, 5, 6)
    assert rival["lost_prompts_total"] == 1
    assert entry(row_of(body, world.rival), GEMINI)["lost_prompts"] == []
    assert "lost_prompts" not in entry(row_of(body, world.own), CHATGPT)


async def _country_breakdown(read: Reader, world: Summary) -> None:
    body = await read.get("{P}/ai/metrics/ai.mention_rate/breakdown", dimension="country")
    assert [(row["dimension"]["id"], row["prompts"]) for row in body["data"]] == [
        ("IN", 2),
        ("US", 1),
    ]
    assert body["meta"]["rows_total"] == 2
    assert body["meta"]["truncated"] is False
    india, america = body["data"]
    assert [value["engine_code"] for value in india["values"]] == [CHATGPT, GEMINI]
    assert counts(india["values"][0]) == (pytest.approx(0.4), 2, 7)
    assert counts(america["values"][0]) == (1, 1, 1)


async def _topic_cards(read: Reader, world: Summary) -> None:
    summary = (await read.get("{P}/ai/prompts-summary", rows="topics", include="series"))["data"]
    breakdown = (await read.get("{P}/ai/metrics/ai.mention_rate/breakdown", dimension="topic"))[
        "data"
    ]
    assert {topic["name"] for topic in summary["topics"]} == {"Managed SOC", "Compliance", None}
    by_term = {row["dimension"]["id"]: row for row in breakdown}
    for topic in summary["topics"]:
        assert all(engine["series"] for engine in topic["engines"])
        row = by_term[topic["term_id"]]
        assert row["prompts"] == topic["prompt_count"]
        for engine in topic["engines"]:
            value = next(v for v in row["values"] if v["engine_code"] == engine["engine_code"])
            cell = engine["mentioned"]
            assert (value["numerator"], value["denominator"], value["n_observations"]) == (
                pytest.approx(cell["numerator"]),
                cell["denominator"],
                cell["n_observations"],
            )


async def _co_mentions(read: Reader, world: Summary) -> None:
    data = (await read.get("{P}/ai/prompts-summary", include="co_mentions"))["data"]
    found = {item["engine_code"]: item for item in data["co_mentions"]}
    assert set(found) == {CHATGPT, GEMINI}
    assert found[CHATGPT]["answers"] == 7
    [pair] = found[CHATGPT]["pairs"]
    assert {pair["a"], pair["b"]} == {str(world.own), str(world.rival)}
    assert pair["answers"] == 1


async def _sources_cards(read: Reader, world: Summary) -> None:
    domains = await read.get("{P}/ai/sources/domains")
    own = next(row for row in domains["data"] if row["registrable_domain"] == OWN_HOST)
    assert own["domain_role"] == "own"
    assert own["citation_units"] > 0
    assert domains["meta"]["citation_units"] > 0
    assert "own" in {share["domain_role"] for share in domains["meta"]["by_role"]}
    pages = await read.get("{P}/ai/sources/pages")
    assert OWN_PAGE_URL in {row["url"] for row in pages["data"]}
    for kind in ("new", "lost"):
        changes = await read.get("{P}/ai/sources/changes", kind=kind)
        assert changes["meta"]["kind"] == kind
        assert isinstance(changes["data"], list)
    diversity = await read.get("{P}/ai/sources/diversity")
    chatgpt = next(e for e in diversity["data"] if e["engine_code"] == CHATGPT)
    assert chatgpt["distinct_domains"] > 0
    assert chatgpt["effective_sources"]["value"] > 0
    fanout = await read.get("{P}/ai/fanout-queries")
    assert {"answers", "answers_with_fanout", "engines_without_fanout"} <= set(fanout["meta"])
    # The engines that expose fan-out are counted; the one that does not is named, not zero.
    assert fanout["meta"]["engine_codes"] == [CHATGPT]
    assert GEMINI in fanout["meta"]["engines_without_fanout"]


async def _activity_cards(read: Reader, world: Summary) -> None:
    runs = await read.get("{P}/runs")
    assert isinstance(runs["data"], list)
    assert "manual_runs_today" in runs["meta"]
    # WP-30 built the daily collection read on develop (commit f0192fb9). This branch has not
    # merged it and still has the `501` stub, so the card has the run list; where the route is
    # built, the days it returns carry what the calendar draws.
    daily = await read.maybe("{P}/ai/collection/daily")
    if daily is not None:
        assert daily["meta"]["engine_codes"] == [CHATGPT, GEMINI]
        assert daily["data"]
        assert {"date", "engine_code", "answers", "valid", "by_status"} <= set(daily["data"][0])
    engines = await read.get("{P}/engines")
    assert {CHATGPT, GEMINI} <= {item["engine"]["engine_code"] for item in engines["data"]}
    assert isinstance((await read.get("{W}/budgets/status"))["data"], list)


@dataclass(frozen=True)
class Card:
    """The check of one row of the map, found by the catalog keys of the row."""

    cards: tuple[str, ...]
    check: Callable[[Reader, Summary], Awaitable[None]]


# One check for every row of the note's table with a read, in the order of the note.
CARD_READS = [
    Card(("ai.prompts_in_scope", "ai.valid_answers"), _numbers_strip),
    Card(
        ("ai.by_engine", "ai.outcome_mix", "ai.answer_funnel", "ai.sample_coverage"), _engine_cards
    ),
    Card(("ai.mention_trend", "ai.rate_trend_by_engine"), _mention_trend),
    Card(("ai.competitor_trend", "ai.sov_over_time"), _competitor_trend),
    Card(
        (
            "ai.share_of_voice",
            "ai.competitor_table",
            "competitors.share_of_voice",
            "competitors.summary",
        ),
        _competitor_table,
    ),
    Card(("ai.lost_to_competitor",), _lost_to_competitor),
    Card(("ai.country_breakdown",), _country_breakdown),
    Card(("ai.topic_heatmap", "ai.topic_trends"), _topic_cards),
    Card(("ai.co_mentions",), _co_mentions),
    Card(
        (
            "sources.top_domains",
            "sources.own_pages",
            "ai.citation_share_by_domain_type",
            "sources.new_lost",
            "sources.diversity",
            "ai.fanout_top",
        ),
        _sources_cards,
    ),
    Card(
        (
            "activity.collection_status",
            "ops.answer_calendar",
            "ops.answer_status",
            "ops.engines",
            "ops.ai_spend",
        ),
        _activity_cards,
    ),
]
# Cards the note names as not built: no read exists, and the note says which package builds it.
NOT_BUILT = ("activity.key_changes",)


@pytest.fixture
async def world(migrated: PostgresServer, seeded: Summary) -> Summary:
    """The seeded world with two markets: `providers` and `pricing` in India, `misc` in the US."""
    await execute(
        migrated,
        "UPDATE ai.prompts SET country_iso = 'IN' WHERE id = ANY($1)",
        [seeded.prompts["providers"].id, seeded.prompts["pricing"].id],
    )
    return seeded


def test_the_card_read_table_of_the_note_is_the_test_table() -> None:
    rows = note_rows()

    assert [row.cards for row in rows] == [*(card.cards for card in CARD_READS), NOT_BUILT]
    assert all(row.requests for row in rows if row.cards != NOT_BUILT)


def test_a_card_with_no_read_is_named_in_the_note_as_not_built() -> None:
    rows = [row for row in note_rows() if not row.requests]
    paths = build_openapi()["paths"]

    assert [row.cards for row in rows] == [NOT_BUILT]
    assert "not built" in rows[0].text
    assert "WP-58" in rows[0].text
    assert not [path for path in paths if path.endswith(("/overview/changes", "/overview/seo"))]


@pytest.mark.parametrize("card", CARD_READS, ids=lambda card: card.cards[0])
async def test_every_overview_card_has_a_read_that_answers_with_the_fields_it_needs(
    api: httpx.AsyncClient, world: Summary, card: Card
) -> None:
    [row] = [row for row in note_rows() if row.cards == card.cards]
    read = Reader(world, api)

    await card.check(read, world)

    # The requests of the row are the ones the check sent: each path of the note, with the
    # parameters it names, and no request the note does not list.
    wanted = [_without_query(request) for request in row.requests]
    for path, parameters in wanted:
        assert any(sent == path and parameters <= given for sent, given in read.sent), (
            path,
            parameters,
        )
    assert {sent for sent, _ in read.sent} <= {path for path, _ in wanted}
