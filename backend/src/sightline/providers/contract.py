"""The part of the adapter contract that submitting and fetching work need
(docs/05-provider-integrations.md section 3).

An adapter turns our requests into a provider's calls and its answers into these types. It never
touches the database or Redis; what an answer means for a task is decided by the ledger.
Normalizing a result into facts arrives with the first workload that ingests them.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Annotated, Literal, Protocol, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, SerializeAsAny, model_validator

from sightline.domain.retries import ProviderErrorKind


class Contract(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class CanonicalRequest(Contract):
    # Our task's id, its run's and which attempt at the task this is, echoed back by the
    # provider (DataForSEO: `tag`) so an answer is matched to the task, checked against its
    # run, and never taken for a later attempt's. A workload builds the request without the
    # attempt; submission sets it, and an adapter sends no request without one.
    task_id: str = Field(min_length=1)
    run_id: UUID
    attempt: int | None = Field(default=None, ge=1)
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
    """What of our request a provider echoes back. Empty when the provider sent nothing we
    recognise as ours, including a request of another installation."""

    task_id: str | None = None
    run_id: UUID | None = None
    attempt: int | None = None

    def names(self, task_id: int, run_id: UUID, attempt: int) -> bool:
        """Whether this echo is of that attempt at that task, of that run."""
        return self.task_id == str(task_id) and self.run_id == run_id and self.attempt == attempt


class ReadyTask(Contract):
    """A task the provider has finished, as its readiness list names it."""

    provider_task_id: str = Field(min_length=1)
    echo: Echo = Echo()


class SubmittedTask(Contract):
    """A task the provider holds, as its list of posted tasks names it."""

    provider_task_id: str = Field(min_length=1)
    # Whether the listing carried a tag at all. An empty echo of a tagged task is someone
    # else's; of an untagged one, it says nothing: the task may be ours.
    tagged: bool = True
    echo: Echo = Echo()
    posted_at: datetime | None = None
    cost_usd: CostUsd | None = None


class FetchResult(Contract):
    """One task's result. `body` is the response exactly as received, for storage: what the
    facts are read from, now and after a parser is fixed."""

    provider_task_id: str = Field(min_length=1)
    status: Literal["ready", "pending", "expired", "failed"]
    # Bytes only: text would be encoded again, and would no longer be what was received.
    body: bytes | None = Field(default=None, strict=True)
    content_type: str = "application/json"
    cost_usd: CostUsd | None = None
    error: ProviderError | None = None

    @model_validator(mode="after")
    def _says_one_thing(self) -> Self:
        if self.status == "ready" and (self.body is None or self.error is not None):
            raise ValueError("a ready result has a body and no error")
        if self.status in ("expired", "failed") and self.error is None:
            raise ValueError("an expired or failed result says why")
        if self.status == "pending" and (self.body is not None or self.error is not None):
            raise ValueError("a pending result has neither body nor error")
        return self


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


@dataclass(frozen=True, slots=True)
class Limit:
    """A provider's limit on calls: at most `per_minute` in any sixty seconds, of which up to
    `burst` may come at once."""

    per_minute: int
    burst: int

    def __post_init__(self) -> None:
        if not 1 <= self.burst < self.per_minute:
            raise ValueError("a burst is at least one call and less than the minute's limit")

    @property
    def refill_per_minute(self) -> int:
        # A bucket that starts full and refills at this rate lets through at most `burst`
        # plus a minute's refill in any sixty seconds: the limit.
        return self.per_minute - self.burst


class GateUnavailableError(Exception):
    """The call gate could not be asked for a turn. No call may be made; nothing was sent."""


class CallGate(Protocol):
    """Where an adapter waits for its turn to call the provider (docs/21 section 7).

    An adapter reports a call it could not make as `not_sent`, never as `rate_limited`: the
    provider did not see it, and slowing down for it would hold back more calls still.
    """

    async def enter(self, family: str | None, *, within: timedelta) -> bool:
        """Take a turn under the provider's limit on all calls and, when `family` is named,
        under that family's own. False when no turn comes within `within`: then no call may
        be made. Raises `GateUnavailableError` when the limits cannot be read."""
        ...

    async def slow_down(self) -> None:
        """The provider itself said the calls come too fast (DataForSEO 40202, HTTP 429):
        fewer for a while. Raises `GateUnavailableError` when that cannot be recorded."""
        ...


class Provider(Protocol):
    @property
    def code(self) -> str: ...

    def batch_size(self, endpoint: str) -> int:
        """How many requests one call to this endpoint takes (DataForSEO task endpoints: 100)."""
        ...

    def result_lifetime(self, endpoint: str) -> timedelta:
        """How long a task may go without a result before it is given up, and a submission
        of unknown outcome with it (DataForSEO: 72 hours, the time its readiness list covers;
        76 for LLM Responses standard tasks). Finished results can be fetched for longer."""
        ...

    def payload_slug(self, endpoint: str) -> str:
        """The endpoint's name in the keys of its stored results (doc 23 section 9.1), such as
        `serp_google_organic_advanced`: lowercase letters, digits and underscores."""
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
