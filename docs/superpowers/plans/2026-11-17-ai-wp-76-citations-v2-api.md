# WP-76 Citations v2 API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Five read routes that serve the new Citations page (the design preview `#/citations` and `#/citations/gaps`) with exactly the numbers the preview shows: the six measures of the strip, the cited pages with the prompts behind each one, the page drawer, the gap analysis and the gap drawer, over the last 1, 2 or 4 runs.

**Architecture:** One service, `CitationBoardService`, loads the counted answers of the scope over a 183 day lookback with their collection run, numbers each prompt and engine's runs from the latest (slot 1) back to slot 8, then reads the citation units of the kept answers once. Every number is computed in pure Python by `citation_board_model.py`, a port of the preview's `cit-data.js`, so the strip, the tables and the drawers always agree and the counting rules are unit tested without a database. The routes reuse the scope rules of the sources lane (`counted_answers`, `citation_bounds`, `scope_prompts`, `flag_toggles`).

**Tech Stack:** FastAPI, Pydantic v2, SQLAlchemy Core (async, asyncpg), PostgreSQL 17, pytest with Testcontainers (Colima), mypy strict, ruff, import-linter.

**Companion documents:** the package brief `docs/ai-visibility/work-packages/WP-76-citations-v2-api.md`, the web package `docs/ai-visibility/work-packages/WP-77-citations-v2-web.md` (the parity spec), and the preview files that are the specification: `apps/web/design-preview/cit-data.js`, `cit.js`, `cit-inspector.js`.

---

## Decisions this plan builds on (owner defaults, see WP-77 section 2)

| # | Decision | Default used here |
|---|---|---|
| D-1 | What "Group" means | The prompt's topic terms (`filter[term]`, the term or one under it). There is no prompt group table. |
| D-2 | What a "run" is | Per prompt and engine: one collection run that holds at least one valid, current, not superseded answer of that pair. Slot 1 is the pair's latest such run, slot 2 the one before, up to slot 8, within 183 days. An answer with no `collection_run_id` is its own run per UTC day. "Last N runs" is slots 1 to N of every pair; "the runs before" is slots N+1 to 2N. |
| D-3 | What a change compares | Every change compares all answers of the two windows, as the preview does: Citation growth is `(citations - previous_citations) / previous_citations`. The route also returns `matched_*` (the pairs answered in both windows) so the owner can switch growth to them, which keeps a prompt added last week from reading as growth; that switch is web copy plus one formula. |
| D-4 | Platforms | The engines of the request (`filter[engine_code_in]`), else every engine code (three today: `chatgpt_web`, `gemini_web`, `google_ai_mode`). Google AI Overview appears when its engine code exists (WP-64). |
| D-5 | Who counts as cited | A brand is cited in an answer when the answer lists at least one citation unit of its role (own) or of its entity (competitor), flagged citations left out as in the sources lane. Mentioned comes from the fact row (`own_mentioned`, `competitor_mentions`). |

## Counting rules (the same words appear in the route descriptions)

1. **Answer.** Counted when its prompt is in scope (`scope_prompts`: active, not deleted, non-branded unless `include_branded`, the term or one under it), its current fact row is valid, and it is not superseded. This is `source_repository.counted_answers`.
2. **Citation unit.** One canonical URL in one answer, counted once however often the answer lists it (docs/16 C2). A citation with an excluded flag is not a unit (`citation_bounds`).
3. **Total citations.** Units of role `own` in the current window.
4. **Citation rate.** Per engine: answers with at least one own unit over answers. The page shows the equal-weight average of the engines with answers (the web computes it with `@/lib/stats/rates.equalWeightAverage`); the route returns the counts.
5. **Prompt coverage.** Per engine: prompts with at least one answer citing an own unit over prompts with an answer; averaged as above.
6. **Unique cited URLs.** Distinct own URLs in the window. **Unique cited domains.** Distinct registrable domains of every unit in the window, own included.
7. **Citation growth.** `(citations - previous_citations) / previous_citations`; `n/a` when the previous count is 0. `matched_citations` and `matched_previous_citations` restrict both to the pairs answered in both windows (D-3 alternative).
8. **Gap.** Decided per engine: a prompt is lost on an engine when it has answers there, none cites you, and at least one selected competitor is cited there. `gap` is the number of engines lost on.

## Conventions for every task (from the plan review)

- Ruff selects E, F, I, B, N and RUF with lines of 100. Run `ruff format` **before** `ruff check` in every commit step, whatever order a step's command shows.
- Code blocks that say "append" show new imports next to the code for reading only: merge them into the file's top import block (E402, I001).
- No `# type: ignore` anywhere. Narrow strings to the schema literals with two helpers in `citation_board_model.py`, used wherever a block below casts: `def role_of(value: str) -> DomainRole` (checks `value in ("own", "competitor", "third_party")`, raises `ValueError` otherwise, returns `cast(DomainRole, value)`), and `state_of(...) -> BrandState`.
- No closure defined inside a loop that reads the loop's variables (B023): pass them as arguments.
- Partitions: the `ai.*` tables are month partitions kept one month back (`ops.partitioned_tables.months_back`, default 1). A test with answers older than about 30 days first runs `UPDATE ops.partitioned_tables SET months_back = 3 WHERE parent IN ('ai.observations'::regclass, 'ai.observation_facts'::regclass, 'ai.citations'::regclass, 'ai.entity_mentions'::regclass)` and `SELECT ops.maintain_partitions()`.

## File structure

| File | Responsibility |
|---|---|
| Create `backend/src/idraft/api/schemas/ai_citation_board.py` | Response and parameter types of the five routes |
| Create `backend/src/idraft/api/ai/citation_board_model.py` | Pure counting: slots, windows, overview, page rows, page detail, gap rows, gap detail (no SQL) |
| Create `backend/src/idraft/api/ai/citation_board_repository.py` | The SQL reads: lookback answers, citation units, prompt texts and topics, tracked competitors, run number |
| Create `backend/src/idraft/api/ai/citation_board.py` | `CitationBoardService`: transaction, scope, load, call the model |
| Create `backend/src/idraft/api/ai/citation_board_routes.py` | The five routes and their parameters |
| Modify `backend/src/idraft/api/resources.py` (lease from the coordinator) | `ai_citation_board: CitationBoardService` |
| Modify `backend/src/idraft/api/main.py` (lease from the coordinator) | Build the service, include the router |
| Create `backend/tests/api/ai/citation_board_support.py` | `run_answer`: an answer with its run, mentions and competitor citations |
| Create `backend/tests/api/ai/test_citation_board_model.py` | Pure unit tests of the model |
| Create `backend/tests/api/ai/test_citation_board_routes.py` | Route tests against Postgres |
| Modify `backend/tests/api/test_route_access.py` | Five `EXPECTED` entries |
| Modify `backend/openapi/v1.json` | Regenerated |
| Modify `docs/19-api-specification.md` | As built section for the five routes |

---

### Task 1: Schemas

**Files:**
- Create: `backend/src/idraft/api/schemas/ai_citation_board.py`
- Test: `backend/tests/api/ai/test_citation_board_model.py` (first test only)

- [ ] **Step 1: Write the failing test**

```python
"""The Citations page model (WP-76): pure counting over hand-built answers, the numbers worked
out by hand. Mirrors apps/web/design-preview/cit-data.check.mjs."""

from __future__ import annotations

from idraft.api.schemas.ai_citation_board import BrandCell, RunSlot


def test_a_brand_cell_states_its_counts() -> None:
    cell = BrandCell(cited=1, mentioned=2, answers=3, state="cited")

    assert cell.model_dump() == {"cited": 1, "mentioned": 2, "answers": 3, "state": "cited"}
    assert RunSlot.model_fields["slot"].metadata  # ge=1 is declared
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/api/ai/test_citation_board_model.py -n 0 --no-cov -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'idraft.api.schemas.ai_citation_board'`

- [ ] **Step 3: Write the schemas**

