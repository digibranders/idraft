"""The second job of a crawl (plan 04 decision D1): what changed against the crawl before it,
the alert for links lost to important pages, anchor counts, and (Task 7) mentions.

It runs for crawls in a data state whose `enrich_state` is `pending` or `running`, one phase
at a time, each phase one transaction that moves the crawl to the next phase. Five failed
passes in a row end it as `failed`; the crawl itself is never touched, so a bug here cannot take
a good crawl away. Every statement names the workspace, because the worker bypasses row-level
security.
"""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Final
from uuid import UUID

import structlog
from pydantic import BaseModel
from sqlalchemy import (
    ARRAY,
    BigInteger,
    Text,
    bindparam,
    case,
    delete,
    func,
    literal,
    select,
    text,
    update,
)
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.collectors.crawl_store import DATA_STATES, html_key
from idraft.crawl.anchors import EDGE_PATTERN, GENERIC_ANCHORS
from idraft.crawl.changes import CHANGES_MAX, AlertSettings, alert_due, alert_settings
from idraft.crawl.mentions import (
    PhraseSet,
    boilerplate_blocks,
    find_mentions,
    index_phrases,
    visible_blocks,
    visible_text,
)
from idraft.crawl.status import BLOCKED_STATUSES
from idraft.db.tables import (
    crawl_alerts,
    crawl_link_changes,
    crawl_mentions,
    crawl_page_changes,
    crawl_pages,
    crawl_runs,
    projects,
    urls,
)
from idraft.storage.raw import ObjectStore, RawStorageError, decompress

ENRICH_JOB: Final = "crawl_enrich"
ENRICH_PASS_TIME: Final = timedelta(minutes=6)
ENRICH_FAILURES_MAX: Final = 5
_LONG_STATEMENT_TIMEOUT: Final = text("SET LOCAL statement_timeout = '5min'")
_log = structlog.get_logger(__name__)


class CrawlEnrichTask(BaseModel):
    """The message of the `crawl_enrich` job: one finished crawl."""

    workspace_id: UUID
    run_id: UUID

    @property
    def dedupe_key(self) -> str:
        return f"{ENRICH_JOB}:{self.run_id}"


@dataclass(frozen=True, slots=True)
class EnrichOutcome:
    phase: str | None
    steps: int
    busy: bool = False
    failed: bool = False


@dataclass(frozen=True, slots=True)
class _Run:
    id: UUID
    workspace_id: UUID
    project_id: UUID
    created_at: datetime
    phase: str | None
    offset: int
    links_kept: bool


type Step = Callable[[async_sessionmaker[AsyncSession], ObjectStore | None, _Run], Awaitable[bool]]


async def _read_run(
    sessions: async_sessionmaker[AsyncSession], task: CrawlEnrichTask
) -> _Run | None:
    """The crawl, when it is in a data state and its enrichment has work left."""
    async with sessions() as db:
        row = (
            await db.execute(
                select(
                    crawl_runs.c.id,
                    crawl_runs.c.workspace_id,
                    crawl_runs.c.project_id,
                    crawl_runs.c.created_at,
                    crawl_runs.c.enrich_phase,
                    crawl_runs.c.enrich_offset,
                    crawl_runs.c.links_dropped_at,
                ).where(
                    crawl_runs.c.workspace_id == task.workspace_id,
                    crawl_runs.c.id == task.run_id,
                    crawl_runs.c.state.in_(DATA_STATES),
                    crawl_runs.c.enrich_state.in_(("pending", "running")),
                )
            )
        ).one_or_none()
    if row is None:
        return None
    return _Run(
        id=row.id,
        workspace_id=row.workspace_id,
        project_id=row.project_id,
        created_at=row.created_at,
        phase=row.enrich_phase or "changes",
        offset=row.enrich_offset,
        links_kept=row.links_dropped_at is None,
    )


class _MovedError(Exception):
    """A pass that found the ground moved under it (a partition dropped while it read): its
    transaction is rolled back and the pass ends without counting a failure."""


