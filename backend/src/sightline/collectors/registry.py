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

from sightline.collectors.ledger import NewTask
from sightline.domain.workloads import TaskWorkload


@dataclass(frozen=True, slots=True)
class ScheduleWindow:
    """One window of one schedule: what a workload plans tasks for."""

    schedule_id: UUID
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


class Registry:
    def __init__(self) -> None:
        self._workloads: dict[TaskWorkload, Workload] = {}

    def add_workload(self, workload: Workload) -> None:
        if workload.name in self._workloads:
            raise ValueError(f"workload {workload.name} is already registered")
        self._workloads[workload.name] = workload

    def workload(self, name: TaskWorkload) -> Workload:
        return self._workloads[name]

    @property
    def workloads(self) -> frozenset[TaskWorkload]:
        return frozenset(self._workloads)
