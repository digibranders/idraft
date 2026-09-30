"""The part of the adapter contract that submitting work needs (docs/05-provider-integrations.md
section 3).

An adapter turns our requests into a provider's calls and its answers into these types. It never
touches the database or Redis; what an answer means for a task is decided by the ledger. The rest
of the contract (capabilities, readiness, fetching, normalizing) arrives with the first real
adapter.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import timedelta
from decimal import Decimal
from typing import Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field, SerializeAsAny

from sightline.domain.retries import ProviderErrorKind


class Contract(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class CanonicalRequest(Contract):
    # Our task's id, echoed back by the provider (DataForSEO: `tag`) so answers can be matched.
    task_id: str = Field(min_length=1)
    priority: Literal["standard", "high"]
    # What to ask, in the workload's own model. Serialized as that model: as the base class
    # it would be written as an empty object.
    params: SerializeAsAny[Contract]


class ProviderError(Contract):
    kind: ProviderErrorKind
    message: str
    provider_status: str | int | None = None
    # The wait the provider asked for, when it named one.
    retry_after: timedelta | None = Field(default=None, ge=timedelta(0))


class AcceptedTask(Contract):
    task_id: str = Field(min_length=1)
    provider_task_id: str = Field(min_length=1)
    # What `ops.collection_tasks.cost_usd` can hold. A negative cost would loosen a budget.
    cost_usd: Decimal | None = Field(default=None, ge=0, max_digits=14, decimal_places=6)


class RejectedTask(Contract):
    task_id: str = Field(min_length=1)
    error: ProviderError


class SubmitResult(Contract):
    """What became of each request of one call. A request named in neither list is one the
    provider may or may not have: its outcome is unknown."""

    accepted: tuple[AcceptedTask, ...] = ()
    rejected: tuple[RejectedTask, ...] = ()


class ProviderCallError(Exception):
    """The call as a whole failed, so no request in it was accepted. A timeout is the exception:
    the request may have arrived, and the adapter says so with the kind `timeout`."""

    def __init__(self, error: ProviderError) -> None:
        super().__init__(f"{error.kind}: {error.message}")
        self.error = error


class Provider(Protocol):
    @property
    def code(self) -> str: ...

    def batch_size(self, endpoint: str) -> int:
        """How many requests one call to this endpoint takes (DataForSEO task endpoints: 100)."""
        ...

    def result_lifetime(self, endpoint: str) -> timedelta:
        """How long the provider keeps a task's result (DataForSEO: 72 hours, 76 for LLM
        Responses standard tasks)."""
        ...

    async def submit(self, endpoint: str, requests: Sequence[CanonicalRequest]) -> SubmitResult:
        """Send the requests in one call. Raises `ProviderCallError` when the call failed."""
        ...
