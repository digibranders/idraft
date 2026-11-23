"""AI answer screenshots: the image of the page an AI engine showed for one observation.

One row per observation. The image is in the raw bucket under `storage_key`; the row says
where it is, how big it is, whether the capture was cut off, and what it cost. DataForSEO
makes a screenshot for 7 days after a task, so a screenshot that was not captured then cannot
be made later: a missing row is "never captured", not "pending".

Revision ID: 0031
Revises: 0030
"""

from __future__ import annotations

from alembic import op

from idraft.db.ddl import grants, statements, tenant_isolation

revision: str = "0031"
down_revision: str | None = "0030"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None

# No foreign key to ai.observations: that table is partitioned by observed_at and the
# observation_facts rows tie to it by the same two columns without one.
_TABLES = """
CREATE TABLE ai.observation_screenshots (
    observation_id   bigint NOT NULL,
    observed_at      timestamptz NOT NULL,
    workspace_id     uuid NOT NULL,
    project_id       uuid NOT NULL,
    storage_key      text NOT NULL CHECK (storage_key <> ''),
    width            integer NOT NULL CHECK (width > 0),
    height           integer NOT NULL CHECK (height > 0),
    byte_size        integer NOT NULL CHECK (byte_size > 0),
    truncated        boolean NOT NULL,
    cost_usd         numeric(14, 6) NOT NULL CHECK (cost_usd >= 0),
    provider_task_id text NOT NULL,
    captured_at      timestamptz NOT NULL DEFAULT now(),
    captured_by      uuid REFERENCES auth.users(id),
    PRIMARY KEY (observation_id, observed_at),
    FOREIGN KEY (project_id, workspace_id) REFERENCES core.projects(id, workspace_id)
        ON DELETE CASCADE
);

CREATE INDEX observation_screenshots_project
    ON ai.observation_screenshots (project_id, observed_at DESC);
"""

_TABLE = "ai.observation_screenshots"


def upgrade() -> None:
    for statement in statements(_TABLES):
        op.execute(statement)
    for statement in tenant_isolation(_TABLE):
        op.execute(statement)
    for statement in grants(_TABLE, api="SELECT, INSERT"):
        op.execute(statement)


def downgrade() -> None:
    # Local development only: the rows are lost; the images stay in the bucket.
    op.execute("DROP TABLE ai.observation_screenshots")