async def _claim(db: AsyncSession, run: _Run) -> bool:
    """Whether this transaction may write the phase the pass read. One pass at a time per
    crawl (a transaction lock), and the crawl's row is locked and compared with what the step
    read, so a pass that was overtaken, or that met a crawl enriched meanwhile, writes
    nothing."""
    key = func.hashtextextended(literal(f"{ENRICH_JOB}:{run.id}"), 0)
    got: bool = (await db.execute(select(func.pg_try_advisory_xact_lock(key)))).scalar_one()
    if not got:
        return False
    row = (
        await db.execute(
            select(crawl_runs.c.enrich_state, crawl_runs.c.enrich_phase, crawl_runs.c.enrich_offset)
            .where(crawl_runs.c.workspace_id == run.workspace_id, crawl_runs.c.id == run.id)
            .with_for_update()
        )
    ).one_or_none()
    return (
        row is not None
        and row.enrich_state in ("pending", "running")
        and (row.enrich_phase or "changes") == run.phase
        and row.enrich_offset == run.offset
    )


# ------------------------------------------------------------------------------------------
# Phase 1: changes against the previous crawl, and the alert

_PREVIOUS = text(
    """
    SELECT p.id, p.links_dropped_at IS NULL AS links_kept
    FROM seo.crawl_runs p
    WHERE p.workspace_id = CAST(:workspace_id AS uuid) AND p.project_id = CAST(:project_id AS uuid)
      AND p.state IN ('ready', 'stopped_at_ceiling')
      AND (p.created_at, p.id) < (CAST(:created_at AS timestamptz), CAST(:run_id AS uuid))
    ORDER BY p.created_at DESC, p.id DESC LIMIT 1
    """
)
_PAGE_CHANGES = text(
    """
    INSERT INTO seo.crawl_page_changes (run_id, workspace_id, url_id, is_new, editorial_in_delta,
                                        equity_points, depth_state, depth_delta)
    SELECT c.run_id, c.workspace_id, c.url_id, p.url_id IS NULL,
           CASE WHEN p.url_id IS NULL THEN NULL
                ELSE c.linking_pages_editorial - p.linking_pages_editorial END,
           CASE WHEN p.url_id IS NULL THEN NULL ELSE
                (round(((coalesce(c.equity_share, 0) - coalesce(p.equity_share, 0))
                        * 1000)::numeric) / 10)::double precision END,
           CASE WHEN p.url_id IS NULL THEN NULL
                WHEN p.click_depth IS NULL AND c.click_depth IS NOT NULL THEN 'found'
                WHEN p.click_depth IS NOT NULL AND c.click_depth IS NULL THEN 'lost' END,
           CASE WHEN p.url_id IS NOT NULL AND p.click_depth IS NOT NULL
                     AND c.click_depth IS NOT NULL THEN c.click_depth - p.click_depth END
    FROM seo.crawl_pages c
    LEFT JOIN seo.crawl_pages p ON p.run_id = CAST(:previous_id AS uuid)
         AND p.workspace_id = c.workspace_id AND p.url_id = c.url_id
    WHERE c.run_id = CAST(:run_id AS uuid) AND c.workspace_id = CAST(:workspace_id AS uuid)
      AND (p.url_id IS NULL
           OR c.linking_pages_editorial <> p.linking_pages_editorial
           OR c.click_depth IS DISTINCT FROM p.click_depth
           OR round(((coalesce(c.equity_share, 0) - coalesce(p.equity_share, 0))
                     * 1000)::numeric) <> 0)
    """
)
# One representative link per source and target pair in a scope: the first by scope order. A
# source that refused the crawler in either crawl is left out of both sides: its links were not
# read, so their absence is no change (plan 08 task 4).
_PAIRS = """
    SELECT DISTINCT ON (source_url_id, target_url_id)
           source_url_id, target_url_id, placement, anchor
    FROM seo.crawl_links
    WHERE run_id = CAST(:{run} AS uuid) AND workspace_id = CAST(:workspace_id AS uuid)
      AND source_url_id <> target_url_id {scope}
      AND NOT EXISTS (
          SELECT 1 FROM seo.crawl_pages refused
          WHERE refused.workspace_id = CAST(:workspace_id AS uuid)
            AND refused.run_id IN (CAST(:run_id AS uuid), CAST(:previous_id AS uuid))
            AND refused.url_id = source_url_id
            AND refused.status_code = ANY(CAST(:blocked AS integer[])))
    ORDER BY source_url_id, target_url_id,
             CASE scope WHEN 'editorial' THEN 0 WHEN 'auto_generated' THEN 1 ELSE 2 END, id
"""
_LINK_CHANGES = """
    WITH now_pairs AS ({now}), before_pairs AS ({before})
    INSERT INTO seo.crawl_link_changes (run_id, workspace_id, change, scope, source_url_id,
                                        target_url_id, placement, anchor, still_linked_by)
    SELECT CAST(:run_id AS uuid), CAST(:workspace_id AS uuid), 'added', :scope,
           n.source_url_id, n.target_url_id, n.placement, left(n.anchor, 500), NULL
    FROM (SELECT * FROM now_pairs n WHERE NOT EXISTS (
            SELECT 1 FROM before_pairs b
            WHERE b.source_url_id = n.source_url_id AND b.target_url_id = n.target_url_id)
          ORDER BY n.source_url_id, n.target_url_id LIMIT :cap) n
    UNION ALL
    SELECT CAST(:run_id AS uuid), CAST(:workspace_id AS uuid), 'lost', :scope,
           b.source_url_id, b.target_url_id, b.placement, left(b.anchor, 500),
           {still}
    FROM (SELECT * FROM before_pairs b WHERE NOT EXISTS (
            SELECT 1 FROM now_pairs n
            WHERE n.source_url_id = b.source_url_id AND n.target_url_id = b.target_url_id)
          ORDER BY b.source_url_id, b.target_url_id LIMIT :cap) b
"""
_STILL_ANY_SCOPE = """(SELECT l.placement FROM seo.crawl_links l
        WHERE l.run_id = CAST(:run_id AS uuid) AND l.workspace_id = CAST(:workspace_id AS uuid)
          AND l.source_url_id = b.source_url_id AND l.target_url_id = b.target_url_id
        ORDER BY CASE l.scope WHEN 'editorial' THEN 0 WHEN 'auto_generated' THEN 1 ELSE 2 END, l.id
        LIMIT 1)"""
