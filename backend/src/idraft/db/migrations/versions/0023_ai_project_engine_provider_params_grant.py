"""AI engines: the API role may change the settings it keeps in `provider_params`.

Migration 0018 let `app_api` update `location_ids` and `is_enabled` of `ai.project_engines` and
nothing else. The device of an AI engine (WP-31) is saved in `provider_params`, so the role needs
UPDATE on that one column. The grant is the whole change: no table-level UPDATE, no other column,
no other role, no data change. The answers per engine, the provider and the engine and workspace
of a row stay out of the API's reach. Row-level security is untouched.

The downgrade revokes the column grant (local development only, as for 0018).

Revision ID: 0023
Revises: 0022
"""

from __future__ import annotations

from alembic import op

from idraft.db.ddl import column_grant

revision: str = "0023"
down_revision: str | None = "0022"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute(
        column_grant(
            "ai.project_engines", role="app_api", privilege="UPDATE", columns=("provider_params",)
        )
    )


def downgrade() -> None:
    op.execute("REVOKE UPDATE (provider_params) ON ai.project_engines FROM app_api")
