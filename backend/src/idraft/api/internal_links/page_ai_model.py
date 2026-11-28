"""The counting of the page drawer's AI tab (section 6 of the page AI tab design), with no SQL
and no I/O: counted answers and citation units in, the body of the tab out.

An answer belongs to the period of its project-local day. The unit counted is one distinct
address per answer (docs/16 C2), so a page cited twice in one answer counts once."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import cast
from uuid import UUID
from zoneinfo import ZoneInfo

from idraft.api.ai.citation_board_model import Answer, Unit, role_of
from idraft.api.schemas.internal_links_ai import (
    ALONGSIDE_LIMIT,
    PROMPT_LIMIT,
    PageAi,
    PageAiAlongside,
    PageAiCompared,
    PageAiDay,
    PageAiPlatform,
    PageAiPlatformCode,
    PageAiPrompt,
    PageAiPromptPlatform,
    PageAiState,
    PageAiWindow,
)


@dataclass(frozen=True, slots=True)
class PageAiInput:
    url_id: int
    zone: ZoneInfo
    first: date
    last: date
    previous: tuple[date, date] | None
    engines: Sequence[str]  # platform codes in engine order
    labels: Mapping[str, str]  # code -> label
    answers: Sequence[Answer]  # counted answers of both periods
    citing: frozenset[int]  # observation ids that cite the page
    units: Mapping[int, Sequence[Unit]]  # units by observation id, of the citing answers
    prompts_in_scope: int


@dataclass(frozen=True, slots=True)
class _PromptRow:
    prompt_id: UUID
    answers: int
    answers_citing: int
    platforms: tuple[tuple[str, int, int], ...]  # (engine code, answers, answers citing)
    last_cited_at: datetime


@dataclass(frozen=True, slots=True)
class Counted:
    """Everything of the body but the prompt texts and `in_crawl`, which need a read."""

    state: PageAiState
    window: PageAiWindow
    days: int
    compare_window: PageAiCompared | None
    answers: int
    answers_citing: int
    previous_answers: int | None
    previous_answers_citing: int | None
    platforms: tuple[PageAiPlatform, ...]
    rows: tuple[_PromptRow, ...]
    prompts_total: int
    trend: tuple[PageAiDay, ...]
    shared: tuple[tuple[Unit, int], ...]  # the alongside rows: a unit and its answers_shared
    alongside_total: int
    labels: Mapping[str, str]
    prompt_ids: tuple[UUID, ...]  # the prompts shown, in row order
    own_urls: tuple[int, ...]  # url ids of the alongside rows with role own

    def build(self, texts: Mapping[UUID, str], crawled: frozenset[int]) -> PageAi:
        return PageAi(
            state=self.state,
            window=self.window,
            days=self.days,
            compare_window=self.compare_window,
            answers=self.answers,
            answers_citing=self.answers_citing,
            previous_answers=self.previous_answers,
            previous_answers_citing=self.previous_answers_citing,
            platforms=list(self.platforms),
            prompts=[
                PageAiPrompt(
                    prompt_id=row.prompt_id,
                    text=texts.get(row.prompt_id, ""),
                    answers=row.answers,
                    answers_citing=row.answers_citing,
                    platforms=[
                        PageAiPromptPlatform(
                            engine_code=_code(code),
                            label=self.labels[code],
                            answers=answers,
                            answers_citing=citing,
                        )
                        for code, answers, citing in row.platforms
                    ],
                    last_cited_at=row.last_cited_at,
                )
                for row in self.rows
            ],
            prompts_total=self.prompts_total,
            trend=list(self.trend),
            alongside=[
                PageAiAlongside(
                    url_id=u.url_id,
                    url=u.url,
                    path=u.path,
                    title=u.title,
                    host=u.host,
                    registrable_domain=u.registrable_domain,
                    domain_role=role_of(u.domain_role),
                    in_crawl=u.domain_role == "own" and u.url_id in crawled,
                    answers_shared=n,
                )
                for u, n in self.shared
            ],
            alongside_total=self.alongside_total,
        )


def _code(value: str) -> PageAiPlatformCode:
    return cast(PageAiPlatformCode, value)


def _day(source: PageAiInput, answer: Answer) -> date:
    return answer.observed_at.astimezone(source.zone).date()


def _in(day: date, period: tuple[date, date]) -> bool:
    return period[0] <= day <= period[1]


def citing_in_current(source: PageAiInput) -> list[Answer]:
    """The citing answers dated inside the current period: the ones the service reads units for."""
    return [
        a
        for a in source.answers
        if a.observation_id in source.citing
        and a.engine_code in source.engines
        and _in(_day(source, a), (source.first, source.last))
    ]


def _platform_counts(source: PageAiInput, answers: Sequence[Answer]) -> list[tuple[str, int, int]]:
    return [
        (
            code,
            sum(a.engine_code == code for a in answers),
            sum(a.engine_code == code and a.observation_id in source.citing for a in answers),
        )
        for code in source.engines
    ]


def count_page_ai(source: PageAiInput) -> Counted:
    shown = [a for a in source.answers if a.engine_code in source.engines]
    current = [a for a in shown if _in(_day(source, a), (source.first, source.last))]
    before = (
        [a for a in shown if _in(_day(source, a), source.previous)] if source.previous else None
    )
    citing = citing_in_current(source)

    days = (source.last - source.first).days + 1
    per_day: defaultdict[date, list[int]] = defaultdict(lambda: [0, 0])
    for a in current:
        cell = per_day[_day(source, a)]
        cell[0] += 1
        cell[1] += a.observation_id in source.citing
    trend = tuple(
        PageAiDay(
            date=(day := source.first + timedelta(days=offset)).isoformat(),
            answers=per_day[day][0],
            answers_citing=per_day[day][1],
        )
        for offset in range(days)
    )

    now_counts = _platform_counts(source, current)
    before_counts = None if before is None else _platform_counts(source, before)
    platforms = tuple(
        PageAiPlatform(
            engine_code=_code(code),
            label=source.labels[code],
            answers=answers,
            answers_citing=cited,
            previous_answers_citing=None if before_counts is None else before_counts[index][2],
        )
        for index, (code, answers, cited) in enumerate(now_counts)
    )

    by_prompt: defaultdict[UUID, list[Answer]] = defaultdict(list)
    for a in current:
        by_prompt[a.prompt_id].append(a)
    rows = []
    for prompt_id, mine in by_prompt.items():
        cited = [a for a in mine if a.observation_id in source.citing]
        if cited:
            rows.append(
                _PromptRow(
                    prompt_id=prompt_id,
                    answers=len(mine),
                    answers_citing=len(cited),
                    platforms=tuple(_platform_counts(source, mine)),
                    last_cited_at=max(a.observed_at for a in cited),
                )
            )
    rows.sort(key=lambda r: (-r.answers_citing, -r.last_cited_at.timestamp(), r.prompt_id))
    shown_rows = tuple(rows[:PROMPT_LIMIT])

    first_unit: dict[int, Unit] = {}
    answers_of: defaultdict[int, int] = defaultdict(int)
    for a in citing:
        for url_id in {u.url_id for u in source.units.get(a.observation_id, ())}:
            if url_id != source.url_id:
                answers_of[url_id] += 1
        for u in source.units.get(a.observation_id, ()):
            if u.url_id != source.url_id:
                first_unit.setdefault(u.url_id, u)
    ranked = sorted(
        answers_of.items(), key=lambda item: (-item[1], first_unit[item[0]].url, item[0])
    )
    shared = tuple((first_unit[url_id], n) for url_id, n in ranked[:ALONGSIDE_LIMIT])

    state: PageAiState = "ready"
    if source.prompts_in_scope == 0:
        state = "no_prompts"
    elif not current:
        state = "no_answers"

    return Counted(
        state=state,
        window=PageAiWindow(
            from_=source.first.isoformat(), to=source.last.isoformat(), timezone=source.zone.key
        ),
        days=days,
        compare_window=None
        if source.previous is None
        else PageAiCompared(
            from_=source.previous[0].isoformat(), to=source.previous[1].isoformat()
        ),
        answers=len(current),
        answers_citing=sum(a.observation_id in source.citing for a in current),
        previous_answers=None if before is None else len(before),
        previous_answers_citing=None
        if before is None
        else sum(a.observation_id in source.citing for a in before),
        platforms=platforms,
        rows=shown_rows,
        prompts_total=len(rows),
        trend=trend,
        shared=shared,
        alongside_total=len(ranked),
        labels=source.labels,
        prompt_ids=tuple(r.prompt_id for r in shown_rows),
        own_urls=tuple(u.url_id for u, _ in shared if u.domain_role == "own"),
    )