_NEWER_CRAWL = text(
    """
    SELECT 1 FROM seo.crawl_runs n
    WHERE n.workspace_id = CAST(:workspace_id AS uuid) AND n.project_id = CAST(:project_id AS uuid)
      AND n.state IN ('ready', 'stopped_at_ceiling')
      AND (n.created_at, n.id) > (CAST(:created_at AS timestamptz), CAST(:run_id AS uuid))
    LIMIT 1
    """
)
_LOST_TO_TOP = text(
    """
    SELECT count(*) FROM seo.crawl_link_changes lc
    JOIN core.project_pages pp ON pp.workspace_id = lc.workspace_id
         AND pp.project_id = CAST(:project_id AS uuid) AND pp.url_id = lc.target_url_id
    JOIN core.page_tier_levels t ON t.id = pp.tier_id AND t.workspace_id = pp.workspace_id
    WHERE lc.run_id = CAST(:run_id AS uuid) AND lc.workspace_id = CAST(:workspace_id AS uuid)
      AND lc.change = 'lost' AND lc.scope = 'editorial' AND t.position <= :max_position
    """
)


def _link_change_statement(scope: str) -> Any:
    """The diff of one scope. `editorial` compares editorial links only and says what else still
    links a lost pair; `all` compares every link, so a lost pair has nothing left."""
    scope_filter = "AND scope = 'editorial'" if scope == "editorial" else ""
    return text(
        _LINK_CHANGES.format(
            now=_PAIRS.format(run="run_id", scope=scope_filter),
            before=_PAIRS.format(run="previous_id", scope=scope_filter),
            still=_STILL_ANY_SCOPE if scope == "editorial" else "NULL",
        )
    )


