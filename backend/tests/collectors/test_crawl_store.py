"""Rule tiers and the tier flow of the latest crawl (spec 5.2 and 6.6; decisions D10, D16).
As the worker, which runs them after a crawl; the API runs the same functions."""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors.crawl_store import apply_rules, latest_run, recompute_tier_flow
from idraft.crawl.tiers import MatchType, TierRule, first_match
from idraft.db.engine import workspace_transaction
from tests.api.auth.support import Workspace, execute, fetch, make_workspace
from tests.api.internal_links.support import SeedLink, seed_crawl, seed_tiers
from tests.api.keywords.support import keyword_project
from tests.conftest import PostgresServer


async def _rule(
    pg: PostgresServer,
    workspace: Workspace,
    project: uuid.UUID,
    position: int,
    match_type: str,
    value: str,
    tier: uuid.UUID,
) -> uuid.UUID:
    rows = await fetch(
        pg,
        "INSERT INTO core.tier_rules (workspace_id, project_id, position, match_type, value, "
        "tier_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
        workspace.id,
        project,
        position,
        match_type,
        value,
        tier,
    )
    rule_id: uuid.UUID = rows[0]["id"]
    return rule_id


async def test_the_latest_finished_crawl_is_the_one_in_scope(
    migrated: PostgresServer, worker_db: async_sessionmaker[AsyncSession]
) -> None:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    older, _ = await seed_crawl(migrated, workspace, project, [("/", 200)])
    newer, _ = await seed_crawl(
        migrated, workspace, project, [("/", 200)], state="stopped_at_ceiling"
    )
    await seed_crawl(migrated, workspace, project, [("/", 200)], state="failed")
    sessions = worker_db

    async with workspace_transaction(sessions, workspace.id) as db:
        assert await latest_run(db, workspace.id, project) == newer
    assert older != newer


async def test_rules_tag_new_pages_and_never_touch_a_manual_tier(
    migrated: PostgresServer, worker_db: async_sessionmaker[AsyncSession]
) -> None:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    t1, t2, *_ = await seed_tiers(migrated, workspace)
    _, ids = await seed_crawl(
        migrated,
        workspace,
        project,
        [("/services/seo", 200), ("/services/ppc", 200), ("/blog/a", 200), ("/about", 200)],
    )
    await _rule(migrated, workspace, project, 1, "exact", "/services/seo", t2)
    await _rule(migrated, workspace, project, 2, "prefix", "/services/", t1)
    await execute(
        migrated,
        "INSERT INTO core.project_pages (project_id, url_id, workspace_id, tier_id, tier_source) "
        "VALUES ($1, $2, $3, NULL, 'manual')",
        project,
        ids["/services/ppc"],
        workspace.id,
    )
    sessions = worker_db

    async with workspace_transaction(sessions, workspace.id) as db:
        changed = await apply_rules(db, workspace_id=workspace.id, project_id=project)

    rows = await fetch(
        migrated,
        "SELECT url_id, tier_id, tier_source FROM core.project_pages WHERE project_id = $1",
        project,
    )
    found = {row["url_id"]: (row["tier_id"], row["tier_source"]) for row in rows}
    assert changed == 1
    assert found == {
        ids["/services/seo"]: (t2, "rule"),  # the first matching rule wins
        ids["/services/ppc"]: (None, "manual"),  # manual Untiered beats the prefix rule
    }


async def test_the_stored_tiers_are_the_ones_the_pure_rules_give(
    migrated: PostgresServer, worker_db: async_sessionmaker[AsyncSession]
) -> None:
    """`apply_rules` matches in Python through `rule_matches`, never in SQL, so a multi-star
    pattern and a trailing slash on an exact rule decide here as they do in the preview."""
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    t1, t2, t3, _ = await seed_tiers(migrated, workspace)
    paths = ["/a/x/b/y", "/a/b/", "/a/x/b", "/pricing", "/pricing/", "/pricing/extra", "/"]
    _, ids = await seed_crawl(migrated, workspace, project, [(path, 200) for path in paths])
    specs = [("pattern", "/a/*/b/*", t1), ("exact", "/pricing", t2), ("prefix", "/pricing/", t3)]
    rule_ids = [
        await _rule(migrated, workspace, project, position, kind, value, tier)
        for position, (kind, value, tier) in enumerate(specs, start=1)
    ]
    rules = [
        TierRule(rule_id, position, MatchType(kind), value, tier)
        for position, (rule_id, (kind, value, tier)) in enumerate(
            zip(rule_ids, specs, strict=True), start=1
        )
    ]
    sessions = worker_db

    async with workspace_transaction(sessions, workspace.id) as db:
        await apply_rules(db, workspace_id=workspace.id, project_id=project)

    rows = await fetch(
        migrated, "SELECT url_id, rule_id FROM core.project_pages WHERE project_id = $1", project
    )
    stored = {row["url_id"]: row["rule_id"] for row in rows}
    expected = {}
    for path in paths:
        match = first_match(rules, path)
        if match is not None:
            expected[ids[path]] = match.rule_id
    assert stored == expected
    assert stored[ids["/pricing/"]] == rule_ids[1]  # a trailing slash does not leave an exact rule
    assert ids["/a/x/b"] not in stored  # the pattern needs a `/b/` and something after it
    assert stored[ids["/a/x/b/y"]] == rule_ids[0]


