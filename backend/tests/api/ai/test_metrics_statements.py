"""Statement counts of the metric routes (contract C8, change C-13): a route costs the statements
of the summary request it makes plus a fixed number of reads of its own, whatever the number of
prompts, answers or engines. Asserted as differences, never as absolute figures (what the summary
reads may change, what a metric route adds may not), after one warm read so each counted read
starts alike."""

from __future__ import annotations

from typing import Any

import httpx

from idraft.api.resources import Resources
from tests.api.ai import summary_support
from tests.api.ai.metrics_support import OVERVIEW, OVERVIEW_AI, Route, get_metric, get_overview
from tests.api.ai.summary_support import (
    Summary,
    full_project,
    get_summary,
    new_topic,
    statements,
)
from tests.api.auth.support import execute
from tests.conftest import PostgresServer

seeded = summary_support.seeded

# The Overview reads, in a second transaction after its summary request: the scope of the
# transaction, the citation units by engine and role (citation share) and the day each entity
# configuration took effect.
OVERVIEW_EXTRA = 3
# What the summary request of the Overview asks for.
OVERVIEW_SUMMARY = {"include": "total,cells"}


async def _overview(
    world: Summary, api: httpx.AsyncClient, resources: Resources, route: Route, **params: Any
) -> int:
    with statements(resources) as seen:
        response = await get_overview(world, api, route, **params)
    assert response.status_code == 200, response.text
    return len(seen)


async def _summary(
    world: Summary, api: httpx.AsyncClient, resources: Resources, **params: Any
) -> int:
    with statements(resources) as seen:
        response = await get_summary(world, api, **OVERVIEW_SUMMARY, **params)
    assert response.status_code == 200, response.text
    return len(seen)


async def _extra(
    world: Summary, api: httpx.AsyncClient, resources: Resources, **params: Any
) -> int:
    """The statements the Overview adds to the summary request it makes, for the same scope."""
    await get_overview(world, api, **params)
    both = await _overview(world, api, resources, OVERVIEW, **params)
    assert await _overview(world, api, resources, OVERVIEW_AI, **params) == both
    return both - await _summary(world, api, resources, **params)


async def test_the_overview_adds_a_fixed_number_of_statements_to_its_summary_request(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, seeded: Summary
) -> None:
    """Over a small world (14 answers) and over the base plan (150 prompts, three engines, 3,600
    answers) the Overview adds the same reads; `compare` adds the summary's own one."""
    world = await full_project(resources, migrated)

    for each in (seeded, world):
        assert await _extra(each, api, resources) == OVERVIEW_EXTRA
        plain = await _overview(each, api, resources, OVERVIEW)
        for params in (
            {"compare": "previous_period"},
            {"compare_from": summary_support.day(40), "compare_to": summary_support.day(30)},
        ):
            # The summary's own read of the window compared with, and nothing of the Overview's.
            assert await _extra(each, api, resources, **params) == OVERVIEW_EXTRA, params
            compared = await _overview(each, api, resources, OVERVIEW, **params)
            assert compared - plain == 1, params
        for params in ({"include_branded": "true"}, {"filter[engine_code_in]": "chatgpt_web"}):
            assert await _extra(each, api, resources, **params) == OVERVIEW_EXTRA, params


# A value or a series reads, in a second transaction after its summary request, the scope of the
# transaction and the day each entity configuration took effect (the meta names them, C-21); the
# citation share of a value also reads the citation units by engine and role.
METRIC_EXTRA = 2
CITATION_SHARE_EXTRA = 3
# (key, route tail, what its summary request asks for, what the route is asked besides, extra reads)
ENTITIES = {"entity_ids": "{own},{rival}"}
CASES = [
    ("ai.mention_rate", (), {"rows": "none", "include": "total"}, {}, METRIC_EXTRA),
    ("ai.citation_rate", (), {"rows": "none", "include": "total"}, {}, METRIC_EXTRA),
    ("ai.outcome_mix", (), {"rows": "none", "include": "total"}, {}, METRIC_EXTRA),
    ("ai.share_of_voice", (), {"rows": "none", "include": "total"}, {}, METRIC_EXTRA),
    ("ai.valid_answers", (), {"rows": "none", "include": "total"}, {}, METRIC_EXTRA),
    ("ai.prompts_in_scope", (), {"rows": "none", "include": "total"}, {}, METRIC_EXTRA),
    ("ai.recommendation_rate", (), {"rows": "none", "include": "total"}, {}, METRIC_EXTRA),
    ("ai.first_mention_rate", (), {"rows": "none", "include": "total,cells"}, {}, METRIC_EXTRA),
    ("ai.fanout_mean_queries", (), {"rows": "none", "include": "total,cells"}, {}, METRIC_EXTRA),
    ("ai.mention_rate", (), {"rows": "none", "include": "total,entities"}, ENTITIES, METRIC_EXTRA),
    (
        "ai.share_of_voice",
        (),
        {"rows": "none", "include": "total,entities"},
        ENTITIES,
        METRIC_EXTRA,
    ),
    ("ai.citation_share", (), {"include": "total"}, {}, CITATION_SHARE_EXTRA),
    ("ai.mention_rate", ("series",), {"rows": "none", "include": "total,series"}, {}, METRIC_EXTRA),
    (
        "ai.share_of_voice",
        ("series",),
        {"rows": "none", "include": "total,series,entities"},
        ENTITIES,
        METRIC_EXTRA,
    ),
]


