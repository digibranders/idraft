"""Google's last crawl of a page, from the URL inspection (page history spec section 6)."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors.gsc_inspect import (
    INSPECTIONS_PER_DAY,
    InspectContext,
    InspectReport,
    PageToInspect,
    _project_lock,
    refresh_inspections,
)
from idraft.collectors.gsc_limits import Budgets, GscLimiter
from idraft.collectors.gsc_store import IntegrationFacts, load_integration
from idraft.db.engine import workspace_transaction
from idraft.providers.google.client import URL_INSPECTION_URL, GoogleClient
from tests.api.auth.support import execute, fetch, make_workspace
from tests.api.internal_links.support import url_id
from tests.collectors.gsc_support import (
    SITE,
    FakeSearchConsole,
    Property,
    make_property,
    sync_context,
)
from tests.conftest import PostgresServer

type Sessions = async_sessionmaker[AsyncSession]
CRAWLED = "2026-11-20T08:15:30Z"


class Pages:
    """A `TrackedSource` of fixed pages."""

    def __init__(self, pages: Sequence[PageToInspect]) -> None:
        self._pages = pages

    async def pages(self, db: AsyncSession, facts: IntegrationFacts) -> Sequence[PageToInspect]:
        return self._pages


class Token:
    """The access token of a property's account, made from its refresh token as the sync does."""

    def __init__(self, google: GoogleClient, prop: Property) -> None:
        self._google, self._prop = google, prop

    async def __call__(self, *, renew: bool) -> str:
        return (await self._google.refresh(self._prop.account.refresh_token)).access_token


def context(sessions: Sessions, fake: FakeSearchConsole, **changes: Any) -> InspectContext:
    base = sync_context(sessions, fake)
    return InspectContext(sessions=sessions, google=base.google, limiter=base.limiter, **changes)


async def pages_of(pg: PostgresServer, count: int) -> list[PageToInspect]:
    return [
        (await url_id(pg, f"https://example.com/inspect-{n}"), f"https://example.com/inspect-{n}")
        for n in range(count)
    ]


async def facts_of(sessions: Sessions, prop: Property) -> IntegrationFacts:
    async with workspace_transaction(sessions, prop.workspace_id) as db:
        facts = await load_integration(db, prop.workspace_id, prop.integration_id)
    assert facts is not None
    return facts


async def rows(pg: PostgresServer, prop: Property) -> dict[int, tuple[datetime | None, str | None]]:
    found = await fetch(
        pg,
        "SELECT url_id, last_crawl_time, coverage_state, workspace_id FROM seo.page_google_crawl "
        "WHERE project_id = $1",
        prop.project_id,
    )
    assert all(row["workspace_id"] == prop.workspace_id for row in found)
    return {row["url_id"]: (row["last_crawl_time"], row["coverage_state"]) for row in found}


async def seed(pg: PostgresServer, prop: Property, page: int, inspected_at: datetime) -> None:
    await execute(
        pg,
        "INSERT INTO seo.page_google_crawl (project_id, url_id, workspace_id, inspected_at) "
        "VALUES ($1, $2, $3, $4)",
        prop.project_id,
        page,
        prop.workspace_id,
        inspected_at,
    )


async def run(
    sessions: Sessions,
    fake: FakeSearchConsole,
    prop: Property,
    pages: Sequence[PageToInspect],
    **changes: Any,
) -> InspectReport:
    ctx = context(sessions, fake, **changes)
    return await refresh_inspections(
        ctx, await facts_of(sessions, prop), Pages(pages), Token(ctx.google, prop)
    )


