"""The counting of the page drawer's AI tab: pure, no database."""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from datetime import UTC, date, datetime, timedelta
from itertools import count
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import pytest

from idraft.api.ai.citation_board_model import Answer, Unit
from idraft.api.internal_links.page_ai_model import (
    MissingPromptTextError,
    PageAiInput,
    citing_in_current,
    count_page_ai,
)
from idraft.api.schemas.internal_links_ai import ALONGSIDE_LIMIT, PROMPT_LIMIT, PageAi

PAGE = 1
ENGINES = ("chatgpt_web", "gemini_web", "google_ai_mode")
LABELS = {"chatgpt_web": "ChatGPT", "gemini_web": "Gemini", "google_ai_mode": "Google AI Mode"}
UTC_ZONE = ZoneInfo("UTC")
FIRST = date(2026, 11, 1)
LAST = date(2026, 11, 28)
_ids = count(1)


def at(day: date, hour: int = 12, minute: int = 0) -> datetime:
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=UTC)


def answer(
    when: datetime, prompt: UUID, engine: str = "chatgpt_web", observation_id: int | None = None
) -> Answer:
    obs = next(_ids) if observation_id is None else observation_id
    return Answer(
        observation_id=obs,
        observed_at=when,
        prompt_id=prompt,
        engine_code=engine,
        run_id=None,
        run_key=f"day:{when.date()}",
        own_mentioned=False,
        competitors_mentioned=frozenset(),
    )


def unit(
    observation_id: int, url_id: int, role: str = "third_party", url: str | None = None
) -> Unit:
    address = url or f"https://example.com/p{url_id}"
    return Unit(
        observation_id=observation_id,
        url_id=url_id,
        url=address,
        host="example.com",
        registrable_domain="example.com",
        path=f"/p{url_id}",
        title=None,
        domain_role=role,
        entity_id=None,
    )


def build(
    answers: Sequence[Answer],
    units: Iterable[Unit] = (),
    *,
    first: date = FIRST,
    last: date = LAST,
    previous: tuple[date, date] | None = None,
    zone: ZoneInfo = UTC_ZONE,
    prompts_in_scope: int = 1,
    citing: Iterable[int] | None = None,
) -> PageAiInput:
    by_obs: dict[int, list[Unit]] = {}
    for u in units:
        by_obs.setdefault(u.observation_id, []).append(u)
    cites = {obs for obs, us in by_obs.items() if any(u.url_id == PAGE for u in us)}
    return PageAiInput(
        url_id=PAGE,
        zone=zone,
        first=first,
        last=last,
        previous=previous,
        engines=ENGINES,
        labels=LABELS,
        answers=answers,
        citing=frozenset(cites if citing is None else citing),
        units=by_obs,
        prompts_in_scope=prompts_in_scope,
    )


def body(source: PageAiInput, texts: dict[UUID, str] | None = None) -> PageAi:
    counted = count_page_ai(source)
    prompt_texts = texts or {p: f"prompt {p}" for p in counted.prompt_ids}
    return counted.build(prompt_texts, frozenset())


def test_a_late_evening_answer_lands_on_its_local_day() -> None:
    prompt = uuid4()
    la = ZoneInfo("America/Los_Angeles")
    # 23:30 on 10 Nov in Los Angeles is 07:30 UTC on 11 Nov.
    when = datetime(2026, 11, 10, 23, 30, tzinfo=la)
    a = answer(when, prompt)
    result = body(build([a], [unit(a.observation_id, PAGE)], zone=la))
    by_day = {d.date: d for d in result.trend}
    assert by_day["2026-11-10"].answers_citing == 1
    assert by_day["2026-11-11"].answers_citing == 0
    assert result.window.timezone == "America/Los_Angeles"


