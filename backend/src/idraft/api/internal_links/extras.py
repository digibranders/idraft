"""The numbers next to a page that the crawl does not hold: change since the last crawl,
tracked keywords and their rank, AI citations, anchors and Search Console clicks (plan 04 D7 to
D10). Each part is one query over the rows being read; every query names the workspace and the
project, and starts from URL ids that came from a row of the crawl in scope."""

from __future__ import annotations

from collections.abc import Collection, Sequence
from dataclasses import dataclass
from typing import Final

from sqlalchemy import ARRAY, BigInteger, and_, bindparam, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.api.internal_links.page_filter import PageScope
from idraft.api.keywords.gsc_repository import scope_of
from idraft.api.keywords.repository import LABS
from idraft.api.schemas.internal_links import (
    AnchorDetail,
    AnchorSummary,
    AnchorText,
    CitationCounts,
    GscPage,
    KeywordRow,
    KeywordSummary,
    PageChange,
)
from idraft.collectors.gsc_pages import page_clicks
from idraft.crawl.anchors import anchor_stats
from idraft.db.tables import crawl_page_changes, crawl_runs

ENGINES: Final = {"chatgpt_web": "chatgpt", "gemini_web": "gemini", "google_ai_mode": "ai_mode"}
ANCHORS_PER_PAGE_MAX: Final = 5_000

# D8: a tracked keyword belongs to its target page, or, with no target, to the page it ranks
# with. Several tracked rows of one keyword (devices, locations) count once, the best ranking.
_KEYWORDS = text(
    """
    WITH owned AS (
        SELECT coalesce(tk.target_url_id, st.current_url_id) AS page_url, tk.keyword_id,
               k.text AS keyword, st.current_rank AS rank, st.rank_change AS change,
               m.search_volume AS volume
        FROM seo.tracked_keywords tk
        JOIN seo.keywords k ON k.id = tk.keyword_id AND k.workspace_id = tk.workspace_id
        LEFT JOIN seo.tracked_keyword_state st ON st.tracked_keyword_id = tk.id
             AND st.workspace_id = tk.workspace_id
        LEFT JOIN seo.keyword_metrics_current m ON m.keyword_id = tk.keyword_id
             AND m.location_id = tk.location_id AND m.language_code = tk.language_code
             AND m.source = :source AND m.workspace_id = tk.workspace_id
        WHERE tk.workspace_id = CAST(:workspace_id AS uuid)
          AND tk.project_id = CAST(:project_id AS uuid)
          AND tk.is_active AND tk.deleted_at IS NULL
    )
    SELECT DISTINCT ON (page_url, keyword_id) page_url, keyword, rank, change, volume
    FROM owned WHERE page_url = ANY(:ids)
    ORDER BY page_url, keyword_id, rank NULLS LAST
    """
).bindparams(bindparam("ids", type_=ARRAY(BigInteger)))
# D9: distinct answers per engine in 28 days, answers that were not superseded.
_CITATIONS = text(
    """
    SELECT c.url_id, c.engine_code, count(DISTINCT c.observation_id) AS answers
    FROM ai.citations c
    JOIN ai.observations o ON o.id = c.observation_id AND o.observed_at = c.observed_at
         AND o.workspace_id = c.workspace_id
    WHERE c.workspace_id = CAST(:workspace_id AS uuid) AND c.project_id = CAST(:project_id AS uuid)
      AND c.url_id = ANY(:ids) AND c.domain_role = 'own'
      AND c.observed_at >= now() - interval '28 days' AND o.superseded_by IS NULL
    GROUP BY c.url_id, c.engine_code
    """
).bindparams(bindparam("ids", type_=ARRAY(BigInteger)))
_ANCHORS = text(
    """
    SELECT target_url_id, lower(btrim(anchor)) AS key, min(anchor) AS shown, count(*) AS links
    FROM seo.crawl_links
    WHERE run_id = CAST(:run_id AS uuid) AND workspace_id = CAST(:workspace_id AS uuid)
      AND scope = 'editorial' AND source_url_id <> target_url_id AND target_url_id = ANY(:ids)
    GROUP BY target_url_id, lower(btrim(anchor))
    """
).bindparams(bindparam("ids", type_=ARRAY(BigInteger)))

NO_CITATIONS: Final = CitationCounts(chatgpt=0, gemini=0, ai_mode=0, total=0)


@dataclass(frozen=True, slots=True)
class KeywordFact:
    keyword: str
    rank: int | None
    change: int | None
    volume: int | None


async def changes_of(
    db: AsyncSession, scope: PageScope, ids: Collection[int]
) -> dict[int, PageChange] | None:
    """None when the crawl has no previous one (the column shows nothing, not zeros)."""
    # One statement: the run's row, with the changes of `ids` outer-joined to it.
    rows = (
        await db.execute(
            select(
                crawl_runs.c.previous_run_id,
                crawl_page_changes.c.url_id,
                crawl_page_changes.c.is_new,
                crawl_page_changes.c.editorial_in_delta,
                crawl_page_changes.c.equity_points,
                crawl_page_changes.c.depth_state,
                crawl_page_changes.c.depth_delta,
            )
            .select_from(
                crawl_runs.outerjoin(
                    crawl_page_changes,
                    and_(
                        crawl_page_changes.c.workspace_id == crawl_runs.c.workspace_id,
                        crawl_page_changes.c.run_id == crawl_runs.c.id,
                        crawl_page_changes.c.url_id.in_(list(ids)),
                    ),
                )
            )
            .where(crawl_runs.c.workspace_id == scope.workspace_id, crawl_runs.c.id == scope.run_id)
        )
    ).all()
    if not rows or rows[0].previous_run_id is None:
        return None
    return {
        row.url_id: PageChange(
            is_new=row.is_new,
            editorial_in_delta=row.editorial_in_delta,
            equity_points=row.equity_points,
            depth_state=row.depth_state,
            depth_delta=row.depth_delta,
        )
        for row in rows
        if row.url_id is not None
    }


