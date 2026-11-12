"""Fixtures of the AI route tests that also drive the worker: sessions as the worker's role on an
empty ledger, the collectors' own fixture."""

from __future__ import annotations

from tests.collectors.conftest import worker_db

__all__ = ["worker_db"]