def deliver_alert(settings: AlertSettings) -> str:
    """The delivery state of a new alert (decision D5). The alert always shows in the app. Email
    and Slack have no sender in this repository yet; when the alerts service (WP-47) is merged
    this is the one place that writes its event and returns `delivered`."""
    return "shown_in_app" if settings.channel == "app" else "channel_unavailable"


async def _evaluate_alert(db: AsyncSession, run: _Run) -> None:
    stored: dict[str, Any] | None = (
        await db.execute(
            select(projects.c.settings).where(
                projects.c.workspace_id == run.workspace_id, projects.c.id == run.project_id
            )
        )
    ).scalar_one()
    settings = alert_settings((stored or {}).get("internal_links"))
    # Only the project's latest crawl raises an alert: an older one (met when old crawls are
    # enriched after the migration, or after a newer crawl) would say what is no longer news.
    newer = (
        await db.execute(
            _NEWER_CRAWL,
            {
                "project_id": str(run.project_id),
                "workspace_id": str(run.workspace_id),
                "run_id": str(run.id),
                "created_at": run.created_at,
            },
        )
    ).first()
    if newer is not None:
        return
    count: int = (
        await db.execute(
            _LOST_TO_TOP,
            {
                "run_id": str(run.id),
                "workspace_id": str(run.workspace_id),
                "project_id": str(run.project_id),
                "max_position": settings.max_position,
            },
        )
    ).scalar_one()
    if not alert_due(count, settings):
        return
    # A rerun keeps the alert it raised before, so a delivery happens once (decision D4).
    await db.execute(
        upsert(crawl_alerts)
        .values(
            run_id=run.id,
            workspace_id=run.workspace_id,
            project_id=run.project_id,
            lost_links=count,
            max_position=settings.max_position,
            threshold=settings.threshold,
            channel=settings.channel,
            delivery_state=deliver_alert(settings),
        )
        .on_conflict_do_nothing()
    )


async def _changes(
    sessions: async_sessionmaker[AsyncSession], store: ObjectStore | None, run: _Run
) -> bool:
    async with sessions() as db, db.begin():
        await db.execute(_LONG_STATEMENT_TIMEOUT)
        if not await _claim(db, run):
            return False
        for table in (crawl_link_changes, crawl_page_changes):
            await db.execute(
                delete(table).where(
                    table.c.run_id == run.id, table.c.workspace_id == run.workspace_id
                )
            )
        keys = {"run_id": str(run.id), "workspace_id": str(run.workspace_id)}
        compared = False
        previous = (
            await db.execute(
                _PREVIOUS,
                {**keys, "project_id": str(run.project_id), "created_at": run.created_at},
            )
        ).one_or_none()
        if previous is not None:
            both = {**keys, "previous_id": str(previous.id)}
            await db.execute(_PAGE_CHANGES, both)
            compared = previous.links_kept and run.links_kept
            if compared:
                for scope in ("editorial", "all"):
                    await db.execute(
                        _link_change_statement(scope),
                        {
                            **both,
                            "scope": scope,
                            "cap": CHANGES_MAX,
                            "blocked": sorted(BLOCKED_STATUSES),
                        },
                    )
                # Retention may have dropped a partition while the diff read it: a missing
                # side would read as every link lost or added.
                dropped = (
                    await db.execute(
                        select(func.count()).where(
                            crawl_runs.c.workspace_id == run.workspace_id,
                            crawl_runs.c.id.in_((run.id, previous.id)),
                            crawl_runs.c.links_dropped_at.is_not(None),
                        )
                    )
                ).scalar_one()
                if dropped:
                    raise _MovedError
        await _evaluate_alert(db, run)
        await db.execute(
            update(crawl_runs)
            .where(crawl_runs.c.workspace_id == run.workspace_id, crawl_runs.c.id == run.id)
            .values(
                previous_run_id=None if previous is None else previous.id,
                enrich_state="running",
                enrich_phase="anchors",
                enrich_offset=0,
                enrich_failures=0,
                links_compared=compared,
            )
        )
    return True


# ------------------------------------------------------------------------------------------
# Phase 2: editorial anchor counts per page, for the "Mostly generic anchors" flag