async def keywords_of(
    db: AsyncSession, scope: PageScope, ids: Sequence[int]
) -> dict[int, list[KeywordFact]]:
    found: dict[int, list[KeywordFact]] = {}
    for row in await db.execute(
        _KEYWORDS,
        {
            "workspace_id": str(scope.workspace_id),
            "project_id": str(scope.project_id),
            "source": LABS,
            "ids": list(ids),
        },
    ):
        found.setdefault(row.page_url, []).append(
            KeywordFact(row.keyword, row.rank, row.change, row.volume)
        )
    return found


def summarize_keywords(rows: Sequence[KeywordFact]) -> KeywordSummary:
    ranks = [row.rank for row in rows if row.rank is not None]
    volumes = [row.volume for row in rows if row.volume is not None]
    return KeywordSummary(
        tracked=len(rows),
        ranking=len(ranks),
        average_rank=round(sum(ranks) / len(ranks), 1) if ranks else None,
        best_volume=max(volumes) if volumes else None,
    )


def keyword_rows(rows: Sequence[KeywordFact]) -> list[KeywordRow]:
    return [
        KeywordRow(keyword=row.keyword, rank=row.rank, change=row.change, volume=row.volume)
        for row in sorted(rows, key=lambda row: (row.rank is None, row.rank or 0, row.keyword))
    ]


async def citations_of(
    db: AsyncSession, scope: PageScope, ids: Sequence[int]
) -> dict[int, CitationCounts]:
    counts: dict[int, dict[str, int]] = {}
    for row in await db.execute(
        _CITATIONS,
        {
            "workspace_id": str(scope.workspace_id),
            "project_id": str(scope.project_id),
            "ids": list(ids),
        },
    ):
        name = ENGINES.get(row.engine_code)
        if name is not None:
            counts.setdefault(row.url_id, {})[name] = row.answers
    return {
        url: CitationCounts(
            chatgpt=found.get("chatgpt", 0),
            gemini=found.get("gemini", 0),
            ai_mode=found.get("ai_mode", 0),
            total=sum(found.values()),
        )
        for url, found in counts.items()
    }


async def anchors_of(
    db: AsyncSession,
    scope: PageScope,
    ids: Sequence[int],
    keywords: dict[int, list[KeywordFact]],
    *,
    top: int = 5,
) -> dict[int, AnchorDetail]:
    grouped: dict[int, list[str]] = {}
    for row in await db.execute(
        _ANCHORS,
        {"run_id": str(scope.run_id), "workspace_id": str(scope.workspace_id), "ids": list(ids)},
    ):
        bucket = grouped.setdefault(row.target_url_id, [])
        room = ANCHORS_PER_PAGE_MAX - len(bucket)
        bucket.extend([row.shown] * min(row.links, max(room, 0)))
    result: dict[int, AnchorDetail] = {}
    for url, anchors in grouped.items():
        stats = anchor_stats(anchors, [row.keyword for row in keywords.get(url, [])], limit=top)
        result[url] = AnchorDetail(
            total=stats.total,
            distinct=stats.distinct,
            generic=stats.generic_count,
            generic_share=stats.generic_share,
            matches_keyword=stats.matches_keyword,
            top=[AnchorText(text=g.text, count=g.count, generic=g.generic) for g in stats.top],
        )
    return result


def empty_anchors(keywords: Sequence[KeywordFact]) -> AnchorDetail:
    return AnchorDetail(
        total=0,
        distinct=0,
        generic=0,
        generic_share=0.0,
        matches_keyword=None if not keywords else False,
        top=[],
    )


def anchor_summary(detail: AnchorDetail) -> AnchorSummary:
    return AnchorSummary(
        total=detail.total,
        distinct=detail.distinct,
        generic=detail.generic,
        generic_share=detail.generic_share,
        matches_keyword=detail.matches_keyword,
    )


async def gsc_of(db: AsyncSession, scope: PageScope, ids: Sequence[int]) -> dict[int, GscPage]:
    """Google's page numbers. `ok` shows 0 for a page with no row in the window (a count);
    `pending` and `not_connected` show none."""
    state = await scope_of(db, scope.workspace_id, scope.project_id)
    if state.state != "ok" or state.integration_id is None or state.window is None:
        empty = GscPage(
            state=state.state, clicks=None, impressions=None, window_start=None, window_end=None
        )
        return dict.fromkeys(ids, empty)
    totals = await page_clicks(
        db, scope.workspace_id, scope.project_id, state.integration_id, state.window, ids
    )
    return {
        url: GscPage(
            state="ok",
            clicks=totals[url].clicks if url in totals else 0,
            impressions=totals[url].impressions if url in totals else 0,
            window_start=state.window[0],
            window_end=state.window[1],
        )
        for url in ids
    }