```python
"""Reads of the Citations page (WP-76; the design preview's #/citations): the six measures, the
cited pages with the prompts behind them, the gap analysis against up to five competitors, and
their drawers, over each prompt and engine's last 1, 2 or 4 runs."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from idraft.api.pagination import OffsetPageInfo
from idraft.api.schemas.ai_sources import DomainRole, EngineUnits
from idraft.domain.ai_engines import EngineCode

BrandState = Literal["cited", "mentioned", "not", "none"]
CitedPageSort = Literal[
    "-citations", "citations", "-change", "change", "-prompts", "prompts",
    "-last_cited", "last_cited", "page", "-page",
]


class RunSlot(BaseModel):
    """One run position over every prompt and engine: slot 1 is each pair's latest run."""

    slot: int = Field(ge=1, description="1 is each prompt and engine's latest run with an answer.")
    first_at: datetime = Field(description="The earliest answer in this slot.")
    last_at: datetime = Field(description="The latest answer in this slot.")
    answers: int


class RunWindow(BaseModel):
    runs: int = Field(description="1, 2 or 4: the slots of the current window.")
    timezone: str
    current: list[RunSlot] = Field(description="Slots 1 to `runs` that hold answers.")
    previous: list[RunSlot] = Field(description="Slots `runs + 1` to `2 * runs` that hold answers.")
    trend: list[RunSlot] = Field(description="Slots 1 to 8 that hold answers, oldest first.")
    answers: int = Field(description="Answers in the current window.")
    prompts: int = Field(description="Prompts with an answer in the current window.")
    latest_answer_at: datetime | None
    latest_run_number: int | None = Field(
        description="How many AI prompt runs the project has had up to the latest answer's run."
    )


class EngineCitationCounts(BaseModel):
    engine_code: EngineCode
    answers: int
    answers_citing: int = Field(description="Answers with at least one own citation unit.")
    prompts: int
    prompts_citing: int
    previous_answers: int
    previous_answers_citing: int
    previous_prompts: int
    previous_prompts_citing: int


class CitationOverview(BaseModel):
    window: RunWindow
    engines: list[EngineCitationCounts]
    citations: int = Field(description="Own citation units in the current window.")
    previous_citations: int
    matched_citations: int = Field(
        description="Own units now, on the prompt and engine pairs answered in both windows."
    )
    matched_previous_citations: int
    matched_pairs: int
    own_urls: int
    previous_own_urls: int
    domains: int
    previous_domains: int


class PromptCount(BaseModel):
    prompt_id: UUID
    text: str
    citations: int


class CitedPageRow(BaseModel):
    url_id: int
    url: str
    host: str
    registrable_domain: str
    path: str
    title: str | None
    domain_role: DomainRole
    entity_id: UUID | None
    entity_name: str | None
    color_index: int | None
    citations: int
    previous_citations: int
    prompts: int
    top_prompts: list[PromptCount] = Field(max_length=10, description="Most citations first.")
    engines: list[EngineUnits]
    trend: list[int] = Field(description="Units per slot of `window.trend`, oldest first.")
    last_cited_at: datetime


class OwnerCounts(BaseModel):
    own: int
    competitor: int
    third_party: int
    all: int


class CitedPagesMeta(BaseModel):
    window: RunWindow
    owners: OwnerCounts = Field(description="Pages per role, whatever the role filter and `q`.")
    citations: int = Field(description="Units of the rows the filter and `q` keep, every page.")


class CitedPagePage(BaseModel):
    data: list[CitedPageRow]
    page: OffsetPageInfo
    meta: CitedPagesMeta


class EngineAnswers(BaseModel):
    engine_code: EngineCode
    cited: int
    answers: int


class CitedPagePrompt(BaseModel):
    prompt_id: UUID
    text: str
    cited: int
    answers: int
    engines: list[EngineAnswers]
    last_cited_at: datetime


class CitedAlongside(BaseModel):
    registrable_domain: str
    domain_role: DomainRole
    entity_id: UUID | None
    entity_name: str | None
    color_index: int | None
    answers: int = Field(description="Answers citing this page that also cite this domain.")


class CitedPageDetail(BaseModel):
    page: CitedPageRow
    prompts: list[CitedPagePrompt]
    alongside: list[CitedAlongside] = Field(max_length=8)
    window: RunWindow


class BrandCell(BaseModel):
    cited: int
    mentioned: int
    answers: int
    state: BrandState


class EngineBrandCell(BrandCell):
    engine_code: EngineCode


class BrandOnPrompt(BaseModel):
    total: BrandCell
    engines: list[EngineBrandCell]
    cited_on: int = Field(description="Engines with answers where the brand is cited.")
    platforms: int = Field(description="Engines with answers.")


class CompetitorOnPrompt(BrandOnPrompt):
    entity_id: UUID


class PromptTopic(BaseModel):
    term_id: UUID
    name: str


class CitationGapRow(BaseModel):
    prompt_id: UUID
    text: str
    topic: PromptTopic | None = Field(description="The prompt's first term in path order.")
    you: BrandOnPrompt
    competitors: list[CompetitorOnPrompt]
    lost_on: list[EngineCode]
    lost_to: list[UUID]
    gap: int = Field(description="How many engines the prompt is lost on.")
    competitor_answers: int


class GapCompetitor(BaseModel):
    entity_id: UUID
    name: str
    color_index: int | None
    domain: str | None


class CitationGapsMeta(BaseModel):
    window: RunWindow
    competitors: list[GapCompetitor]
    prompts: int
    gaps: int


class CitationGapList(BaseModel):
    data: list[CitationGapRow]
    meta: CitationGapsMeta


class GapPage(BaseModel):
    url_id: int
    url: str
    entity_id: UUID | None
    citations: int
    engines: list[EngineCode]


class CitationGapDetail(BaseModel):
    row: CitationGapRow
    answers: int
    competitor_pages: list[GapPage]
    own_pages: list[GapPage]
    closest_pages: list[GapPage] = Field(max_length=3)
    third_party_pages: list[GapPage] = Field(max_length=5)
    window: RunWindow
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/api/ai/test_citation_board_model.py -n 0 --no-cov -q`
Expected: `1 passed`

- [ ] **Step 5: Lint, type check, commit**

```bash
cd backend && uv run ruff check src/idraft/api/schemas/ai_citation_board.py tests/api/ai/test_citation_board_model.py && uv run ruff format src/idraft/api/schemas/ai_citation_board.py tests/api/ai/test_citation_board_model.py && uv run mypy src/idraft/api/schemas/ai_citation_board.py
git add backend/src/idraft/api/schemas/ai_citation_board.py backend/tests/api/ai/test_citation_board_model.py
git commit -m "WP-76: Citations page response types"
```

---

### Task 2: Run slots and windows (pure)

**Files:**
- Create: `backend/src/idraft/api/ai/citation_board_model.py`
- Test: `backend/tests/api/ai/test_citation_board_model.py`

- [ ] **Step 1: Write the failing tests**

Append to the test file:

```python
from collections.abc import Iterable
from datetime import UTC, datetime, timedelta
from uuid import UUID

from idraft.api.ai.citation_board_model import Answer, Board, assign_slots

NOW = datetime(2026, 11, 16, 9, 0, tzinfo=UTC)
P1, P2 = UUID(int=1), UUID(int=2)


def ans(
    oid: int, prompt: UUID, run: str, days: float, engine: str = "chatgpt_web", *,
    own_mentioned: bool = False, mentions: Iterable[UUID] = (),
) -> Answer:
    return Answer(
        observation_id=oid,
        observed_at=NOW - timedelta(days=days),
        prompt_id=prompt,
        engine_code=engine,
        run_id=None,
        run_key=run,
        own_mentioned=own_mentioned,
        competitors_mentioned=frozenset(mentions),
    )


def test_each_pair_numbers_its_own_runs_from_the_latest() -> None:
    answers = [
        ans(1, P1, "r3", 1), ans(2, P1, "r2", 8), ans(3, P1, "r1", 15),
        # P2 was only asked in the latest run: its slot 1 is r3 too
        ans(4, P2, "r3", 1),
        # Gemini asked P1 in a manual run between r2 and r3: it is Gemini's slot 1
        ans(5, P1, "m1", 3, engine="gemini_web"), ans(6, P1, "r2", 8, engine="gemini_web"),
    ]

    slots = {s.answer.observation_id: s.slot for s in assign_slots(answers)}

    assert slots == {1: 1, 2: 2, 3: 3, 4: 1, 5: 1, 6: 2}


def test_two_replicates_of_one_run_share_a_slot_and_slot_nine_is_dropped() -> None:
    answers = [ans(i, P1, f"r{i}", float(i)) for i in range(1, 10)]
    answers.append(ans(100, P1, "r1", 1.01))

    slotted = assign_slots(answers)

    assert {s.answer.observation_id for s in slotted if s.slot == 1} == {1, 100}
    assert max(s.slot for s in slotted) == 8
    assert 9 not in {s.answer.observation_id for s in slotted}


def test_the_windows_are_slots_1_to_n_and_n_plus_1_to_2n() -> None:
    answers = [ans(i, P1, f"r{i}", float(i)) for i in range(1, 9)]
    board = Board(runs=2, answers=assign_slots(answers), units={})

    assert [s.answer.observation_id for s in board.current()] == [1, 2]
    assert [s.answer.observation_id for s in board.previous()] == [3, 4]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/api/ai/test_citation_board_model.py -n 0 --no-cov -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'idraft.api.ai.citation_board_model'`

- [ ] **Step 3: Write the model's first part**

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/api/ai/test_citation_board_model.py -n 0 --no-cov -q`
Expected: `4 passed`

- [ ] **Step 5: Commit**

```bash
cd backend && uv run ruff check src/idraft/api/ai/citation_board_model.py tests/api/ai/test_citation_board_model.py && uv run ruff format src/idraft/api/ai/citation_board_model.py tests/api/ai/test_citation_board_model.py && uv run mypy src/idraft/api/ai/citation_board_model.py tests/api/ai/test_citation_board_model.py
git add backend/src/idraft/api/ai/citation_board_model.py backend/tests/api/ai/test_citation_board_model.py
git commit -m "WP-76: number each prompt and engine's runs into slots"
```

---

### Task 3: Window meta and the six measures (pure)

**Files:**
- Modify: `backend/src/idraft/api/ai/citation_board_model.py`
- Test: `backend/tests/api/ai/test_citation_board_model.py`

- [ ] **Step 1: Write the failing tests**

```python
from idraft.api.ai.citation_board_model import Unit, overview, run_window

OWN_A = "https://own.example/a"


def unit(oid: int, url: str, role: str = "own", entity: UUID | None = None, url_id: int | None = None) -> Unit:
    host = url.split("/")[2]
    return Unit(oid, url_id or abs(hash(url)) % 10_000, url, host, host, "/" + url.split("/", 3)[-1], None, role, entity)


def board(runs: int, answers: list[Answer], units: list[Unit]) -> Board:
    by_answer: dict[int, list[Unit]] = {}
    for u in units:
        by_answer.setdefault(u.observation_id, []).append(u)
    return Board(runs=runs, answers=assign_slots(answers), units=by_answer)


def test_the_strip_counts_own_units_rates_per_engine_and_matched_growth() -> None:
    # P1 ChatGPT: r2 (now) cites own twice, r1 (before) once. P2 ChatGPT: only r2, cites own once.
    # P1 Gemini: r2 cites nothing, r1 cites own. Runs = 1.
    answers = [
        ans(1, P1, "r2", 1), ans(2, P1, "r1", 8), ans(3, P2, "r2", 1),
        ans(4, P1, "r2", 1, engine="gemini_web"), ans(5, P1, "r1", 8, engine="gemini_web"),
    ]
    units = [
        unit(1, OWN_A, url_id=1), unit(1, "https://own.example/b", url_id=2), unit(1, "https://g2.com/x", "third_party", url_id=3),
        unit(2, OWN_A, url_id=1), unit(3, OWN_A, url_id=1), unit(5, OWN_A, url_id=1),
    ]

    result = overview(board(1, answers, units), ["chatgpt_web", "gemini_web"], timezone="UTC")

    assert (result.citations, result.previous_citations) == (3, 2)
    # Matched pairs: P1 ChatGPT and P1 Gemini (P2 has no previous run)
    assert (result.matched_citations, result.matched_previous_citations, result.matched_pairs) == (2, 2, 2)
    chatgpt, gemini = result.engines
    assert (chatgpt.answers, chatgpt.answers_citing, chatgpt.prompts, chatgpt.prompts_citing) == (2, 2, 2, 2)
    assert (chatgpt.previous_answers, chatgpt.previous_answers_citing) == (1, 1)
    assert (gemini.answers, gemini.answers_citing, gemini.previous_answers_citing) == (1, 0, 1)
    assert (result.own_urls, result.previous_own_urls) == (2, 1)
    assert (result.domains, result.previous_domains) == (2, 1)


