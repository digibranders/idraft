"""The read model of Cannibalization and Switching: keyword rows, headline numbers, page pairs
and switch events, built from the rules (`ranks.cannibalization`) over loaded checks. Pure."""

from __future__ import annotations

import math
import re
from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from statistics import median

from idraft.api.cannibalization.repository import KeywordSeries, UrlInfo
from idraft.api.schemas.cannibalization import (
    CheckRank,
    ConflictHeadline,
    Count,
    DeviceName,
    KeywordCheck,
    KeywordConflict,
    PageFigures,
    PagePair,
    PairPage,
    StripCell,
    SwitchEvent,
    SwitchHeadline,
    SwitchRow,
    VerdictCounts,
    WeekBucket,
)
from idraft.ranks.cannibalization import MIN_CHECKS, Analysis, analyse

CONFLICTS = ("likely", "co_ranking", "unstable")
_ORDER = {"likely": 0, "co_ranking": 1, "unstable": 2, "none": 3, "insufficient": 4, "unranked": 5}
_LETTERS = "ABCDEF"
_STOP = frozenset({"the", "and", "for", "with", "your", "you", "are", "how", "what", "from"})


@dataclass(frozen=True, slots=True)
class Window:
    """The period read and, when the history allows it, the same number of days before."""

    today: int  # date ordinal of the last day
    days: int

    @property
    def start(self) -> int:
        return self.today - self.days  # exclusive

    @property
    def before_start(self) -> int:
        return self.today - 2 * self.days  # exclusive


@dataclass(frozen=True, slots=True)
class Result:
    series: KeywordSeries
    now: Analysis
    before: Analysis | None


def _slice(series: KeywordSeries, after: int, upto: int) -> Analysis:
    return analyse([c for c in series.checks if after < c.day <= upto])


def analyse_all(series: Sequence[KeywordSeries], window: Window) -> list[Result]:
    results: list[Result] = []
    for item in series:
        now = _slice(item, window.start, window.today)
        before = _slice(item, window.before_start, window.start)
        # A previous period with too few checks says nothing, so it is not compared
        has_before = before.verdict not in ("insufficient", "unranked")
        results.append(Result(item, now, before if has_before else None))
    return results


def is_conflict(result: Result) -> bool:
    return result.now.verdict in CONFLICTS


def matches(result: Result, verdict: str) -> bool:
    if verdict == "all":
        return True
    if verdict == "conflicts":
        return is_conflict(result)
    return result.now.verdict == verdict


def verdict_counts(results: Sequence[Result]) -> VerdictCounts:
    count = {v: sum(1 for r in results if r.now.verdict == v) for v in _ORDER}
    return VerdictCounts(
        all=len(results),
        conflicts=sum(count[v] for v in CONFLICTS),
        likely=count["likely"],
        co_ranking=count["co_ranking"],
        unstable=count["unstable"],
        none=count["none"],
        unranked=count["unranked"],
        insufficient=count["insufficient"],
    )


def sort_results(results: Sequence[Result]) -> list[Result]:
    return sorted(
        results,
        key=lambda r: (_ORDER[r.now.verdict], -(r.series.volume or 0), r.series.keyword),
    )


def _iso(ordinal: int) -> date:
    return date.fromordinal(ordinal)


def letters_of(analysis: Analysis) -> dict[int, str]:
    """A is the page to compare with; the others follow by how often they ranked."""
    order = sorted(analysis.pages, key=lambda s: (s.page != analysis.primary, -s.ranked, s.page))
    return {s.page: (_LETTERS[i] if i < len(_LETTERS) else "+") for i, s in enumerate(order)}


def _url(urls: Mapping[int, UrlInfo], page: int) -> UrlInfo:
    return urls.get(page) or UrlInfo(page, "", "", None)


def switch_event(
    event_day: int, from_page: int, to_page: int, before: int, after: int, held: int, revert: bool
) -> SwitchEvent:
    return SwitchEvent(
        date=_iso(event_day),
        from_url_id=str(from_page),
        to_url_id=str(to_page),
        rank_before=before,
        rank_after=after,
        held_days=held,
        is_flip_flop=revert,
    )


