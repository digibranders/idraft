"""The numbers next to a page that the crawl does not hold: change since the last crawl,
tracked keywords and their rank, AI citations, anchors and Search Console clicks (plan 04 D7 to
D10). Each part is one query over the rows being read; every query names the workspace and the
project, and starts from URL ids that came from a row of the crawl in scope."""

from __future__ import annotations

from collections.abc import Collection, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Any, Final

from sqlalchemy import ARRAY, BigInteger, Row, Text, and_, bindparam, exists, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.api.internal_links.page_filter import PageScope
from idraft.api.keywords.gsc_repository import GscScope, scope_of
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
from idraft.crawl.anchors import EDGE_PATTERN, GENERIC_ANCHORS
from idraft.db.tables import crawl_page_changes, crawl_pages, crawl_runs, gsc_page_daily

# AI Overview has no column of its own in `CitationCounts`; it counts in the total only.
ENGINES: Final = {
    "chatgpt_web": "chatgpt",
    "gemini_web": "gemini",
    "google_ai_mode": "ai_mode",
    "google_ai_overview": "ai_overview",
}
# What a page that did not change shows once its crawl was compared with the one before.
UNCHANGED: Final = PageChange(
    is_new=False, editorial_in_delta=0, equity_points=0.0, depth_state=None, depth_delta=0
)

# D8: a tracked keyword belongs to its target page, or, with no target, to the page it ranks
# with. Several tracked rows of one keyword (devices, locations) count once, the best ranking.
_KEYWORDS = text(
    """
    WITH owned AS (
        SELECT coalesce(tk.target_url_id, st.current_url_id) AS page_url, tk.keyword_id,
               k.text AS keyword, st.current_rank AS rank, st.rank_change AS change,
               m.search_volume AS volume, st.last_observed_at AS observed_at
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
    SELECT DISTINCT ON (page_url, keyword_id) page_url, keyword, rank, change, volume, observed_at
    FROM owned WHERE page_url = ANY(:ids)
    ORDER BY page_url, keyword_id, rank NULLS LAST
    """
).bindparams(bindparam("ids", type_=ARRAY(BigInteger)))
# D9: distinct answers per engine in 28 days, answers that were not superseded.
_CITATIONS = text(
    """
    SELECT c.url_id, c.engine_code, count(DISTINCT c.observation_id) AS answers,
           NULL::timestamptz AS newest
    FROM ai.citations c
    JOIN ai.observations o ON o.id = c.observation_id AND o.observed_at = c.observed_at
         AND o.workspace_id = c.workspace_id
    WHERE c.workspace_id = CAST(:workspace_id AS uuid) AND c.project_id = CAST(:project_id AS uuid)
      AND c.url_id = ANY(:ids) AND c.domain_role = 'own'
      AND c.observed_at >= now() - interval '28 days' AND o.superseded_by IS NULL
    GROUP BY c.url_id, c.engine_code
    UNION ALL
    -- One more row, in the same statement: the project's newest answer that was not superseded,
    -- which dates the counts whatever page they are shown for.
    SELECT NULL, NULL, 0, max(observed_at) FROM ai.observations
    WHERE workspace_id = CAST(:workspace_id AS uuid) AND project_id = CAST(:project_id AS uuid)
      AND superseded_by IS NULL
    """
).bindparams(bindparam("ids", type_=ARRAY(BigInteger)))
# D7: anchors group by the edge-trimmed text without letter case and count every link, the way
# `crawl_enrich` stores `editorial_anchors` and `generic_anchors`, so the numbers are equal. The
# totals and the keyword match are made in SQL, so memory holds only the top texts per page.
_ANCHORS = text(
    """
    WITH grouped AS (
        SELECT target_url_id, lower(clean) AS key, min(clean COLLATE "C") AS shown,
               count(*) AS links
        FROM (SELECT target_url_id, regexp_replace(anchor, :edge, '', 'g') AS clean
              FROM seo.crawl_links
              WHERE run_id = CAST(:run_id AS uuid) AND workspace_id = CAST(:workspace_id AS uuid)
                AND scope = 'editorial' AND source_url_id <> target_url_id AND NOT ignored
                AND target_url_id = ANY(:ids)) edge_trimmed
        GROUP BY target_url_id, lower(clean)
    ), ranked AS (
        SELECT target_url_id, key, shown, links,
               row_number() OVER (PARTITION BY target_url_id
                                  ORDER BY links DESC, key COLLATE "C") AS place,
               sum(links) OVER (PARTITION BY target_url_id) AS total,
               count(*) OVER (PARTITION BY target_url_id) AS distinct_texts,
               coalesce(sum(links) FILTER (WHERE key = ANY(:generic))
                        OVER (PARTITION BY target_url_id), 0) AS generic_links
        FROM grouped
    ), matched AS (
        SELECT DISTINCT g.target_url_id
        FROM grouped g
        JOIN unnest(:keyword_pages, :keyword_words) AS k(page, word) ON k.page = g.target_url_id
        WHERE g.key <> '' AND NOT g.key = ANY(:generic)
          AND (strpos(g.key, k.word) > 0 OR strpos(k.word, g.key) > 0)
    )
    SELECT r.target_url_id, r.shown, r.links, r.key = ANY(:generic) AS is_generic,
           r.total, r.distinct_texts, r.generic_links,
           r.target_url_id IN (SELECT target_url_id FROM matched) AS matches_keyword
    FROM ranked r
    WHERE r.place <= :top
    ORDER BY r.target_url_id, r.place
    """
).bindparams(
    bindparam("ids", type_=ARRAY(BigInteger)),
    bindparam("generic", type_=ARRAY(Text)),
    bindparam("keyword_pages", type_=ARRAY(BigInteger)),
    bindparam("keyword_words", type_=ARRAY(Text)),
)