def test_the_window_lists_its_slots_with_dates_and_counts() -> None:
    answers = [ans(1, P1, "r2", 1), ans(2, P1, "r1", 8), ans(3, P2, "r2", 2)]

    window = run_window(board(1, answers, []), timezone="Asia/Kolkata", run_number=None)

    assert [s.slot for s in window.current] == [1]
    assert window.current[0].answers == 2
    assert window.current[0].first_at == NOW - timedelta(days=2)
    assert [s.slot for s in window.previous] == [1 + 1]
    assert [s.slot for s in window.trend] == [2, 1]
    assert (window.answers, window.prompts, window.latest_answer_at) == (2, 2, NOW - timedelta(days=1))
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/api/ai/test_citation_board_model.py -n 0 --no-cov -q`
Expected: FAIL with `ImportError: cannot import name 'overview'`

- [ ] **Step 3: Implement**

Append to `citation_board_model.py` (and add `from idraft.api.schemas.ai_citation_board import CitationOverview, EngineCitationCounts, RunSlot, RunWindow` plus `from idraft.domain.ai_engines import EngineCode` to the imports):

```python
def _slots(answers: Iterable[Slotted], wanted: Iterable[int]) -> list[RunSlot]:
    by_slot: defaultdict[int, list[datetime]] = defaultdict(list)
    for s in answers:
        by_slot[s.slot].append(s.answer.observed_at)
    return [
        RunSlot(slot=slot, first_at=min(by_slot[slot]), last_at=max(by_slot[slot]), answers=len(by_slot[slot]))
        for slot in wanted
        if by_slot.get(slot)
    ]


def run_window(board: Board, *, timezone: str, run_number: int | None) -> RunWindow:
    current = board.current()
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


def overview(board: Board, engines: Sequence[str], *, timezone: str, run_number: int | None = None) -> CitationOverview:
    """The six measures of the strip and their previous values (plan rules 3 to 7)."""
    now, before = board.current(), board.previous()
    matched = {_pair(s) for s in now} & {_pair(s) for s in before}

    def engine_counts(code: str) -> EngineCitationCounts:
        def counts(answers: list[Slotted]) -> tuple[int, int, int, int]:
            mine = [s for s in answers if s.answer.engine_code == code]
            citing = [s for s in mine if any(u.domain_role == "own" for u in board.units_of(s))]
            return len(mine), len(citing), len({s.answer.prompt_id for s in mine}), len({s.answer.prompt_id for s in citing})

        a, b, c, d = counts(now)
        e, f, g, h = counts(before)
        return EngineCitationCounts(
            engine_code=EngineCode(code), answers=a, answers_citing=b, prompts=c, prompts_citing=d,
            previous_answers=e, previous_answers_citing=f, previous_prompts=g, previous_prompts_citing=h,
        )

    def domains_of(answers: list[Slotted]) -> int:
        return len({u.registrable_domain for s in answers for u in board.units_of(s)})

    return CitationOverview(
        window=run_window(board, timezone=timezone, run_number=run_number),
        engines=[engine_counts(code) for code in engines],
        citations=len(_own_units(board, now)),
        previous_citations=len(_own_units(board, before)),
        matched_citations=len(_own_units(board, [s for s in now if _pair(s) in matched])),
        matched_previous_citations=len(_own_units(board, [s for s in before if _pair(s) in matched])),
        matched_pairs=len(matched),
        own_urls=len({u.url_id for u in _own_units(board, now)}),
        previous_own_urls=len({u.url_id for u in _own_units(board, before)}),
        domains=domains_of(now),
        previous_domains=domains_of(before),
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/api/ai/test_citation_board_model.py -n 0 --no-cov -q`
Expected: `6 passed`

- [ ] **Step 5: Commit**

```bash
cd backend && uv run ruff check src/idraft/api/ai/citation_board_model.py tests/api/ai/test_citation_board_model.py && uv run ruff format src/idraft/api/ai/citation_board_model.py tests/api/ai/test_citation_board_model.py && uv run mypy src/idraft/api/ai/citation_board_model.py tests/api/ai/test_citation_board_model.py
git add backend/src/idraft/api/ai/citation_board_model.py backend/tests/api/ai/test_citation_board_model.py
git commit -m "WP-76: the six citation measures and the run window"
```

---

### Task 4: Cited page rows and the page drawer (pure)

**Files:**
- Modify: `backend/src/idraft/api/ai/citation_board_model.py`
- Test: `backend/tests/api/ai/test_citation_board_model.py`

The rules, from `cit-data.js` `pageRows` and `pageDetail`:
- One row per URL with at least one unit in the current window. `citations` counts its units now, `previous_citations` in the previous window, `engines` its units per engine of the request (zeros kept), `prompts` how many prompts cite it, `top_prompts` the ten with most units (ties by text), `trend` its units per slot of `window.trend` oldest first, `last_cited_at` its latest citing answer.
- The drawer lists every prompt citing it with `cited` (answers citing it) over `answers` (every current answer of that prompt), per engine the same, sorted by `cited` then text. `alongside` is the other registrable domains in the answers that cite it, counted once per answer (the preview counted per URL; the drawer's copy says answers, so once per answer is the rule), top 8 by answers then domain.

- [ ] **Step 1: Write the failing tests**

```python
from idraft.api.ai.citation_board_model import page_detail, page_rows

TEXTS = {P1: "Best SOC providers?", P2: "SOC pricing?"}
NAMES: dict[UUID, tuple[str, int | None]] = {}


def test_a_page_row_counts_units_prompts_engines_and_trend() -> None:
    answers = [
        ans(1, P1, "r2", 1), ans(2, P2, "r2", 1), ans(3, P1, "r1", 8),
        ans(4, P1, "r2", 1, engine="gemini_web"),
    ]
    units = [unit(1, OWN_A, url_id=1), unit(2, OWN_A, url_id=1), unit(3, OWN_A, url_id=1), unit(4, OWN_A, url_id=1)]
    b = board(1, answers, units)

    (row,) = page_rows(b, ["chatgpt_web", "gemini_web"], TEXTS, NAMES)

    assert (row.citations, row.previous_citations, row.prompts) == (3, 1, 2)
    assert [(e.engine_code, e.citation_units) for e in row.engines] == [("chatgpt_web", 2), ("gemini_web", 1)]
    assert [(p.text, p.citations) for p in row.top_prompts] == [("Best SOC providers?", 2), ("SOC pricing?", 1)]
    assert row.trend == [1, 3]
    assert row.last_cited_at == NOW - timedelta(days=1)


def test_the_page_drawer_lists_prompts_with_cited_over_answers_and_alongside_domains() -> None:
    answers = [ans(1, P1, "r2", 1), ans(2, P1, "r2", 1.1), ans(3, P2, "r2", 1)]
    units = [
        unit(1, OWN_A, url_id=1), unit(1, "https://g2.com/x", "third_party", url_id=3), unit(1, "https://g2.com/y", "third_party", url_id=4),
        unit(3, OWN_A, url_id=1),
    ]

    detail = page_detail(board(1, answers, units), 1, ["chatgpt_web"], TEXTS, NAMES)

    assert [(p.text, p.cited, p.answers) for p in detail.prompts] == [("Best SOC providers?", 1, 2), ("SOC pricing?", 1, 1)]
    assert [(a.registrable_domain, a.answers) for a in detail.alongside] == [("g2.com", 1)]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/api/ai/test_citation_board_model.py -n 0 --no-cov -q`
Expected: FAIL with `ImportError: cannot import name 'page_rows'`

- [ ] **Step 3: Implement**

Add `CitedAlongside, CitedPageDetail, CitedPagePrompt, CitedPageRow, EngineAnswers, PromptCount` to the schema import and `EngineUnits` from `idraft.api.schemas.ai_sources`, then append:

```python
# entity id -> (name, color index)
Names = Mapping[UUID, tuple[str, int | None]]


def _trend_slots(board: Board) -> list[int]:
    present = {s.slot for s in board.answers}
    return [slot for slot in range(TREND_SLOTS, 0, -1) if slot in present]


def page_rows(board: Board, engines: Sequence[str], texts: Mapping[UUID, str], names: Names) -> list[CitedPageRow]:
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
        name, color = names.get(u.entity_id, (None, None)) if u.entity_id else (None, None)
        rows.append(
            CitedPageRow(
                url_id=url_id, url=u.url, host=u.host, registrable_domain=u.registrable_domain, path=u.path,
                title=u.title, domain_role=role_of(u.domain_role), entity_id=u.entity_id, entity_name=name, color_index=color,
                citations=len(citing), previous_citations=before[url_id], prompts=len(by_prompt),
                top_prompts=[PromptCount(prompt_id=p, text=texts.get(p, ""), citations=n) for p, n in top],
                engines=[EngineUnits(engine_code=EngineCode(c), citation_units=sum(s.answer.engine_code == c for s in citing)) for c in engines],
                trend=[per_slot[url_id].get(slot, 0) for slot in trend_slots],
                last_cited_at=max(s.answer.observed_at for s in citing),
            )
        )
    return rows


def page_detail(board: Board, url_id: int, engines: Sequence[str], texts: Mapping[UUID, str], names: Names) -> CitedPageDetail | None:
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
                prompt_id=prompt_id, text=texts.get(prompt_id, ""), cited=len(citing), answers=len(mine),
                engines=[
                    EngineAnswers(engine_code=EngineCode(c), cited=sum(s.answer.engine_code == c for s in citing), answers=sum(s.answer.engine_code == c for s in mine))
                    for c in engines
                ],
                last_cited_at=max(s.answer.observed_at for s in citing),
            )
        )
    prompts.sort(key=lambda p: (-p.cited, p.text))
    alongside: dict[str, tuple[Unit, int]] = {}
    for s in now:
        if not cites(s):
            continue
        for domain, u in {u.registrable_domain: u for u in board.units_of(s) if u.url_id != url_id}.items():
            seen = alongside.get(domain)
            alongside[domain] = (seen[0] if seen else u, (seen[1] if seen else 0) + 1)
    ranked = sorted(alongside.items(), key=lambda item: (-item[1][1], item[0]))[:8]
    return CitedPageDetail(
        page=row,
        prompts=prompts,
        alongside=[
            CitedAlongside(
                registrable_domain=domain, domain_role=role_of(u.domain_role), entity_id=u.entity_id,
                entity_name=names.get(u.entity_id, (None, None))[0] if u.entity_id else None,
                color_index=names.get(u.entity_id, (None, None))[1] if u.entity_id else None,
                answers=count,
            )
            for domain, (u, count) in ranked
        ],
        window=run_window(board, timezone="", run_number=None),
    )
