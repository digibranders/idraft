"""Raising alerts after runs and checks, against stored facts (no provider call)."""

from __future__ import annotations

import json

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.alerts.evaluate import evaluate_alerts
from tests.alerts.support import (
    CHATGPT,
    GEMINI,
    World,
    add_answer,
    add_rank_event,
    add_tracked_keyword,
    alerts,
    make_rule,
    make_run,
    make_world,
    set_cursor,
)
from tests.api.auth.support import execute, fetchrow
from tests.collectors.ai_support import add_prompt
from tests.conftest import PostgresServer

Sessions = async_sessionmaker[AsyncSession]


async def _two_runs(
    pg: PostgresServer,
    world: World,
    before: dict[str, object],
    after: dict[str, object],
    *,
    engines: tuple[str, ...] = (CHATGPT,),
) -> None:
    """A run 3 hours ago and one 2 hours ago, each with one answer per engine."""
    for hours, facts in ((3, before), (2, after)):
        run_id, completed_at = await make_run(pg, world.project, hours_ago=hours)
        for engine in engines:
            await add_answer(pg, world, run_id, completed_at, engine=engine, **facts)  # type: ignore[arg-type]


async def test_the_first_pass_only_marks_where_to_start_and_raises_nothing(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    world = await make_world(migrated)
    await make_rule(migrated, world.project, "ai_mention_lost")
    await _two_runs(migrated, world, {"mentioned": True}, {"mentioned": False})

    await evaluate_alerts(worker_db)

    assert await alerts(migrated, world.project) == []
    cursor = await fetchrow(
        migrated,
        "SELECT last_completed_at FROM ops.alert_cursors WHERE project_id = $1",
        world.project.id,
    )
    assert cursor["last_completed_at"] is not None


async def test_a_lost_mention_is_raised_once_with_both_runs_counts(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    world = await make_world(migrated)
    rule_id = await make_rule(migrated, world.project, "ai_mention_lost")
    await set_cursor(migrated, world.project, hours_ago=5)
    await _two_runs(migrated, world, {"mentioned": True}, {"mentioned": False})

    first = await evaluate_alerts(worker_db)
    again = await evaluate_alerts(worker_db)

    assert (first.raised, again.raised) == (1, 0)
    [alert] = await alerts(migrated, world.project)
    assert (alert["rule_id"], alert["event_kind"], alert["severity"]) == (
        rule_id,
        "ai_mention_lost",
        "warning",
    )
    assert alert["subject_type"] == "prompt"
    assert alert["subject_id"] == str(world.prompt.id)
    assert alert["subject_label"] == "best event security companies in Chicago"
    evidence = json.loads(alert["evidence"])
    assert evidence["engine_code"] == CHATGPT
    assert evidence["before"] == {"mentioning": 1, "valid": 1}
    assert evidence["after"] == {"mentioning": 0, "valid": 1}


async def test_replaying_the_same_runs_after_the_cursor_is_lost_raises_nothing_new(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    world = await make_world(migrated)
    await make_rule(migrated, world.project, "ai_mention_lost")
    await set_cursor(migrated, world.project, hours_ago=5)
    await _two_runs(migrated, world, {"mentioned": True}, {"mentioned": False})
    await evaluate_alerts(worker_db)

    await set_cursor(migrated, world.project, hours_ago=5)
    replay = await evaluate_alerts(worker_db)

    assert replay.raised == 0
    assert len(await alerts(migrated, world.project)) == 1


async def test_two_platforms_in_one_run_raise_two_alerts(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    world = await make_world(migrated)
    await make_rule(migrated, world.project, "ai_mention_lost")
    await set_cursor(migrated, world.project, hours_ago=5)
    await _two_runs(
        migrated, world, {"mentioned": True}, {"mentioned": False}, engines=(CHATGPT, GEMINI)
    )

    await evaluate_alerts(worker_db)

    found = await alerts(migrated, world.project)
    assert sorted(json.loads(a["evidence"])["engine_code"] for a in found) == [CHATGPT, GEMINI]


async def test_a_competitor_that_appears_is_named_in_the_alert(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    world = await make_world(migrated)
    await make_rule(migrated, world.project, "ai_competitor_appeared")
    await set_cursor(migrated, world.project, hours_ago=5)
    await _two_runs(migrated, world, {}, {"rivals": [world.ai.rival]})

    await evaluate_alerts(worker_db)

    [alert] = await alerts(migrated, world.project)
    assert alert["event_kind"] == "ai_competitor_appeared"
    assert json.loads(alert["evidence"])["competitor"] == {
        "id": str(world.ai.rival),
        "name": "CyberNX",
    }


async def test_only_the_rules_of_the_kind_raise_their_kind(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    world = await make_world(migrated)
    await make_rule(migrated, world.project, "ai_mention_gained")
    await set_cursor(migrated, world.project, hours_ago=5)
    await _two_runs(migrated, world, {"mentioned": True}, {"mentioned": False})

    await evaluate_alerts(worker_db)

    assert await alerts(migrated, world.project) == []


async def test_a_run_that_collected_nothing_is_not_the_previous_run(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    world = await make_world(migrated)
    await make_rule(migrated, world.project, "ai_mention_lost")
    await set_cursor(migrated, world.project, hours_ago=6)
    good, good_at = await make_run(migrated, world.project, hours_ago=4)
    await add_answer(migrated, world, good, good_at, mentioned=True)
    # A budget-blocked run and a run whose answers were all unusable, between the two.
    await make_run(migrated, world.project, hours_ago=3, status="budget_blocked")
    bad, bad_at = await make_run(migrated, world.project, hours_ago=2.5)
    await add_answer(migrated, world, bad, bad_at, mentioned=False, valid=False)
    latest, latest_at = await make_run(migrated, world.project, hours_ago=2)
    await add_answer(migrated, world, latest, latest_at, mentioned=False)

    await evaluate_alerts(worker_db)

    found = await alerts(migrated, world.project)
    assert [a["event_kind"] for a in found] == ["ai_mention_lost"]


async def test_an_answer_that_is_not_valid_never_makes_a_change(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    world = await make_world(migrated)
    await make_rule(migrated, world.project, "ai_mention_lost")
    await set_cursor(migrated, world.project, hours_ago=5)
    await _two_runs(migrated, world, {"mentioned": True}, {"mentioned": False, "valid": False})

    await evaluate_alerts(worker_db)

    assert await alerts(migrated, world.project) == []


async def test_the_cursor_moves_with_no_active_rule_so_a_rule_switched_on_later_is_quiet(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    world = await make_world(migrated)
    rule_id = await make_rule(migrated, world.project, "ai_mention_lost", active=False)
    await set_cursor(migrated, world.project, hours_ago=5)
    await _two_runs(migrated, world, {"mentioned": True}, {"mentioned": False})
    await evaluate_alerts(worker_db)

    await execute(migrated, "UPDATE ops.alert_rules SET is_active = true WHERE id = $1", rule_id)
    await evaluate_alerts(worker_db)

    assert await alerts(migrated, world.project) == []


async def test_a_rule_made_after_the_run_does_not_raise_for_it(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    world = await make_world(migrated)
    await make_rule(migrated, world.project, "ai_mention_lost", created_days_ago=0)
    await set_cursor(migrated, world.project, hours_ago=5)
    await _two_runs(migrated, world, {"mentioned": True}, {"mentioned": False})

    await evaluate_alerts(worker_db)

    assert await alerts(migrated, world.project) == []


async def test_the_scope_narrows_by_platform_and_by_group(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    world = await make_world(migrated)
    other = await add_prompt(migrated, world.project, "who provides festival security staff")
    vocabulary = await fetchrow(
        migrated,
        "INSERT INTO core.taxonomy_vocabularies (workspace_id, name, kind) "
        "VALUES ($1, 'Groups', 'topic') RETURNING id",
        world.project.workspace_id,
    )
    term = await fetchrow(
        migrated,
        "INSERT INTO core.taxonomy_terms (workspace_id, vocabulary_id, name, slug, path) "
        "VALUES ($1, $2, 'Event', 'event', 'event') RETURNING id",
        world.project.workspace_id,
        vocabulary["id"],
    )
    await execute(
        migrated,
        "INSERT INTO ai.prompt_terms (prompt_id, term_id, workspace_id) VALUES ($1, $2, $3)",
        other.id,
        term["id"],
        world.project.workspace_id,
    )
    await make_rule(
        migrated,
        world.project,
        "ai_mention_lost",
        name="Gemini only",
        scope=json.dumps({"engine_codes": [GEMINI]}),
    )
    await make_rule(
        migrated,
        world.project,
        "ai_mention_lost",
        name="Event group",
        scope=json.dumps({"group_ids": [str(term["id"])]}),
    )
    await set_cursor(migrated, world.project, hours_ago=5)
    for hours, mentioned in ((3, True), (2, False)):
        run_id, at = await make_run(migrated, world.project, hours_ago=hours)
        for prompt in (world.prompt, other):
            for engine in (CHATGPT, GEMINI):
                await add_answer(
                    migrated, world, run_id, at, engine=engine, mentioned=mentioned, prompt=prompt
                )

    await evaluate_alerts(worker_db)

    found = await alerts(migrated, world.project)
    names = {
        (
            (
                await fetchrow(
                    migrated, "SELECT name FROM ops.alert_rules WHERE id = $1", a["rule_id"]
                )
            )["name"],
            json.loads(a["evidence"])["engine_code"],
            a["subject_id"],
        )
        for a in found
    }
    assert names == {
        ("Gemini only", GEMINI, str(world.prompt.id)),
        ("Gemini only", GEMINI, str(other.id)),
        ("Event group", CHATGPT, str(other.id)),
        ("Event group", GEMINI, str(other.id)),
    }


async def test_a_drop_of_the_set_positions_is_raised_once_and_a_smaller_one_is_not(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    world = await make_world(migrated)
    await make_rule(migrated, world.project, "rank_drop", params=json.dumps({"positions": 5}))
    await evaluate_alerts(worker_db)  # starts the cursor
    big = await add_tracked_keyword(migrated, world.project, "event security guards")
    small = await add_tracked_keyword(migrated, world.project, "crowd control services")
    big_event = await add_rank_event(migrated, world, big, 4, 15)
    await add_rank_event(migrated, world, small, 9, 13)
    await add_rank_event(migrated, world, small, 13, 9, event_type="rank_gain")

    first = await evaluate_alerts(worker_db)
    again = await evaluate_alerts(worker_db)

    assert (first.raised, again.raised) == (1, 0)
    [alert] = await alerts(migrated, world.project)
    assert (alert["subject_type"], alert["subject_id"]) == ("keyword", str(big))
    assert alert["subject_label"] == "event security guards"
    assert alert["severity"] == "critical"
    assert json.loads(alert["evidence"]) == {
        "rank_event_id": str(big_event),
        "from_rank": 4,
        "to_rank": 15,
        "positions_lost": 11,
        "positions": 5,
    }


async def test_a_rank_drop_before_the_first_pass_is_not_raised(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    world = await make_world(migrated)
    await make_rule(migrated, world.project, "rank_drop")
    tracked = await add_tracked_keyword(migrated, world.project, "old keyword")
    await add_rank_event(migrated, world, tracked, 1, 30)

    await evaluate_alerts(worker_db)
    await evaluate_alerts(worker_db)

    assert await alerts(migrated, world.project) == []
