"""The helpers of routes whose contract is published before their body (idraft.api.stubs)."""

from __future__ import annotations

import pytest

from idraft.api.problems import NotImplementedProblemError
from idraft.api.stubs import is_not_built, not_built, not_built_yet, refuse_unbuilt


def test_a_marked_endpoint_is_the_same_function_and_says_so() -> None:
    async def endpoint() -> None: ...

    assert not is_not_built(endpoint)
    assert not_built(endpoint) is endpoint
    assert is_not_built(endpoint)


def test_nothing_new_sent_is_no_error() -> None:
    refuse_unbuilt({"compare": False, "rows": False})
    refuse_unbuilt({})


def test_what_was_sent_is_named_in_order() -> None:
    with pytest.raises(NotImplementedProblemError) as caught:
        refuse_unbuilt({"rows": True, "compare": False, "group_by": True})
    assert caught.value.detail == "Not built yet: rows, group_by."
    assert (caught.value.status, caught.value.problem_code) == (501, "not_implemented")


def test_a_stub_says_its_contract_is_published() -> None:
    assert not_built_yet().detail == (
        "This route's contract is published; its body is not built yet."
    )