```

The service replaces `window` with the request's real window (Task 7); the model keeps no time zone.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/api/ai/test_citation_board_model.py -n 0 --no-cov -q`
Expected: `8 passed`

- [ ] **Step 5: Commit**

```bash
cd backend && uv run ruff check src/idraft/api/ai/citation_board_model.py tests/api/ai/test_citation_board_model.py && uv run ruff format src/idraft/api/ai/citation_board_model.py tests/api/ai/test_citation_board_model.py && uv run mypy src/idraft/api/ai/citation_board_model.py tests/api/ai/test_citation_board_model.py
git add backend/src/idraft/api/ai/citation_board_model.py backend/tests/api/ai/test_citation_board_model.py
git commit -m "WP-76: cited page rows and the page drawer"
```

Add the `role_of` helper (Conventions) to the model in this task, with `from typing import cast` and `DomainRole` from `idraft.api.schemas.ai_sources`, and a test that `role_of("watch")` raises `ValueError`.

---

### Task 5: Gap rows and the gap drawer (pure)

**Files:**
- Modify: `backend/src/idraft/api/ai/citation_board_model.py`
- Test: `backend/tests/api/ai/test_citation_board_model.py`

The rules, from `cit-data.js` `gapRows` and `promptDetail`:
- Per prompt with at least one current answer, and per engine of the request: `you` counts answers (`answers`), answers with an own unit (`cited`) and answers whose fact row names the own brand (`mentioned`); each selected competitor counts answers with a unit of its entity and answers that name it. `state` is `none` with no answers, `cited` when `cited > 0`, `mentioned` when only named, else `not`; `total` sums the engines.
- `lost_on`: engines with answers where `you.cited == 0` and some selected competitor has `cited > 0`. `lost_to`: the selected competitors cited on any lost engine, in the request's order. `gap = len(lost_on)`. `competitor_answers`: the sum of the competitors' `total.cited`.
- The drawer: `competitor_pages` are the units of the selected competitors in the prompt's current answers, per URL with their count and engines, most first; `own_pages` the own units in those answers; `closest_pages` the own units of the other prompts that share a term with this prompt, top 3 (empty when the prompt has no term); `third_party_pages` the third-party units, top 5.

- [ ] **Step 1: Write the failing tests**

```python
from idraft.api.ai.citation_board_model import gap_detail, gap_rows

RIVAL_1, RIVAL_2 = UUID(int=11), UUID(int=12)


def test_a_prompt_is_lost_per_engine_where_a_competitor_is_cited_and_you_are_not() -> None:
    answers = [
        ans(1, P1, "r1", 1), ans(2, P1, "r1", 1, engine="gemini_web"),
        ans(3, P2, "r1", 1, mentions={RIVAL_2}),
    ]
    units = [
        unit(1, OWN_A, url_id=1),  # ChatGPT: you are cited
        unit(2, "https://rival.example/soc", "competitor", RIVAL_1, url_id=5),  # Gemini: only the rival
    ]

    rows = {r.prompt_id: r for r in gap_rows(board(1, answers, units), ["chatgpt_web", "gemini_web"], [RIVAL_1, RIVAL_2], TEXTS, {})}

    p1 = rows[P1]
    assert (p1.lost_on, p1.lost_to, p1.gap) == (["gemini_web"], [RIVAL_1], 1)
    assert (p1.you.total.state, p1.you.cited_on, p1.you.platforms) == ("cited", 1, 2)
    assert p1.competitors[0].total.state == "cited"
    p2 = rows[P2]
    assert p2.gap == 0
    # Named but never linked is a mention, not a citation
    assert p2.competitors[1].total.state == "mentioned"
    assert [e.state for e in p2.you.engines] == ["not", "none"]


def test_the_gap_drawer_lists_competitor_own_closest_and_third_party_pages() -> None:
    answers = [ans(1, P1, "r1", 1), ans(2, P2, "r1", 1)]
    units = [
        unit(1, "https://rival.example/soc", "competitor", RIVAL_1, url_id=5),
        unit(1, "https://g2.com/x", "third_party", url_id=3),
        unit(2, OWN_A, url_id=1),
    ]
    terms = {P1: [UUID(int=99)], P2: [UUID(int=99)]}

    detail = gap_detail(board(1, answers, units), P1, ["chatgpt_web"], [RIVAL_1], TEXTS, {}, terms)

    assert detail is not None
    assert [(p.url, p.citations) for p in detail.competitor_pages] == [("https://rival.example/soc", 1)]
    assert detail.own_pages == []
    assert [p.url for p in detail.closest_pages] == [OWN_A]
    assert [p.url for p in detail.third_party_pages] == ["https://g2.com/x"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/api/ai/test_citation_board_model.py -n 0 --no-cov -q`
Expected: FAIL with `ImportError: cannot import name 'gap_rows'`

- [ ] **Step 3: Implement**

Add `BrandCell, BrandOnPrompt, CitationGapDetail, CitationGapRow, CompetitorOnPrompt, EngineBrandCell, GapPage, PromptTopic` to the schema import, then append:

```python
# prompt id -> its first term (id, name), for the Group column
Topics = Mapping[UUID, tuple[UUID, str]]


def state_of(cited: int, mentioned: int, answers: int) -> BrandState:
    if answers == 0:
        return "none"
    if cited > 0:
        return "cited"
    return "mentioned" if mentioned > 0 else "not"


def _brand(cells: Mapping[str, tuple[int, int, int]], engines: Sequence[str]) -> BrandOnPrompt:
    per = [
        EngineBrandCell(engine_code=EngineCode(c), cited=k, mentioned=m, answers=n, state=state_of(k, m, n))
        for c in engines
        for k, m, n in (cells.get(c, (0, 0, 0)),)
    ]
    k, m, n = (sum(cell.cited for cell in per), sum(cell.mentioned for cell in per), sum(cell.answers for cell in per))
    return BrandOnPrompt(
        total=BrandCell(cited=k, mentioned=m, answers=n, state=state_of(k, m, n)),
        engines=per,
        cited_on=sum(cell.answers > 0 and cell.cited > 0 for cell in per),
        platforms=sum(cell.answers > 0 for cell in per),
    )


def _cells(
    answers: Sequence[Slotted], engines: Sequence[str],
    cited: Callable[[Slotted], bool], named: Callable[[Slotted], bool],
) -> dict[str, tuple[int, int, int]]:
    """(cited, mentioned, answers) per engine of one prompt's answers."""
    out = {}
    for code in engines:
        on = [s for s in answers if s.answer.engine_code == code]
        out[code] = (sum(map(cited, on)), sum(map(named, on)), len(on))
    return out


def _cites_own(board: Board) -> Callable[[Slotted], bool]:
    return lambda s: any(u.domain_role == "own" for u in board.units_of(s))


def _cites_entity(board: Board, entity: UUID) -> Callable[[Slotted], bool]:
    return lambda s: any(u.domain_role == "competitor" and u.entity_id == entity for u in board.units_of(s))


def _names_entity(entity: UUID) -> Callable[[Slotted], bool]:
    return lambda s: entity in s.answer.competitors_mentioned


def gap_rows(
    board: Board, engines: Sequence[str], competitors: Sequence[UUID], texts: Mapping[UUID, str], topics: Topics
) -> list[CitationGapRow]:
    """One row per prompt with a current answer, most engines lost first (the page re-sorts)."""
    now = board.current()
    rows = []
    for prompt_id in sorted({s.answer.prompt_id for s in now}, key=lambda p: texts.get(p, "")):
        mine = [s for s in now if s.answer.prompt_id == prompt_id]
        you = _brand(_cells(mine, engines, _cites_own(board), lambda s: s.answer.own_mentioned), engines)
        rivals = [
            CompetitorOnPrompt(
                entity_id=entity,
                **_brand(_cells(mine, engines, _cites_entity(board, entity), _names_entity(entity)), engines).model_dump(),
            )
            for entity in competitors
        ]
        lost_on = [
            cell.engine_code
            for index, cell in enumerate(you.engines)
            if cell.answers > 0 and cell.cited == 0 and any(r.engines[index].cited > 0 for r in rivals)
        ]
        lost_to = [r.entity_id for r in rivals if any(r.engines[engines.index(str(code))].cited > 0 for code in lost_on)]
        topic = topics.get(prompt_id)
        rows.append(
            CitationGapRow(
                prompt_id=prompt_id, text=texts.get(prompt_id, ""),
                topic=None if topic is None else PromptTopic(term_id=topic[0], name=topic[1]),
                you=you, competitors=rivals, lost_on=lost_on, lost_to=lost_to, gap=len(lost_on),
                competitor_answers=sum(r.total.cited for r in rivals),
            )
        )
    rows.sort(key=lambda r: (-r.gap, -len(r.lost_to), -r.competitor_answers, r.text))
    return rows


def _pages(board: Board, answers: Iterable[Slotted], keep: Callable[[Unit], bool], limit: int | None = None) -> list[GapPage]:
    found: dict[int, tuple[Unit, int, set[str]]] = {}
    for s in answers:
        for u in board.units_of(s):
            if keep(u):
                seen = found.get(u.url_id)
                found[u.url_id] = (u, (seen[1] if seen else 0) + 1, (seen[2] if seen else set()) | {s.answer.engine_code})
    ranked = sorted(found.values(), key=lambda item: (-item[1], item[0].url))
    return [
        GapPage(url_id=u.url_id, url=u.url, entity_id=u.entity_id, citations=n, engines=[EngineCode(c) for c in sorted(codes)])
        for u, n, codes in ranked[:limit]
    ]


def gap_detail(
    board: Board, prompt_id: UUID, engines: Sequence[str], competitors: Sequence[UUID],
    texts: Mapping[UUID, str], topics: Topics, terms: Mapping[UUID, Sequence[UUID]],
) -> CitationGapDetail | None:
    """The drawer of one prompt of the gap analysis; None when it has no current answer."""
    row = next((r for r in gap_rows(board, engines, competitors, texts, topics) if r.prompt_id == prompt_id), None)
    if row is None:
        return None
    now = board.current()
    here = [s for s in now if s.answer.prompt_id == prompt_id]
    mine = set(terms.get(prompt_id, ()))
    neighbours = [s for s in now if s.answer.prompt_id != prompt_id and mine & set(terms.get(s.answer.prompt_id, ()))]
    selected = set(competitors)
    return CitationGapDetail(
        row=row,
        answers=len(here),
        competitor_pages=_pages(board, here, lambda u: u.domain_role == "competitor" and u.entity_id in selected),
        own_pages=_pages(board, here, lambda u: u.domain_role == "own"),
        closest_pages=_pages(board, neighbours, lambda u: u.domain_role == "own", 3),
        third_party_pages=_pages(board, here, lambda u: u.domain_role == "third_party", 5),
        window=run_window(board, timezone="", run_number=None),
    )
```

