"""The helpers the Phase 0 test runs share: nothing is sent past the cap, and the figures they
report are computed right. No network."""

from __future__ import annotations

import time
from datetime import timedelta
from decimal import Decimal

import pytest

from sightline.providers.contract import Limit
from spikes.common import (
    Budget,
    LocalGate,
    SpendError,
    first_result,
    percentile,
    task_cost,
    wilson,
    worst_case,
)


def test_a_task_is_estimated_at_its_dearest() -> None:
    assert worst_case(10, async_overview=False) == Decimal("0.0006")
    assert worst_case(20, async_overview=False) == Decimal("0.0012")
    assert worst_case(100, async_overview=False) == Decimal("0.0060")
    # The multiplier reading of the async AI Overview surcharge, the dearer one.
    assert worst_case(100, async_overview=True) == Decimal("0.0120")
    assert worst_case(15, async_overview=False) == Decimal("0.0012")


def test_nothing_is_sent_past_the_cap() -> None:
    budget = Budget(cap=Decimal("1.00"))
    budget.allow(Decimal("1.00"))
    budget.charge(Decimal("0.60"), fallback=Decimal("9"))
    budget.charge(None, fallback=Decimal("0.30"))

    assert budget.spent == Decimal("0.90")
    with pytest.raises(SpendError, match="over the cap"):
        budget.allow(Decimal("0.11"))


def test_the_wilson_interval_holds_the_share() -> None:
    low, high = wilson(50, 100)

    assert low == pytest.approx(0.4038, abs=1e-4)
    assert high == pytest.approx(0.5962, abs=1e-4)
    assert wilson(0, 10)[0] == pytest.approx(0.0, abs=1e-12)


def test_a_percentile_is_a_value_that_was_seen() -> None:
    values = [float(value) for value in range(1, 101)]

    assert percentile(values, 0.95) == 95.0
    assert percentile([3.0], 0.95) == 3.0


def test_an_answer_is_read_for_its_first_result_and_cost() -> None:
    body = {"tasks": [{"cost": 0.0012, "result": [{"items": [{"type": "organic"}]}]}]}

    assert first_result(body) == {"items": [{"type": "organic"}]}
    assert task_cost(body) == Decimal("0.0012")
    assert first_result(None) == {}
    assert task_cost({"tasks": [{}]}) is None


async def test_the_local_gate_spaces_calls_and_refuses_what_would_wait_too_long() -> None:
    gate = LocalGate(Limit(per_minute=1200, burst=1), {"id_list": Limit(per_minute=600, burst=1)})

    started = time.monotonic()
    assert await gate.enter("id_list", within=timedelta(seconds=1))
    assert await gate.enter("id_list", within=timedelta(seconds=1))
    # One call every tenth of a second for this family.
    assert time.monotonic() - started >= 0.09
    assert not await gate.enter("id_list", within=timedelta(0))