async def test_the_tier_flow_counts_unique_pairs_per_scope_and_all(
    migrated: PostgresServer, worker_db: async_sessionmaker[AsyncSession]
) -> None:
    workspace = await make_workspace(migrated)
    project = await keyword_project(migrated, workspace)
    t1, *_ = await seed_tiers(migrated, workspace)
    run, ids = await seed_crawl(
        migrated,
        workspace,
        project,
        [("/", 200), ("/pricing", 200), ("/blog/a", 200)],
        [
            SeedLink("/blog/a", "/pricing", "content", "See plans"),
            SeedLink("/blog/a", "/pricing", "content", "Pricing"),
            SeedLink("/blog/a", "/pricing", "navigation", "Pricing"),
            SeedLink("/", "/pricing", "navigation", "Pricing"),
            SeedLink("/", "/blog/a", "content"),
        ],
    )
    await execute(
        migrated,
        "INSERT INTO core.project_pages (project_id, url_id, workspace_id, tier_id, tier_source) "
        "VALUES ($1, $2, $3, $4, 'manual')",
        project,
        ids["/pricing"],
        workspace.id,
        t1,
    )
    sessions = worker_db

    async with workspace_transaction(sessions, workspace.id) as db:
        await recompute_tier_flow(db, workspace_id=workspace.id, run_id=run)

    rows = await fetch(
        migrated,
        "SELECT scope, from_tier_id, to_tier_id, links FROM seo.crawl_tier_flow WHERE run_id = $1",
        run,
    )
    cells = {(row["scope"], row["from_tier_id"], row["to_tier_id"]): row["links"] for row in rows}
    assert cells == {
        ("editorial", None, t1): 1,
        ("editorial", None, None): 1,
        ("template", None, t1): 2,
        ("all", None, t1): 2,
        ("all", None, None): 1,
    }
    stats = await fetch(
        migrated, "SELECT tier_id, pages FROM seo.crawl_tier_stats WHERE run_id = $1", run
    )
    assert {row["tier_id"]: row["pages"] for row in stats} == {t1: 1, None: 2}


async def test_one_workspace_never_changes_another_workspaces_tiers_or_flow(
    migrated: PostgresServer, worker_db: async_sessionmaker[AsyncSession]
) -> None:
    """The worker bypasses row-level security and both workspaces crawled the same URLs, so
    every statement has to name its own workspace."""
    pages = [("/", 200), ("/pricing", 200), ("/blog/a", 200)]
    links = [SeedLink("/blog/a", "/pricing", "content"), SeedLink("/", "/pricing", "navigation")]
    a = await make_workspace(migrated, name="A")
    b = await make_workspace(migrated, name="B")
    project_a = await keyword_project(migrated, a)
    project_b = await keyword_project(migrated, b)
    tier_a, *_ = await seed_tiers(migrated, a)
    tier_b, tier_b2, *_ = await seed_tiers(migrated, b)
    run_a, _ = await seed_crawl(migrated, a, project_a, pages, links)
    run_b, ids = await seed_crawl(migrated, b, project_b, pages, links)
    await _rule(migrated, a, project_a, 1, "prefix", "/", tier_a)
    await _rule(migrated, b, project_b, 1, "prefix", "/blog/", tier_b)
    # B holds a manual tier and a flow row that A's recompute must leave exactly as they are.
    await execute(
        migrated,
        "INSERT INTO core.project_pages (project_id, url_id, workspace_id, tier_id, tier_source) "
        "VALUES ($1, $2, $3, $4, 'manual')",
        project_b,
        ids["/pricing"],
        b.id,
        tier_b2,
    )
    await execute(
        migrated,
        "INSERT INTO seo.crawl_tier_flow (run_id, workspace_id, scope, from_tier_id, to_tier_id, "
        "links) VALUES ($1, $2, 'editorial', $3, $3, 77)",
        run_b,
        b.id,
        tier_b,
    )
    await execute(
        migrated,
        "INSERT INTO seo.crawl_tier_stats (run_id, workspace_id, tier_id, pages, equity_share) "
        "VALUES ($1, $2, $3, 5, 0.5)",
        run_b,
        b.id,
        tier_b,
    )
    sessions = worker_db

    async with workspace_transaction(sessions, a.id) as db:
        assert await apply_rules(db, workspace_id=a.id, project_id=project_a) == 3
        await recompute_tier_flow(db, workspace_id=a.id, run_id=run_a)

    b_pages = await fetch(
        migrated,
        "SELECT url_id, tier_id, tier_source FROM core.project_pages WHERE workspace_id = $1",
        b.id,
    )
    assert [(row["url_id"], row["tier_id"], row["tier_source"]) for row in b_pages] == [
        (ids["/pricing"], tier_b2, "manual")
    ]
    b_flow = await fetch(
        migrated, "SELECT links FROM seo.crawl_tier_flow WHERE workspace_id = $1", b.id
    )
    assert [row["links"] for row in b_flow] == [77]
    b_stats = await fetch(
        migrated, "SELECT pages FROM seo.crawl_tier_stats WHERE workspace_id = $1", b.id
    )
    assert [row["pages"] for row in b_stats] == [5]
    a_flow = await fetch(
        migrated, "SELECT DISTINCT workspace_id FROM seo.crawl_tier_flow WHERE run_id = $1", run_a
    )
    assert [row["workspace_id"] for row in a_flow] == [a.id]

    # And B's own run, as B, still follows B's rules and keeps its manual tier.
    async with workspace_transaction(sessions, b.id) as db:
        assert await apply_rules(db, workspace_id=b.id, project_id=project_b) == 1
        await recompute_tier_flow(db, workspace_id=b.id, run_id=run_b)
    a_pages = await fetch(
        migrated, "SELECT count(*) AS n FROM core.project_pages WHERE workspace_id = $1", a.id
    )
    assert a_pages[0]["n"] == 3