Add `from collections.abc import Callable` and `BrandState` (from the schemas) to the top import block.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/api/ai/test_citation_board_model.py -n 0 --no-cov -q`
Expected: `10 passed`

- [ ] **Step 5: Commit**

```bash
cd backend && uv run ruff check src/idraft/api/ai/citation_board_model.py tests/api/ai/test_citation_board_model.py && uv run ruff format src/idraft/api/ai/citation_board_model.py tests/api/ai/test_citation_board_model.py && uv run mypy src/idraft/api/ai/citation_board_model.py tests/api/ai/test_citation_board_model.py
git add backend/src/idraft/api/ai/citation_board_model.py backend/tests/api/ai/test_citation_board_model.py
git commit -m "WP-76: gap rows decided per engine, and the gap drawer"
```

---

### Task 6: Repository reads

**Files:**
- Create: `backend/src/idraft/api/ai/citation_board_repository.py`
- Create: `backend/tests/api/ai/citation_board_support.py`
- Test: `backend/tests/api/ai/test_citation_board_routes.py` (repository tests first)

Read first: `backend/src/idraft/api/ai/source_repository.py` lines 1 to 260 (the module note on planning without statistics, `counted_answers`, `citation_bounds`, `unit`), `backend/src/idraft/db/tables.py` around lines 344 (`collection_runs`), 507 (`entities`), 556 (`entity_domains`), 580 (`project_entities`), 1539 (`ai_observations`), 1603 (`ai_citations`), 1692 (`ai_observation_facts`), and `backend/src/idraft/api/ai/prompt_repository.py` `terms_of`.

- [ ] **Step 1: Write the test support**

```python
"""Answers for the Citations page tests (WP-76): `sources_support.answer` plus what the page reads
that it leaves at its defaults: the collection run, the own mention and the competitor mentions."""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from typing import Any

from tests.api.ai.sources_support import Cite, World, answer
from tests.api.auth.support import execute, fetchrow
from tests.collectors.ai_support import Prompt
from tests.conftest import PostgresServer


async def make_run(pg: PostgresServer, world: World, *, days_ago: float) -> uuid.UUID:
    """An `ai_prompt` collection run whose window starts `days_ago` days before now."""
    row = await fetchrow(
        pg,
        "INSERT INTO ops.collection_runs (workspace_id, project_id, workload, window_start, "
        "window_end, trigger, status, config_snapshot) VALUES ($1, $2, 'ai_prompt', "
        "now() - make_interval(secs => $3), now() - make_interval(secs => $3) + interval '1 hour', "
        "'manual', 'completed', '{}'::jsonb) RETURNING id",
        world.project.workspace_id,
        world.project.id,
        days_ago * 86400.0,
    )
    run_id: uuid.UUID = row["id"]
    return run_id


async def run_answer(
    pg: PostgresServer,
    world: World,
    prompt: Prompt,
    *,
    run: uuid.UUID | None,
    days_ago: float,
    engine: str = "chatgpt_web",
    cites: Sequence[Cite] = (),
    own_mentioned: bool = False,
    mentions: Sequence[uuid.UUID] = (),
    **rest: Any,
) -> int:
    observation_id = await answer(pg, world, prompt, days_ago=days_ago, engine=engine, cites=cites, **rest)
    await execute(pg, "UPDATE ai.observations SET collection_run_id = $2 WHERE id = $1", observation_id, run)
    await execute(
        pg,
        "UPDATE ai.observation_facts SET own_mentioned = $2, competitor_mentions = $3::uuid[] "
        "WHERE observation_id = $1",
        observation_id,
        own_mentioned,
        list(mentions),
    )
    return observation_id
```

The run status CHECK (0004 line 100) allows `planned`, `running`, `completed`, `completed_with_errors`, `failed`, `cancelled` and `budget_blocked`; the `tasks_*` columns have defaults. Import `fetchrow` and `execute` from the module `sources_support.py` imports them from.

- [ ] **Step 2: Write the failing repository tests**

```python
"""The Citations page routes (WP-76) against Postgres: the repository reads, then each route.
Numbers are worked out by hand from the answers in each test."""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime, timedelta
from uuid import UUID

import httpx
import pytest

from idraft.api.ai import citation_board_repository as repository
from idraft.api.ai.source_repository import SourceScope
from idraft.api.resources import Resources
from idraft.db.engine import workspace_transaction
from tests.api.ai.citation_board_support import make_run, run_answer
from tests.api.ai.sources_support import GUIDE, OWN, Cite, World, make_world
from tests.api.auth.support import execute
from tests.collectors.ai_support import Prompt, add_prompt
from tests.conftest import PostgresServer


def scope_of(world: World, prompt_ids: tuple[UUID, ...], *, days: int = repository.LOOKBACK_DAYS) -> SourceScope:
    now = datetime.now(UTC)
    return SourceScope(
        workspace_id=world.project.workspace_id, project_id=world.project.id,
        since=now - timedelta(days=days), until=now + timedelta(seconds=1),
        engine_codes=("chatgpt_web", "gemini_web", "google_ai_mode"), prompt_ids=prompt_ids,
    )


async def test_lookback_answers_carry_their_run_and_mentions(resources: Resources, migrated: PostgresServer) -> None:
    world = await make_world(resources, migrated)
    prompt = await add_prompt(migrated, world.project, "Best managed SOC providers?")
    run = await make_run(migrated, world, days_ago=1)
    await run_answer(migrated, world, prompt, run=run, days_ago=1, cites=[world.own_cite()], own_mentioned=True, mentions=[world.rival])
    # Outside a 5 day lookback, inside the partitions the test database keeps
    await run_answer(migrated, world, prompt, run=None, days_ago=20)

    async with workspace_transaction(resources.sessions, world.project.workspace_id, user_id=world.owner.user_id) as db:
        answers = await repository.lookback_answers(db, scope_of(world, (prompt.id,), days=5))

    (only,) = answers
    assert (only.run_id, only.run_key, only.own_mentioned) == (run, str(run), True)
    assert only.competitors_mentioned == frozenset({world.rival})


async def test_units_are_one_per_url_per_answer_and_skip_flagged_citations(resources: Resources, migrated: PostgresServer) -> None:
    world = await make_world(resources, migrated)
    prompt = await add_prompt(migrated, world.project, "Best managed SOC providers?")
    run = await make_run(migrated, world, days_ago=1)
    oid = await run_answer(migrated, world, prompt, run=run, days_ago=1, cites=[world.own_cite(), world.own_cite(), Cite(GUIDE)])
    await execute(migrated, "UPDATE ai.citations SET flags = ARRAY['unresolved_redirect'] WHERE observation_id = $1 AND raw_url = $2", oid, GUIDE)
    scope = replace(scope_of(world, (prompt.id,)), excluded_flags=("unresolved_redirect",))

    async with workspace_transaction(resources.sessions, world.project.workspace_id, user_id=world.owner.user_id) as db:
        answers = await repository.lookback_answers(db, scope)
        units = await repository.units_of(db, scope, answers)

    assert [(u.url, u.domain_role) for u in units[oid]] == [(OWN, "own")]
