"""The workloads this worker can plan, by name (docs/21-scheduler-workers.md section 3.2).

A workload is what turns one window of a schedule into tasks: which subjects the schedule selects
today, what is asked about each, and what that is expected to cost. The planner knows none of
that. It asks the workload registered under the schedule's name, and a schedule whose workload
is not registered is left alone until it is.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Any, Protocol
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from sightline.collectors.ledger import LedgerTask, NewTask, TaskRef
from sightline.domain.workloads import TaskWorkload
from sightline.providers.contract import CanonicalRequest, Provider


@dataclass(frozen=True, slots=True)
class ScheduleWindow:
    """One window of one schedule, or of one manual run: what a workload plans tasks for. A
    manual run has no schedule; its selector is the one it was asked with."""

    schedule_id: UUID | None
    workspace_id: UUID
    project_id: UUID
    workload: TaskWorkload
    provider_mode: str
    selector: Mapping[str, Any]
    window_start: datetime
    window_end: datetime
    window_hours: int


@dataclass(frozen=True, slots=True)
class Plan:
    # Every task already has its place in the window (`domain.tasks.scheduled_for`).
    tasks: Sequence[NewTask]
    # From the price book, for all the tasks together.
    estimated_cost_usd: Decimal
    # What the run is planned with (versions of adapter, parser and extractor, provider mode,
    # replicates), kept on the run so its results can be read the way they were made.
    config_snapshot: Mapping[str, Any]


class Workload(Protocol):
    @property
    def name(self) -> TaskWorkload: ...

    async def plan(self, db: AsyncSession, window: ScheduleWindow) -> Plan:
        """The tasks of this window, each one once. The database is read-only while this
        runs: the planner writes. Every read must name the window's workspace, because the
        session bypasses row-level security."""
        ...

    def batch_key(self, task: LedgerTask) -> str:
        """What tasks must share to be sent in one batch, besides provider, endpoint and
        priority: empty when any may go together. Keyword metrics: the location and language,
        since one Labs call asks about one of each."""
        ...

    async def build_requests(
        self, db: AsyncSession, tasks: Sequence[LedgerTask]
    ) -> Mapping[TaskRef, CanonicalRequest]:
        """What to ask the provider for each task, keyed by the task. The database is
        read-only while this runs, and every read must name the task's workspace. A task left
        out is not sent: its outcome is recorded as a request that could not be built."""
        ...


def answers_live(provider: Provider, endpoint: str) -> bool:
    """Whether the endpoint answers in the call (`Provider.live`). An endpoint the provider
    does not know is not live: `submit` refuses it the way it refuses any request it cannot
    send."""
    try:
        return provider.is_live(endpoint)
    except ValueError:
        return False


class Registry:
    def __init__(self) -> None:
        self._workloads: dict[TaskWorkload, Workload] = {}
        self._providers: dict[str, Provider] = {}

    def add_workload(self, workload: Workload) -> None:
        if workload.name in self._workloads:
            raise ValueError(f"workload {workload.name} is already registered")
        self._workloads[workload.name] = workload

    def add_provider(self, provider: Provider) -> None:
        if provider.code in self._providers:
            raise ValueError(f"provider {provider.code} is already registered")
        self._providers[provider.code] = provider

    def workload(self, name: TaskWorkload) -> Workload:
        return self._workloads[name]

    def provider(self, code: str) -> Provider:
        return self._providers[code]

    @property
    def workloads(self) -> frozenset[TaskWorkload]:
        return frozenset(self._workloads)

    @property
    def providers(self) -> frozenset[str]:
        return frozenset(self._providers)