def keyword_row(result: Result, urls: Mapping[int, UrlInfo], device: DeviceName) -> KeywordConflict:
    now, series = result.now, result.series
    letters = letters_of(now)
    target = series.target_url_id
    pages = [
        PageFigures(
            url_id=str(s.page),
            url=_url(urls, s.page).url,
            path=_url(urls, s.page).path,
            title=_url(urls, s.page).title,
            letter=letters[s.page],
            is_primary=s.page == now.primary,
            is_target=target is not None and s.page == target,
            is_sub_result=s.page in now.grouped_pages,
            ranked=s.ranked,
            share=s.share,
            best_count=s.best_count,
            median=s.median,
            best_ever=s.best_ever,
            last_date=_iso(s.last_day),
            last_rank=s.last_rank,
        )
        for s in now.pages
    ]
    return KeywordConflict(
        tracked_keyword_id=str(series.tracked_keyword_id),
        keyword=series.keyword,
        group_ids=[str(g) for g in series.group_ids],
        device=device,
        volume=series.volume,
        verdict=now.verdict,
        previous_verdict=result.before.verdict if result.before else None,
        checks=now.checks,
        unreadable_checks=now.unreadable,
        ranked_checks=now.ranked_checks,
        pages=pages,
        rank_gap=now.rank_gap,
        switch_rate=now.switch_rate,
        together_rate=now.co_rate,
        switches=[
            switch_event(
                e.day, e.from_page, e.to_page, e.rank_before, e.rank_after, e.held_days, e.revert
            )
            for e in now.events
        ],
        one_check_changes=now.flickers,
        flip_flops=now.reverts,
        longest_hold_days=now.longest_hold,
        held_now_days=now.held_now,
        current_url_id=str(now.current) if now.current is not None else None,
        current_rank=now.current_rank,
        target_url_id=str(target) if target is not None else None,
        on_target=None if target is None or now.current is None else now.current == target,
        strip=[
            StripCell(
                date=_iso(c.day),
                kind=c.kind,
                url_id=str(c.page) if c.page is not None else None,
                rank=c.rank,
                together=c.together,
            )
            for c in now.strip
        ],
    )


def keyword_checks(series: KeywordSeries, window: Window) -> list[KeywordCheck]:
    return [
        KeywordCheck(
            date=_iso(c.day),
            readable=c.readable,
            ranks=[CheckRank(url_id=str(p), rank=r) for p, r in c.ranks],
            sub_results=[str(p) for p in c.grouped],
        )
        for c in series.checks
        if window.start < c.day <= window.today
    ]


def _count(rows: Sequence[Result], before: Sequence[Analysis], pick: str | None) -> Count:
    def hit(verdict: str) -> bool:
        return verdict in CONFLICTS if pick is None else verdict == pick

    return Count(
        value=sum(1 for r in rows if hit(r.now.verdict)),
        before=sum(1 for a in before if hit(a.verdict)) if before else None,
    )


def conflict_headline(results: Sequence[Result]) -> ConflictHeadline:
    before = [r.before for r in results if r.before is not None]
    likely = [r for r in results if r.now.verdict == "likely"]
    gaps = [r.now.rank_gap for r in likely]
    return ConflictHeadline(
        ranked_keywords=sum(1 for r in results if r.now.ranked_checks >= MIN_CHECKS),
        conflicts=_count(results, before, None),
        likely=_count(results, before, "likely"),
        together=_count(results, before, "co_ranking"),
        unstable=_count(results, before, "unstable"),
        volume_at_risk=sum(r.series.volume or 0 for r in likely),
        volume_keywords=len(likely),
        typical_rank_gap=float(median(gaps)) if gaps else None,
    )


def _words(title: str | None) -> set[str]:
    return {
        w for w in re.sub(r"[^a-z0-9 ]", " ", (title or "").lower()).split() if len(w) > 2
    } - _STOP


def title_overlap(a: str | None, b: str | None) -> float | None:
    """Share of title words two pages have in common (Jaccard): a hint, never a verdict."""
    x, y = _words(a), _words(b)
    if not x or not y:
        return None
    both = len(x & y)
    return both / (len(x) + len(y) - both)


def _pair_page(urls: Mapping[int, UrlInfo], page: int) -> PairPage:
    info = _url(urls, page)
    return PairPage(url_id=str(page), url=info.url, path=info.path, title=info.title)


@dataclass(slots=True)
class _PairTotals:
    ids: list[str]
    volume: int = 0
    likely: int = 0
    a_leads: int = 0
    b_leads: int = 0


