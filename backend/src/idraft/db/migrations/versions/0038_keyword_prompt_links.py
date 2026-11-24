"""Links between prompts and keywords (docs/04-data-model.md section 9, WP-44).

A prompt is linked to the keywords it stands for. The link is at the `seo.keywords` level (text
plus language), not `seo.tracked_keywords`, so a linked keyword costs no rank checks. The Prompts
page reads a prompt's search volume through its link. Every key that names a workspace carries it,
so a link can never join rows of two workspaces.

The API makes and removes links, and changes whether one is primary or accepted; the worker only
reads them, to know which keywords' metrics to collect. A prompt has at most one active primary
link.

Revision ID: 0038
Revises: 0037
"""

from __future__ import annotations

from alembic import op

from idraft.db.ddl import column_grant, grants, statements, tenant_isolation

revision: str = "0038"
down_revision: str | None = "0037"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None

_TABLE = """
CREATE TABLE core.keyword_prompt_links (
    id             uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id   uuid NOT NULL,
    project_id     uuid NOT NULL,
    keyword_id     uuid NOT NULL,
    prompt_id      uuid NOT NULL,
    link_type      text NOT NULL CHECK (link_type IN (
                       'exact_match', 'manual', 'generated', 'semantic', 'cluster',
                       'ai_suggestion', 'fanout')),
    confidence     numeric(4,3) CHECK (confidence BETWEEN 0 AND 1),
    is_primary     boolean NOT NULL DEFAULT false,
    status         text NOT NULL DEFAULT 'active'
                   CHECK (status IN ('suggested', 'active', 'rejected')),
    method_version smallint,
    created_by     uuid REFERENCES auth.users(id),
    created_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, keyword_id, prompt_id),
    FOREIGN KEY (project_id, workspace_id) REFERENCES core.projects(id, workspace_id)
        ON DELETE CASCADE,
    FOREIGN KEY (keyword_id, workspace_id) REFERENCES seo.keywords(id, workspace_id)
        ON DELETE CASCADE,
    FOREIGN KEY (prompt_id, workspace_id) REFERENCES ai.prompts(id, workspace_id)
        ON DELETE CASCADE
);

CREATE INDEX keyword_prompt_links_prompt ON core.keyword_prompt_links (prompt_id)
    WHERE status = 'active';

CREATE INDEX keyword_prompt_links_keyword ON core.keyword_prompt_links (keyword_id);

CREATE UNIQUE INDEX keyword_prompt_links_one_primary ON core.keyword_prompt_links (prompt_id)
    WHERE is_primary AND status = 'active';
"""


def upgrade() -> None:
    for statement in statements(_TABLE):
        op.execute(statement)
    for statement in tenant_isolation("core.keyword_prompt_links"):
        op.execute(statement)
    for statement in (
        *grants("core.keyword_prompt_links", api="SELECT, INSERT, DELETE", worker="SELECT"),
        column_grant(
            "core.keyword_prompt_links",
            role="app_api",
            privilege="UPDATE",
            columns=("is_primary", "status"),
        ),
    ):
        op.execute(statement)


def downgrade() -> None:
    # Local development only: the links are lost.
    op.execute("DROP TABLE core.keyword_prompt_links")