def test_the_invariants_of_a_built_body() -> None:
    p1, p2 = uuid4(), uuid4()
    answers, units = [], []
    for index in range(6):
        a = answer(at(FIRST + timedelta(days=index)), p1 if index % 2 else p2, ENGINES[index % 3])
        answers.append(a)
        if index % 3 != 2:
            units += [unit(a.observation_id, PAGE), unit(a.observation_id, 7 + index)]
    other = answer(at(LAST), p1)
    answers.append(other)
    result = body(build(answers, units, prompts_in_scope=2))
    assert result.answers == 7
    assert result.answers_citing <= result.answers
    assert sum(d.answers_citing for d in result.trend) == result.answers_citing
    assert sum(d.answers for d in result.trend) == result.answers
    assert sum(p.answers_citing for p in result.platforms) == result.answers_citing
    assert len(result.trend) == result.days == 28
    assert all(p.answers_citing > 0 for p in result.prompts)
    for p in result.prompts:
        assert sum(x.answers for x in p.platforms) == p.answers
        assert sum(x.answers_citing for x in p.platforms) == p.answers_citing
    assert all(row.answers_shared <= result.answers_citing for row in result.alongside)
    assert PAGE not in {row.url_id for row in result.alongside}


def test_platforms_are_three_in_engine_order_and_zero_filled() -> None:
    prompt = uuid4()
    a = answer(at(FIRST), prompt, "gemini_web")
    result = body(build([a], [unit(a.observation_id, PAGE)]))
    assert [p.engine_code for p in result.platforms] == list(ENGINES)
    assert [p.label for p in result.platforms] == ["ChatGPT", "Gemini", "Google AI Mode"]
    assert [(p.answers, p.answers_citing) for p in result.platforms] == [(0, 0), (1, 1), (0, 0)]


def test_a_prompt_row_groups_its_answers_and_keeps_the_newest_citing_date() -> None:
    prompt = uuid4()
    first = answer(at(FIRST, 9), prompt, "chatgpt_web")
    second = answer(at(FIRST + timedelta(days=3), 9), prompt, "gemini_web")
    third = answer(at(FIRST + timedelta(days=5), 9), prompt, "chatgpt_web")
    uncited = answer(at(FIRST + timedelta(days=9), 9), prompt, "chatgpt_web")
    units = [unit(a.observation_id, PAGE) for a in (first, second, third)]
    result = body(build([first, second, third, uncited], units))
    (row,) = result.prompts
    assert (row.answers, row.answers_citing) == (4, 3)
    assert [(p.answers, p.answers_citing) for p in row.platforms] == [(3, 2), (1, 1), (0, 0)]
    assert row.last_cited_at == third.observed_at


def test_prompt_order_and_the_limit() -> None:
    prompts = sorted(uuid4() for _ in range(PROMPT_LIMIT + 1))
    answers, units = [], []
    for prompt in prompts:
        a = answer(at(FIRST + timedelta(days=1)), prompt)
        answers.append(a)
        units.append(unit(a.observation_id, PAGE))
    top = answer(at(FIRST + timedelta(days=2)), prompts[-1])
    answers.append(top)
    units.append(unit(top.observation_id, PAGE))
    newer = answer(at(FIRST + timedelta(days=7)), prompts[3])
    answers.append(newer)
    units.append(unit(newer.observation_id, PAGE))
    result = body(build(answers, units, prompts_in_scope=len(prompts)))
    assert len(result.prompts) == PROMPT_LIMIT
    assert result.prompts_total == PROMPT_LIMIT + 1
    # Two citing answers first, the newer one before the older one; then one each, newest, then id.
    assert [p.prompt_id for p in result.prompts[:2]] == [prompts[3], prompts[-1]]
    rest = result.prompts[2:]
    keys = [(-p.answers_citing, -p.last_cited_at.timestamp(), str(p.prompt_id)) for p in rest]
    assert keys == sorted(keys)