def pair_rows(results: Sequence[Result], urls: Mapping[int, UrlInfo]) -> list[PagePair]:
    """Pages that compete on several keywords, the level at which a conflict is fixed."""
    pairs: dict[tuple[int, int], _PairTotals] = {}
    for r in results:
        if not is_conflict(r):
            continue
        ranked = [s for s in r.now.pages if s.ranked >= 3][:3]
        for i, first in enumerate(ranked):
            for second in ranked[i + 1 :]:
                a, b = sorted((first, second), key=lambda s: s.page)
                totals = pairs.setdefault((a.page, b.page), _PairTotals(ids=[]))
                totals.ids.append(str(r.series.tracked_keyword_id))
                totals.volume += r.series.volume or 0
                totals.likely += r.now.verdict == "likely"
                if a.median <= b.median:
                    totals.a_leads += 1
                else:
                    totals.b_leads += 1
    items = [
        PagePair(
            a=_pair_page(urls, a),
            b=_pair_page(urls, b),
            keywords=len(t.ids),
            likely=t.likely,
            volume=t.volume,
            a_leads=t.a_leads,
            b_leads=t.b_leads,
            title_overlap=title_overlap(_url(urls, a).title, _url(urls, b).title),
            tracked_keyword_ids=t.ids,
        )
        for (a, b), t in pairs.items()
    ]
    return sorted(items, key=lambda p: (-p.volume, p.a.url_id, p.b.url_id))


def switch_rows(results: Sequence[Result], urls: Mapping[int, UrlInfo]) -> list[SwitchRow]:
    rows: list[SwitchRow] = []
    for r in results:
        target = r.series.target_url_id
        for e in r.now.events:
            frm, to = _url(urls, e.from_page), _url(urls, e.to_page)
            rows.append(
                SwitchRow(
                    tracked_keyword_id=str(r.series.tracked_keyword_id),
                    keyword=r.series.keyword,
                    volume=r.series.volume,
                    event=switch_event(
                        e.day,
                        e.from_page,
                        e.to_page,
                        e.rank_before,
                        e.rank_after,
                        e.held_days,
                        e.revert,
                    ),
                    rank_change=e.rank_before - e.rank_after,
                    left_target=target is not None
                    and e.from_page == target
                    and e.to_page != target,
                    from_title=frm.title,
                    to_title=to.title,
                    from_url=frm.url,
                    to_url=to.url,
                )
            )
    return sorted(rows, key=lambda s: (-s.event.date.toordinal(), s.keyword))


def switch_headline(results: Sequence[Result], rows: Sequence[SwitchRow]) -> SwitchHeadline:
    before_events = sum(len(r.before.events) for r in results if r.before is not None)
    has_before = any(r.before is not None for r in results)
    return SwitchHeadline(
        ranked_keywords=sum(1 for r in results if r.now.ranked_checks >= MIN_CHECKS),
        switches=Count(value=len(rows), before=before_events if has_before else None),
        keywords=len({s.tracked_keyword_id for s in rows}),
        flip_flop_keywords=len({s.tracked_keyword_id for s in rows if s.event.is_flip_flop}),
        left_target=sum(1 for s in rows if s.left_target),
        improved=sum(1 for s in rows if s.rank_change > 0),
        dropped=sum(1 for s in rows if s.rank_change < 0),
        one_check_changes=sum(r.now.flickers for r in results),
    )


def weekly_switches(rows: Sequence[SwitchRow], window: Window) -> list[WeekBucket]:
    """Switches per week of the period, by what the new page did to the rank."""
    weeks = math.ceil(window.days / 7)
    first = window.today - weeks * 7 + 1  # the first day of week 0
    buckets = [{"improved": 0, "same": 0, "dropped": 0} for _ in range(weeks)]
    for s in rows:
        index = min(weeks - 1, max(0, (s.event.date.toordinal() - first) // 7))
        buckets[index][
            "improved" if s.rank_change > 0 else "dropped" if s.rank_change < 0 else "same"
        ] += 1
    return [WeekBucket(starts_on=_iso(first + 7 * i), **bucket) for i, bucket in enumerate(buckets)]


def switch_matches(row: SwitchRow, kind: str) -> bool:
    return {
        "all": True,
        "flip_flop": row.event.is_flip_flop,
        "improved": row.rank_change > 0,
        "dropped": row.rank_change < 0,
        "left_target": row.left_target,
    }[kind]


@dataclass(frozen=True, slots=True)
class PageConflicts:
    keywords: int
    likely: int
    co_ranking: int
    unstable: int


def conflicts_by_page(results: Sequence[Result]) -> dict[int, PageConflicts]:
    """Per own page, the tracked keywords where it and another own page compete, by verdict.
    The count Monitoring shows beside a page; a page no conflict names has no entry."""
    found: dict[int, dict[str, int]] = defaultdict(
        lambda: {"keywords": 0, "likely": 0, "co_ranking": 0, "unstable": 0}
    )
    for r in results:
        if not is_conflict(r):
            continue
        for s in r.now.pages:
            entry = found[s.page]
            entry["keywords"] += 1
            entry[r.now.verdict] += 1
    return {page: PageConflicts(**entry) for page, entry in found.items()}
