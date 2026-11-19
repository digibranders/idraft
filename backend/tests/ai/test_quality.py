"""AI quality counters (WP-62 T3, BE-OPS-14): the five checks of docs/25 section 9, computed from
`ai.observations`. Each boundary is tried at the threshold, one under and one over, and a check
below its minimum sample is `insufficient_data`, never `ok`."""

from __future__ import annotations

import re
import uuid
from datetime import UTC, date, datetime, time, timedelta

import pytest
from asyncpg.connection import LoggedQuery

from idraft.ai.quality import (
    CHECKS,
    CITATION_PRESENCE,
    DUPLICATE_ANSWERS,
    FANOUT_PRESENCE,
    MODEL_CHANGE,
    REFUSED_SHARE,
    STATUS_MIX,
    QualityResult,
    State,
    ai_quality_checks,
    render_table,
)
from tests.ai.quality_support import (
    BASELINE,
    DAY,
    NOON,
    World,
    another_project,
    day_of,
    failing_day,
    find,
    make_world,
    put,
)
from tests.conftest import PostgresServer
from tests.db.support import connection

WORKSPACE_FILTER = re.compile(r"\bworkspace_id = \$\d+")
PROJECT_FILTER = re.compile(r"\bproject_id = \$\d+")


async def checks(
    pg: PostgresServer, world: World, *, day: date = DAY, project: bool = True
) -> list[QualityResult]:
    """The checks as the owner role, for the world's project (or its whole workspace)."""
    async with connection(pg, "migrator") as db:
        return await ai_quality_checks(
            db,
            day,
            workspace_id=world.project.workspace_id,
            project_id=world.project.id if project else None,
        )


@pytest.mark.parametrize(
    ("errors", "empties", "state"),
    [(9, 0, State.OK), (10, 0, State.OK), (5, 6, State.FLAGGED), (11, 0, State.FLAGGED)],
)
async def test_the_status_mix_flags_error_and_empty_above_ten_percent(
    migrated: PostgresServer, errors: int, empties: int, state: State
) -> None:
    world = await make_world(migrated)
    async with connection(migrated) as db:
        await put(db, world, n=errors, status="error")
        await put(db, world, n=empties, status="empty")
        await put(db, world, n=100 - errors - empties)

    result = find(await checks(migrated, world), STATUS_MIX)

    assert (result.numerator, result.n, result.state) == (errors + empties, 100, state)
    assert result.value == (errors + empties) / 100


