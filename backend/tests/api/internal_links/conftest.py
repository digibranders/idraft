"""Fixtures of the internal links route tests."""

from __future__ import annotations

# The worker's sessions, for tests that run `crawl_enrich` and then read through the API.
from tests.collectors.conftest import worker_db

__all__ = ["worker_db"]
