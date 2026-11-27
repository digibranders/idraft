"""Files attached to page notes and the workspace's cap on them (Pages spec 9.8.5, D25, D26).

A file is uploaded on its own, so a row exists before any note holds it (`note_id` null) and is
attached once. The bytes live in the raw bucket under `storage_key`; the row says what they are.
The API adds a row, attaches it and marks it removed; no role may delete a row, and the worker
does not read the table. A note may now hold files and no text, so its body check allows an empty
body; the service refuses an empty body with no live file. Each workspace may store
`max_note_file_bytes` of note files, counted over every row.

Revision ID: 0044
Revises: 0043
"""

from __future__ import annotations

from alembic import op

from idraft.db.ddl import column_grant, grants, statements, tenant_isolation

revision: str = "0044"
down_revision: str | None = "0043"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None

_TABLE = """
CREATE TABLE core.page_note_attachments (
    id            uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id  uuid NOT NULL,
    project_id    uuid NOT NULL,
    url_id        bigint NOT NULL REFERENCES core.urls(id),
    note_id       uuid,
    uploaded_by   uuid NOT NULL REFERENCES auth.users(id),
    storage_key   text NOT NULL UNIQUE,
    original_name text NOT NULL CHECK (char_length(original_name) BETWEEN 1 AND 255),
    size_bytes    bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
    content_type  text NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/gif',
                  'image/webp', 'application/pdf', 'text/plain', 'text/csv')),
    created_at    timestamptz NOT NULL DEFAULT now(),
    removed_at    timestamptz,
    CHECK (removed_at IS NULL OR note_id IS NOT NULL),
    FOREIGN KEY (note_id, workspace_id) REFERENCES core.page_notes(id, workspace_id),
    FOREIGN KEY (project_id, workspace_id) REFERENCES core.projects(id, workspace_id)
        ON DELETE CASCADE
);

CREATE INDEX page_note_attachments_note ON core.page_note_attachments (note_id)
    WHERE note_id IS NOT NULL AND removed_at IS NULL;

CREATE INDEX page_note_attachments_workspace ON core.page_note_attachments (workspace_id)
    INCLUDE (size_bytes);
"""


def upgrade() -> None:
    for statement in statements(_TABLE):
        op.execute(statement)
    for statement in tenant_isolation("core.page_note_attachments"):
        op.execute(statement)
    for statement in (
        *grants("core.page_note_attachments", api="SELECT, INSERT"),
        column_grant(
            "core.page_note_attachments",
            role="app_api",
            privilege="UPDATE",
            columns=("note_id", "removed_at"),
        ),
    ):
        op.execute(statement)
    op.execute("ALTER TABLE core.page_notes DROP CONSTRAINT page_notes_body_check")
    op.execute(
        "ALTER TABLE core.page_notes ADD CONSTRAINT page_notes_body_check "
        "CHECK (char_length(body) <= 2000 AND body = btrim(body))"
    )
    op.execute(
        "ALTER TABLE core.workspace_quotas ADD COLUMN max_note_file_bytes bigint "
        "NOT NULL DEFAULT 1073741824 CHECK (max_note_file_bytes >= 0)"
    )


def downgrade() -> None:
    # Local development only: the file rows are lost, and the old body check needs no empty note.
    op.execute("ALTER TABLE core.workspace_quotas DROP COLUMN max_note_file_bytes")
    op.execute("ALTER TABLE core.page_notes DROP CONSTRAINT page_notes_body_check")
    op.execute(
        "ALTER TABLE core.page_notes ADD CONSTRAINT page_notes_body_check "
        "CHECK (char_length(body) BETWEEN 1 AND 2000 AND body = btrim(body))"
    )
    op.execute("DROP TABLE core.page_note_attachments")
