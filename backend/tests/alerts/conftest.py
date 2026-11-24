"""Fixtures of the alert tests."""

from __future__ import annotations

# The worker's sessions, as the evaluation tick uses them.
from tests.collectors.conftest import worker_db

__all__ = ["worker_db"]