_ANCHORS = text(
    """
    UPDATE seo.crawl_pages p SET editorial_anchors = c.total, generic_anchors = c.generic
    FROM (SELECT target_url_id, count(*) AS total,
                 count(*) FILTER (WHERE lower(regexp_replace(anchor, :edge, '', 'g'))
                                        = ANY(:generic)) AS generic
          FROM seo.crawl_links
          WHERE run_id = CAST(:run_id AS uuid) AND workspace_id = CAST(:workspace_id AS uuid)
            AND scope = 'editorial' AND source_url_id <> target_url_id
          GROUP BY target_url_id) c
    WHERE p.run_id = CAST(:run_id AS uuid) AND p.workspace_id = CAST(:workspace_id AS uuid)
      AND p.url_id = c.target_url_id
    """
).bindparams(bindparam("generic", type_=ARRAY(Text)))


async def _anchors(
    sessions: async_sessionmaker[AsyncSession], store: ObjectStore | None, run: _Run
) -> bool:
    async with sessions() as db, db.begin():
        await db.execute(_LONG_STATEMENT_TIMEOUT)
        if not await _claim(db, run):
            return False
        if run.links_kept:
            await db.execute(
                _ANCHORS,
                {
                    "run_id": str(run.id),
                    "workspace_id": str(run.workspace_id),
                    "edge": EDGE_PATTERN,
                    "generic": sorted(GENERIC_ANCHORS),
                },
            )
        await db.execute(
            update(crawl_runs)
            .where(crawl_runs.c.workspace_id == run.workspace_id, crawl_runs.c.id == run.id)
            .values(
                enrich_state="running", enrich_phase="mentions", enrich_offset=0, enrich_failures=0
            )
        )
    return True


# ------------------------------------------------------------------------------------------
# Phase 3: mentions, found in the stored HTML of the pages a visitor can reach (decision D11)

MENTION_PAGES_PER_STEP: Final = 25
# A page's text is cut here before it is searched (the HTML of a trap page can be huge).
MENTION_TEXT_MAX: Final = 500_000
# A tracked keyword belongs to the page it targets, or, with no target, to the page it ranks
# with now (decision D8).
_KEYWORD_PHRASES = text(
    """
    SELECT coalesce(tk.target_url_id, st.current_url_id) AS url_id, k.text AS phrase
    FROM seo.tracked_keywords tk
    JOIN seo.keywords k ON k.id = tk.keyword_id AND k.workspace_id = tk.workspace_id
    LEFT JOIN seo.tracked_keyword_state st
         ON st.tracked_keyword_id = tk.id AND st.workspace_id = tk.workspace_id
    WHERE tk.workspace_id = CAST(:workspace_id AS uuid)
      AND tk.project_id = CAST(:project_id AS uuid)
      AND tk.is_active AND tk.deleted_at IS NULL
      AND coalesce(tk.target_url_id, st.current_url_id) IS NOT NULL
    """
)
# Anchors at least two other pages use to link to a page by an editorial link.
_ANCHOR_PHRASES = text(
    """
    SELECT target_url_id AS url_id, min(anchor) AS phrase
    FROM seo.crawl_links
    WHERE run_id = CAST(:run_id AS uuid) AND workspace_id = CAST(:workspace_id AS uuid)
      AND scope = 'editorial' AND source_url_id <> target_url_id AND anchor <> ''
    GROUP BY target_url_id, lower(anchor)
    HAVING count(DISTINCT source_url_id) >= 2
    """
)
_ALREADY_LINKED = text(
    """
    SELECT DISTINCT source_url_id, target_url_id FROM seo.crawl_links
    WHERE run_id = CAST(:run_id AS uuid) AND workspace_id = CAST(:workspace_id AS uuid)
      AND scope = 'editorial' AND source_url_id = ANY(:sources)
    """
).bindparams(bindparam("sources", type_=ARRAY(BigInteger)))


# The first pages of a crawl are read once to learn which blocks of text the template repeats
# (a menu built of plain elements, a header button). The answer is kept for the crawl being
# enriched, so the steps of one pass do not read the sample again; another crawl replaces it.
BOILERPLATE_SAMPLE: Final = 40
_boilerplate_memo: dict[UUID, frozenset[str]] = {}


