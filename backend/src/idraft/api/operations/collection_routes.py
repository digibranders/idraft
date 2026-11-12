"""Daily AI collection and the AI coverage of a run.

WP-30 (runs-costs-health) fills this router; api/main.py includes it already (docs/ai-visibility/
MASTER-PLAN.md section 3.3). Its service comes from a dependency in this file, built from
`Resources`, so resources.py and main.py stay as they are.
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()