def test_alongside_counts_distinct_answers_and_orders_rows() -> None:
    prompt = uuid4()
    a1 = answer(at(FIRST), prompt)
    a2 = answer(at(FIRST + timedelta(days=1)), prompt)
    units = [
        unit(a1.observation_id, PAGE),
        unit(a1.observation_id, 5),
        unit(a1.observation_id, 5),  # cited twice in one answer, counted once
        unit(a1.observation_id, 6),
        unit(a2.observation_id, PAGE),
        unit(a2.observation_id, 6),
        unit(a2.observation_id, 9, url="https://example.com/a"),
        unit(a2.observation_id, 8, url="https://example.com/a"),
    ]
    result = body(build([a1, a2], units))
    rows = [(r.url_id, r.answers_shared) for r in result.alongside]
    # 6 is shared twice; the one-answer rows follow by url (".../a" before ".../p5"), then url id.
    assert rows == [(6, 2), (8, 1), (9, 1), (5, 1)]


def test_alongside_limit_and_total() -> None:
    prompt = uuid4()
    a = answer(at(FIRST), prompt)
    units = [unit(a.observation_id, PAGE)]
    units += [unit(a.observation_id, 100 + n) for n in range(ALONGSIDE_LIMIT + 1)]
    result = body(build([a], units))
    assert len(result.alongside) == ALONGSIDE_LIMIT
    assert result.alongside_total == ALONGSIDE_LIMIT + 1


def test_own_urls_and_in_crawl() -> None:
    prompt = uuid4()
    a = answer(at(FIRST), prompt)
    units = [
        unit(a.observation_id, PAGE),
        unit(a.observation_id, 20, "own"),
        unit(a.observation_id, 21, "own"),
        unit(a.observation_id, 30, "competitor"),
    ]
    counted = count_page_ai(build([a], units))
    assert sorted(counted.own_urls) == [20, 21]
    result = counted.build({prompt: "q"}, frozenset({20, 30}))
    flags = {r.url_id: r.in_crawl for r in result.alongside}
    assert flags == {20: True, 21: False, 30: False}


def test_states() -> None:
    prompt = uuid4()
    assert body(build([], prompts_in_scope=0)).state == "no_prompts"
    assert body(build([], prompts_in_scope=3)).state == "no_answers"
    outside = answer(at(FIRST - timedelta(days=2)), prompt)
    assert body(build([outside], prompts_in_scope=1)).state == "no_answers"
    plain = answer(at(FIRST), prompt)
    ready = body(build([plain], [unit(plain.observation_id, 4)]))
    assert ready.state == "ready"
    assert (ready.answers, ready.answers_citing, ready.prompts, ready.alongside) == (1, 0, [], [])


def test_compare_counts_the_compared_days_only() -> None:
    prompt = uuid4()
    previous = (date(2026, 10, 4), date(2026, 10, 31))
    now = answer(at(FIRST), prompt, "chatgpt_web")
    before = answer(at(date(2026, 10, 10)), prompt, "chatgpt_web")
    before_uncited = answer(at(date(2026, 10, 11)), prompt, "gemini_web")
    too_old = answer(at(date(2026, 9, 1)), prompt, "chatgpt_web")
    units = [unit(now.observation_id, PAGE), unit(before.observation_id, PAGE)]
    units.append(unit(too_old.observation_id, PAGE))
    result = body(build([now, before, before_uncited, too_old], units, previous=previous))
    assert (result.answers, result.answers_citing) == (1, 1)
    assert (result.previous_answers, result.previous_answers_citing) == (2, 1)
    assert [p.previous_answers_citing for p in result.platforms] == [1, 0, 0]
    assert result.compare_window is not None
    assert (result.compare_window.from_, result.compare_window.to) == ("2026-10-04", "2026-10-31")
    assert [p.prompt_id for p in result.prompts] == [prompt]
    assert result.prompts[0].answers == 1


def test_without_a_compared_period_the_previous_fields_are_null() -> None:
    prompt = uuid4()
    a = answer(at(FIRST), prompt)
    result = body(build([a], [unit(a.observation_id, PAGE)]))
    assert result.compare_window is None
    assert result.previous_answers is None
    assert result.previous_answers_citing is None
    assert all(p.previous_answers_citing is None for p in result.platforms)


