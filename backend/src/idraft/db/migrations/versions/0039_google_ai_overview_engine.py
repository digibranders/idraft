"""Google AI Overview as an engine of keyword level (docs/superpowers/plans/2026-11-25-ai-overview-
engine.md).

The engine is read from the rank checks of a prompt's linked keyword, so it is never asked per
prompt: it has no task endpoint and no row in the price book. Only the `ai.engines` row is new,
so a project can turn it on (`ai.project_engines.engine_code` references it). The table is global
and read-only for the roles, as migration 0018 made it; nothing about its grants changes.

Revision ID: 0039
Revises: 0038
"""

from __future__ import annotations

from alembic import op
from sqlalchemy import text

revision: str = "0039"
down_revision: str | None = "0038"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None

# code, label, observation class, vendor, exposes citations, exposes fan-out: the values of
# `idraft.domain.ai_engines` (tests/db/test_ai_schema.py keeps the two equal).
_ENGINE = ("google_ai_overview", "Google AI Overview", "serp_ai", "google", True, False)


def upgrade() -> None:
    code, label, observation_class, vendor, citations, fanout = _ENGINE
    op.get_bind().execute(
        text(
            "INSERT INTO ai.engines (code, label, observation_class, vendor, "
            "exposes_citations, exposes_fanout) VALUES (:code, :label, :observation_class, "
            ":vendor, :citations, :fanout)"
        ),
        {
            "code": code,
            "label": label,
            "observation_class": observation_class,
            "vendor": vendor,
            "citations": citations,
            "fanout": fanout,
        },
    )


def downgrade() -> None:
    op.execute("DELETE FROM ai.project_engines WHERE engine_code = 'google_ai_overview'")
    op.execute("DELETE FROM ai.engines WHERE code = 'google_ai_overview'")