```

The session pattern is the one of `tests/collectors/test_gsc_sync.py:241`. `world.owner.user_id`: check the `Caller` field name in the members support and use it.

- [ ] **Step 3: Run tests to verify they fail**

Run (Colima variables as in AGENTS.md): `cd backend && uv run pytest tests/api/ai/test_citation_board_routes.py -n 0 --no-cov -q`
Expected: FAIL with `ImportError: cannot import name 'citation_board_repository'`

- [ ] **Step 4: Implement the repository**

```python
"""SQL reads of the Citations page (WP-76). The counted answers are those of the sources lane
(`source_repository.counted_answers`: same prompts, validity, currency and supersession rules),
read over `LOOKBACK_DAYS` so every prompt and engine has its last eight runs; the citation units
are read once, for the answers the slots keep. See the module note of `source_repository` on
planning without statistics: these reads bound every `ai.*` table by the window's instants too."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Collection, Sequence
from dataclasses import replace
from datetime import timedelta
from typing import Final
from uuid import UUID

from sqlalchemy import and_, func, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from idraft.api.ai.citation_board_model import Answer, Slotted, Unit
from idraft.api.ai.source_repository import SourceScope, citation_bounds, counted_answers
from idraft.api.schemas.ai_citation_board import GapCompetitor
from idraft.db.tables import (
    ai_citations,
    ai_observation_facts,
    ai_observations,
    ai_prompt_versions,
    ai_prompts,
    collection_runs,
    domains,
    entities,
    entity_domains,
    project_entities,
    urls,
)

# Eight weekly runs take 56 days; twice the slots of a monthly schedule still fit.
LOOKBACK_DAYS: Final = 183
# asyncpg takes at most 32,767 parameters; two per answer key.
_KEYS_PER_QUERY: Final = 4000

_O, _C, _D, _U = ai_observations.c, ai_citations.c, domains.c, urls.c


async def lookback_answers(db: AsyncSession, scope: SourceScope) -> list[Answer]:
    """The counted answers of the scope with their run, own mention and competitor mentions."""
    counted = counted_answers(scope)
    facts = ai_observation_facts.alias("mentions")
    f = facts.c
    rows = await db.execute(
        select(
            counted.c.observation_id, counted.c.observed_at, counted.c.prompt_id, counted.c.engine_code,
            _O.collection_run_id, _O.observed_date, f.own_mentioned, f.competitor_mentions,
        ).select_from(
            counted.join(
                ai_observations,
                and_(
                    _O.id == counted.c.observation_id, _O.observed_at == counted.c.observed_at,
                    _O.workspace_id == scope.workspace_id, _O.observed_at >= scope.since, _O.observed_at < scope.until,
                ),
            ).join(
                facts,
                and_(
                    f.observation_id == counted.c.observation_id, f.observed_at == counted.c.observed_at,
                    f.derivation_id == counted.c.derivation_id, f.workspace_id == scope.workspace_id,
                    f.observed_at >= scope.since, f.observed_at < scope.until,
                ),
            )
        )
    )
    return [
        Answer(
            observation_id=row.observation_id, observed_at=row.observed_at, prompt_id=row.prompt_id,
            engine_code=row.engine_code, run_id=row.collection_run_id,
            run_key=str(row.collection_run_id) if row.collection_run_id else f"day:{row.observed_date}",
            own_mentioned=bool(row.own_mentioned), competitors_mentioned=frozenset(row.competitor_mentions or ()),
        )
        for row in rows
    ]


async def units_of(db: AsyncSession, scope: SourceScope, answers: Sequence[Answer | Slotted]) -> dict[int, list[Unit]]:
    """The citation units of these answers, by observation id, flagged citations left out."""
    keys = [(a.answer if isinstance(a, Slotted) else a) for a in answers]
    found: defaultdict[int, list[Unit]] = defaultdict(list)
    for start in range(0, len(keys), _KEYS_PER_QUERY):
        chunk = keys[start : start + _KEYS_PER_QUERY]
        bounded = replace(scope, since=min(a.observed_at for a in chunk), until=max(a.observed_at for a in chunk) + timedelta(microseconds=1))
        rows = await db.execute(
            select(
                _C.observation_id, _C.url_id, _U.canonical_url, _D.host, _D.registrable_domain, _U.path,
                func.max(_C.title).label("title"), _C.domain_role, _C.role_entity_id,
            )
            .select_from(ai_citations.join(urls, _U.id == _C.url_id).join(domains, _D.id == _C.domain_id))
            .where(*citation_bounds(bounded), tuple_(_C.observation_id, _C.observed_at).in_([(a.observation_id, a.observed_at) for a in chunk]))
            .group_by(_C.observation_id, _C.url_id, _U.canonical_url, _D.host, _D.registrable_domain, _U.path, _C.domain_role, _C.role_entity_id)
            .order_by(_C.observation_id, func.min(_C.citation_index))
        )
        for row in rows:
            found[row.observation_id].append(
                Unit(row.observation_id, row.url_id, row.canonical_url, row.host, row.registrable_domain, row.path, row.title, row.domain_role, row.role_entity_id)
            )
    return dict(found)


async def prompt_texts(db: AsyncSession, workspace_id: UUID, prompt_ids: Collection[UUID]) -> dict[UUID, str]:
    p, v = ai_prompts.c, ai_prompt_versions.c
    rows = await db.execute(
        select(p.id, v.text).join(ai_prompt_versions, v.id == p.current_version_id).where(p.workspace_id == workspace_id, p.id.in_(list(prompt_ids)))
    )
    return {row.id: row.text for row in rows}


async def tracked_competitors(db: AsyncSession, workspace_id: UUID, project_id: UUID) -> list[GapCompetitor]:
    """The project's competitors in the order Settings lists them (added first), with a domain."""
    pe, e, ed, d = project_entities.c, entities.c, entity_domains.c, domains.c
    domain = (
        select(func.min(d.registrable_domain)).select_from(entity_domains.join(domains, d.id == ed.domain_id))
        .where(ed.entity_id == pe.entity_id, ed.workspace_id == workspace_id).scalar_subquery()
    )
    rows = await db.execute(
        select(pe.entity_id, e.canonical_name, pe.color_index, domain.label("domain"))
        .join(entities, and_(e.id == pe.entity_id, e.workspace_id == pe.workspace_id))
        .where(pe.workspace_id == workspace_id, pe.project_id == project_id, pe.role == "competitor", pe.removed_at.is_(None))
        .order_by(pe.added_at, pe.entity_id)
    )
    return [GapCompetitor(entity_id=r.entity_id, name=r.canonical_name, color_index=r.color_index, domain=r.domain) for r in rows]


async def entity_names(db: AsyncSession, workspace_id: UUID, project_id: UUID, ids: Collection[UUID]) -> dict[UUID, tuple[str, int | None]]:
    if not ids:
        return {}
    pe, e = project_entities.c, entities.c
    rows = await db.execute(
        select(e.id, e.canonical_name, pe.color_index)
        .outerjoin(project_entities, and_(pe.entity_id == e.id, pe.project_id == project_id, pe.workspace_id == workspace_id))
        .where(e.workspace_id == workspace_id, e.id.in_(list(ids)))
    )
    return {r.id: (r.canonical_name, r.color_index) for r in rows}


async def run_number(db: AsyncSession, workspace_id: UUID, project_id: UUID, run_id: UUID | None) -> int | None:
    """How many AI prompt runs the project has had up to this run (the footer's "run 48")."""
    if run_id is None:
        return None
    r = collection_runs.c
    start = select(r.window_start).where(r.id == run_id, r.workspace_id == workspace_id).scalar_subquery()
    count = await db.scalar(
        select(func.count()).where(
            r.workspace_id == workspace_id, r.project_id == project_id, r.workload == "ai_prompt",
            r.status.in_(("completed", "completed_with_errors")), r.window_start <= start,
        )
    )
    return int(count or 0) or None
```

Column names to check against `tables.py` before running: `entities.c.canonical_name`, `entity_domains.c.entity_id` / `.domain_id` / `.workspace_id`, `ai_prompt_versions.c.text`. Fix the names to the table's if they differ; the behavior stays.

`prompt_terms`: the service calls `idraft.api.ai.prompt_repository.terms_of` (returns `dict[prompt_id, list[TermRecord]]` in path order) and keeps `(record.id, record.name)` of the first record for the Group column and every record's id for "closest page".

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/api/ai/test_citation_board_routes.py -n 0 --no-cov -q`
Expected: `2 passed`

- [ ] **Step 6: Commit**

```bash
cd backend && uv run ruff check src/idraft/api/ai/citation_board_repository.py tests/api/ai && uv run ruff format src/idraft/api/ai/citation_board_repository.py tests/api/ai/citation_board_support.py tests/api/ai/test_citation_board_routes.py && uv run mypy src/idraft/api/ai/citation_board_repository.py tests/api/ai/citation_board_support.py tests/api/ai/test_citation_board_routes.py && uv run lint-imports
git add backend/src/idraft/api/ai/citation_board_repository.py backend/tests/api/ai/citation_board_support.py backend/tests/api/ai/test_citation_board_routes.py
git commit -m "WP-76: lookback answers, citation units and the page's lookups"
```

---

### Task 7: Service

**Files:**
- Create: `backend/src/idraft/api/ai/citation_board.py`

Read first: `backend/src/idraft/api/ai/sources.py` lines 95 to 200 (`SourceQuery`, `scoped`, `shown_engines`) and 566 to 590 (`SourceService._transaction`, the `enable_nestloop` note).

- [ ] **Step 1: Write the service**