async def _mention_sources(db: AsyncSession, run: _Run, *, after: int, limit: int) -> list[Any]:
    """The pages whose text is searched: live, indexable, reachable, links read from HTML."""
    result = await db.execute(
        select(crawl_pages.c.url_id, urls.c.url_hash)
        .join(urls, urls.c.id == crawl_pages.c.url_id)
        .where(
            crawl_pages.c.workspace_id == run.workspace_id,
            crawl_pages.c.run_id == run.id,
            crawl_pages.c.status_code == 200,
            crawl_pages.c.is_indexable,
            crawl_pages.c.click_depth.is_not(None),
            crawl_pages.c.links_state == "from_html",
            crawl_pages.c.url_id > after,
        )
        .order_by(crawl_pages.c.url_id)
        .limit(limit)
    )
    return list(result.all())


async def _boilerplate(db: AsyncSession, store: ObjectStore, run: _Run) -> frozenset[str]:
    # The first step of a pass reads the sample afresh: the stored HTML may have changed.
    known = None if run.offset == 0 else _boilerplate_memo.get(run.id)
    if known is not None:
        return known
    pages: list[list[str]] = []
    for source in await _mention_sources(db, run, after=0, limit=BOILERPLATE_SAMPLE):
        try:
            html = decompress(await store.get(html_key(run.project_id, source.url_hash)))
        except RawStorageError:
            continue
        # The whole body: a page with a `main` hides the template text that its siblings show.
        text = html.decode("utf-8", errors="replace")[:MENTION_TEXT_MAX]
        pages.append(visible_blocks(text, whole_body=True))
    found = boilerplate_blocks(pages)
    _boilerplate_memo.clear()
    _boilerplate_memo[run.id] = found
    return found


async def _mentions(
    sessions: async_sessionmaker[AsyncSession], store: ObjectStore | None, run: _Run
) -> bool:
    """25 source pages per step: read the stored HTML, take the visible text and look for the
    phrases of every live indexable target. A page whose HTML is gone has no mention."""
    keys = {"run_id": str(run.id), "workspace_id": str(run.workspace_id)}
    async with sessions() as db:
        sources = await _mention_sources(db, run, after=run.offset, limit=MENTION_PAGES_PER_STEP)
        boilerplate = (
            await _boilerplate(db, store, run) if sources and store is not None else frozenset()
        )
        index: dict[str, list[tuple[int, Any]]] = {}
        already: dict[int, set[int]] = {}
        if sources and store is not None:
            targets = {
                row.url_id
                for row in await db.execute(
                    select(crawl_pages.c.url_id).where(
                        crawl_pages.c.workspace_id == run.workspace_id,
                        crawl_pages.c.run_id == run.id,
                        crawl_pages.c.status_code == 200,
                        crawl_pages.c.is_indexable,
                    )
                )
            }
            keywords: dict[int, list[str]] = {}
            for row in await db.execute(
                _KEYWORD_PHRASES, {**keys, "project_id": str(run.project_id)}
            ):
                keywords.setdefault(row.url_id, []).append(row.phrase)
            anchors: dict[int, list[str]] = {}
            for row in await db.execute(_ANCHOR_PHRASES, keys):
                anchors.setdefault(row.url_id, []).append(row.phrase)
            index = index_phrases(
                {
                    url: PhraseSet(keywords.get(url, ()), anchors.get(url, ()))
                    for url in targets
                    if url in keywords or url in anchors
                }
            )
            for row in await db.execute(
                _ALREADY_LINKED, {**keys, "sources": [row.url_id for row in sources]}
            ):
                already.setdefault(row.source_url_id, set()).add(row.target_url_id)
    found: list[dict[str, object]] = []
    for source in sources:
        if store is None or not index:
            break
        try:
            html = decompress(await store.get(html_key(run.project_id, source.url_hash)))
        except RawStorageError:
            continue
        page_text = visible_text(html.decode("utf-8", errors="replace"), boilerplate=boilerplate)[
            :MENTION_TEXT_MAX
        ]
        for mention in find_mentions(
            page_text,
            index,
            source_url_id=source.url_id,
            skip=already.get(source.url_id, set()),
        ):
            found.append(
                {
                    "run_id": run.id,
                    "workspace_id": run.workspace_id,
                    "source_url_id": source.url_id,
                    "target_url_id": mention.target_url_id,
                    "phrase": mention.phrase[:200],
                    "context": mention.context[:400],
                    "origin": mention.origin,
                }
            )
    async with sessions() as db, db.begin():
        if not await _claim(db, run):
            return False
        if run.offset == 0:
            await db.execute(
                delete(crawl_mentions).where(
                    crawl_mentions.c.run_id == run.id,
                    crawl_mentions.c.workspace_id == run.workspace_id,
                )
            )
        if found:
            # A retried step may meet rows it already wrote: the primary key makes that harmless.
            await db.execute(upsert(crawl_mentions).values(found).on_conflict_do_nothing())
        finished = len(sources) < MENTION_PAGES_PER_STEP
        await db.execute(
            update(crawl_runs)
            .where(crawl_runs.c.workspace_id == run.workspace_id, crawl_runs.c.id == run.id)
            .values(
                enrich_state="done" if finished else "running",
                enrich_phase="done" if finished else "mentions",
                enrich_offset=0 if finished else sources[-1].url_id,
                enrich_failures=0,
            )
        )
    return True


