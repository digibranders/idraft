"""The provider contract's own rules (docs/05-provider-integrations.md section 3)."""

import uuid
from decimal import Decimal

import pytest
from pydantic import ValidationError

from idraft.domain.retries import ProviderErrorKind
from idraft.providers.contract import (
    Echo,
    FetchResult,
    ProviderError,
    ReadyTask,
    SubmittedTask,
)

RUN = uuid.UUID("0192f0a1-3c44-7e10-8a51-2b7d9c0e4f11")
EXPIRED = ProviderError(kind=ProviderErrorKind.NOT_FOUND_EXPIRED, message="gone")


def test_an_echo_names_one_attempt_at_one_task_of_one_run() -> None:
    echo = Echo(task_id="42", run_id=RUN, attempt=1)

    assert echo.names(42, RUN, 1)
    assert not echo.names(43, RUN, 1)
    assert not echo.names(42, uuid.uuid4(), 1)
    assert not echo.names(42, RUN, 2)
    # An echo that is missing a part names nothing: each part is a check.
    assert not Echo(task_id="42", run_id=RUN).names(42, RUN, 1)
    assert not Echo().names(42, RUN, 1)


def test_a_result_keeps_the_exact_bytes() -> None:
    body = b'{"tasks": [{"result": []}]}\n\x00'
    result = FetchResult(provider_task_id="p-1", status="ready", body=body)

    assert result.body == body
    assert result.content_type == "application/json"


def test_a_body_given_as_text_is_refused() -> None:
    """Encoded again, it would no longer be what the provider sent."""
    with pytest.raises(ValidationError):
        FetchResult.model_validate(
            {"provider_task_id": "p-1", "status": "ready", "body": '{"tasks": []}'}
        )


@pytest.mark.parametrize(
    "fields",
    [
        {"status": "ready"},
        {"status": "ready", "body": b"{}", "error": EXPIRED},
        {"status": "expired"},
        {"status": "failed", "body": b"{}"},
        {"status": "pending", "body": b"{}"},
        {"status": "pending", "error": EXPIRED},
    ],
)
def test_a_result_says_one_thing(fields: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        FetchResult.model_validate({"provider_task_id": "p-1", **fields})


def test_the_states_a_result_can_have() -> None:
    assert FetchResult(provider_task_id="p", status="pending").body is None
    assert FetchResult(provider_task_id="p", status="expired", error=EXPIRED).error == EXPIRED


@pytest.mark.parametrize("cost", ["-0.01", "1e20", "0.0000001"])
def test_a_cost_the_ledger_cannot_hold_is_refused_everywhere(cost: str) -> None:
    with pytest.raises(ValidationError):
        FetchResult.model_validate(
            {"provider_task_id": "p", "status": "ready", "body": b"{}", "cost_usd": cost}
        )
    with pytest.raises(ValidationError):
        SubmittedTask.model_validate({"provider_task_id": "p", "cost_usd": cost})


def test_a_listed_task_needs_a_provider_id() -> None:
    with pytest.raises(ValidationError):
        ReadyTask(provider_task_id="")
    assert SubmittedTask(provider_task_id="p", cost_usd=Decimal("0.0006")).echo == Echo()