```python
"""The Citations page (WP-76): one load per request (answers over the lookback, slots, units,
lookups) and the model's counting. One REPEATABLE READ snapshot per request, as the sources
lane, so a table and its `meta` agree while an answer is being ingested."""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, ClassVar
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from idraft.api.ai import citation_board_model as model
from idraft.api.ai import citation_board_repository as repository
from idraft.api.ai import source_repository
from idraft.api.ai.prompt_repository import terms_of
from idraft.api.ai.sources import shown_engines
from idraft.api.pagination import OffsetPageInfo, OffsetParams
from idraft.api.problems import NotFoundError, ProblemError
from idraft.api.schemas.ai_citation_board import (
    CitationGapDetail, CitationGapList, CitationGapsMeta, CitationOverview, CitedPageDetail,
    CitedPagePage, CitedPageRow, CitedPageSort, CitedPagesMeta, GapCompetitor, OwnerCounts,
    RunWindow,
)
from idraft.api.ranks.repository import project_zone
from idraft.api.workspaces.access import WorkspaceAccess
from idraft.db.engine import workspace_transaction
from idraft.domain.ai_engines import EngineCode


class CompetitorNotTrackedError(ProblemError):
    status, code, title = 422, "competitor_not_tracked", "Competitor is not tracked"


@dataclass(frozen=True, slots=True)
class BoardQuery:
    runs: int
    engine_codes: Sequence[EngineCode] | None
    term_id: UUID | None
    include_branded: bool
    excluded_flags: tuple[str, ...]
    competitor_ids: tuple[UUID, ...] = ()


@dataclass(frozen=True, slots=True)
class Loaded:
    board: model.Board
    engines: list[str]
    texts: dict[UUID, str]
    window: RunWindow


class CitationBoardService:
    SORT_KEYS: ClassVar[dict[str, Callable[[CitedPageRow], Any]]] = {
        "citations": lambda r: r.citations,
        "change": lambda r: r.citations - r.previous_citations,
        "prompts": lambda r: r.prompts,
        "last_cited": lambda r: r.last_cited_at,
        "page": lambda r: r.url,
    }

    def __init__(self, *, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    @asynccontextmanager
    async def _transaction(self, access: WorkspaceAccess) -> AsyncIterator[AsyncSession]:
        async with workspace_transaction(self._sessions, access.workspace_id, user_id=access.user_id, isolation_level="REPEATABLE READ") as db:
            await db.execute(text("SET LOCAL enable_nestloop = off"))
            yield db

    async def _load(self, db: AsyncSession, access: WorkspaceAccess, project_id: UUID, query: BoardQuery) -> Loaded:
        zone = await project_zone(db, access.workspace_id, project_id)
        if zone is None:
            raise NotFoundError
        engines = shown_engines(query.engine_codes)
        prompt_ids = await source_repository.scope_prompts(
            db, access.workspace_id, project_id, include_branded=query.include_branded, prompt_id=None, term_id=query.term_id, country_iso=None
        )
        now = datetime.now(UTC)
        scope = source_repository.SourceScope(
            workspace_id=access.workspace_id, project_id=project_id,
            since=now - timedelta(days=repository.LOOKBACK_DAYS), until=now + timedelta(seconds=1),
            engine_codes=tuple(engines), prompt_ids=prompt_ids, excluded_flags=query.excluded_flags,
        )
        answers = model.assign_slots(await repository.lookback_answers(db, scope) if prompt_ids else [])
        units = await repository.units_of(db, scope, answers)
        board = model.Board(runs=query.runs, answers=answers, units=units)
        texts = await repository.prompt_texts(db, access.workspace_id, {s.answer.prompt_id for s in answers})
        number = await repository.run_number(db, access.workspace_id, project_id, model.latest_run_id(board))
        return Loaded(board, engines, texts, model.run_window(board, timezone=zone.timezone, run_number=number))

    async def overview(self, access: WorkspaceAccess, project_id: UUID, query: BoardQuery) -> CitationOverview:
        async with self._transaction(access) as db:
            loaded = await self._load(db, access, project_id, query)
        result = model.overview(loaded.board, loaded.engines, timezone=loaded.window.timezone)
        return result.model_copy(update={"window": loaded.window})

    async def pages(
        self, access: WorkspaceAccess, project_id: UUID, query: BoardQuery, *,
        role: str | None, q: str | None, sort: CitedPageSort, page: OffsetParams,
    ) -> CitedPagePage:
        async with self._transaction(access) as db:
            loaded = await self._load(db, access, project_id, query)
            names = await self._names(db, access, project_id, loaded)
        rows = model.page_rows(loaded.board, loaded.engines, loaded.texts, names)
        owners = OwnerCounts(
            own=sum(r.domain_role == "own" for r in rows), competitor=sum(r.domain_role == "competitor" for r in rows),
            third_party=sum(r.domain_role == "third_party" for r in rows), all=len(rows),
        )
        needle = (q or "").casefold()
        kept = [r for r in rows if (role is None or r.domain_role == role) and (needle == "" or needle in r.url.casefold() or needle in (r.title or "").casefold())]
        key = self.SORT_KEYS[sort.lstrip("-")]
        # Ties: most citations first, then the address, so a page boundary never moves
        kept.sort(key=lambda r: r.url)
        kept.sort(key=lambda r: r.citations, reverse=True)
        kept.sort(key=key, reverse=sort.startswith("-"))
        return CitedPagePage(
            data=kept[page.offset : page.offset + page.limit],
            page=OffsetPageInfo(offset=page.offset, limit=page.limit, total=len(kept)),
            meta=CitedPagesMeta(window=loaded.window, owners=owners, citations=sum(r.citations for r in kept)),
        )

    async def page_detail(self, access: WorkspaceAccess, project_id: UUID, query: BoardQuery, url_id: int) -> CitedPageDetail:
        async with self._transaction(access) as db:
            loaded = await self._load(db, access, project_id, query)
            names = await self._names(db, access, project_id, loaded)
        detail = model.page_detail(loaded.board, url_id, loaded.engines, loaded.texts, names)
        if detail is None:
            raise NotFoundError
        return detail.model_copy(update={"window": loaded.window})

    async def gaps(self, access: WorkspaceAccess, project_id: UUID, query: BoardQuery) -> CitationGapList:
        async with self._transaction(access) as db:
            loaded = await self._load(db, access, project_id, query)
            competitors = await self._selected(db, access, project_id, query.competitor_ids)
            topics = await self._topics(db, access, loaded)
        rows = model.gap_rows(loaded.board, loaded.engines, query.competitor_ids, loaded.texts, {p: t[0] for p, t in topics.items() if t})
        return CitationGapList(
            data=rows,
            meta=CitationGapsMeta(window=loaded.window, competitors=competitors, prompts=len(rows), gaps=sum(r.gap > 0 for r in rows)),
        )

    async def gap_detail(self, access: WorkspaceAccess, project_id: UUID, query: BoardQuery, prompt_id: UUID) -> CitationGapDetail:
        async with self._transaction(access) as db:
            loaded = await self._load(db, access, project_id, query)
            await self._selected(db, access, project_id, query.competitor_ids)
            topics = await self._topics(db, access, loaded)
        detail = model.gap_detail(
            loaded.board, prompt_id, loaded.engines, query.competitor_ids, loaded.texts,
            {p: t[0] for p, t in topics.items() if t}, {p: [term for term, _ in t] for p, t in topics.items()},
        )
        if detail is None:
            raise NotFoundError
        return detail.model_copy(update={"window": loaded.window})

    async def _names(self, db: AsyncSession, access: WorkspaceAccess, project_id: UUID, loaded: Loaded) -> dict[UUID, tuple[str, int | None]]:
        ids = {u.entity_id for units in loaded.board.units.values() for u in units if u.entity_id is not None}
        return await repository.entity_names(db, access.workspace_id, project_id, ids)

    async def _selected(self, db: AsyncSession, access: WorkspaceAccess, project_id: UUID, ids: Sequence[UUID]) -> list[GapCompetitor]:
        tracked = {c.entity_id: c for c in await repository.tracked_competitors(db, access.workspace_id, project_id)}
        unknown = [str(i) for i in ids if i not in tracked]
        if unknown:
            raise CompetitorNotTrackedError(f"Not a tracked competitor of the project: {', '.join(unknown)}.", entity_ids=unknown)
        return [tracked[i] for i in ids]

    async def _topics(self, db: AsyncSession, access: WorkspaceAccess, loaded: Loaded) -> dict[UUID, list[tuple[UUID, str]]]:
        """Each prompt's topic terms in path order (D-1): only the `topic` vocabularies, so a market
        or product term is never the Group and never makes two prompts neighbours."""
        records = await terms_of(db, access.workspace_id, loaded.texts.keys())
        return {
            prompt: [(r.term_id, r.name) for r in rs if r.vocabulary_kind == "topic"]
            for prompt, rs in records.items()
        }
```

`prompt_repository.terms_of` returns `idraft.keywords.links.TermRecord` (`term_id`, `vocabulary_id`, `vocabulary_kind`, `name`, `path`, `is_single_valued`). `project_zone` returns `ProjectZone(timezone, deep_check_weekday)`.

- [ ] **Step 2: Type check and import contracts**

Run: `cd backend && uv run ruff check src/idraft/api/ai/citation_board.py && uv run ruff format src/idraft/api/ai/citation_board.py && uv run mypy src/idraft/api/ai/citation_board.py && uv run lint-imports`
Expected: no errors; `Contracts: N kept, 0 broken.`

- [ ] **Step 3: Commit**

```bash
git add backend/src/idraft/api/ai/citation_board.py
git commit -m "WP-76: Citations page service"
```

---

### Task 8: Routes, wiring, route tests

**Files:**
- Create: `backend/src/idraft/api/ai/citation_board_routes.py`
- Modify: `backend/src/idraft/api/resources.py:79` (lease), `backend/src/idraft/api/main.py:265` and `:336` (lease)
- Modify: `backend/tests/api/test_route_access.py` (the `EXPECTED` table, beside the sources routes near line 333)
- Test: `backend/tests/api/ai/test_citation_board_routes.py`

- [ ] **Step 1: Write the failing route tests**

