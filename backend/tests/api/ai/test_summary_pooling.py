"""Pooled weekly points (contract C2, change log C-10 and C-11): a point of a prompt row always
holds the trailing four weeks, and a point of a topic or total row does so when fewer than ten
prompts answered that week. The pool never leaves the window. Answers are written straight into
the tables, one valid answer per prompt and week on a Wednesday of a UTC project, so every
number is worked by hand."""

from __future__ import annotations

import hashlib
import uuid
from collections.abc import Sequence
from dataclasses import dataclass, fields, replace
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

import httpx
import pytest

from idraft.api.ai.summary import sum_counts
from idraft.api.ai.summary_repository import Counts
from idraft.api.resources import Resources
from tests.api.ai.summary_support import (
    Summary,
    assign_topic,
    cell,
    full_project,
    get_summary,
    new_prompts,
    new_topic,
    new_world,
    pooled,
    prompt_row,
    statements,
    summary_data,
    topic_row,
)
from tests.api.auth.support import execute, fetchrow
from tests.conftest import PostgresServer

BELOW = 10


def _base_week() -> date:
    """The Monday of this week, or a later one when four weeks before it would fall before the
    first partition (the first day of last month): answers are written at that Monday's weeks."""
    today = datetime.now(UTC).date()
    week = today - timedelta(days=today.weekday())
    reach = (today.replace(day=1) - timedelta(days=1)).replace(day=1)
    while week - timedelta(weeks=4) < reach:
        week += timedelta(weeks=1)
    return week


def _wednesday(week: date, weeks: int) -> datetime:
    """Noon on the Wednesday of the week `weeks` weeks after the Monday `week`."""
    return datetime.combine(week + timedelta(weeks=weeks, days=2), time(12), tzinfo=UTC)


def _span(first: date, last: date) -> dict[str, str]:
    return {"from": first.isoformat(), "to": last.isoformat()}


async def _write_answers(
    migrated: PostgresServer, world: Summary, answers: Sequence[tuple[str, datetime, bool]]
) -> None:
    """One valid ChatGPT answer for each (prompt name, when, names the own brand), as the facts
    ingest writes them."""
    raw = await fetchrow(
        migrated,
        "INSERT INTO ops.raw_payloads (storage, object_key, sha256, bytes_raw, bytes_stored, "
        "compression, content_type, provider_code, provider_endpoint, fetched_at, "
        "retention_class, expires_at) VALUES ('r2', $1, $2, 10, 10, 'zstd', "
        "'application/json', 'dataforseo', 'ai_optimization/chat_gpt/llm_scraper', now(), "
        "'ai_raw', now() + interval '400 days') RETURNING id",
        f"ai/pool/{uuid.uuid4()}",
        hashlib.sha256(uuid.uuid4().bytes).digest(),
    )
    derivation = await fetchrow(
        migrated,
        "INSERT INTO ai.derivations (workspace_id, project_id, extractor_version, "
        "entity_config_version, recommendation_version, sentiment_version) "
        "VALUES ($1, $2, 1, 1, 1, 1) ON CONFLICT ON CONSTRAINT derivations_identity "
        "DO UPDATE SET extractor_version = 1 RETURNING id",
        world.workspace.id,
        world.project.id,
    )
    await execute(
        migrated,
        "INSERT INTO ai.observations (observed_at, observed_date, workspace_id, project_id, "
        "engine_code, observation_class, prompt_id, prompt_version_id, query_text, "
        "provider_code, provider_endpoint, status, has_citations, raw_payload_id, "
        "adapter_version, normalizer_version, canonicalizer_version) "
        "SELECT a.at, (a.at AT TIME ZONE 'UTC')::date, p.workspace_id, p.project_id, e.code, "
        "e.observation_class, p.id, p.current_version_id, a.mark, 'dataforseo', "
        "'ai_optimization/chat_gpt/llm_scraper', 'complete', false, $4, 1, 1, 1 "
        "FROM unnest($1::uuid[], $2::timestamptz[], $3::text[]) AS a(prompt_id, at, mark) "
        "JOIN ai.prompts p ON p.id = a.prompt_id JOIN ai.engines e ON e.code = 'chatgpt_web'",
        [world.prompts[name].id for name, _, _ in answers],
        [when for _, when, _ in answers],
        ["m" if mentioned else "n" for _, _, mentioned in answers],
        raw["id"],
    )
    # The mark `m` names the own brand. Only the answers written now get a fact row.
    await execute(
        migrated,
        "INSERT INTO ai.observation_facts (observation_id, observed_at, derivation_id, "
        "workspace_id, project_id, observed_date, engine_code, observation_class, prompt_id, "
        "prompt_version_id, replicate_index, is_valid, own_mentioned, own_domain_cited, "
        "own_citation_count, total_citation_count, tracked_entities_mentioned, "
        "had_structured_list) SELECT o.id, o.observed_at, $2, o.workspace_id, o.project_id, "
        "o.observed_date, o.engine_code, o.observation_class, o.prompt_id, o.prompt_version_id, "
        "1, true, o.query_text = 'm', false, 0, 0, CASE WHEN o.query_text = 'm' THEN 1 ELSE 0 END, "
        "false FROM ai.observations o WHERE o.project_id = $1 AND NOT EXISTS "
        "(SELECT 1 FROM ai.observation_facts f "
        "WHERE f.observation_id = o.id AND f.observed_at = o.observed_at)",
        world.project.id,
        derivation["id"],
    )