async def _metric(
    world: Summary,
    api: httpx.AsyncClient,
    resources: Resources,
    key: str,
    tail: tuple[str, ...],
    **params: Any,
) -> int:
    with statements(resources) as seen:
        response = await get_metric(world, api, key, *tail, **params)
    assert response.status_code == 200, response.text
    return len(seen)


def _asked(world: Summary, case: tuple[Any, ...], **params: Any) -> dict[str, Any]:
    """What the route is asked, with the ids of the entities of the world written in."""
    ids = {"own": world.own, "rival": world.rival}
    return {**{k: v.format(**ids) for k, v in case[3].items()}, **params}


async def _metric_extra(
    world: Summary,
    api: httpx.AsyncClient,
    resources: Resources,
    case: tuple[Any, ...],
    **scope: Any,
) -> int:
    """The statements a value or a series adds to the summary request it makes, same scope."""
    key, tail, summary, _, _ = case
    asked = _asked(world, case, **scope)
    await get_metric(world, api, key, *tail, **asked)
    both = await _metric(world, api, resources, key, tail, **asked)
    with statements(resources) as seen:
        response = await get_summary(world, api, **summary, **scope)
    assert response.status_code == 200, response.text
    return both - len(seen)


async def test_a_value_or_a_series_adds_a_fixed_number_of_statements_to_its_summary_request(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, seeded: Summary
) -> None:
    """Over a small world (14 answers) and over the base plan (150 prompts, three engines, 3,600
    answers) a route adds the same reads to the summary request it makes: whatever the number of
    prompts, answers or engines, and whichever scope."""
    world = await full_project(resources, migrated)

    for case in CASES:
        extra = case[-1]
        for each in (seeded, world):
            assert await _metric_extra(each, api, resources, case) == extra, case[:2]
            for scope in ({"include_branded": "true"}, {"filter[engine_code_in]": "chatgpt_web"}):
                assert await _metric_extra(each, api, resources, case, **scope) == extra, (
                    case[:2],
                    scope,
                )


async def test_compare_adds_the_summarys_own_read_to_a_value_and_nothing_else(
    api: httpx.AsyncClient, resources: Resources, seeded: Summary
) -> None:
    """A series has no compare, so only the value routes are asked for one."""
    compared = {"compare": "previous_period"}

    for case in [case for case in CASES if not case[1]]:
        key, tail, _, _, extra = case
        assert await _metric_extra(seeded, api, resources, case, **compared) == extra, case[:2]
        asked = _asked(seeded, case)
        await _metric(seeded, api, resources, key, tail, **asked)
        base = await _metric(seeded, api, resources, key, tail, **asked)
        more = await _metric(seeded, api, resources, key, tail, **asked, **compared) - base
        # The summary's own read of the window compared with, and one more for the entities'.
        assert more == (2 if "entities" in case[2]["include"] else 1), case[:2]


async def test_a_value_or_a_series_of_no_prompt_reads_nothing_of_its_own(
    api: httpx.AsyncClient, resources: Resources, seeded: Summary
) -> None:
    """No prompt in scope: the cells are empty and there is no citation or configuration to read."""
    for case in CASES:
        extra = await _metric_extra(seeded, api, resources, case, **{"filter[country_iso]": "FR"})

        assert extra == 0, case[:2]


async def test_an_overview_of_no_prompt_reads_nothing_of_its_own(
    api: httpx.AsyncClient, resources: Resources, seeded: Summary
) -> None:
    """No prompt in scope: the cells are empty and there is no citation to count."""
    assert await _extra(seeded, api, resources, **{"filter[country_iso]": "FR"}) == 0


