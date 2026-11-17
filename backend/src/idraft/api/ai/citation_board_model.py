"""The counting of the Citations page (WP-76), with no SQL: a port of the design preview's
cit-data.js over real answers, so the strip, the tables and the drawers come from one place.

A run is numbered per prompt and engine (plan decision D-2): slot 1 is the pair's latest
collection run with a counted answer, slot 2 the one before, up to `TREND_SLOTS`. A manual run
of five prompts is slot 1 of those five pairs only, and two schedules that split the prompts
between them still give every pair one slot per run."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Final
from uuid import UUID

from idraft.api.schemas.ai_citation_board import (
    CitationOverview,
    EngineCitationCounts,
    RunSlot,
    RunWindow,
)
from idraft.domain.ai_engines import EngineCode

TREND_SLOTS: Final = 8
RUN_CHOICES: Final = (1, 2, 4)


@dataclass(frozen=True, slots=True)
class Answer:
    """A counted answer (rule 1 of the plan) and what the page needs of it."""

    observation_id: int
    observed_at: datetime
    prompt_id: UUID
    engine_code: str
    run_id: UUID | None
    # The run it belongs to: the collection run id, or `day:<UTC date>` when it has none
    run_key: str
    own_mentioned: bool
    competitors_mentioned: frozenset[UUID]


@dataclass(frozen=True, slots=True)
class Unit:
    """One citation unit: a canonical URL in one answer (docs/16 C2)."""

    observation_id: int
    url_id: int
    url: str
    host: str
    registrable_domain: str
    path: str
    title: str | None
    domain_role: str
    entity_id: UUID | None


@dataclass(frozen=True, slots=True)
class Slotted:
    answer: Answer
    slot: int


def assign_slots(answers: Iterable[Answer], max_slots: int = TREND_SLOTS) -> list[Slotted]:
    """Each answer with its run's slot within its prompt and engine; runs past `max_slots` are
    left out. A run's place is its latest answer; ties fall to the run key, so it is stable."""
    listed = list(answers)
    latest: defaultdict[tuple[UUID, str], dict[str, datetime]] = defaultdict(dict)
    for a in listed:
        runs = latest[(a.prompt_id, a.engine_code)]
        if a.run_key not in runs or a.observed_at > runs[a.run_key]:
            runs[a.run_key] = a.observed_at
    slot_of: dict[tuple[UUID, str, str], int] = {}
    for (prompt_id, engine_code), runs in latest.items():
        ordered = sorted(runs.items(), key=lambda item: (item[1], item[0]), reverse=True)
        for index, (key, _) in enumerate(ordered[:max_slots], 1):
            slot_of[(prompt_id, engine_code, key)] = index
    return [
        Slotted(a, slot_of[(a.prompt_id, a.engine_code, a.run_key)])
        for a in listed
        if (a.prompt_id, a.engine_code, a.run_key) in slot_of
    ]


@dataclass(frozen=True, slots=True)
class Board:
    """The slotted answers of a scope and their citation units, by observation id."""

    runs: int
    answers: Sequence[Slotted]
    units: Mapping[int, Sequence[Unit]]

    def current(self) -> list[Slotted]:
        return [s for s in self.answers if s.slot <= self.runs]

    def previous(self) -> list[Slotted]:
        return [s for s in self.answers if self.runs < s.slot <= 2 * self.runs]

    def units_of(self, slotted: Slotted) -> Sequence[Unit]:
        return self.units.get(slotted.answer.observation_id, ())


def _slots(answers: Iterable[Slotted], wanted: Iterable[int]) -> list[RunSlot]:
    by_slot: defaultdict[int, list[datetime]] = defaultdict(list)
    for s in answers:
        by_slot[s.slot].append(s.answer.observed_at)
    return [
        RunSlot(
            slot=slot,
            first_at=min(by_slot[slot]),
            last_at=max(by_slot[slot]),
            answers=len(by_slot[slot]),
        )
        for slot in wanted
        if by_slot.get(slot)
    ]


def run_window(board: Board, *, timezone: str, run_number: int | None) -> RunWindow:
    current = board.current()
    # The latest answer over the whole board, not only the current window
    latest = max((s.answer.observed_at for s in board.answers), default=None)
    return RunWindow(
        runs=board.runs,
        timezone=timezone,
        current=_slots(board.answers, range(1, board.runs + 1)),
        previous=_slots(board.answers, range(board.runs + 1, 2 * board.runs + 1)),
        trend=_slots(board.answers, range(TREND_SLOTS, 0, -1)),
        answers=len(current),
        prompts=len({s.answer.prompt_id for s in current}),
        latest_answer_at=latest,
        latest_run_number=run_number,
    )


def latest_run_id(board: Board) -> UUID | None:
    """The run of the scope's latest answer, for the footer's run number."""
    newest = max(board.answers, key=lambda s: s.answer.observed_at, default=None)
    return None if newest is None else newest.answer.run_id


def _own_units(board: Board, answers: Iterable[Slotted]) -> list[Unit]:
    return [u for s in answers for u in board.units_of(s) if u.domain_role == "own"]


def _pair(s: Slotted) -> tuple[UUID, str]:
    return s.answer.prompt_id, s.answer.engine_code


def overview(
    board: Board, engines: Sequence[str], *, timezone: str, run_number: int | None = None
) -> CitationOverview:
    """The six measures of the strip and their previous values (plan rules 3 to 7)."""
    now, before = board.current(), board.previous()
    matched = {_pair(s) for s in now} & {_pair(s) for s in before}

    def engine_counts(code: str) -> EngineCitationCounts:
        def counts(answers: list[Slotted]) -> tuple[int, int, int, int]:
            mine = [s for s in answers if s.answer.engine_code == code]
            citing = [s for s in mine if any(u.domain_role == "own" for u in board.units_of(s))]
            return (
                len(mine),
                len(citing),
                len({s.answer.prompt_id for s in mine}),
                len({s.answer.prompt_id for s in citing}),
            )

        a, b, c, d = counts(now)
        e, f, g, h = counts(before)
        return EngineCitationCounts(
            engine_code=EngineCode(code),
            answers=a,
            answers_citing=b,
            prompts=c,
            prompts_citing=d,
            previous_answers=e,
            previous_answers_citing=f,
            previous_prompts=g,
            previous_prompts_citing=h,
        )

    def domains_of(answers: list[Slotted]) -> int:
        return len({u.registrable_domain for s in answers for u in board.units_of(s)})

    return CitationOverview(
        window=run_window(board, timezone=timezone, run_number=run_number),
        engines=[engine_counts(code) for code in engines],
        citations=len(_own_units(board, now)),
        previous_citations=len(_own_units(board, before)),
        matched_citations=len(_own_units(board, [s for s in now if _pair(s) in matched])),
        matched_previous_citations=len(
            _own_units(board, [s for s in before if _pair(s) in matched])
        ),
        matched_pairs=len(matched),
        own_urls=len({u.url_id for u in _own_units(board, now)}),
        previous_own_urls=len({u.url_id for u in _own_units(board, before)}),
        domains=domains_of(now),
        previous_domains=domains_of(before),
    )
