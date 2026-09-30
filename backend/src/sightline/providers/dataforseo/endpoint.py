"""A DataForSEO task endpoint, as the adapter needs to know it."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import timedelta

from sightline.providers.contract import CanonicalRequest

# Builds one task of a `task_post` body from a request and the tag it is sent with. Raises
# `TypeError` or `ValueError` for a request that is not this endpoint's.
TaskBuilder = Callable[[CanonicalRequest, str], dict[str, object]]


@dataclass(frozen=True, slots=True)
class TaskEndpoint:
    # The path its calls start with, such as `/v3/serp/google/organic`.
    base: str
    # The result's path after the base, without the task id: `task_get/advanced`.
    result: str
    build: TaskBuilder
    # How long a task may go without a result before it is given up.
    result_lifetime: timedelta