async def _project(resources: Resources, migrated: PostgresServer, names: Sequence[str]) -> Summary:
    """A UTC project with ChatGPT enabled and the prompts `names`, all in the topic Managed SOC."""
    world = await new_world(resources, migrated)
    world = replace(world, prompts=await new_prompts(migrated, world, list(names)))
    topic = await new_topic(migrated, world.project, "Managed SOC")
    for name in names:
        await assign_topic(migrated, world, name, topic)
    return world


def _five_weeks(week: date) -> list[tuple[str, datetime, bool]]:
    """Prompt `a` answered once a week from W-4 to W; it names the own brand in W-3, W-1 and W."""
    named = (False, True, False, True, True)
    return [("a", _wednesday(week, offset), named[offset + 4]) for offset in range(-4, 1)]


def _series(row: dict[str, Any]) -> list[dict[str, Any]]:
    series: list[dict[str, Any]] = row["engines"][0]["series"]
    return series


def _pool(point: dict[str, Any]) -> tuple[int, str, str, str, int]:
    """(weeks, window from, window to, reason, below_prompts) of a pooled point."""
    pool = point["pool"]
    return (
        pool["weeks"],
        pool["window"]["from"],
        pool["window"]["to"],
        pool["reason"],
        pool["below_prompts"],
    )


def _days(*days: date) -> list[str]:
    return [day.isoformat() for day in days]