# A breakdown reads, in a second transaction after its summary request, the scope of the
# transaction and the day each entity configuration took effect (the meta names them, C-21); a
# dimension that is an attribute of the prompt also reads the attributes of the prompts in scope
# (`prompt_attributes`, which joins the persona's name, so the persona costs no more than the
# rest). The summary request is the one the dimension needs: the topic rows, the total row, or the
# prompt rows (`rows` left out).
BREAKDOWN_EXTRA = 2
ATTRIBUTE_EXTRA = 3
BREAKDOWN_CASES = [
    ("topic", {"rows": "topics", "include": "total"}, BREAKDOWN_EXTRA),
    ("engine", {"rows": "none", "include": "total"}, BREAKDOWN_EXTRA),
    ("intent", {"include": "total"}, ATTRIBUTE_EXTRA),
    ("funnel_stage", {"include": "total"}, ATTRIBUTE_EXTRA),
    ("prompt_type", {"include": "total"}, ATTRIBUTE_EXTRA),
    ("language", {"include": "total"}, ATTRIBUTE_EXTRA),
    ("country", {"include": "total"}, ATTRIBUTE_EXTRA),
    ("persona", {"include": "total"}, ATTRIBUTE_EXTRA),
]


async def _breakdown(
    world: Summary,
    api: httpx.AsyncClient,
    resources: Resources,
    key: str,
    dimension: str,
    **params: Any,
) -> int:
    with statements(resources) as seen:
        response = await get_metric(world, api, key, "breakdown", dimension=dimension, **params)
    assert response.status_code == 200, response.text
    return len(seen)


async def _breakdown_extra(
    world: Summary,
    api: httpx.AsyncClient,
    resources: Resources,
    case: tuple[str, dict[str, str], int],
    key: str = "ai.mention_rate",
    **scope: Any,
) -> int:
    """The statements a breakdown adds to the summary request it makes, for the same scope."""
    dimension, summary, _ = case
    await get_metric(world, api, key, "breakdown", dimension=dimension, **scope)
    both = await _breakdown(world, api, resources, key, dimension, **scope)
    with statements(resources) as seen:
        response = await get_summary(world, api, **summary, **scope)
    assert response.status_code == 200, response.text
    return both - len(seen)


async def test_a_breakdown_adds_a_fixed_number_of_statements_to_its_summary_request(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, seeded: Summary
) -> None:
    """Over a small world (14 answers) and over the base plan (150 prompts, three engines, 3,600
    answers) each dimension adds the same reads: whatever the number of prompts, answers, groups or
    engines, and whichever scope or key."""
    world = await full_project(resources, migrated)

    for case in BREAKDOWN_CASES:
        extra = case[-1]
        for each in (seeded, world):
            assert await _breakdown_extra(each, api, resources, case) == extra, case[0]
            for scope in ({"include_branded": "true"}, {"filter[engine_code_in]": "chatgpt_web"}):
                assert await _breakdown_extra(each, api, resources, case, **scope) == extra, (
                    case[0],
                    scope,
                )
    # The key does not change the reads, except for the small cells, which are columns of the
    # same statement as the counts.
    topic = BREAKDOWN_CASES[0]
    assert (
        await _breakdown_extra(seeded, api, resources, topic, "ai.outcome_mix") == BREAKDOWN_EXTRA
    )
    detail = ("topic", {"rows": "topics", "include": "total,cells"}, BREAKDOWN_EXTRA)
    assert (
        await _breakdown_extra(seeded, api, resources, detail, "ai.first_mention_rate")
        == BREAKDOWN_EXTRA
    )


async def test_a_persona_breakdown_costs_the_same_whether_a_prompt_has_a_persona_or_not(
    api: httpx.AsyncClient, resources: Resources, migrated: PostgresServer, seeded: Summary
) -> None:
    persona = BREAKDOWN_CASES[-1]
    assert persona[0] == "persona"
    without = await _breakdown_extra(seeded, api, resources, persona)
    buyer = await new_topic(migrated, seeded.project, "Buyer", kind="persona")
    await execute(
        migrated,
        "UPDATE ai.prompts SET persona_term_id = $2 WHERE id = $1",
        seeded.prompts["providers"].id,
        buyer,
    )

    assert without == ATTRIBUTE_EXTRA
    assert await _breakdown_extra(seeded, api, resources, persona) == ATTRIBUTE_EXTRA


async def test_a_breakdown_of_no_prompt_reads_nothing_of_its_own(
    api: httpx.AsyncClient, resources: Resources, seeded: Summary
) -> None:
    """No prompt in scope: no group, no attribute and no configuration to read."""
    for case in BREAKDOWN_CASES:
        extra = await _breakdown_extra(
            seeded, api, resources, case, **{"filter[country_iso]": "FR"}
        )

        assert extra == 0, case[0]
