"""Notes on a page (Pages spec 9.7, decision D15).

A note belongs to a project and an address (`core.urls`), not to a crawl's page row, so it stays
when the site is crawled again and exists for an address that redirects or errors. The API adds
a note, changes its body and marks it deleted (`deleted_at`, `deleted_by`); no role may delete a
row, so Undo is one update and the audit log can always name the note. The worker does not read it.

Revision ID: 0042
Revises: 0041
"""

from __future__ import annotations

from alembic import op

from idraft.db.ddl import column_grant, grants, statements, tenant_isolation

revision: str = "0042"
down_revision: str | None = "0041"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None

_TABLE = """
CREATE TABLE core.page_notes (
    id           uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id uuid NOT NULL,
    project_id   uuid NOT NULL,
    url_id       bigint NOT NULL REFERENCES core.urls(id),
    author_id    uuid NOT NULL REFERENCES auth.users(id),
    body         text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000 AND body = btrim(body)),
    created_at   timestamptz NOT NULL DEFAULT now(),
    edited_at    timestamptz,
    deleted_at   timestamptz,
    deleted_by   uuid REFERENCES auth.users(id),
    CHECK ((deleted_at IS NULL) = (deleted_by IS NULL)),
    UNIQUE (id, workspace_id),
    FOREIGN KEY (project_id, workspace_id) REFERENCES core.projects(id, workspace_id)
        ON DELETE CASCADE
);

CREATE INDEX page_notes_page ON core.page_notes (project_id, url_id, created_at DESC, id DESC)
    WHERE deleted_at IS NULL;
"""


def upgrade() -> None:
    for statement in statements(_TABLE):
        op.execute(statement)
    for statement in tenant_isolation("core.page_notes"):
        op.execute(statement)
    for statement in (
        *grants("core.page_notes", api="SELECT, INSERT"),
        column_grant(
            "core.page_notes",
            role="app_api",
            privilege="UPDATE",
            columns=("body", "edited_at", "deleted_at", "deleted_by"),
        ),
    ):
        op.execute(statement)


def downgrade() -> None:
    # Local development only: the notes are lost.
    op.execute("DROP TABLE core.page_notes")
