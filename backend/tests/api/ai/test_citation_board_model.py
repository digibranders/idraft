"""The Citations page model (WP-76): pure counting over hand-built answers, the numbers worked
out by hand. Mirrors apps/web/design-preview/cit-data.check.mjs."""

from __future__ import annotations

from collections.abc import Iterable
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest

from idraft.api.ai.citation_board_model import (
    Answer,
    Board,
    Names,
    Unit,
    assign_slots,
    gap_detail,
    gap_rows,
    overview,
    page_detail,
    page_rows,
    role_of,
    run_window,
)
from idraft.api.schemas.ai_citation_board import BrandCell, RunSlot

NOW = datetime(2026, 11, 16, 9, 0, tzinfo=UTC)
P1, P2 = UUID(int=1), UUID(int=2)
RIVAL_1, RIVAL_2 = UUID(int=11), UUID(int=12)
OWN_A = "https://own.example/a"
TEXTS = {P1: "Best SOC providers?", P2: "SOC pricing?"}
NAMES: Names = {}


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


def unit(
    oid: int,
    url: str,
    role: str = "own",
    entity: UUID | None = None,
    *,
    url_id: int,
) -> Unit:
    host = url.split("/")[2]
    path = "/" + url.split("/", 3)[-1]
    return Unit(oid, url_id, url, host, host, path, None, role, entity)


def board(runs: int, answers: list[Answer], units: list[Unit]) -> Board:
    by_answer: dict[int, list[Unit]] = {}
    for u in units:
        by_answer.setdefault(u.observation_id, []).append(u)
    return Board(runs=runs, answers=assign_slots(answers), units=by_answer)


def test_the_strip_counts_own_units_rates_per_engine_and_matched_growth() -> None:
    # P1 ChatGPT: r2 (now) cites own twice, r1 (before) once. P2 ChatGPT: only r2, cites own once.
    # P1 Gemini: r2 cites nothing, r1 cites own. Runs = 1.
    answers = [
        ans(1, P1, "r2", 1),
        ans(2, P1, "r1", 8),
        ans(3, P2, "r2", 1),
        ans(4, P1, "r2", 1, engine="gemini_web"),
        ans(5, P1, "r1", 8, engine="gemini_web"),
    ]
    units = [
        unit(1, OWN_A, url_id=1),
        unit(1, "https://own.example/b", url_id=2),
        unit(1, "https://g2.com/x", "third_party", url_id=3),
        unit(2, OWN_A, url_id=1),
        unit(3, OWN_A, url_id=1),
        unit(5, OWN_A, url_id=1),
    ]

    result = overview(board(1, answers, units), ["chatgpt_web", "gemini_web"], timezone="UTC")

    assert (result.citations, result.previous_citations) == (3, 2)
    # Matched pairs: P1 ChatGPT and P1 Gemini (P2 has no previous run)
    matched = (result.matched_citations, result.matched_previous_citations, result.matched_pairs)
    assert matched == (2, 2, 2)
    chatgpt, gemini = result.engines
    now = (chatgpt.answers, chatgpt.answers_citing, chatgpt.prompts, chatgpt.prompts_citing)
    assert now == (2, 2, 2, 2)
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
    assert (window.answers, window.prompts, window.latest_answer_at) == (
        2,
        2,
        NOW - timedelta(days=1),
    )


def test_a_page_row_counts_units_prompts_engines_and_trend() -> None:
    # Url 1 is cited in every answer: slot 1 holds three answers, slot 2 (P1 ChatGPT, 8 days) one
    answers = [
        ans(1, P1, "r2", 1),
        ans(2, P2, "r2", 1),
        ans(3, P1, "r1", 8),
        ans(4, P1, "r2", 1, engine="gemini_web"),
    ]
    units = [unit(oid, OWN_A, url_id=1) for oid in (1, 2, 3, 4)]

    (row,) = page_rows(board(1, answers, units), ["chatgpt_web", "gemini_web"], TEXTS, NAMES)

    assert (row.citations, row.previous_citations, row.prompts) == (3, 1, 2)
    assert [(e.engine_code, e.citation_units) for e in row.engines] == [
        ("chatgpt_web", 2),
        ("gemini_web", 1),
    ]
    assert [(p.text, p.citations) for p in row.top_prompts] == [
        ("Best SOC providers?", 2),
        ("SOC pricing?", 1),
    ]
    assert row.trend == [1, 3]
    assert row.last_cited_at == NOW - timedelta(days=1)


def test_the_page_drawer_lists_prompts_with_cited_over_answers_and_alongside_domains() -> None:
    # Answers 1 and 2 are replicates of one run of P1; only answer 1 cites url 1
    answers = [ans(1, P1, "r2", 1), ans(2, P1, "r2", 1.1), ans(3, P2, "r2", 1)]
    units = [
        unit(1, OWN_A, url_id=1),
        unit(1, "https://g2.com/x", "third_party", url_id=3),
        unit(1, "https://g2.com/y", "third_party", url_id=4),
        unit(3, OWN_A, url_id=1),
    ]

    detail = page_detail(board(1, answers, units), 1, ["chatgpt_web"], TEXTS, NAMES)

    assert detail is not None
    assert [(p.text, p.cited, p.answers) for p in detail.prompts] == [
        ("Best SOC providers?", 1, 2),
        ("SOC pricing?", 1, 1),
    ]
    # g2.com is listed once for the answer that holds two of its URLs
    assert [(a.registrable_domain, a.answers) for a in detail.alongside] == [("g2.com", 1)]