NO_CITATIONS: Final = CitationCounts(chatgpt=0, gemini=0, ai_mode=0, total=0, citations_as_of=None)


def _day(moment: datetime) -> date:
    return moment.astimezone(UTC).date()


@dataclass(frozen=True, slots=True)
class KeywordFact:
    keyword: str
    rank: int | None
    change: int | None
    volume: int | None
    observed_at: datetime | None


async def changes_of(
    db: AsyncSession, scope: PageScope, ids: Collection[int]
) -> dict[int, PageChange] | None:
    """None when the crawl has no previous one (the column shows nothing, not zeros). Once the
    comparison is done (`enrich_state` `done`), a page without a stored row did not change and
    shows zeros; before that, such a page has no answer yet and is absent."""
    # One statement: the run's row, with the changes of `ids` outer-joined to it.
    rows = (
        await db.execute(
            select(
                crawl_runs.c.previous_run_id,
                crawl_runs.c.enrich_state,
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
    found = {
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
    if rows[0].enrich_state == "done":
        return {url: found.get(url, UNCHANGED) for url in ids}
    return found


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
            KeywordFact(row.keyword, row.rank, row.change, row.volume, row.observed_at)
        )
    return found


def summarize_keywords(rows: Sequence[KeywordFact]) -> KeywordSummary:
    ranks = [row.rank for row in rows if row.rank is not None]
    volumes = [row.volume for row in rows if row.volume is not None]
    days = [_day(row.observed_at) for row in rows if row.observed_at]
    return KeywordSummary(
        tracked=len(rows),
        ranking=len(ranks),
        average_rank=round(sum(ranks) / len(ranks), 1) if ranks else None,
        best_volume=max(volumes) if volumes else None,
        rank_as_of=max(days, default=None),
    )


def keyword_rows(rows: Sequence[KeywordFact]) -> list[KeywordRow]:
    return [
        KeywordRow(
            keyword=row.keyword,
            rank=row.rank,
            change=row.change,
            volume=row.volume,
            rank_as_of=_day(row.observed_at) if row.observed_at else None,
        )
        for row in sorted(rows, key=lambda row: (row.rank is None, row.rank or 0, row.keyword))
    ]


async def citations_of(
    db: AsyncSession, scope: PageScope, ids: Sequence[int]
) -> dict[int, CitationCounts]:
    counts: dict[int, dict[str, int]] = {}
    newest: datetime | None = None
    for row in await db.execute(
        _CITATIONS,
        {
            "workspace_id": str(scope.workspace_id),
            "project_id": str(scope.project_id),
            "ids": list(ids),
        },
    ):
        if row.url_id is None:
            newest = row.newest
            continue
        name = ENGINES.get(row.engine_code)
        if name is not None:
            counts.setdefault(row.url_id, {})[name] = row.answers
    as_of = _day(newest) if newest is not None else None
    return {
        url: CitationCounts(
            chatgpt=(found := counts.get(url, {})).get("chatgpt", 0),
            gemini=found.get("gemini", 0),
            ai_mode=found.get("ai_mode", 0),
            total=sum(found.values()),
            citations_as_of=as_of,
        )
        for url in ids
    }


async def anchors_of(
    db: AsyncSession,
    scope: PageScope,
    ids: Sequence[int],
    keywords: dict[int, list[KeywordFact]],
    *,
    top: int = 5,
) -> dict[int, AnchorDetail]:
    """A page with no editorial link in is absent (see `empty_anchors`). A crawl whose links are
    gone keeps only the stored counts: the texts, their number and the keyword match are None."""
    if scope.links_dropped:
        return await _stored_anchors(db, scope, ids)
    words = [(url, row.keyword.lower()) for url in ids for row in keywords.get(url, [])]
    rows = await db.execute(
        _ANCHORS,
        {
            "run_id": str(scope.run_id),
            "workspace_id": str(scope.workspace_id),
            "ids": list(ids),
            "edge": EDGE_PATTERN,
            "generic": sorted(GENERIC_ANCHORS),
            "keyword_pages": [url for url, _ in words],
            "keyword_words": [word for _, word in words],
            "top": top,
        },
    )
    by_page: dict[int, list[Row[Any]]] = {}
    for row in rows:
        by_page.setdefault(row.target_url_id, []).append(row)
    result: dict[int, AnchorDetail] = {}
    for url, texts in by_page.items():
        first = texts[0]
        total, generic = int(first.total), int(first.generic_links)
        result[url] = AnchorDetail(
            total=total,
            distinct=first.distinct_texts,
            generic=generic,
            generic_share=generic / total,
            matches_keyword=bool(first.matches_keyword) if keywords.get(url) else None,
            top=[
                AnchorText(text=row.shown, count=row.links, generic=row.is_generic) for row in texts
            ],
        )
    return result


async def _stored_anchors(
    db: AsyncSession, scope: PageScope, ids: Sequence[int]
) -> dict[int, AnchorDetail]:
    result: dict[int, AnchorDetail] = {}
    for row in await db.execute(
        select(
            crawl_pages.c.url_id, crawl_pages.c.editorial_anchors, crawl_pages.c.generic_anchors
        ).where(
            crawl_pages.c.workspace_id == scope.workspace_id,
            crawl_pages.c.run_id == scope.run_id,
            crawl_pages.c.url_id.in_(list(ids)),
        )
    ):
        result[row.url_id] = AnchorDetail(
            total=row.editorial_anchors,
            distinct=None,
            generic=row.generic_anchors,
            generic_share=row.generic_anchors / row.editorial_anchors
            if row.editorial_anchors
            else 0.0,
            matches_keyword=None,
            top=None,
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


async def gsc_window(db: AsyncSession, scope: PageScope) -> GscScope:
    """The project's Google state for page numbers. The pull says `ok` as soon as it has a
    window, but the page days are stored after that (and may stop on a budget, or never exist
    for a property connected before this feature), so `ok` also needs one stored page day in the
    window; otherwise it is `pending`, with no property or window."""
    state = await scope_of(db, scope.workspace_id, scope.project_id)
    if state.state != "ok":
        return state
    if state.integration_id is None or state.window is None:
        return GscScope("pending")
    stored = (
        await db.execute(
            select(
                exists().where(
                    gsc_page_daily.c.workspace_id == scope.workspace_id,
                    gsc_page_daily.c.project_id == scope.project_id,
                    gsc_page_daily.c.integration_id == state.integration_id,
                    gsc_page_daily.c.metric_date.between(*state.window),
                )
            )
        )
    ).scalar_one()
    return state if stored else GscScope("pending")


async def gsc_of(db: AsyncSession, scope: PageScope, ids: Sequence[int]) -> dict[int, GscPage]:
    """Google's page numbers. `ok` shows 0 for a page with no row in the window (a count);
    `pending` and `not_connected` show none."""
    state = await gsc_window(db, scope)
    if state.integration_id is None or state.window is None:
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
