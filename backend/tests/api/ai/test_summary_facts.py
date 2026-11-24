"""`position`, `other_brands` and `top_links` of an engine with `include=facts`: where the own brand
is named in the valid answers, the other brands they name and the pages they cite. The numbers are
worked by hand from the seeded world of `test_prompts_summary` (its docstring lists each answer)."""

from __future__ import annotations

from typing import Any

import httpx
import pytest

from idraft.api.ai import summary_repository
from idraft.collectors.ai_prompt_ingest import ingest
from tests.api.ai import summary_support
from tests.api.ai.summary_support import (
    CHATGPT,
    GEMINI,
    OWN_PAGE,
    Summary,
    answer_in_another_project,
    by,
    cell,
    prompt_row,
    summary_data,
    topic_row,
)
from tests.api.ai.test_prompts_summary import OTHER_PAGE, RIVAL_PAGE
from tests.api.auth.support import execute, make_workspace
from tests.api.keywords.test_tracked_keyword_ranks import Ledger
from tests.collectors.ai_support import OWN_HOST, RIVAL_HOST, RIVAL_NAME
from tests.collectors.test_fetching import MemoryStore
from tests.conftest import PostgresServer

seeded = summary_support.seeded


def _engine(row: dict[str, Any], code: str) -> dict[str, Any]:
    engine: dict[str, Any] = by(row["engines"], "engine_code")[code]
    return engine


async def test_a_prompt_row_counts_where_the_own_brand_is_named(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    """`providers` on ChatGPT has five valid answers in the window. The own brand is named in
    the first (`BOTH`, before the rival) and in the second: two answers, both first."""
    data = await summary_data(seeded, api, include="facts")

    position = _engine(prompt_row(data, seeded, "providers"), CHATGPT)["position"]
    assert position == {"rank_sum": 2, "ordered_answers": 2, "mentions": 2, "answers": 5}
    gemini = _engine(prompt_row(data, seeded, "providers"), GEMINI)["position"]
    assert gemini["answers"] == 1
    assert gemini["mentions"] == 1
    assert gemini["ordered_answers"] == 1
    assert gemini["rank_sum"] in (1, 2)


async def test_an_engine_without_a_valid_answer_has_counts_of_zero_not_null(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    data = await summary_data(seeded, api, include="facts")

    engine = _engine(prompt_row(data, seeded, "pricing"), GEMINI)
    assert engine["position"] == {"rank_sum": 0, "ordered_answers": 0, "mentions": 0, "answers": 0}
    assert engine["other_brands"] == []
    assert engine["top_links"] == []


async def test_the_other_brands_are_the_competitors_the_answers_name(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    """The rival is named in the first answer and is the only brand of the fourth: two of the
    five valid answers. The own brand is never in the list."""
    data = await summary_data(seeded, api, include="facts")

    engine = _engine(prompt_row(data, seeded, "providers"), CHATGPT)
    assert [brand["name"] for brand in engine["other_brands"]] == [RIVAL_NAME]
    assert cell(engine["other_brands"][0]["mentioned"]) == (2, 5, 6)
    nobody = _engine(prompt_row(data, seeded, "misc"), CHATGPT)
    assert nobody["other_brands"] == []


async def test_the_top_links_count_each_page_once_per_answer_and_name_who_owns_it(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    """Two answers cite the outside page and two the own page, one the rival's: most cited first,
    then by address. The refusal, the superseded and the not current answers cite nothing."""
    data = await summary_data(seeded, api, include="facts")

    links = _engine(prompt_row(data, seeded, "providers"), CHATGPT)["top_links"]
    assert [
        (link["url"], link["domain"], link["domain_role"], link["answers"]) for link in links
    ] == [
        *sorted(
            [
                (OWN_PAGE, OWN_HOST, "own", 2),
                (OTHER_PAGE, "news.example", "third_party", 2),
            ],
            key=lambda entry: entry[0],
        ),
        (RIVAL_PAGE, RIVAL_HOST, "competitor", 1),
    ]


async def test_a_flagged_citation_is_left_out_as_it_is_on_the_sources_page(
    api: httpx.AsyncClient, seeded: Summary, migrated: PostgresServer
) -> None:
    await execute(
        migrated,
        "UPDATE ai.citations SET flags = ARRAY['engine_internal'] WHERE raw_url = $1",
        OTHER_PAGE,
    )

    data = await summary_data(seeded, api, include="facts")

    links = _engine(prompt_row(data, seeded, "providers"), CHATGPT)["top_links"]
    assert OTHER_PAGE not in [link["url"] for link in links]


async def test_the_lists_are_cut_at_the_limit_and_keep_the_most_named_and_cited(
    api: httpx.AsyncClient, seeded: Summary, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(summary_repository, "FACT_LIST_LIMIT", 1)

    data = await summary_data(seeded, api, include="facts")

    engine = _engine(prompt_row(data, seeded, "providers"), CHATGPT)
    assert len(engine["top_links"]) == 1
    assert engine["top_links"][0]["answers"] == 2
    assert len(engine["other_brands"]) == 1


async def test_topic_total_and_country_rows_carry_position_sums_and_no_lists(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    """`Managed SOC` holds `providers` and `pricing` (the archived prompt is out): ChatGPT has
    six valid answers in them and two name the own brand first."""
    data = await summary_data(seeded, api, include="facts,total", group_by="country")

    rows = [
        _engine(topic_row(data, "Managed SOC"), CHATGPT),
        _engine(data["total"], CHATGPT),
    ]
    assert rows[0]["position"] == {"rank_sum": 2, "ordered_answers": 2, "mentions": 2, "answers": 6}
    assert rows[1]["position"]["ordered_answers"] == 3
    for engine in rows:
        assert "other_brands" not in engine
        assert "top_links" not in engine


async def test_the_facts_are_left_out_unless_asked_for(
    api: httpx.AsyncClient, seeded: Summary
) -> None:
    data = await summary_data(seeded, api)

    engine = _engine(prompt_row(data, seeded, "providers"), CHATGPT)
    for key in ("position", "other_brands", "top_links"):
        assert key not in engine


async def test_another_projects_answers_are_not_in_the_facts(
    api: httpx.AsyncClient,
    migrated: PostgresServer,
    worker_db: Ledger,
    import_store: MemoryStore,
    seeded: Summary,
) -> None:
    before = await summary_data(seeded, api, include="facts,total", group_by="country")
    other_workspace = await make_workspace(migrated)
    for number, workspace_id in enumerate((seeded.workspace.id, other_workspace.id)):
        await answer_in_another_project(
            migrated, worker_db, import_store, workspace_id, f"Otherco{number}", 1
        )
    await ingest(worker_db, import_store)

    after = await summary_data(seeded, api, include="facts,total", group_by="country")

    assert after == before
