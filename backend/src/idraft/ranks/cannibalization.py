"""Which of a site's own pages competes for a tracked keyword (docs/33 section 6).

Method version `cannibalization_v2`.

Pure rules over the checks of one tracked keyword in one period: no I/O, no clock. A check names
the own pages that ranked on it, one `(page, rank)` pair per distinct organic rank; a page nested
under another own result is `grouped` and never counts as competition.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from statistics import median
from typing import Final, Literal

Verdict = Literal["likely", "co_ranking", "unstable", "none", "unranked", "insufficient"]
StripKind = Literal["page", "none", "unreadable"]

MIN_CHECKS: Final = 10  # ranked checks before a verdict is given
FLIP_DAYS: Final = 14  # a page that returns within this many days makes its return a flip-flop
MIN_READABLE_DEPTH: Final = 20  # a lighter check cannot show the top 20 the rules look at
TOGETHER_RANK: Final = 20
LIKELY_SWITCH_RATE: Final = 0.2
LIKELY_RANK_GAP: Final = 3
CO_RANKING_RATE: Final = 0.5
PRIMARY_MIN_BEST: Final = 3  # the page to compare with must have ranked first on this many checks


@dataclass(frozen=True, slots=True)
class Check:
    day: int  # position in time: days since an agreed origin, only differences are used
    readable: bool
    ranks: tuple[tuple[int, int], ...] = ()  # (url id, organic rank), best rank first
    grouped: tuple[int, ...] = ()  # url ids nested under another own result

    @property
    def best(self) -> tuple[int, int] | None:
        return self.ranks[0] if self.ranks else None


@dataclass(frozen=True, slots=True)
class PageStats:
    page: int
    ranked: int  # checks on which the page ranked
    best_count: int  # checks on which it was the ranking page
    share: float  # ranked / ranked checks
    median: float
    best_ever: int
    last_day: int
    last_rank: int
    grouped: int  # checks on which it was a sub-result


@dataclass(frozen=True, slots=True)
class Switch:
    day: int
    from_page: int
    to_page: int
    rank_before: int
    rank_after: int
    held_days: int  # how long the page it replaced had held
    revert: bool  # a flip-flop: the return of the page it replaced within FLIP_DAYS


@dataclass(frozen=True, slots=True)
class StripCell:
    day: int
    kind: StripKind
    page: int | None = None
    rank: int | None = None
    together: bool = False


@dataclass(frozen=True, slots=True)
class Analysis:
    verdict: Verdict
    checks: int  # readable checks
    unreadable: int
    ranked_checks: int
    pages: tuple[PageStats, ...]  # most often the ranking page first
    primary: int | None
    rank_gap: float
    switch_rate: float
    co_rate: float
    events: tuple[Switch, ...]
    flickers: int
    reverts: int
    longest_hold: int
    current: int | None
    current_rank: int | None
    held_now: int
    grouped_pages: tuple[int, ...]
    strip: tuple[StripCell, ...]


def check_from_observation(
    *,
    day: int,
    is_valid: bool,
    depth_requested: int,
    ranks: Sequence[int],
    url_ids: Sequence[int],
) -> Check:
    """One stored check (`all_organic_ranks` and `all_url_ids`, same order) as a `Check`.

    Of the URLs that share a rank the first is the page at that rank and the rest are grouped
    under it. A page at two ranks keeps its best one.
    """
    readable = is_valid and depth_requested >= MIN_READABLE_DEPTH
    if not readable:
        return Check(day=day, readable=False)
    taken: dict[int, int] = {}  # rank -> page
    grouped: list[int] = []
    for rank, page in zip(ranks, url_ids, strict=True):
        if rank in taken:
            if page != taken[rank] and page not in grouped:
                grouped.append(page)
        else:
            taken[rank] = page
    best_rank_of: dict[int, int] = {}
    for rank in sorted(taken):
        best_rank_of.setdefault(taken[rank], rank)
    pairs = tuple(sorted(((page, rank) for page, rank in best_rank_of.items()), key=lambda p: p[1]))
    return Check(day=day, readable=True, ranks=pairs, grouped=tuple(grouped))


def _switches(ranked: Sequence[Check]) -> tuple[list[Switch], int, int]:
    """Confirmed switches, one-check flickers, longest hold. A change counts when the new page
    holds the best rank on the next ranked check too."""
    events: list[Switch] = []
    flickers = 0
    longest = 0
    if not ranked:
        return events, flickers, longest
    first_best = ranked[0].best
    assert first_best is not None
    current, since = first_best[0], ranked[0].day
    for i in range(1, len(ranked)):
        best = ranked[i].best
        previous = ranked[i - 1].best
        assert best is not None
        assert previous is not None
        if best[0] == current:
            continue
        following = ranked[i + 1].best if i + 1 < len(ranked) else None
        if following is None or following[0] != best[0]:
            flickers += 1
            continue
        held = ranked[i].day - since
        longest = max(longest, held)
        revert = any(
            e.from_page == best[0] and e.to_page == current and ranked[i].day - e.day <= FLIP_DAYS
            for e in events
        )
        events.append(Switch(ranked[i].day, current, best[0], previous[1], best[1], held, revert))
        current, since = best[0], ranked[i].day
    longest = max(longest, ranked[-1].day - since)
    return events, flickers, longest


def analyse(checks: Sequence[Check]) -> Analysis:
    readable = [c for c in checks if c.readable]
    ranked = [c for c in readable if c.best is not None]
    events, flickers, longest = _switches(ranked)

    ranks_of: dict[int, list[int]] = {}
    best_ranks_of: dict[int, list[int]] = {}
    grouped_of: dict[int, int] = {}
    last_of: dict[int, tuple[int, int]] = {}
    for check in ranked:
        for page, rank in check.ranks:
            ranks_of.setdefault(page, []).append(rank)
            last_of[page] = (check.day, rank)
        best = check.best
        assert best is not None
        best_ranks_of.setdefault(best[0], []).append(best[1])
        for page in check.grouped:
            grouped_of[page] = grouped_of.get(page, 0) + 1
    pages = tuple(
        sorted(
            (
                PageStats(
                    page=page,
                    ranked=len(ranks),
                    best_count=len(best_ranks_of.get(page, ())),
                    share=len(ranks) / len(ranked),
                    median=float(median(ranks)),
                    best_ever=min(ranks),
                    last_day=last_of[page][0],
                    last_rank=last_of[page][1],
                    grouped=grouped_of.get(page, 0),
                )
                for page, ranks in ranks_of.items()
            ),
            key=lambda s: (-s.best_count, -s.ranked, s.page),
        )
    )

    # The page to compare with ranks best when it is the ranking page, not the page that ranks
    # most often: a keyword Google hands to the weaker page half the time is the case to find.
    candidates = [s for s in pages if s.best_count >= PRIMARY_MIN_BEST]
    primary: int | None
    if candidates:
        primary = min(
            candidates,
            key=lambda s: (median(best_ranks_of[s.page]), -s.best_count, -s.ranked, s.page),
        ).page
    else:
        primary = pages[0].page if pages else None
    primary_ranks = [c.best[1] for c in ranked if c.best and c.best[0] == primary]
    other_ranks = [c.best[1] for c in ranked if c.best and c.best[0] != primary]
    rank_gap = (
        max(0.0, float(median(other_ranks)) - float(median(primary_ranks)))
        if primary_ranks and other_ranks
        else 0.0
    )
    co_rate = (
        sum(1 for c in ranked if len(c.ranks) >= 2 and c.ranks[1][1] <= TOGETHER_RANK) / len(ranked)
        if ranked
        else 0.0
    )
    switch_rate = len(events) / (len(ranked) - 1) if len(ranked) > 1 else 0.0
    ranking_pages = {c.best[0] for c in ranked if c.best}

    verdict: Verdict
    if not ranked:
        verdict = "unranked"
    elif len(ranked) < MIN_CHECKS:
        verdict = "insufficient"
    elif (
        len(ranking_pages) >= 2
        and switch_rate >= LIKELY_SWITCH_RATE
        and rank_gap >= LIKELY_RANK_GAP
    ):
        verdict = "likely"
    elif co_rate >= CO_RANKING_RATE:
        verdict = "co_ranking"
    elif switch_rate >= LIKELY_SWITCH_RATE:
        verdict = "unstable"
    else:
        verdict = "none"

    last = ranked[-1] if ranked else None
    last_best = last.best if last else None
    if last is not None and events:
        held_now = last.day - events[-1].day
    elif last is not None:
        held_now = last.day - ranked[0].day
    else:
        held_now = 0
    strip = tuple(
        StripCell(c.day, "unreadable")
        if not c.readable
        else StripCell(c.day, "page", c.best[0], c.best[1], len(c.ranks) > 1)
        if c.best
        else StripCell(c.day, "none")
        for c in checks
    )
    grouped_pages = tuple(dict.fromkeys(p for c in ranked for p in c.grouped))
    return Analysis(
        verdict=verdict,
        checks=len(readable),
        unreadable=len(checks) - len(readable),
        ranked_checks=len(ranked),
        pages=pages,
        primary=primary,
        rank_gap=rank_gap,
        switch_rate=switch_rate,
        co_rate=co_rate,
        events=tuple(events),
        flickers=flickers,
        reverts=sum(1 for e in events if e.revert),
        longest_hold=longest,
        current=last_best[0] if last_best else None,
        current_rank=last_best[1] if last_best else None,
        held_now=held_now,
        grouped_pages=grouped_pages,
        strip=strip,
    )