def test_a_page_that_is_not_cited_now_has_no_drawer() -> None:
    answers = [ans(1, P1, "r2", 1), ans(2, P1, "r1", 8)]

    assert page_detail(board(1, answers, [unit(2, OWN_A, url_id=1)]), 1, [], TEXTS, NAMES) is None


def test_role_of_narrows_a_known_role_and_rejects_others() -> None:
    assert role_of("competitor") == "competitor"
    with pytest.raises(ValueError, match="watch"):
        role_of("watch")


def test_a_prompt_is_lost_per_engine_where_a_competitor_is_cited_and_you_are_not() -> None:
    answers = [
        ans(1, P1, "r1", 1),
        ans(2, P1, "r1", 1, engine="gemini_web"),
        ans(3, P2, "r1", 1, mentions={RIVAL_2}),
    ]
    units = [
        unit(1, OWN_A, url_id=1),  # ChatGPT: you are cited
        unit(2, "https://rival.example/soc", "competitor", RIVAL_1, url_id=5),  # Gemini: the rival
    ]

    rows = {
        r.prompt_id: r
        for r in gap_rows(
            board(1, answers, units), ["chatgpt_web", "gemini_web"], [RIVAL_1, RIVAL_2], TEXTS, {}
        )
    }

    p1 = rows[P1]
    assert (p1.lost_on, p1.lost_to, p1.gap) == (["gemini_web"], [RIVAL_1], 1)
    assert (p1.you.total.state, p1.you.cited_on, p1.you.platforms) == ("cited", 1, 2)
    assert p1.competitors[0].total.state == "cited"
    p2 = rows[P2]
    assert p2.gap == 0
    # Named but never linked is a mention, not a citation
    assert p2.competitors[1].total.state == "mentioned"
    assert [e.state for e in p2.you.engines] == ["not", "none"]


def test_a_competitor_that_is_not_selected_never_makes_a_gap() -> None:
    answers = [ans(1, P1, "r1", 1)]
    units = [unit(1, "https://rival.example/soc", "competitor", RIVAL_2, url_id=5)]

    (row,) = gap_rows(board(1, answers, units), ["chatgpt_web"], [RIVAL_1], TEXTS, {})

    assert (row.gap, row.lost_on, row.lost_to, row.competitor_answers) == (0, [], [], 0)
    assert row.competitors[0].total.state == "not"


def test_gap_rows_sort_by_engines_lost_then_competitors_then_citations_then_text() -> None:
    p3, p4 = UUID(int=3), UUID(int=4)
    texts = {P1: "m", P2: "n", p3: "z", p4: "a"}
    answers = [
        ans(1, P1, "r1", 1),
        ans(2, P1, "r1", 1, engine="gemini_web"),
        ans(3, P2, "r1", 1),
        # Two replicates of one run: P3 has the rival cited twice, P4 once
        ans(4, p3, "r1", 1),
        ans(5, p3, "r1", 1.1),
        ans(6, p4, "r1", 1),
    ]
    rival = "https://rival.example/soc"
    units = [
        unit(1, rival, "competitor", RIVAL_1, url_id=5),
        unit(2, rival, "competitor", RIVAL_1, url_id=5),
        unit(3, rival, "competitor", RIVAL_1, url_id=5),
        unit(3, "https://other.example/x", "competitor", RIVAL_2, url_id=6),
        unit(4, rival, "competitor", RIVAL_1, url_id=5),
        unit(5, rival, "competitor", RIVAL_1, url_id=5),
        unit(6, rival, "competitor", RIVAL_1, url_id=5),
    ]

    rows = gap_rows(
        board(1, answers, units), ["chatgpt_web", "gemini_web"], [RIVAL_1, RIVAL_2], texts, {}
    )

    # P1 loses two engines; P2 loses one to two rivals; P3 and P4 lose one to one rival, P3 with
    # more citations (the text "a" would put P4 first if it came earlier in the key)
    assert [r.prompt_id for r in rows] == [P1, P2, p3, p4]
    assert [(r.gap, len(r.lost_to), r.competitor_answers) for r in rows] == [
        (2, 1, 2),
        (1, 2, 2),
        (1, 1, 2),
        (1, 1, 1),
    ]


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
    assert [(p.url, p.citations) for p in detail.competitor_pages] == [
        ("https://rival.example/soc", 1)
    ]
    assert detail.own_pages == []
    assert [p.url for p in detail.closest_pages] == [OWN_A]
    assert [p.url for p in detail.third_party_pages] == ["https://g2.com/x"]


def test_the_gap_drawer_has_no_closest_pages_without_a_term_and_none_without_an_answer() -> None:
    answers = [ans(1, P1, "r1", 1), ans(2, P2, "r1", 1)]
    units = [unit(2, OWN_A, url_id=1)]
    gap_board = board(1, answers, units)

    detail = gap_detail(gap_board, P1, ["chatgpt_web"], [RIVAL_1], TEXTS, {}, {P2: [UUID(int=99)]})

    assert detail is not None
    assert detail.closest_pages == []
    assert gap_detail(gap_board, UUID(int=77), ["chatgpt_web"], [RIVAL_1], TEXTS, {}, {}) is None
