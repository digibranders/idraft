"""The Citations page model (WP-76): pure counting over hand-built answers, the numbers worked
out by hand. Mirrors apps/web/design-preview/cit-data.check.mjs."""

from __future__ import annotations

from collections.abc import Iterable
from datetime import UTC, datetime, timedelta
from uuid import UUID

from idraft.api.ai.citation_board_model import Answer, Board, assign_slots
from idraft.api.schemas.ai_citation_board import BrandCell, RunSlot

NOW = datetime(2026, 11, 16, 9, 0, tzinfo=UTC)
P1, P2 = UUID(int=1), UUID(int=2)


def test_a_brand_cell_states_its_counts() -> None:
    cell = BrandCell(cited=1, mentioned=2, answers=3, state="cited")

    assert cell.model_dump() == {"cited": 1, "mentioned": 2, "answers": 3, "state": "cited"}
    assert RunSlot.model_fields["slot"].metadata  # ge=1 is declared


def ans(
    oid: int,
    prompt: UUID,
    run: str,
    days: float,
    engine: str = "chatgpt_web",
    *,
    own_mentioned: bool = False,
    mentions: Iterable[UUID] = (),
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
        ans(1, P1, "r3", 1),
        ans(2, P1, "r2", 8),
        ans(3, P1, "r1", 15),
        # P2 was only asked in the latest run: its slot 1 is r3 too
        ans(4, P2, "r3", 1),
        # Gemini asked P1 in a manual run between r2 and r3: it is Gemini's slot 1
        ans(5, P1, "m1", 3, engine="gemini_web"),
        ans(6, P1, "r2", 8, engine="gemini_web"),
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