async def test_a_prompt_point_pools_the_trailing_four_weeks(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """One prompt answered once a week for the five weeks W-4 to W, naming the own brand in the
    weeks W-3, W-1 and W. The point of a week holds the answers of its own week and the three
    before it, so the last point has dropped W-4."""
    world = await _project(resources, migrated, ["a"])
    week = _base_week()
    await _write_answers(migrated, world, _five_weeks(week))

    data = await summary_data(
        world, api, include="series", **_span(week - timedelta(weeks=4), week + timedelta(days=6))
    )

    points = _series(prompt_row(data, world, "a"))
    assert [point["week_start"] for point in points] == _days(
        *(week - timedelta(weeks=n) for n in range(4, -1, -1))
    )
    assert [cell(point["mentioned"]) for point in points] == [
        (0, 1, 1),
        (1, 2, 2),
        (1, 3, 3),
        (2, 4, 4),
        (3, 4, 4),
    ]
    assert points[4]["mentioned"]["value"] == pytest.approx(0.75)
    for point in points:
        assert point["mentioned"]["pooled"] is None
        assert point["is_pooled"] is True
        assert point["prompts"] == 1
    assert [_pool(point) for point in points] == [
        (
            1,
            *_days(week - timedelta(weeks=4), week - timedelta(weeks=4) + timedelta(days=6)),
            "prompt_point",
            BELOW,
        ),
        (
            2,
            *_days(week - timedelta(weeks=4), week - timedelta(weeks=3) + timedelta(days=6)),
            "prompt_point",
            BELOW,
        ),
        (
            3,
            *_days(week - timedelta(weeks=4), week - timedelta(weeks=2) + timedelta(days=6)),
            "prompt_point",
            BELOW,
        ),
        (
            4,
            *_days(week - timedelta(weeks=4), week - timedelta(weeks=1) + timedelta(days=6)),
            "prompt_point",
            BELOW,
        ),
        (4, *_days(week - timedelta(weeks=3), week + timedelta(days=6)), "prompt_point", BELOW),
    ]
    assert points[0]["pool"]["window"]["timezone"] == "UTC"


async def test_the_first_point_pool_is_clipped_at_the_window_start(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """The window opens on the Thursday of W-4, after that week's Wednesday answer: the answer is
    outside the window and in no pool, and no pool starts before the Thursday."""
    world = await _project(resources, migrated, ["a"])
    week = _base_week()
    await _write_answers(migrated, world, _five_weeks(week))
    opens = week - timedelta(weeks=4) + timedelta(days=3)

    data = await summary_data(
        world, api, include="series", **_span(opens, week + timedelta(days=6))
    )

    points = _series(prompt_row(data, world, "a"))
    assert [cell(point["mentioned"]) for point in points] == [
        (0, 0, 0),
        (1, 1, 1),
        (1, 2, 2),
        (2, 3, 3),
        (3, 4, 4),
    ]
    assert points[0]["mentioned"]["value"] is None
    assert [point["prompts"] for point in points] == [0, 1, 1, 1, 1]
    starts = [point["pool"]["window"]["from"] for point in points]
    assert starts == _days(opens, opens, opens, opens, week - timedelta(weeks=3))
    assert [point["pool"]["weeks"] for point in points] == [1, 2, 3, 4, 4]
    assert points[0]["pool"]["window"]["to"] == (week - timedelta(weeks=3, days=1)).isoformat()


@dataclass(frozen=True)
class Ten:
    """Ten prompts of one topic. Every one was answered in the week W-1 (p1 and p2 name the own
    brand); in the week W p1 to p9 were (p1 to p5 name it) and p10 was not."""

    world: Summary
    week: date


@pytest.fixture
async def ten(resources: Resources, migrated: PostgresServer) -> Ten:
    names = [f"p{number}" for number in range(1, 11)]
    world = await _project(resources, migrated, names)
    week = _base_week()
    await _write_answers(
        migrated,
        world,
        [(name, _wednesday(week, -1), name in ("p1", "p2")) for name in names]
        + [(name, _wednesday(week, 0), number <= 5) for number, name in enumerate(names[:9], 1)],
    )
    return Ten(world, week)


def _two_weeks(ten: Ten) -> dict[str, str]:
    return _span(ten.week - timedelta(weeks=1), ten.week + timedelta(days=6))


async def test_a_topic_week_with_nine_prompts_pools_and_with_ten_does_not(
    api: httpx.AsyncClient, migrated: PostgresServer, ten: Ten
) -> None:
    week = ten.week
    data = await summary_data(ten.world, api, include="series", **_two_weeks(ten))

    before, now = _series(topic_row(data, "Managed SOC"))
    # Ten prompts answered in W-1: its own cells, two of them naming the own brand.
    assert (before["prompts"], before["is_pooled"]) == (10, False)
    assert "pool" not in before
    assert cell(before["mentioned"]) == (2, 10, 10)
    # Nine answered in W: the point holds W-1 and W. p1 and p2 are 2 of 2, p3 to p5 1 of 2, p6
    # to p9 0 of 2, and p10 0 of 1: 3.5 over 10 prompts, 7 of 19 answers.
    assert (now["prompts"], now["is_pooled"]) == (9, True)
    assert _pool(now) == (
        2,
        (week - timedelta(weeks=1)).isoformat(),
        (week + timedelta(days=6)).isoformat(),
        "few_prompts",
        BELOW,
    )
    assert cell(now["mentioned"]) == (3.5, 10, 19)
    assert pooled(now["mentioned"]) == (7, 19)
    assert cell(now["cited"]) == (0, 10, 19)
    assert cell(now["share_of_voice"]) == (7, 7, 19)

    # The tenth prompt answers in W: ten prompts, so the point is the week's own cells.
    await _write_answers(migrated, ten.world, [("p10", _wednesday(week, 0), False)])
    data = await summary_data(ten.world, api, include="series", **_two_weeks(ten))

    before, now = _series(topic_row(data, "Managed SOC"))
    assert (now["prompts"], now["is_pooled"]) == (10, False)
    assert "pool" not in now
    assert cell(now["mentioned"]) == (5, 10, 10)
    assert pooled(now["mentioned"]) == (5, 10)
    assert cell(before["mentioned"]) == (2, 10, 10)


async def test_a_week_with_ten_prompts_stays_its_own_when_its_neighbour_pools(
    api: httpx.AsyncClient, ten: Ten
) -> None:
    """In the window W-1 to W the week W-1 has ten prompts and W has nine: W pools over both,
    W-1 reaches back no further than itself and is not pooled."""
    data = await summary_data(ten.world, api, include="series", **_two_weeks(ten))

    before, now = _series(topic_row(data, "Managed SOC"))
    assert before["is_pooled"] is False
    assert before["week_start"] == (ten.week - timedelta(weeks=1)).isoformat()
    assert now["is_pooled"] is True
    assert now["pool"]["weeks"] == 2


async def test_total_points_follow_the_same_rule_as_topic_points(
    api: httpx.AsyncClient, migrated: PostgresServer, ten: Ten
) -> None:
    """The total row holds the same ten prompts as the topic, so its points are the topic's:
    pooled with nine answering, its own with ten. (A country row follows the rule through the same
    code: task 6 tests it when `by_country` is built.)"""
    data = await summary_data(ten.world, api, include="series,total", **_two_weeks(ten))

    topic = _series(topic_row(data, "Managed SOC"))
    assert [point["is_pooled"] for point in topic] == [False, True]
    assert data["total"]["engines"][0]["series"] == topic

    await _write_answers(migrated, ten.world, [("p10", _wednesday(ten.week, 0), False)])
    data = await summary_data(ten.world, api, include="series,total", **_two_weeks(ten))

    topic = _series(topic_row(data, "Managed SOC"))
    assert [point["is_pooled"] for point in topic] == [False, False]
    assert data["total"]["engines"][0]["series"] == topic


async def test_an_empty_topic_week_pools(api: httpx.AsyncClient, ten: Ten) -> None:
    """Two weeks before W nothing was answered: no prompt answered, so the point pools, over the
    one week it can reach inside the window, and holds counts of 0 and no value."""
    week = ten.week
    window = _span(week - timedelta(weeks=2), week + timedelta(days=6))

    data = await summary_data(ten.world, api, include="series", **window)

    empty, before, now = _series(topic_row(data, "Managed SOC"))
    assert (empty["prompts"], empty["is_pooled"]) == (0, True)
    assert _pool(empty)[0] == 1
    assert empty["pool"]["reason"] == "few_prompts"
    assert cell(empty["mentioned"]) == (0, 0, 0)
    assert empty["mentioned"]["value"] is None
    assert pooled(empty["mentioned"]) == (0, 0)
    assert before["is_pooled"] is False
    # The week W reaches back to the start of the window, three weeks, and holds the same
    # answers as when the window was two weeks long.
    assert now["pool"]["weeks"] == 3
    assert pooled(now["mentioned"]) == (7, 19)


async def test_previous_and_window_cells_are_not_pooled(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """One prompt answered weekly from W-4 to W (names the own brand in W-3, W-1 and W). The
    window is W-1 to W and the window compared with is W-4 to W-2: only the points are pooled,
    and only inside the window."""
    world = await _project(resources, migrated, ["a"])
    week = _base_week()
    await _write_answers(migrated, world, _five_weeks(week))
    window = {
        **_span(week - timedelta(weeks=1), week + timedelta(days=6)),
        **{
            "compare_from": (week - timedelta(weeks=4)).isoformat(),
            "compare_to": (week - timedelta(days=8)).isoformat(),
        },
    }

    data = await summary_data(world, api, include="series", **window)
    plain = await summary_data(world, api, **window)

    row = prompt_row(data, world, "a")["engines"][0]
    # The window cell is the two answers of the window; `previous` the three of the compare
    # window (W-4, W-3 and W-2, one of them naming the brand): neither is pooled, neither moved.
    assert cell(row["mentioned"]) == (2, 2, 2)
    assert row["mentioned"]["pooled"] is None
    assert cell(row["previous"]["mentioned"]) == (1, 3, 3)
    assert row["previous"]["mentioned"]["pooled"] is None
    plain_row = prompt_row(plain, world, "a")["engines"][0]
    for name in ("mentioned", "cited", "share_of_voice", "previous"):
        assert row[name] == plain_row[name]
    topic = topic_row(data, "Managed SOC")["engines"][0]
    assert pooled(topic["mentioned"]) == (2, 2)
    assert topic["mentioned"] == topic_row(plain, "Managed SOC")["engines"][0]["mentioned"]
    # The points hold the window only: W-1 alone, then W-1 and W. W-2 and before, which the
    # window compared with read, are in no pool.
    first, last = row["series"]
    assert (cell(first["mentioned"]), first["pool"]["weeks"]) == ((1, 1, 1), 1)
    assert (cell(last["mentioned"]), last["pool"]["weeks"]) == ((2, 2, 2), 2)
    assert first["pool"]["window"]["from"] == window["from"]


async def test_pooling_adds_no_statement(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer
) -> None:
    """`include=series` is one statement more than the plain summary at full capacity, pooled
    points or not: pooling is Python over the weekly counts already read."""
    world = await full_project(resources, migrated)
    await get_summary(world, api)
    with statements(resources) as plain:
        await get_summary(world, api)
    with statements(resources) as seen:
        response = await get_summary(world, api, include="series")

    assert response.status_code == 200, response.text
    assert len(seen) - len(plain) == 1, seen


def test_sum_counts_adds_every_count_and_keeps_the_newest_times() -> None:
    older, newer = datetime(2026, 11, 2, tzinfo=UTC), datetime(2026, 11, 9, tzinfo=UTC)
    first = Counts(
        1, 2, 3, 4, 5, 6, 7, 8, 9, 0.5, last_observed_at=older, last_valid_at=older, lost_to=11
    )
    second = Counts(10, 20, 30, 40, 50, 60, 70, 80, 90, 1.5, last_observed_at=newer, lost_to=110)
    # A count a later task adds to `Counts` must be given a value here and be summed.
    assert all(
        getattr(first, f.name) and getattr(second, f.name)
        for f in fields(Counts)
        if not f.name.startswith("last_")
    )

    total = sum_counts([first, second])

    for f in fields(Counts):
        if not f.name.startswith("last_"):
            assert getattr(total, f.name) == getattr(first, f.name) + getattr(second, f.name)
    assert (total.n_observations, total.sov_share) == (11, 2.0)
    assert (total.last_observed_at, total.last_valid_at) == (newer, older)
    assert sum_counts([]) == Counts()
