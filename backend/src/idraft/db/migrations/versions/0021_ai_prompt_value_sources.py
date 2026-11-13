# renumber at push time: next free number, down_revision = the head on origin/develop
"""AI prompts: where the type and the branded flag came from.

`prompt_type_source` says whether the type was set by the server's wording rule (`rule`) or
chosen by a person (`person`); `is_branded_source` says whether the branded flag was computed
from the project's own aliases (`computed`) or set by a person (`override`). Rows that exist
now were written with the type the caller sent and a computed flag, so the defaults are
`person` and `computed`. Both defaults are constants, so this is a catalog change with no table
rewrite. The API role may change both, like the columns they describe.

The downgrade drops both columns and what they say (local development only, as for 0018).

Revision ID: 0021
Revises: 0020
"""

from __future__ import annotations

from alembic import op

revision: str = "0021"
down_revision: str | None = "0020"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE ai.prompts "
        "ADD COLUMN prompt_type_source text NOT NULL DEFAULT 'person' "
        "CHECK (prompt_type_source IN ('rule','person')), "
        "ADD COLUMN is_branded_source text NOT NULL DEFAULT 'computed' "
        "CHECK (is_branded_source IN ('computed','override'))"
    )
    op.execute("GRANT UPDATE (prompt_type_source, is_branded_source) ON ai.prompts TO app_api")


def downgrade() -> None:
    op.execute("REVOKE UPDATE (prompt_type_source, is_branded_source) ON ai.prompts FROM app_api")
    op.execute(
        "ALTER TABLE ai.prompts DROP COLUMN prompt_type_source, DROP COLUMN is_branded_source"
    )
