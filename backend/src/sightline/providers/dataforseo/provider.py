"""The DataForSEO adapter (docs/06-dataforseo-seo-integration.md section 4,
docs/05-provider-integrations.md section 3).

One adapter serves every DataForSEO task endpoint the ledger names; what differs between them
is in their `TaskEndpoint`. Tasks are matched to ours by the tag they were sent with, never by
their position in an answer.

After tasks were sent, nothing the answer says may be lost to an exception: a task the answer
does not name for certain is left out of the result, and its outcome stays unknown for the
ledger to resolve.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import ROUND_UP, Decimal
from types import MappingProxyType
from typing import Final

from sightline.domain.retries import ProviderErrorKind
from sightline.providers.contract import (
    AcceptedTask,
    CanonicalRequest,
    FetchResult,
    ProviderCallError,
    ProviderError,
    ReadyTask,
    RejectedTask,
    SubmitResult,
    SubmittedTask,
)
from sightline.providers.dataforseo import serp
from sightline.providers.dataforseo.client import Answered, DataForSeoClient, TaskAnswer
from sightline.providers.dataforseo.endpoint import TaskEndpoint
from sightline.providers.dataforseo.errors import Answer, read_status
from sightline.providers.dataforseo.tags import INSTALLATION, make_tag, read_tag

K = ProviderErrorKind

CODE: Final = "dataforseo"
# Tasks in one `task_post` (DataForSEO refuses more with 40006).
BATCH_SIZE: Final = 100
ENDPOINTS: Final[Mapping[str, TaskEndpoint]] = MappingProxyType({serp.SERP_ORGANIC: serp.ENDPOINT})
# `id_list` gives up to 1,000 tasks a call. More pages than this in one period is more than
# the resolver asks about; it is refused rather than read in part.
ID_LIST_PAGE: Final = 1_000
ID_LIST_PAGES: Final = 5
# A task id is used in a path: letters, digits and hyphens only.
_TASK_ID: Final = re.compile(r"[0-9A-Za-z-]{1,64}")
# What `ops.collection_tasks.cost_usd`, numeric(14,6), holds.
_COST_STEP: Final = Decimal("0.000001")
_COST_LIMIT: Final = Decimal(10) ** 8
_DATETIME: Final = "%Y-%m-%d %H:%M:%S %z"


@dataclass(frozen=True, slots=True)
class AccountState:
    """What `user_data` says of the account. None where it did not say."""

    balance_usd: Decimal
    calls_per_minute: int | None
    spent_today_usd: Decimal | None


def _invalid(message: str) -> ProviderCallError:
    return ProviderCallError(ProviderError(kind=K.INVALID_REQUEST, message=message))


def _provider_fault(message: str) -> ProviderCallError:
    return ProviderCallError(ProviderError(kind=K.PROVIDER_ERROR, message=message))


def _number(value: object) -> Decimal | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return Decimal(value)
    if isinstance(value, Decimal) and value.is_finite():
        return value
    return None


def _cost(value: object) -> Decimal | None:
    """A cost as the ledger can hold it, rounded up so a budget never counts less than was
    spent. None for anything that is not a cost."""
    number = _number(value)
    if number is None or number < 0:
        return None
    rounded = number.quantize(_COST_STEP, rounding=ROUND_UP)
    return rounded if rounded < _COST_LIMIT else None


def _at(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.strptime(value, _DATETIME)
    except ValueError:
        return None


def _utc(moment: datetime) -> str:
    if moment.tzinfo is None or moment.utcoffset() is None:
        raise ValueError("a period is given in times with their time zone")
    return moment.astimezone(UTC).strftime("%Y-%m-%d %H:%M:%S +00:00")


def _field(value: object, *path: str) -> object:
    for key in path:
        if not isinstance(value, dict):
            return None
        value = value.get(key)
    return value


class DataForSeo:
    """The `Provider` for DataForSEO's task endpoints."""

    code: Final = CODE
    lists_submissions: Final = True

    def __init__(
        self,
        client: DataForSeoClient,
        *,
        installation: str,
        endpoints: Mapping[str, TaskEndpoint] = ENDPOINTS,
    ) -> None:
        if not INSTALLATION.fullmatch(installation):
            raise ValueError("an installation is 1 to 16 lowercase letters and digits")
        self._client = client
        self._installation = installation
        self._endpoints = endpoints

    def _endpoint(self, endpoint: str) -> TaskEndpoint:
        spec = self._endpoints.get(endpoint)
        if spec is None:
            raise ValueError(f"unknown DataForSEO endpoint {endpoint!r}")
        return spec

    def _endpoint_to_call(self, endpoint: str) -> TaskEndpoint:
        """The endpoint, or a refused call: its callers then know nothing was sent."""
        try:
            return self._endpoint(endpoint)
        except ValueError as error:
            raise _invalid(str(error)) from None

    def batch_size(self, endpoint: str) -> int:
        self._endpoint(endpoint)
        return BATCH_SIZE

    def result_lifetime(self, endpoint: str) -> timedelta:
        return self._endpoint(endpoint).result_lifetime

    def _tag(self, request: CanonicalRequest) -> str:
        if request.attempt is None:
            raise ValueError("the request is not bound to an attempt")
        try:
            task_id = int(request.task_id)
        except ValueError:
            raise ValueError("the task id is not a number") from None
        return make_tag(self._installation, task_id, request.attempt, request.run_id)

    async def submit(self, endpoint: str, requests: Sequence[CanonicalRequest]) -> SubmitResult:
        spec = self._endpoint_to_call(endpoint)
        if len(requests) > BATCH_SIZE:
            raise _invalid(f"{len(requests)} tasks in one call; DataForSEO takes {BATCH_SIZE}")
        by_tag: dict[str, str] = {}
        tasks: list[dict[str, object]] = []
        rejected: list[RejectedTask] = []
        for request in requests:
            try:
                tag = self._tag(request)
                if tag in by_tag:
                    raise ValueError("the same attempt at the task is already in this call")
                tasks.append(spec.build(request, tag))
            except (TypeError, ValueError) as error:
                refusal = ProviderError(kind=K.INVALID_REQUEST, message=f"not sent: {error}")
                rejected.append(RejectedTask(task_id=request.task_id, error=refusal))
                continue
            by_tag[tag] = request.task_id
        if not tasks:
            return SubmitResult(rejected=tuple(rejected))

        answered = await self._client.call(
            "POST", f"{spec.base}/task_post", sending=True, body=tasks
        )
        accepted: list[AcceptedTask] = []
        for task in answered.tasks:
            echoed = _field(task.data, "tag") if task is not None else None
            task_id = by_tag.get(echoed) if isinstance(echoed, str) else None
            if task is None or task_id is None:
                continue
            outcome = read_status(task.status_code, task.status_message, sending=True)
            if outcome is Answer.OK and task.id is not None:
                accepted.append(
                    AcceptedTask(
                        task_id=task_id, provider_task_id=task.id, cost_usd=_cost(task.cost)
                    )
                )
            elif isinstance(outcome, ProviderError) and outcome.kind is not K.TIMEOUT:
                await self._client.slow_if_limited(outcome)
                rejected.append(RejectedTask(task_id=task_id, error=outcome))
            # Anything else leaves the task's outcome unknown: it may have been created.
        return SubmitResult(accepted=tuple(accepted), rejected=tuple(rejected))

    async def _only_task(self, answered: Answered) -> TaskAnswer:
        """The one task of an answer about one thing, which must itself have worked."""
        if len(answered.tasks) != 1 or answered.tasks[0] is None:
            raise _provider_fault("the answer did not hold one readable task")
        task = answered.tasks[0]
        outcome = read_status(task.status_code, task.status_message, sending=False)
        if isinstance(outcome, ProviderError):
            await self._client.slow_if_limited(outcome)
            raise ProviderCallError(outcome)
        return task

    async def list_ready(self, endpoint: str) -> Sequence[ReadyTask]:
        spec = self._endpoint_to_call(endpoint)
        answered = await self._client.call("GET", f"{spec.base}/tasks_ready", family="tasks_ready")
        task = await self._only_task(answered)
        ready: list[ReadyTask] = []
        for item in task.result or ():
            provider_task_id = _field(item, "id")
            # One entry that cannot be read is left for the id sweeper to find.
            if isinstance(provider_task_id, str) and _TASK_ID.fullmatch(provider_task_id):
                echo = read_tag(_field(item, "tag"), self._installation)
                ready.append(ReadyTask(provider_task_id=provider_task_id, echo=echo))
        return ready

    async def fetch(self, endpoint: str, provider_task_id: str) -> FetchResult:
        spec = self._endpoint_to_call(endpoint)
        if not _TASK_ID.fullmatch(provider_task_id):
            raise _invalid("not a DataForSEO task id")
        answered = await self._client.call("GET", f"{spec.base}/{spec.result}/{provider_task_id}")
        task = answered.tasks[0] if len(answered.tasks) == 1 else None
        if task is None or task.id != provider_task_id:
            raise _provider_fault("the answer was not about the task asked for")
        outcome = read_status(task.status_code, task.status_message, sending=False)
        if outcome is Answer.NOT_READY:
            return FetchResult(provider_task_id=provider_task_id, status="pending")
        if isinstance(outcome, ProviderError):
            await self._client.slow_if_limited(outcome)
            expired = outcome.kind is K.NOT_FOUND_EXPIRED
            return FetchResult(
                provider_task_id=provider_task_id,
                status="expired" if expired else "failed",
                error=outcome,
            )
        # A search with no results is a result too, and is kept like any other.
        return FetchResult(
            provider_task_id=provider_task_id,
            status="ready",
            body=answered.content,
            content_type=answered.content_type,
            cost_usd=_cost(task.cost),
        )

    async def find_submitted(
        self, endpoint: str, since: datetime, until: datetime
    ) -> Sequence[SubmittedTask]:
        """Every task posted in the period, from any endpoint: the tag says which is ours."""
        self._endpoint_to_call(endpoint)
        period = {"datetime_from": _utc(since), "datetime_to": _utc(until)}
        if since >= until:
            raise ValueError("a period starts before it ends")
        found: list[SubmittedTask] = []
        for page in range(ID_LIST_PAGES):
            body: dict[str, object] = {
                **period,
                "limit": ID_LIST_PAGE,
                "offset": page * ID_LIST_PAGE,
                "sort": "asc",
                "include_metadata": True,
            }
            answered = await self._client.call(
                "POST", "/v3/tasks/id_list", family="id_list", body=[body]
            )
            items = (await self._only_task(answered)).result or []
            found += [self._submitted(item) for item in items]
            if len(items) < ID_LIST_PAGE:
                return found
        # A task left out would be taken for one the provider never received, and sent again.
        raise _provider_fault("more tasks were posted in the period than one look reads")

    def _submitted(self, item: object) -> SubmittedTask:
        provider_task_id = _field(item, "id")
        if not isinstance(provider_task_id, str) or not provider_task_id:
            # Not knowing a task is not knowing that it is absent.
            raise _provider_fault("a listed task could not be read")
        return SubmittedTask(
            provider_task_id=provider_task_id,
            echo=read_tag(_field(item, "metadata", "tag"), self._installation),
            posted_at=_at(_field(item, "datetime_posted")),
            cost_usd=_cost(_field(item, "cost")),
        )

    async def account_state(self) -> AccountState:
        answered = await self._client.call("GET", "/v3/appendix/user_data", family="user_data")
        result = (await self._only_task(answered)).result or [None]
        account = result[0]
        balance = _number(_field(account, "money", "balance"))
        if balance is None:
            raise _provider_fault("the account state had no balance")
        calls = _field(account, "rates", "limits", "minute", "total")
        return AccountState(
            balance_usd=balance,
            calls_per_minute=calls
            if isinstance(calls, int) and not isinstance(calls, bool)
            else None,
            spent_today_usd=_number(_field(account, "money", "statistics", "day", "total")),
        )