async def test_the_status_mix_flags_error_and_empty_above_ten_percent_with_a_minimum_of_100(
    migrated: PostgresServer,
) -> None:
    few, enough = await make_world(migrated), await make_world(migrated)
    async with connection(migrated) as db:
        for world, answers in ((few, 99), (enough, 100)):
            await put(db, world, n=answers // 2, status="error")
            await put(db, world, n=answers - answers // 2)

    below = find(await checks(migrated, few), STATUS_MIX)
    at_minimum = find(await checks(migrated, enough), STATUS_MIX)

    assert (below.n, below.state) == (99, State.INSUFFICIENT_DATA)
    assert (at_minimum.n, at_minimum.state) == (100, State.FLAGGED)
    assert CHECKS[STATUS_MIX].minimum_n == 100


@pytest.mark.parametrize(
    ("baseline_refused", "refused", "state"),
    [
        (14, 3, State.OK),
        (14, 4, State.OK),  # exactly twice its 2% baseline
        (14, 5, State.FLAGGED),
        (0, 0, State.OK),
        (0, 1, State.FLAGGED),
    ],
)
async def test_refused_is_flagged_above_twice_its_baseline(
    migrated: PostgresServer, baseline_refused: int, refused: int, state: State
) -> None:
    world = await make_world(migrated)
    async with connection(migrated) as db:
        await put(db, world, n=baseline_refused, status="refused", at=BASELINE)
        await put(db, world, n=700 - baseline_refused, at=BASELINE)
        await put(db, world, n=refused, status="refused")
        await put(db, world, n=100 - refused)

    result = find(await checks(migrated, world), REFUSED_SHARE)

    assert (result.numerator, result.n, result.state) == (refused, 100, state)
    assert (result.baseline_numerator, result.baseline_n) == (baseline_refused, 700)


@pytest.mark.parametrize(
    ("cited", "state"), [(105, State.OK), (104, State.FLAGGED), (106, State.OK)]
)
async def test_citation_presence_below_70_percent_of_the_baseline_is_flagged(
    migrated: PostgresServer, cited: int, state: State
) -> None:
    """The baseline is 300 of 400 (75%); 70% of it is 52.5%, which is 105 of 200."""
    world = await make_world(migrated)
    async with connection(migrated) as db:
        await put(db, world, n=300, cited=True, at=BASELINE)
        await put(db, world, n=100, at=BASELINE)
        await put(db, world, n=cited, cited=True)
        await put(db, world, n=200 - cited)

    result = find(await checks(migrated, world), CITATION_PRESENCE)

    assert (result.numerator, result.n, result.state) == (cited, 200, state)
    assert (result.baseline_numerator, result.baseline_n) == (300, 400)


async def test_citation_presence_counts_only_valid_answers_and_needs_200_of_them(
    migrated: PostgresServer,
) -> None:
    """Partial answers are valid; errors, empties and refusals are not in the count at all."""
    enough, few = await make_world(migrated), await make_world(migrated)
    async with connection(migrated) as db:
        for world in (enough, few):
            await put(db, world, n=400, cited=True, at=BASELINE)
        await put(db, enough, n=100, cited=True)
        await put(db, enough, n=100, cited=True, status="partial")
        await put(db, few, n=199, cited=True)
        for status in ("error", "empty", "refused"):
            for world in (enough, few):
                await put(db, world, n=100, status=status)

    at_minimum = find(await checks(migrated, enough), CITATION_PRESENCE)
    below = find(await checks(migrated, few), CITATION_PRESENCE)

    assert (at_minimum.numerator, at_minimum.n, at_minimum.state) == (200, 200, State.OK)
    assert (below.n, below.state) == (199, State.INSUFFICIENT_DATA)


@pytest.mark.parametrize(("fanout", "state"), [(25, State.OK), (24, State.FLAGGED), (26, State.OK)])
async def test_fanout_presence_below_half_of_the_baseline_is_flagged(
    migrated: PostgresServer, fanout: int, state: State
) -> None:
    """The baseline is 100 of 200 (50%); half of it is 25%, which is 25 of 100."""
    world = await make_world(migrated)
    async with connection(migrated) as db:
        await put(db, world, n=100, fanout=2, at=BASELINE)
        await put(db, world, n=100, at=BASELINE)
        await put(db, world, n=fanout, fanout=3)
        await put(db, world, n=100 - fanout)

    result = find(await checks(migrated, world), FANOUT_PRESENCE)

    assert (result.numerator, result.n, result.state) == (fanout, 100, state)


async def test_fanout_presence_counts_only_chatgpt_web_valid_answers(
    migrated: PostgresServer,
) -> None:
    world = await make_world(migrated)
    async with connection(migrated) as db:
        for engine in ("chatgpt_web", "gemini_web"):
            await put(db, world, n=200, fanout=2, engine=engine, at=BASELINE)
        await put(db, world, n=50, fanout=3)
        await put(db, world, n=50)
        await put(db, world, n=50, fanout=3, status="error")
        await put(db, world, n=100, fanout=3, engine="gemini_web")

    results = await checks(migrated, world)

    chatgpt = find(results, FANOUT_PRESENCE)
    assert (chatgpt.numerator, chatgpt.n, chatgpt.state) == (50, 100, State.OK)
    assert [
        r for r in results if r.check == FANOUT_PRESENCE and r.engine_code != "chatgpt_web"
    ] == []


async def test_fanout_presence_needs_100_valid_answers(migrated: PostgresServer) -> None:
    world = await make_world(migrated)
    async with connection(migrated) as db:
        await put(db, world, n=200, fanout=2, at=BASELINE)
        await put(db, world, n=99, fanout=3)

    result = find(await checks(migrated, world), FANOUT_PRESENCE)

    assert (result.n, result.state) == (99, State.INSUFFICIENT_DATA)


async def test_a_model_first_seen_today_is_flagged_and_a_known_one_is_not(
    migrated: PostgresServer,
) -> None:
    changed, steady = await make_world(migrated), await make_world(migrated)
    async with connection(migrated) as db:
        for world in (changed, steady):
            # Known from long before the baseline: still known, not new.
            await put(db, world, n=3, model="model-1", at=NOON - timedelta(days=40))
            await put(db, world, n=2, model="model-1")
            await put(db, world, n=1, model=None)
        await put(db, changed, n=4, model="model-2")
        # First seen the day after: not new on DAY.
        await put(db, changed, n=1, model="model-3", at=NOON + timedelta(days=1))

    flagged = find(await checks(migrated, changed), MODEL_CHANGE)
    known = find(await checks(migrated, steady), MODEL_CHANGE)

    assert (flagged.state, flagged.numerator, flagged.n, flagged.detail) == (
        State.FLAGGED,
        1,
        2,
        "model-2",
    )
    assert (known.state, known.numerator, known.n, known.detail) == (State.OK, 0, 1, "")
    after = find(await checks(migrated, changed, day=day_of(1)), MODEL_CHANGE)
    assert (after.state, after.detail) == (State.FLAGGED, "model-3")


async def test_the_first_models_of_an_engine_are_not_a_change(migrated: PostgresServer) -> None:
    world = await make_world(migrated)
    async with connection(migrated) as db:
        await put(db, world, n=5, model="model-1")

    result = find(await checks(migrated, world), MODEL_CHANGE)

    assert (result.state, result.numerator) == (State.INSUFFICIENT_DATA, 1)


@pytest.mark.parametrize(
    ("groups", "repeated", "state"),
    [
        (50, 25, State.OK),  # exactly half
        (50, 24, State.OK),
        (50, 26, State.FLAGGED),
        (49, 49, State.INSUFFICIENT_DATA),
    ],
)
async def test_duplicate_answers_count_replicate_groups_with_a_repeated_hash(
    migrated: PostgresServer, groups: int, repeated: int, state: State
) -> None:
    world = await make_world(migrated)
    async with connection(migrated) as db:
        for index in range(groups):
            await put(
                db,
                world,
                n=2,
                run=uuid.uuid4(),
                hashes="same" if index < repeated else "distinct",
            )
        # Not groups: one answer alone, partial answers, and answers with no hash.
        for _ in range(10):
            await put(db, world, n=1, run=uuid.uuid4(), hashes="same")
            await put(db, world, n=2, run=uuid.uuid4(), hashes="same", status="partial")
            await put(db, world, n=2, run=uuid.uuid4(), hashes="none")

    result = find(await checks(migrated, world), DUPLICATE_ANSWERS)

    assert (result.numerator, result.n, result.state) == (repeated, groups, state)


async def test_an_empty_baseline_is_insufficient_data_never_ok(migrated: PostgresServer) -> None:
    world = await make_world(migrated)
    async with connection(migrated) as db:
        await put(db, world, n=300, cited=True, fanout=2)

    results = await checks(migrated, world)

    for check in (REFUSED_SHARE, CITATION_PRESENCE, FANOUT_PRESENCE):
        result = find(results, check)
        assert result.state is State.INSUFFICIENT_DATA, check
        assert result.baseline is None, check
    # The status mix needs no baseline.
    assert find(results, STATUS_MIX).state is State.OK


async def test_only_the_day_and_the_seven_days_before_count(migrated: PostgresServer) -> None:
    world = await make_world(migrated)
    async with connection(migrated) as db:
        await put(db, world, n=100)
        await put(db, world, n=10, status="refused", at=BASELINE)
        await put(db, world, n=90, at=BASELINE)
        # Eight days before and the day after: outside both windows.
        await put(db, world, n=500, status="refused", at=NOON - timedelta(days=8))
        await put(db, world, n=500, status="error", at=NOON + timedelta(days=1))

    result = find(await checks(migrated, world), REFUSED_SHARE)

    assert (result.n, result.numerator, result.baseline_n, result.baseline_numerator) == (
        100,
        0,
        100,
        10,
    )


async def test_results_are_per_workspace_project_and_engine(migrated: PostgresServer) -> None:
    sick, healthy = await make_world(migrated), await make_world(migrated)
    sibling = await another_project(migrated, sick)
    async with connection(migrated) as db:
        await failing_day(db, sick)
        await put(db, sick, n=100, engine="gemini_web")
        await put(db, healthy, n=100)
        await failing_day(db, sibling)

    async with connection(migrated, "migrator") as db:
        everything = await ai_quality_checks(db, DAY)

    def mix(world: World, engine: str = "chatgpt_web") -> QualityResult:
        own = [
            r
            for r in everything
            if (r.workspace_id, r.project_id) == (world.project.workspace_id, world.project.id)
        ]
        return find(own, STATUS_MIX, engine)

    assert mix(sick).state is State.FLAGGED
    assert mix(sick, "gemini_web").state is State.OK
    assert mix(healthy).state is State.OK
    assert mix(sibling).state is State.FLAGGED
    assert (mix(healthy).numerator, mix(healthy).n) == (0, 100)
    assert (mix(sick).numerator, mix(sick).n) == (50, 100)


async def test_another_workspaces_answers_are_never_counted(migrated: PostgresServer) -> None:
    """The reads run as the owner, which row-level security does not hide anything from: the
    scope has to be in the statements, as bound values."""
    mine, theirs = await make_world(migrated), await make_world(migrated)
    async with connection(migrated) as db:
        await put(db, mine, n=100)
        await failing_day(db, theirs)
        await put(db, theirs, n=300, model="other-model")
    queries: list[tuple[str, tuple[object, ...]]] = []

    async with connection(migrated, "migrator") as db:

        def log(record: LoggedQuery) -> None:
            queries.append((record.query, record.args))

        db.add_query_logger(log)
        results = await ai_quality_checks(
            db, DAY, workspace_id=mine.project.workspace_id, project_id=mine.project.id
        )

    assert {(r.workspace_id, r.project_id) for r in results} == {
        (mine.project.workspace_id, mine.project.id)
    }
    status = find(results, STATUS_MIX)
    assert (status.numerator, status.n, status.state) == (0, 100, State.OK)
    reads = [(sql, args) for sql, args in queries if "ai.observations" in sql]
    assert len(reads) == 5
    for sql, args in reads:
        assert WORKSPACE_FILTER.search(sql), sql
        assert PROJECT_FILTER.search(sql), sql
        assert mine.project.workspace_id in args
        assert mine.project.id in args
        assert theirs.project.workspace_id not in args


async def test_the_checks_use_one_statement_each_whatever_the_number_of_projects(
    migrated: PostgresServer,
) -> None:
    one = await make_world(migrated)
    async with connection(migrated) as db:
        await failing_day(db, one)
    projects = [one, *[await another_project(migrated, one) for _ in range(4)]]
    async with connection(migrated) as db:
        for world in projects[1:]:
            await failing_day(db, world)
            await put(db, world, n=3, status="partial", cited=True, fanout=1, hashes="same")

    async def statements(world: World, *, project: bool) -> tuple[int, list[QualityResult]]:
        seen: list[str] = []
        async with connection(migrated, "migrator") as db:
            db.add_query_logger(lambda record: seen.append(record.query))
            results = await ai_quality_checks(
                db,
                DAY,
                workspace_id=world.project.workspace_id,
                project_id=world.project.id if project else None,
            )
        return len([sql for sql in seen if "ai.observations" in sql]), results

    single, single_results = await statements(one, project=True)
    many, many_results = await statements(one, project=False)

    assert (single, many) == (5, 5)
    assert {r.project_id for r in single_results} == {one.project.id}
    assert {r.project_id for r in many_results} == {world.project.id for world in projects}


async def test_the_day_is_a_utc_day(migrated: PostgresServer) -> None:
    world = await make_world(migrated)
    last_second = datetime.combine(DAY, time(23, 59, 59), tzinfo=UTC)
    midnight = last_second + timedelta(seconds=1)
    async with connection(migrated) as db:
        await put(db, world, n=1, at=last_second)
        await put(db, world, n=1, at=midnight, status="error")
    scope = {"workspace_id": world.project.workspace_id, "project_id": world.project.id}

    # The session zone is not UTC: the day must not move with it.
    async with connection(migrated, "migrator") as owner:
        await owner.execute("SET TIME ZONE 'Asia/Kolkata'")
        first = find(await ai_quality_checks(owner, DAY, **scope), STATUS_MIX)
        second = find(await ai_quality_checks(owner, day_of(1), **scope), STATUS_MIX)

    assert (first.n, first.numerator) == (1, 0)
    assert (second.n, second.numerator) == (1, 1)


async def test_nothing_is_written(migrated: PostgresServer) -> None:
    world = await make_world(migrated)
    async with connection(migrated) as db:
        await failing_day(db, world)
        await put(db, world, n=4, model="model-2", hashes="same", run=uuid.uuid4())
    counts = (
        "SELECT table_schema || '.' || table_name AS name, "
        "(xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', "
        "table_schema, table_name), false, true, '')))[1]::text::bigint AS rows "
        "FROM information_schema.tables "
        "WHERE table_schema IN ('ai', 'ops') AND table_type = 'BASE TABLE'"
    )

    async with connection(migrated) as db:
        before = {row["name"]: row["rows"] for row in await db.fetch(counts)}
        await checks(migrated, world)
        after = {row["name"]: row["rows"] for row in await db.fetch(counts)}

    assert before == after
    assert sum(rows for name, rows in before.items() if name.startswith("ai.observations")) >= 104


def test_the_table_has_one_line_per_result_and_marks_unknown_values() -> None:
    unknown = QualityResult(
        check=CITATION_PRESENCE,
        workspace_id=uuid.UUID(int=1),
        project_id=uuid.UUID(int=2),
        engine_code="gemini_web",
        numerator=0,
        n=0,
        value=None,
        baseline_numerator=None,
        baseline_n=None,
        baseline=None,
        threshold=0.7,
        state=State.INSUFFICIENT_DATA,
    )
    flagged = QualityResult(
        check=MODEL_CHANGE,
        workspace_id=uuid.UUID(int=1),
        project_id=uuid.UUID(int=2),
        engine_code="chatgpt_web",
        numerator=1,
        n=2,
        value=0.5,
        baseline_numerator=None,
        baseline_n=None,
        baseline=None,
        threshold=0.0,
        state=State.FLAGGED,
        detail="model-2",
    )

    lines = render_table([unknown, flagged], DAY).splitlines()

    assert len(lines) == 3
    assert lines[0].split() == ["project", "window", "engine", "check", "value", "n", "state"]
    assert "0/0 = n/a" in lines[1]
    assert lines[1].endswith("insufficient_data")
    assert "1/2 = 50.0%" in lines[2]
    assert lines[2].endswith("flagged model-2")
    assert str(uuid.UUID(int=2)) in lines[1]
