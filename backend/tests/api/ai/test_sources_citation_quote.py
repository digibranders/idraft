"""The quote of a citation row (WP-32 follow-up; BE-SOURCES-21): `GET {P}/ai/citations` rows carry
the same nullable `quote` as `CitationOut` of the answer detail (contract `evidence.md`): the
passage the provider quoted, whitespace collapsed and cut at 1,000 characters when it is stored,
null for ChatGPT (it gives none) and for rows stored before migration 0024. The column is read by
the existing statement of the list: the list costs the statements it cost before."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx
import pytest

from idraft.api.resources import Resources
from idraft.api.schemas.ai import CitationOut
from idraft.api.schemas.ai_sources import CitationRow
from tests.api.ai.sources_support import (
    GUIDE,
    OWN,
    WIKI,
    Cite,
    World,
    answer,
    make_world,
    statements,
)
from tests.api.auth.support import execute
from tests.collectors.ai_support import add_prompt
from tests.conftest import PostgresServer

SHORT = "A short passage the engine quoted."
# The longest a stored quote is: the parser cuts at this (ai_parse.QUOTE_MAX_CHARS).
LONGEST = "x" * 1000
# What a row written straight into the table can hold: the API returns it as stored, as the
# answer detail does for `CitationOut`.
TOO_LONG = "y" * 1001
# The statements the citations list sends, warm: the same with or without the quote column.
CITATION_LIST_STATEMENTS = 7


@dataclass(frozen=True)
class Quotes:
    world: World
    chatgpt: int
    gemini: int


async def _quote(pg: PostgresServer, observation_id: int, index: int, text: str) -> None:
    await execute(
        pg,
        "UPDATE ai.citations SET quote = $3 WHERE observation_id = $1 AND citation_index = $2",
        observation_id,
        index,
        text,
    )


@pytest.fixture
async def quotes(resources: Resources, migrated: PostgresServer) -> Quotes:
    """ChatGPT answers (days_ago 1) with two citations and no quote; a Gemini answer (days_ago 2)
    with three: a short quote, one of the longest length and one with none (a row stored before
    quotes were kept); and a second Gemini answer (days_ago 3) holding a value over the cap."""
    world = await make_world(resources, migrated)
    prompt = await add_prompt(migrated, world.project, "Best managed SOC providers?")
    chatgpt = await answer(
        migrated, world, prompt, days_ago=1, cites=[world.own_cite(OWN), Cite(GUIDE)]
    )
    gemini = await answer(
        migrated,
        world,
        prompt,
        days_ago=2,
        engine="gemini_web",
        cites=[world.own_cite(OWN), Cite(GUIDE), Cite(WIKI)],
    )
    long_one = await answer(
        migrated, world, prompt, days_ago=3, engine="gemini_web", cites=[Cite(GUIDE)]
    )
    await _quote(migrated, gemini, 1, SHORT)
    await _quote(migrated, gemini, 2, LONGEST)
    await _quote(migrated, long_one, 1, TOO_LONG)
    return Quotes(world, chatgpt, gemini)


async def _rows(world: World, api: httpx.AsyncClient) -> list[dict[str, Any]]:
    response = await api.get(
        world.url("ai", "citations"), params={"limit": 200}, headers=world.owner.headers
    )
    assert response.status_code == 200, response.text
    rows: list[dict[str, Any]] = response.json()["data"]
    return rows


def _quoted(rows: list[dict[str, Any]], observation_id: int) -> list[Any]:
    """The quotes of one answer's citations, in citation order."""
    mine = [row for row in rows if row["observation_id"] == str(observation_id)]
    return [row["quote"] for row in sorted(mine, key=lambda row: row["citation_index"])]


async def test_a_quote_stays_null_for_chatgpt_and_for_a_row_stored_before_quotes(
    api: httpx.AsyncClient, quotes: Quotes
) -> None:
    rows = await _rows(quotes.world, api)

    # Every row has the member, null when there is none: ChatGPT gives no quote, and the third
    # Gemini row is one stored before migration 0024.
    assert all("quote" in row for row in rows)
    assert _quoted(rows, quotes.chatgpt) == [None, None]
    assert _quoted(rows, quotes.gemini)[2] is None


async def test_a_stored_quote_comes_back_unchanged_up_to_the_cap(
    api: httpx.AsyncClient, quotes: Quotes
) -> None:
    rows = await _rows(quotes.world, api)

    assert _quoted(rows, quotes.gemini)[:2] == [SHORT, LONGEST]
    assert len(LONGEST) == 1000
    # The cap is the parser's, as for `CitationOut`: a longer value written straight into the
    # table is returned as stored, never cut or refused here.
    assert sorted(row["quote"] for row in rows if row["quote"] and len(row["quote"]) > 1000) == [
        TOO_LONG
    ]


def test_the_quote_is_described_as_the_answer_detail_describes_it() -> None:
    """One text for both rows, so the cap is stated once (`CitationOut`'s)."""
    row, detail = CitationRow.model_fields["quote"], CitationOut.model_fields["quote"]

    assert row.description == detail.description
    assert row.default is None


async def test_another_workspaces_quote_is_never_shown(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, quotes: Quotes
) -> None:
    before = await _rows(quotes.world, api)
    other = await make_world(resources, migrated)
    theirs = await add_prompt(migrated, other.project, "Best managed SOC providers?")
    secret = await answer(
        migrated, other, theirs, days_ago=1, engine="gemini_web", cites=[Cite(GUIDE)]
    )
    await _quote(migrated, secret, 1, "a secret passage of the other workspace")

    after = await _rows(quotes.world, api)
    theirs_read = await _rows(other, api)

    assert after == before
    assert "secret passage" not in str(after)
    assert [row["quote"] for row in theirs_read] == ["a secret passage of the other workspace"]


async def test_the_list_costs_the_statements_it_cost_before_the_quote(
    api: httpx.AsyncClient, resources: Resources, quotes: Quotes
) -> None:
    """The quote is a column of the statement that reads the rows, not a statement of its own."""
    await _rows(quotes.world, api)
    with statements(resources) as seen:
        await _rows(quotes.world, api)

    assert len(seen) == CITATION_LIST_STATEMENTS, seen
