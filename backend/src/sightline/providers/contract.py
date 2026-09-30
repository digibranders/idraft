"""The part of the adapter contract that submitting and fetching work need
(docs/05-provider-integrations.md section 3).

An adapter turns our requests into a provider's calls and its answers into these types. It never
touches the database or Redis; what an answer means for a task is decided by the ledger.
Normalizing a result into facts arrives with the first workload that ingests them.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Annotated, Literal, Protocol
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, SerializeAsAny

from sightline.domain.retries import ProviderErrorKind


class Contract(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class CanonicalRequest(Contract):
    # Our task's id and its run's, echoed back by the provider (DataForSEO: `tag`) so answers
    # can be matched to the task, and checked against its run.
    task_id: str = Field(min_length=1)
    run_id: UUID
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


# What `ops.collection_tasks.cost_usd` can hold. A negative cost would loosen a budget.
CostUsd = Annotated[Decimal, Field(ge=0, max_digits=14, decimal_places=6)]


class AcceptedTask(Contract):
    task_id: str = Field(min_length=1)
    provider_task_id: str = Field(min_length=1)
    cost_usd: CostUsd | None = None


class Echo(Contract):
    """What of our request a provider echoes back: the task's id, and as much of its run's id
    as the provider could carry (the start of its hex digits). None when the provider sent
    nothing we recognise."""

    task_id: str | None = None
    run_prefix: str | None = Field(default=None, pattern=r"^[0-9a-f]{1,32}$")

    def names(self, task_id: int, run_id: UUID) -> bool:
        """Whether this echo is of that task, and of its run."""
        return (
            self.task_id == str(task_id)
            and self.run_prefix is not None
            and run_id.hex.startswith(self.run_prefix)
        )


class ReadyTask(Contract):
    """A task the provider has finished, as its readiness list names it."""

    provider_task_id: str = Field(min_length=1)
    echo: Echo = Echo()


class SubmittedTask(Contract):
    """A task the provider holds, as its list of posted tasks names it."""

    provider_task_id: str = Field(min_length=1)
    echo: Echo = Echo()
    posted_at: datetime | None = None
    cost_usd: CostUsd | None = None


class FetchResult(Contract):
    """One task's result. `body` is the response exactly as received, for storage: what the
    facts are read from, now and after a parser is fixed."""

    provider_task_id: str = Field(min_length=1)
    status: Literal["ready", "pending", "expired", "failed"]
    body: bytes | None = None
    content_type: str = "application/json"
    cost_usd: CostUsd | None = None
    error: ProviderError | None = None


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

    async def list_ready(self, endpoint: str) -> Sequence[ReadyTask]:
        """The tasks of this endpoint that are finished and not yet fetched."""
        ...

    async def fetch(self, endpoint: str, provider_task_id: str) -> FetchResult:
        """One task's result. Raises `ProviderCallError` when the call failed."""
        ...

    @property
    def lists_submissions(self) -> bool:
        """Whether `find_submitted` can say which tasks the provider holds."""
        ...

    async def find_submitted(
        self, endpoint: str, since: datetime, until: datetime
    ) -> Sequence[SubmittedTask]:
        """The tasks posted to this endpoint in the period, with our tags, so a submission of
        unknown outcome can be found."""
        ...