def test_empty_days_are_zero_points_and_the_period_length_sets_the_points() -> None:
    prompt = uuid4()
    a = answer(at(FIRST + timedelta(days=2)), prompt)
    result = body(build([a], [unit(a.observation_id, PAGE)]))
    assert [d.answers for d in result.trend[:4]] == [0, 0, 1, 0]
    one = body(build([], first=LAST, last=LAST, prompts_in_scope=1))
    assert len(one.trend) == one.days == 1
    long = body(build([], first=LAST - timedelta(days=91), last=LAST, prompts_in_scope=1))
    assert len(long.trend) == long.days == 92


def test_an_answer_on_an_engine_outside_the_list_is_not_counted() -> None:
    prompt = uuid4()
    shown = answer(at(FIRST), prompt, "chatgpt_web")
    hidden = answer(at(FIRST), prompt, "google_ai_overview")
    units = [unit(a.observation_id, PAGE) for a in (shown, hidden)]
    units.append(unit(hidden.observation_id, 9))
    source = build([shown, hidden], units)
    assert [a.observation_id for a in citing_in_current(source)] == [shown.observation_id]
    result = body(source)
    assert (result.answers, result.answers_citing) == (1, 1)
    assert sum(d.answers for d in result.trend) == 1
    assert result.prompts[0].answers == 1
    assert result.alongside == []


def test_the_period_edges_are_whole_local_days() -> None:
    prompt = uuid4()
    previous = (date(2026, 10, 4), date(2026, 10, 31))
    inside = [
        answer(at(FIRST, 0, 0), prompt),
        answer(at(LAST, 23, 59), prompt),
        answer(at(previous[0], 0, 0), prompt),
        answer(at(previous[1], 23, 59), prompt),
    ]
    outside = [
        answer(at(LAST + timedelta(days=1), 0, 0), prompt),
        answer(at(previous[0] - timedelta(days=1), 23, 59), prompt),
    ]
    result = body(build(inside + outside, previous=previous))
    assert (result.answers, result.previous_answers) == (2, 2)
    by_day = {d.date: d.answers for d in result.trend}
    assert (by_day["2026-11-01"], by_day["2026-11-28"]) == (1, 1)
    assert sum(by_day.values()) == 2


def test_alongside_ignores_units_of_a_compared_period_answer() -> None:
    prompt = uuid4()
    previous = (date(2026, 10, 4), date(2026, 10, 31))
    now = answer(at(FIRST), prompt)
    before = answer(at(date(2026, 10, 10)), prompt)
    units = [
        unit(now.observation_id, PAGE),
        unit(now.observation_id, 51),
        unit(before.observation_id, PAGE),
        unit(before.observation_id, 50),
    ]
    result = body(build([now, before], units, previous=previous))
    assert [(r.url_id, r.answers_shared) for r in result.alongside] == [(51, 1)]
    assert result.alongside_total == 1


def test_a_missing_prompt_text_is_an_error_not_a_blank() -> None:
    prompt = uuid4()
    a = answer(at(FIRST), prompt)
    counted = count_page_ai(build([a], [unit(a.observation_id, PAGE)]))
    with pytest.raises(MissingPromptTextError, match=str(prompt)):
        counted.build({}, frozenset())


def test_citing_in_current_keeps_only_the_current_period() -> None:
    prompt = uuid4()
    previous = (date(2026, 10, 4), date(2026, 10, 31))
    now = answer(at(FIRST), prompt)
    before = answer(at(date(2026, 10, 10)), prompt)
    uncited = answer(at(FIRST + timedelta(days=1)), prompt)
    units = [unit(now.observation_id, PAGE), unit(before.observation_id, PAGE)]
    source = build([now, before, uncited], units, previous=previous)
    assert [a.observation_id for a in citing_in_current(source)] == [now.observation_id]
