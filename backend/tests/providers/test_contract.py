"""The provider contract's own rules (docs/05-provider-integrations.md section 3)."""

import uuid
from decimal import Decimal

import pytest
from pydantic import ValidationError

from sightline.providers.contract import Echo, FetchResult, ReadyTask, SubmittedTask

RUN = uuid.UUID("0192f0a1-3c44-7e10-8a51-2b7d9c0e4f11")


def test_an_echo_names_a_task_only_with_its_run() -> None:
    echo = Echo(task_id="42", run_prefix="0192f0a1")

    assert echo.names(42, RUN)
    assert not echo.names(43, RUN)
    assert not echo.names(42, uuid.uuid4())
    # An echo with no run part names nothing: the check is what makes a tag trusted.
    assert not Echo(task_id="42").names(42, RUN)
    assert not Echo().names(42, RUN)


@pytest.mark.parametrize("prefix", ["", "0192F0A1", "xyz", "0" * 33])
def test_a_run_prefix_is_lower_case_hex(prefix: str) -> None:
    with pytest.raises(ValidationError):
        Echo(task_id="1", run_prefix=prefix)


def test_a_result_keeps_the_exact_bytes() -> None:
    body = b'{"tasks": [{"result": []}]}\n\x00'
    result = FetchResult(provider_task_id="p-1", status="ready", body=body)

    assert result.body == body
    assert result.content_type == "application/json"


@pytest.mark.parametrize("cost", ["-0.01", "1e20", "0.0000001"])
def test_a_cost_the_ledger_cannot_hold_is_refused_everywhere(cost: str) -> None:
    for model in (FetchResult, SubmittedTask):
        fields: dict[str, object] = {"provider_task_id": "p-1", "cost_usd": cost}
        if model is FetchResult:
            fields["status"] = "ready"
        with pytest.raises(ValidationError):
            model.model_validate(fields)


def test_a_listed_task_needs_a_provider_id() -> None:
    with pytest.raises(ValidationError):
        ReadyTask(provider_task_id="")
    assert SubmittedTask(provider_task_id="p", cost_usd=Decimal("0.0006")).echo == Echo()