Append (fixture `api`, `resources` and `migrated` are the suite's; see `test_sources_prompts.py`):

```python
from tests.api.entities.support import problem


async def _get(world: World, api: httpx.AsyncClient, *path: str, **params: object) -> httpx.Response:
    return await api.get(world.url("ai", *path), params=params, headers=world.owner.headers)


@pytest.fixture
async def two_runs(resources: Resources, migrated: PostgresServer) -> tuple[World, Prompt, Prompt]:
    """Prompt A: run 2 (1 day ago) cites the own page and the guide on ChatGPT and only the rival
    on Gemini; run 1 (8 days ago) cites the own page on ChatGPT. Prompt B: run 2 only, names the
    rival without a link."""
    world = await make_world(resources, migrated)
    a = await add_prompt(migrated, world.project, "Best managed SOC providers?")
    b = await add_prompt(migrated, world.project, "How much does a SOC cost?")
    r1, r2 = await make_run(migrated, world, days_ago=8), await make_run(migrated, world, days_ago=1)
    await run_answer(migrated, world, a, run=r2, days_ago=1, cites=[world.own_cite(), Cite(GUIDE)])
    await run_answer(migrated, world, a, run=r2, days_ago=1, engine="gemini_web", cites=[world.rival_cite()])
    await run_answer(migrated, world, a, run=r1, days_ago=8, cites=[world.own_cite()])
    await run_answer(migrated, world, b, run=r2, days_ago=1, mentions=[world.rival])
    return world, a, b


async def test_the_overview_counts_the_last_run_against_the_run_before(api: httpx.AsyncClient, two_runs: tuple[World, Prompt, Prompt]) -> None:
    world, _, _ = two_runs
    body = (await _get(world, api, "citation-overview", runs=1)).json()

    assert (body["citations"], body["previous_citations"]) == (1, 1)
    assert (body["matched_citations"], body["matched_previous_citations"]) == (1, 1)
    assert (body["own_urls"], body["domains"]) == (1, 3)
    assert body["window"]["answers"] == 3
    assert [s["slot"] for s in body["window"]["trend"]] == [2, 1]
    chatgpt = next(e for e in body["engines"] if e["engine_code"] == "chatgpt_web")
    assert (chatgpt["answers"], chatgpt["answers_citing"], chatgpt["prompts"], chatgpt["prompts_citing"]) == (2, 1, 2, 1)


async def test_cited_pages_filter_by_role_search_and_count_owners(api: httpx.AsyncClient, two_runs: tuple[World, Prompt, Prompt]) -> None:
    world, _, _ = two_runs
    body = (await _get(world, api, "cited-pages", runs=1, **{"filter[domain_role_in]": "own"})).json()

    (row,) = body["data"]
    assert (row["url"], row["citations"], row["previous_citations"], row["prompts"]) == (OWN, 1, 1, 1)
    assert body["meta"]["owners"] == {"own": 1, "competitor": 1, "third_party": 1, "all": 3}
    assert (await _get(world, api, "cited-pages", runs=1, q="guide.example")).json()["page"]["total"] == 1


async def test_the_gap_analysis_marks_the_gemini_loss(api: httpx.AsyncClient, two_runs: tuple[World, Prompt, Prompt]) -> None:
    world, a, b = two_runs
    body = (await _get(world, api, "citation-gaps", runs=1, **{"filter[competitor_id_in]": str(world.rival)})).json()

    rows = {row["prompt_id"]: row for row in body["data"]}
    assert rows[str(a.id)]["lost_on"] == ["gemini_web"]
    assert rows[str(b.id)]["competitors"][0]["total"]["state"] == "mentioned"
    assert (body["meta"]["prompts"], body["meta"]["gaps"]) == (2, 1)


async def test_an_untracked_competitor_is_refused(api: httpx.AsyncClient, two_runs: tuple[World, Prompt, Prompt]) -> None:
    world, _, _ = two_runs
    response = await _get(world, api, "citation-gaps", **{"filter[competitor_id_in]": str(world.own)})

    assert problem(response) == (422, "competitor_not_tracked")


async def test_a_page_not_cited_in_the_window_is_not_found(api: httpx.AsyncClient, two_runs: tuple[World, Prompt, Prompt]) -> None:
    world, _, _ = two_runs
    assert (await _get(world, api, "cited-pages", "999999999", runs=1)).status_code == 404


async def test_runs_other_than_1_2_or_4_are_refused(api: httpx.AsyncClient, two_runs: tuple[World, Prompt, Prompt]) -> None:
    world, _, _ = two_runs
    assert (await _get(world, api, "citation-overview", runs=3)).status_code == 422
```

`problem(response)` returns `(status, code)` as the sources tests use it (`NOT_FOUND = (404, "not_found")` in `test_sources_prompts.py`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/api/ai/test_citation_board_routes.py -n 0 --no-cov -q`
Expected: FAIL, 404 on every route (the router is not included).

- [ ] **Step 3: Write the routes**

```python
"""The Citations page (WP-76; the design preview's #/citations). Reading needs `data:read`."""

from __future__ import annotations

from dataclasses import replace
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Path, Query
from pydantic import AfterValidator

from idraft.api.ai.citation_board import BoardQuery, CitationBoardService
from idraft.api.ai.source_routes import PROJECT, Flags, ReadData
from idraft.api.pagination import Commas, Offset
from idraft.api.resources import Resources, get_resources
from idraft.api.schemas.ai_citation_board import (
    CitationGapDetail, CitationGapList, CitationOverview, CitedPageDetail, CitedPagePage, CitedPageSort,
)
from idraft.api.schemas.ai_sources import DomainRole
from idraft.api.schemas.common import printable
from idraft.domain.ai_engines import EngineCode

router = APIRouter(prefix=f"{PROJECT}/ai", tags=["ai"])


def get_board(resources: Annotated[Resources, Depends(get_resources)]) -> CitationBoardService:
    return resources.ai_citation_board


Board = Annotated[CitationBoardService, Depends(get_board)]


def _run_choice(value: int) -> int:
    if value not in (1, 2, 4):
        raise ValueError("runs is 1, 2 or 4")
    return value


def board_query(
    flags: Flags,
    runs: Annotated[int, AfterValidator(_run_choice), Query(description="Each prompt and engine's last 1, 2 or 4 runs.")] = 4,
    engine_codes: Annotated[list[EngineCode] | None, Commas, Query(alias="filter[engine_code_in]", max_length=3)] = None,
    term_id: Annotated[UUID | None, Query(alias="filter[term]", description="The prompts given the term or one under it.")] = None,
    include_branded: bool = False,
) -> BoardQuery:
    return BoardQuery(runs=runs, engine_codes=engine_codes, term_id=term_id, include_branded=include_branded, excluded_flags=flags)


Query_ = Annotated[BoardQuery, Depends(board_query)]
Competitors = Annotated[
    list[UUID], Commas,
    Query(alias="filter[competitor_id_in]", min_length=1, max_length=5, description="Up to five tracked competitors, the columns of the gap analysis."),
]

WINDOW = (
    "Counts each prompt and engine's last `runs` collection runs with a counted answer (slots 1 "
    "to `runs`) against the `runs` before them, over at most 183 days. A citation unit is a "
    "distinct canonical URL per answer (docs/16 C2); flagged citations are left out unless asked "
    "for. The answers are those of the sources routes: valid, current, not superseded, of the "
    "active non-branded prompts unless `include_branded`. "
)


@router.get("/citation-overview", summary="The six citation measures of the Citations page", description=WINDOW)
async def citation_overview(project_id: UUID, access: ReadData, board: Board, query: Query_) -> CitationOverview:
    return await board.overview(access, project_id, query)


@router.get(
    "/cited-pages", summary="Pages cited in AI answers, with the prompts behind each",
    description=WINDOW + "Offset pages. `meta.owners` counts the pages of each role whatever the filter and `q`.",
)
async def cited_pages(
    project_id: UUID, access: ReadData, board: Board, query: Query_, page: Offset,
    role: Annotated[DomainRole | None, Query(alias="filter[domain_role_in]")] = None,
    q: Annotated[Annotated[str, AfterValidator(printable)] | None, Query(max_length=200)] = None,
    sort: CitedPageSort = "-citations",
) -> CitedPagePage:
    return await board.pages(access, project_id, query, role=role, q=q, sort=sort, page=page)


@router.get("/cited-pages/{url_id}", summary="One cited page: its prompts, platforms and the domains cited beside it", description=WINDOW)
async def cited_page(project_id: UUID, access: ReadData, board: Board, query: Query_, url_id: Annotated[int, Path(ge=1)]) -> CitedPageDetail:
    return await board.page_detail(access, project_id, query, url_id)


@router.get(
    "/citation-gaps", summary="Citation gap analysis: you and up to five competitors per prompt",
    description=WINDOW + "A prompt is lost on an engine where a selected competitor is cited and you are not.",
)
async def citation_gaps(project_id: UUID, access: ReadData, board: Board, query: Query_, competitors: Competitors) -> CitationGapList:
    return await board.gaps(access, project_id, replace(query, competitor_ids=tuple(competitors)))


@router.get("/citation-gaps/{prompt_id}", summary="One prompt of the gap analysis", description=WINDOW)
async def citation_gap(project_id: UUID, access: ReadData, board: Board, query: Query_, competitors: Competitors, prompt_id: UUID) -> CitationGapDetail:
    return await board.gap_detail(access, project_id, replace(query, competitor_ids=tuple(competitors)), prompt_id)
```

The `role` parameter keeps the sources lane's alias with one value (the page filters one role or none). The problem responses need no declaration: the default problem response is added to every operation globally. The web never calls the gap routes with no competitor; `filter[competitor_id_in]` is required (1 to 5).

Wire it:
- `resources.py`, beside line 79: `ai_citation_board: CitationBoardService` (import from `idraft.api.ai.citation_board`).
- `main.py` beside line 265: `ai_citation_board=CitationBoardService(sessions=sessions),`; beside line 336: `app.include_router(ai_citation_board_router)` with `from idraft.api.ai.citation_board_routes import router as ai_citation_board_router` beside line 31.
- `test_route_access.py`: five entries, each `("GET", "/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/<path>"): ("data:read")` for `citation-overview`, `cited-pages`, `cited-pages/{url_id}`, `citation-gaps`, `citation-gaps/{prompt_id}`.

- [ ] **Step 4: Run the tests**

Run: `cd backend && uv run pytest tests/api/ai/test_citation_board_routes.py tests/api/ai/test_citation_board_model.py tests/api/test_route_access.py -n 0 --no-cov -q`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/idraft/api/ai/citation_board_routes.py backend/src/idraft/api/resources.py backend/src/idraft/api/main.py backend/tests/api/test_route_access.py backend/tests/api/ai/test_citation_board_routes.py
git commit -m "WP-76: Citations page routes"
```

---

### Task 9: A full project stays fast

**Files:**
- Test: `backend/tests/api/ai/test_citation_board_routes.py`

Read first: `tests/api/ai/sources_support.py` `full_project` (a project at its prompt limit) and the timing test of `test_sources.py` (`grep -n "time.perf_counter\|full_project" backend/tests/api/ai/test_sources*.py`).

- [ ] **Step 1: Write the test**

Follow the existing timing test: build `full_project`, give its answers run ids (eight runs, one per week, with `UPDATE ai.observations SET collection_run_id = ...` by `observed_date` week), then time `citation-overview`, `cited-pages` and `citation-gaps` (three tracked competitors: add two more competitor entities the way `make_world` adds the rival). Assert each answers 200 and under the same budget the sources timing test uses.

- [ ] **Step 2: Run it**

Run: `cd backend && uv run pytest tests/api/ai/test_citation_board_routes.py -k fast -n 0 --no-cov -q`
Expected: PASS. If it fails on time, profile `lookback_answers` with `EXPLAIN (ANALYZE)` in the test database before changing code; do not raise the budget.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/api/ai/test_citation_board_routes.py
git commit -m "WP-76: a full project's Citations reads stay inside the budget"
```

---

### Task 10: OpenAPI, as-built note, full checks

**Files:**
- Modify: `backend/openapi/v1.json`
- Modify: `docs/19-api-specification.md` (after the sources lane's as-built paragraph)

- [ ] **Step 1: Regenerate the document**

Run: `cd backend && uv run python -m idraft.api.openapi > openapi/v1.json && uv run pytest tests/api/test_openapi.py -n 0 --no-cov -q`
Expected: pass.

- [ ] **Step 2: Write the as-built note**

Add a paragraph **As built (WP-76, Citations page).** to docs/19 naming the five routes, the run slot rule (D-2), the 183 day lookback, growth over all answers with the matched counts beside it (D-3), the per-engine gap rule, the `competitor_not_tracked` problem, and that the rates are returned as counts for the client's equal-weight average. ASCII only, no dashes.

- [ ] **Step 3: Run the full backend checks**

```bash
colima status || colima start --cpu 10 --memory 16
export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock" TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock
cd backend && uv sync --frozen && ./check.sh
```

Expected: ruff, format, mypy, import contracts and pytest all green, coverage gate passed. Run through `infra/dev/heavy` when other sessions are running (MASTER-PLAN section 4).

- [ ] **Step 4: Commit, then regenerate the web client in its own commit**

```bash
git add backend/openapi/v1.json docs/19-api-specification.md
git commit -m "WP-76: OpenAPI and as-built note for the Citations page routes"
cd apps/web && pnpm gen:api && pnpm typecheck && pnpm vitest run src/lib/api
git add apps/web/src/lib/api/schema.ts
git commit -m "WP-76: regenerate the web API client"
```

- [ ] **Step 5: Final review and push**

A fresh Sonnet reviewer reads this plan, the package diff and the preview's `cit-data.js`, runs `./check.sh`, and confirms every counting rule above against the tests. Then `git fetch origin && git rebase origin/develop`, re-run the targeted tests, `git push origin HEAD:develop`. Never push `main`.

---

## Self-review

- Spec coverage: strip (Task 3), cited pages with prompts (Task 4, 8), page drawer (Task 4), gap rows and drawer (Task 5), runs filter (Task 2, 8), platforms and group filters (Task 8 `board_query`), competitors up to five (Task 8), gap count badge (`meta.gaps`), footer freshness and run number (`window.latest_answer_at`, `latest_run_number`), performance (Task 9).
- Review of 2026-11-17 (Sonnet, against the repo): import paths, the run status value, the test session pattern, the missing `Unit` import, the route's missing `prompt_id`, lint (B023, E402, ordering of format and check), the typing of casts and `SORT_KEYS`, topic-only terms and partitions are fixed above. Every hand-worked number in the tests was re-derived and holds.
