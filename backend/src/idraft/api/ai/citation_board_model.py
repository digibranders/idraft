"""The counting of the Citations page (WP-76), with no SQL: a port of the design preview's
cit-data.js over real answers, so the strip, the tables and the drawers come from one place.

A run is numbered per prompt and engine (plan decision D-2): slot 1 is the pair's latest
collection run with a counted answer, slot 2 the one before, up to `TREND_SLOTS`. A manual run
of five prompts is slot 1 of those five pairs only, and two schedules that split the prompts
between them still give every pair one slot per run."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Final, cast
from uuid import UUID

from idraft.api.schemas.ai_citation_board import (
    BrandCell,
    BrandOnPrompt,
    BrandState,
    CitationGapDetail,
    CitationGapRow,
    CitationOverview,
    CitedAlongside,
    CitedPageDetail,
    CitedPagePrompt,
    CitedPageRow,
    CompetitorOnPrompt,
    EngineAnswers,
    EngineBrandCell,
    EngineCitationCounts,
    GapPage,
    PromptCount,
    PromptTopic,
    RunSlot,
    RunWindow,
)
from idraft.api.schemas.ai_sources import DomainRole, EngineUnits
from idraft.domain.ai_engines import EngineCode

TREND_SLOTS: Final = 8
RUN_CHOICES: Final = (1, 2, 4)

# entity id -> (name, color index)
Names = Mapping[UUID, tuple[str, int | None]]
# prompt id -> its first term (id, name), for the Group column
Topics = Mapping[UUID, tuple[UUID, str]]


def role_of(value: str) -> DomainRole:
    """Narrow a stored role to the schema literal."""
    if value not in ("own", "competitor", "third_party"):
        raise ValueError(f"unknown domain role: {value!r}")
    return cast(DomainRole, value)


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


def _trend_slots(board: Board) -> list[int]:
    present = {s.slot for s in board.answers}
    return [slot for slot in range(TREND_SLOTS, 0, -1) if slot in present]


def _name_and_color(names: Names, entity_id: UUID | None) -> tuple[str | None, int | None]:
    if entity_id is None or entity_id not in names:
        return None, None
    return names[entity_id]


def page_rows(
    board: Board, engines: Sequence[str], texts: Mapping[UUID, str], names: Names
) -> list[CitedPageRow]:
    """One row per URL cited in the current window, in no particular order (the service sorts)."""
    trend_slots = _trend_slots(board)
    first: dict[int, Unit] = {}
    now: defaultdict[int, list[Slotted]] = defaultdict(list)
    before: defaultdict[int, int] = defaultdict(int)
    per_slot: defaultdict[int, defaultdict[int, int]] = defaultdict(lambda: defaultdict(int))
    for s in board.answers:
        for u in board.units_of(s):
            per_slot[u.url_id][s.slot] += 1
            if s.slot <= board.runs:
                first.setdefault(u.url_id, u)
                now[u.url_id].append(s)
            elif s.slot <= 2 * board.runs:
                before[u.url_id] += 1
    rows = []
    for url_id, citing in now.items():
        u = first[url_id]
        by_prompt: defaultdict[UUID, int] = defaultdict(int)
        for s in citing:
            by_prompt[s.answer.prompt_id] += 1
        top = sorted(by_prompt.items(), key=lambda item: (-item[1], texts.get(item[0], "")))[:10]
        name, color = _name_and_color(names, u.entity_id)
        rows.append(
            CitedPageRow(
                url_id=url_id,
                url=u.url,
                host=u.host,
                registrable_domain=u.registrable_domain,
                path=u.path,
                title=u.title,
                domain_role=role_of(u.domain_role),
                entity_id=u.entity_id,
                entity_name=name,
                color_index=color,
                citations=len(citing),
                previous_citations=before[url_id],
                prompts=len(by_prompt),
                top_prompts=[
                    PromptCount(prompt_id=p, text=texts.get(p, ""), citations=n) for p, n in top
                ],
                engines=[
                    EngineUnits(
                        engine_code=EngineCode(c),
                        citation_units=sum(s.answer.engine_code == c for s in citing),
                    )
                    for c in engines
                ],
                trend=[per_slot[url_id].get(slot, 0) for slot in trend_slots],
                last_cited_at=max(s.answer.observed_at for s in citing),
            )
        )
    return rows


def page_detail(
    board: Board, url_id: int, engines: Sequence[str], texts: Mapping[UUID, str], names: Names
) -> CitedPageDetail | None:
    """The drawer of one cited page; None when the page is not cited in the current window."""
    row = next((r for r in page_rows(board, engines, texts, names) if r.url_id == url_id), None)
    if row is None:
        return None
    now = board.current()

    def cites(s: Slotted) -> bool:
        return any(u.url_id == url_id for u in board.units_of(s))

    prompts = []
    for prompt_id in {s.answer.prompt_id for s in now if cites(s)}:
        mine = [s for s in now if s.answer.prompt_id == prompt_id]
        citing = [s for s in mine if cites(s)]
        prompts.append(
            CitedPagePrompt(
                prompt_id=prompt_id,
                text=texts.get(prompt_id, ""),
                cited=len(citing),
                answers=len(mine),
                engines=[
                    EngineAnswers(
                        engine_code=EngineCode(c),
                        cited=sum(s.answer.engine_code == c for s in citing),
                        answers=sum(s.answer.engine_code == c for s in mine),
                    )
                    for c in engines
                ],
                last_cited_at=max(s.answer.observed_at for s in citing),
            )
        )
    prompts.sort(key=lambda p: (-p.cited, p.text))
    # Other URLs of the answers that cite this page, once per answer and registrable domain. Only
    # this URL is left out, so the page's own domain shows when another of its URLs is cited too.
    alongside: dict[str, tuple[Unit, int]] = {}
    for s in now:
        if not cites(s):
            continue
        for domain, u in {
            u.registrable_domain: u for u in board.units_of(s) if u.url_id != url_id
        }.items():
            seen = alongside.get(domain)
            alongside[domain] = (seen[0] if seen else u, (seen[1] if seen else 0) + 1)
    ranked = sorted(alongside.items(), key=lambda item: (-item[1][1], item[0]))[:8]
    return CitedPageDetail(
        page=row,
        prompts=prompts,
        alongside=[
            CitedAlongside(
                registrable_domain=domain,
                domain_role=role_of(u.domain_role),
                entity_id=u.entity_id,
                entity_name=_name_and_color(names, u.entity_id)[0],
                color_index=_name_and_color(names, u.entity_id)[1],
                answers=count,
            )
            for domain, (u, count) in ranked
        ],
        window=run_window(board, timezone="", run_number=None),
    )


def state_of(cited: int, mentioned: int, answers: int) -> BrandState:
    """A brand's state on a prompt: no answers, cited, only named, or not named."""
    if answers == 0:
        return "none"
    if cited > 0:
        return "cited"
    return "mentioned" if mentioned > 0 else "not"