async def test_a_page_is_inspected_and_its_last_crawl_is_stored(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    fake = FakeSearchConsole()
    prop = await make_property(migrated, fake)
    pages = await pages_of(migrated, 1)
    fake.inspections[pages[0][1]] = (CRAWLED, "Submitted and indexed")

    report = await run(worker_db, fake, prop, pages)

    assert (report.calls, report.stored, report.skipped) == (1, 1, 0)
    assert await rows(migrated, prop) == {
        pages[0][0]: (datetime(2026, 11, 20, 8, 15, 30, tzinfo=UTC), "Submitted and indexed")
    }
    assert fake.calls[-1].json_body == {"inspectionUrl": pages[0][1], "siteUrl": SITE}


async def test_a_page_google_never_crawled_stores_a_null_crawl_time(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    fake = FakeSearchConsole()
    prop = await make_property(migrated, fake)
    pages = await pages_of(migrated, 1)

    await run(worker_db, fake, prop, pages)

    assert await rows(migrated, prop) == {pages[0][0]: (None, "URL is unknown to Google")}


async def test_the_daily_cap_is_respected_and_no_call_is_made_beyond_it(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    fake = FakeSearchConsole()
    prop = await make_property(migrated, fake)
    pages = await pages_of(migrated, 5)
    # One page was inspected earlier today: it counts against the cap but is not due again.
    await seed(migrated, prop, pages[0][0], datetime.now(UTC))

    first = await run(worker_db, fake, prop, pages, daily_cap=3)
    second = await run(worker_db, fake, prop, pages, daily_cap=3)

    assert (first.calls, first.stored, first.cap_reached) == (2, 2, True)
    assert (second.calls, second.cap_reached) == (0, True)
    assert len(fake.called(URL_INSPECTION_URL)) == 2
    assert len(await rows(migrated, prop)) == 3


async def test_the_cap_counts_only_todays_inspections(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    fake = FakeSearchConsole()
    prop = await make_property(migrated, fake)
    pages = await pages_of(migrated, 2)
    await seed(migrated, prop, pages[0][0], datetime.now(UTC) - timedelta(days=2))

    report = await run(worker_db, fake, prop, pages, daily_cap=1)

    assert (report.calls, report.stored) == (1, 1)


def test_the_default_cap_leaves_headroom_under_googles_2000_a_day() -> None:
    assert INSPECTIONS_PER_DAY == 1_500


async def test_a_quota_answer_stops_the_pass_and_slows_the_bucket(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    fake = FakeSearchConsole()
    prop = await make_property(migrated, fake)
    pages = await pages_of(migrated, 3)
    fake.inspect_status = 429
    fake.inspect_error = {"status": "RESOURCE_EXHAUSTED", "message": "quota"}
    slowed: list[str] = []
    limiter = GscLimiter(Budgets(1e9, 1e9, 1e9))
    limiter.quota_exceeded = lambda *, site: slowed.append(site)  # type: ignore[method-assign]
    google = context(worker_db, fake).google

    report = await refresh_inspections(
        InspectContext(sessions=worker_db, google=google, limiter=limiter),
        await facts_of(worker_db, prop),
        Pages(pages),
        Token(google, prop),
    )

    assert (report.calls, report.stored, report.quota_hit) == (1, 0, True)
    assert slowed == [SITE]
    assert await rows(migrated, prop) == {}


async def test_one_failing_page_does_not_stop_the_others(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    fake = FakeSearchConsole()
    prop = await make_property(migrated, fake)
    pages = await pages_of(migrated, 3)
    fake.inspect_fail_for[pages[1][1]] = 404

    report = await run(worker_db, fake, prop, pages)

    assert (report.calls, report.stored, report.skipped) == (3, 2, 1)
    # The failed page keeps a row with no value, so it is not retried at once.
    assert (await rows(migrated, prop))[pages[1][0]] == (None, None)
    assert set(await rows(migrated, prop)) == {p[0] for p in pages}


async def test_a_fresh_page_is_skipped_and_a_stale_one_is_read_again(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    fake = FakeSearchConsole()
    prop = await make_property(migrated, fake)
    pages = await pages_of(migrated, 2)
    await seed(migrated, prop, pages[0][0], datetime.now(UTC) - timedelta(hours=2))
    await seed(migrated, prop, pages[1][0], datetime.now(UTC) - timedelta(hours=30))
    fake.inspections[pages[1][1]] = (CRAWLED, "Crawled")

    report = await run(worker_db, fake, prop, pages)

    assert (report.calls, report.stored) == (1, 1)
    found = await rows(migrated, prop)
    assert found[pages[1][0]][1] == "Crawled"
    assert found[pages[0][0]] == (None, None)


async def test_the_never_inspected_come_first_then_the_oldest(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    fake = FakeSearchConsole()
    prop = await make_property(migrated, fake)
    pages = await pages_of(migrated, 3)
    await seed(migrated, prop, pages[0][0], datetime.now(UTC) - timedelta(days=1))
    await seed(migrated, prop, pages[1][0], datetime.now(UTC) - timedelta(days=5))

    await run(worker_db, fake, prop, pages, daily_cap=3 + 2)

    order = [c.json_body["inspectionUrl"] for c in fake.calls if c.json_body]
    assert order == [pages[2][1], pages[1][1], pages[0][1]]


async def test_rows_carry_the_workspace_of_the_property_and_other_workspaces_are_untouched(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    fake = FakeSearchConsole()
    mine = await make_property(migrated, fake)
    other = await make_property(migrated, fake, workspace=await make_workspace(migrated))
    pages = await pages_of(migrated, 1)

    await run(worker_db, fake, mine, pages)

    assert set(await rows(migrated, mine)) == {pages[0][0]}
    assert await rows(migrated, other) == {}
    stored = await fetch(
        migrated,
        "SELECT workspace_id FROM seo.page_google_crawl WHERE project_id = ANY($1)",
        [mine.project_id, other.project_id],
    )
    assert {row["workspace_id"] for row in stored} == {mine.workspace_id}


async def test_a_failed_page_backs_off_and_counts_toward_the_cap(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    fake = FakeSearchConsole()
    prop = await make_property(migrated, fake)
    pages = await pages_of(migrated, 1)
    fake.inspect_fail_for[pages[0][1]] = 404

    first = await run(worker_db, fake, prop, pages)
    second = await run(worker_db, fake, prop, pages)

    assert (first.calls, first.skipped, first.stored) == (1, 1, 0)
    assert (second.calls, second.stored) == (0, 0)
    assert await rows(migrated, prop) == {pages[0][0]: (None, None)}


async def test_a_failure_keeps_an_older_good_value(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    fake = FakeSearchConsole()
    prop = await make_property(migrated, fake)
    pages = await pages_of(migrated, 1)
    fake.inspections[pages[0][1]] = (CRAWLED, "Crawled")
    await run(worker_db, fake, prop, pages)
    await execute(
        migrated,
        "UPDATE seo.page_google_crawl SET inspected_at = now() - interval '2 days' "
        "WHERE project_id = $1",
        prop.project_id,
    )
    fake.inspect_fail_for[pages[0][1]] = 404

    report = await run(worker_db, fake, prop, pages)

    assert (report.calls, report.skipped) == (1, 1)
    assert await rows(migrated, prop) == {
        pages[0][0]: (datetime(2026, 11, 20, 8, 15, 30, tzinfo=UTC), "Crawled")
    }
    fresh = await fetch(
        migrated,
        "SELECT inspected_at FROM seo.page_google_crawl WHERE project_id = $1",
        prop.project_id,
    )
    assert fresh[0]["inspected_at"] > datetime.now(UTC) - timedelta(minutes=5)


async def test_a_second_pass_on_a_busy_property_does_nothing(
    migrated: PostgresServer, worker_db: Sessions
) -> None:
    fake = FakeSearchConsole()
    prop = await make_property(migrated, fake)
    pages = await pages_of(migrated, 2)

    async with _project_lock(worker_db, prop.project_id) as held:
        assert held
        busy = await run(worker_db, fake, prop, pages)
    after = await run(worker_db, fake, prop, pages)

    assert busy == InspectReport(busy=True)
    assert len(fake.called(URL_INSPECTION_URL)) == 2
    assert (after.calls, after.stored, after.busy) == (2, 2, False)