_STEPS: Final[dict[str, Step]] = {
    "changes": _changes,
    "anchors": _anchors,
    "mentions": _mentions,
}


async def _failed_pass(sessions: async_sessionmaker[AsyncSession], run: _Run) -> None:
    """Count a failed pass; the fifth in a row ends the enrichment as `failed`."""
    async with sessions() as db, db.begin():
        await db.execute(
            update(crawl_runs)
            .where(
                crawl_runs.c.workspace_id == run.workspace_id,
                crawl_runs.c.id == run.id,
                crawl_runs.c.enrich_state.in_(("pending", "running")),
                # A pass that was overtaken must not count against the phase now under way.
                func.coalesce(crawl_runs.c.enrich_phase, "changes") == run.phase,
            )
            .values(
                enrich_failures=crawl_runs.c.enrich_failures + 1,
                enrich_state=case(
                    (crawl_runs.c.enrich_failures + 1 >= ENRICH_FAILURES_MAX, "failed"),
                    else_=crawl_runs.c.enrich_state,
                ),
            )
        )


async def enrich_run(
    sessions: async_sessionmaker[AsyncSession],
    store: ObjectStore | None,
    task: CrawlEnrichTask,
    *,
    deadline: float,
) -> EnrichOutcome:
    """One pass: phases until the crawl is enriched or `deadline` (`time.monotonic()`) has
    passed; at least one phase is taken. It reads the database, and in Task 7 raw HTML from
    storage; it never calls a provider and spends nothing."""
    steps = 0
    while True:
        run = await _read_run(sessions, task)
        if run is None:
            return EnrichOutcome(phase=None, steps=steps)
        if run.phase not in _STEPS:
            # A phase this code does not know (a rollback): counted, so it ends as `failed`
            # instead of being sent every minute for good.
            await _failed_pass(sessions, run)
            return EnrichOutcome(phase=run.phase, steps=steps, failed=True)
        try:
            applied = await _STEPS[run.phase](sessions, store, run)
        except _MovedError:
            return EnrichOutcome(phase=run.phase, steps=steps, busy=True)
        except Exception as failure:
            _log.error(
                "crawl enrich step failed",
                run_id=str(run.id),
                phase=run.phase,
                error=type(failure).__name__,
            )
            await _failed_pass(sessions, run)
            return EnrichOutcome(phase=run.phase, steps=steps, failed=True)
        if not applied:
            return EnrichOutcome(phase=run.phase, steps=steps, busy=True)
        steps += 1
        if time.monotonic() >= deadline:
            return EnrichOutcome(phase=run.phase, steps=steps)