def _brand(cells: Mapping[str, tuple[int, int, int]], engines: Sequence[str]) -> BrandOnPrompt:
    """A brand over the engines of the request: its cells in that order, and the sums."""
    per = []
    for code in engines:
        cited, mentioned, answers = cells.get(code, (0, 0, 0))
        per.append(
            EngineBrandCell(
                engine_code=EngineCode(code),
                cited=cited,
                mentioned=mentioned,
                answers=answers,
                state=state_of(cited, mentioned, answers),
            )
        )
    cited = sum(cell.cited for cell in per)
    mentioned = sum(cell.mentioned for cell in per)
    answers = sum(cell.answers for cell in per)
    return BrandOnPrompt(
        total=BrandCell(
            cited=cited,
            mentioned=mentioned,
            answers=answers,
            state=state_of(cited, mentioned, answers),
        ),
        engines=per,
        cited_on=sum(cell.answers > 0 and cell.cited > 0 for cell in per),
        platforms=sum(cell.answers > 0 for cell in per),
    )


def _cells(
    answers: Sequence[Slotted],
    engines: Sequence[str],
    cited: Callable[[Slotted], bool],
    named: Callable[[Slotted], bool],
) -> dict[str, tuple[int, int, int]]:
    """(cited, mentioned, answers) per engine of one prompt's answers."""
    out: dict[str, tuple[int, int, int]] = {}
    for code in engines:
        on = [s for s in answers if s.answer.engine_code == code]
        out[code] = (sum(map(cited, on)), sum(map(named, on)), len(on))
    return out


def _cites_own(board: Board) -> Callable[[Slotted], bool]:
    return lambda s: any(u.domain_role == "own" for u in board.units_of(s))


def _cites_entity(board: Board, entity: UUID) -> Callable[[Slotted], bool]:
    return lambda s: any(
        u.domain_role == "competitor" and u.entity_id == entity for u in board.units_of(s)
    )


