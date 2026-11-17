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
