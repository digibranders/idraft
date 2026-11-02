"""The worker files a keyword's intent from the provider's answer.

Intent defaults to the `main_intent` of the keyword's Labs overview, with `intent_source`
`provider`, and a person's own choice (`manual`) is never replaced (docs/09 section 4). Metrics
ingest does that on the keyword rows, so the worker may change `intent` and `intent_source`
there, and no other column.

Revision ID: 0014
Revises: 0013
"""

from __future__ import annotations

from alembic import op

from idraft.db.ddl import column_grant

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None

_COLUMNS = ("intent", "intent_source")


def upgrade() -> None:
    op.execute(
        column_grant(
            "seo.tracked_keywords", role="app_worker", privilege="UPDATE", columns=_COLUMNS
        )
    )
    # Keywords whose metrics were read before ingest filed intents.
    op.execute(
        "UPDATE seo.tracked_keywords t SET intent = m.intent_main, intent_source = 'provider' "
        "FROM seo.keyword_metrics_current m "
        "WHERE m.workspace_id = t.workspace_id AND m.keyword_id = t.keyword_id "
        "AND m.location_id = t.location_id AND m.language_code = t.language_code "
        "AND m.intent_main IS NOT NULL AND t.intent_source IS NULL AND t.intent = 'unknown'"
    )


def downgrade() -> None:
    op.execute("REVOKE UPDATE (intent, intent_source) ON seo.tracked_keywords FROM app_worker")