def _names_entity(entity: UUID) -> Callable[[Slotted], bool]:
    return lambda s: entity in s.answer.competitors_mentioned


def gap_rows(
    board: Board,
    engines: Sequence[str],
    competitors: Sequence[UUID],
    texts: Mapping[UUID, str],
    topics: Topics,
) -> list[CitationGapRow]:
    """One row per prompt with a current answer, the biggest gap first (plan rule 8)."""
    now = board.current()
    rows = []
    for prompt_id in sorted({s.answer.prompt_id for s in now}):
        mine = [s for s in now if s.answer.prompt_id == prompt_id]
        you = _brand(
            _cells(mine, engines, _cites_own(board), lambda s: s.answer.own_mentioned), engines
        )
        rivals = [
            CompetitorOnPrompt(
                entity_id=entity,
                **_brand(
                    _cells(mine, engines, _cites_entity(board, entity), _names_entity(entity)),
                    engines,
                ).model_dump(),
            )
            for entity in competitors
        ]
        # `you.engines` and every `r.engines` hold one cell per engine, in the order of `engines`
        lost = [
            index
            for index, cell in enumerate(you.engines)
            if cell.answers > 0
            and cell.cited == 0
            and any(r.engines[index].cited > 0 for r in rivals)
        ]
        topic = topics.get(prompt_id)
        rows.append(
            CitationGapRow(
                prompt_id=prompt_id,
                text=texts.get(prompt_id, ""),
                topic=None if topic is None else PromptTopic(term_id=topic[0], name=topic[1]),
                you=you,
                competitors=rivals,
                lost_on=[you.engines[index].engine_code for index in lost],
                lost_to=[
                    r.entity_id for r in rivals if any(r.engines[index].cited > 0 for index in lost)
                ],
                gap=len(lost),
                competitor_answers=sum(r.total.cited for r in rivals),
            )
        )
    rows.sort(key=lambda r: (-r.gap, -len(r.lost_to), -r.competitor_answers, r.text))
    return rows


def _pages(
    board: Board,
    answers: Iterable[Slotted],
    keep: Callable[[Unit], bool],
    limit: int | None = None,
) -> list[GapPage]:
    """The kept units of the answers per URL: how many answers list it and on which engines."""
    found: dict[int, tuple[Unit, int, set[str]]] = {}
    for s in answers:
        for u in board.units_of(s):
            if keep(u):
                seen = found.get(u.url_id)
                found[u.url_id] = (
                    u,
                    (seen[1] if seen else 0) + 1,
                    (seen[2] if seen else set()) | {s.answer.engine_code},
                )
    ranked = sorted(found.values(), key=lambda item: (-item[1], item[0].url))
    return [
        GapPage(
            url_id=u.url_id,
            url=u.url,
            entity_id=u.entity_id,
            citations=n,
            engines=[EngineCode(c) for c in sorted(codes)],
        )
        for u, n, codes in ranked[:limit]
    ]


def gap_detail(
    board: Board,
    prompt_id: UUID,
    engines: Sequence[str],
    competitors: Sequence[UUID],
    texts: Mapping[UUID, str],
    topics: Topics,
    terms: Mapping[UUID, Sequence[UUID]],
) -> CitationGapDetail | None:
    """The drawer of one prompt of the gap analysis; None when it has no current answer."""
    row = next(
        (
            r
            for r in gap_rows(board, engines, competitors, texts, topics)
            if r.prompt_id == prompt_id
        ),
        None,
    )
    if row is None:
        return None
    now = board.current()
    here = [s for s in now if s.answer.prompt_id == prompt_id]
    mine = set(terms.get(prompt_id, ()))
    neighbours = [
        s
        for s in now
        if s.answer.prompt_id != prompt_id and mine & set(terms.get(s.answer.prompt_id, ()))
    ]
    selected = set(competitors)
    return CitationGapDetail(
        row=row,
        answers=len(here),
        competitor_pages=_pages(
            board, here, lambda u: u.domain_role == "competitor" and u.entity_id in selected
        ),
        own_pages=_pages(board, here, lambda u: u.domain_role == "own"),
        closest_pages=_pages(board, neighbours, lambda u: u.domain_role == "own", 3),
        third_party_pages=_pages(board, here, lambda u: u.domain_role == "third_party", 5),
        window=run_window(board, timezone="", run_number=None),
    )
