"""Domains, locations, entities and taxonomy: the vocabulary SEO and AI share.

Table definitions follow docs/04-data-model.md sections 5.1 to 5.3 and 6, with these choices
(plan `docs/superpowers/plans/2026-10-01-entities-taxonomy.md`):

- Domains, domain categories, locations and the provider location map are global dictionaries:
  no workspace and no row-level security. No route lists domains (D1).
- Every tenant table carries `workspace_id`, `core.entity_domains` included, and refers to its
  parents through (id, workspace_id), so a row can never point into another workspace (D2).
- `core.project_domain_roles` is a plain view that runs with the reader's rights, so the base
  tables' policies apply to it; a materialized view cannot have row-level security (D3).
- `core.urls` and `core.url_remap` wait for SERP ingest, their first writer.

Revision ID: 0010
Revises: 0009
"""

from __future__ import annotations

from alembic import op
from sqlalchemy import text

from sightline.db.ddl import grants, statements, tenant_isolation

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None

# docs/14-citation-intelligence.md section 4. Roles such as own or competitor are not categories.
_CATEGORIES = (
    ("news", "News", "News publishers and magazines"),
    ("review_aggregator", "Review aggregator", "Sites that collect and rank product reviews"),
    ("ugc_forum", "Forum", "Forums, Q&A and other user-generated discussion"),
    ("social", "Social", "Social networks"),
    ("video", "Video", "Video platforms"),
    ("wiki_reference", "Wiki or reference", "Encyclopedias and reference works"),
    ("vendor_site", "Vendor site", "A company's own site about its products"),
    ("marketplace", "Marketplace", "Marketplaces and app stores"),
    ("directory", "Directory", "Business and software directories"),
    ("government", "Government", "Government sites"),
    ("education", "Education", "Universities, schools and course sites"),
    ("blog_independent", "Independent blog", "Blogs not run by a vendor or publisher"),
    ("affiliate", "Affiliate", "Sites that earn from referral links"),
    ("docs", "Documentation", "Product and developer documentation"),
    ("other", "Other", "Anything not in another category"),
)

_TABLES = """
CREATE TABLE core.domain_categories (
    code         text PRIMARY KEY,
    label        text NOT NULL,
    description  text NOT NULL
);

CREATE TABLE core.domains (
    id                  integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    host                text NOT NULL CHECK (host = lower(host) AND host <> ''),
    registrable_domain  text NOT NULL,
    public_suffix       text NOT NULL,
    is_ip               boolean NOT NULL DEFAULT false,
    default_category    text REFERENCES core.domain_categories(code),
    category_source     text CHECK (category_source IN ('seed_list','rule','llm','manual')),
    category_version    smallint,
    first_seen_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (host)
);

CREATE INDEX domains_registrable_domain ON core.domains (registrable_domain);

CREATE TABLE core.locations (
    id             integer PRIMARY KEY,
    name           text NOT NULL,
    country_iso    char(2) NOT NULL,
    location_type  text NOT NULL,
    parent_id      integer REFERENCES core.locations(id),
    is_active      boolean NOT NULL DEFAULT true
);

CREATE INDEX locations_name ON core.locations USING gin (name gin_trgm_ops);

CREATE TABLE core.provider_location_map (
    provider_code   text NOT NULL REFERENCES ops.providers(code),
    location_id     integer NOT NULL REFERENCES core.locations(id),
    provider_value  text NOT NULL,
    supports        text[] NOT NULL,
    PRIMARY KEY (provider_code, location_id)
);

ALTER TABLE core.projects
    ADD CONSTRAINT projects_id_workspace_id_key UNIQUE (id, workspace_id),
    ADD CONSTRAINT projects_primary_domain_id_fkey
        FOREIGN KEY (primary_domain_id) REFERENCES core.domains(id),
    ADD CONSTRAINT projects_default_location_id_fkey
        FOREIGN KEY (default_location_id) REFERENCES core.locations(id);

CREATE TABLE core.entities (
    id                    uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id          uuid NOT NULL REFERENCES auth.workspaces(id) ON DELETE CASCADE,
    entity_type           text NOT NULL CHECK (entity_type IN ('brand','product',
                                                                'organization','person','other')),
    canonical_name        text NOT NULL CHECK (length(canonical_name) BETWEEN 1 AND 200),
    parent_entity_id      uuid,
    description           text,
    is_ambiguous          boolean NOT NULL DEFAULT false,
    disambiguation_hints  text[] NOT NULL DEFAULT '{}',
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, workspace_id),
    CHECK (parent_entity_id IS DISTINCT FROM id),
    FOREIGN KEY (parent_entity_id, workspace_id) REFERENCES core.entities(id, workspace_id)
);

CREATE UNIQUE INDEX entities_workspace_name_type
    ON core.entities (workspace_id, lower(canonical_name), entity_type);

CREATE TABLE core.entity_aliases (
    id                uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id      uuid NOT NULL,
    entity_id         uuid NOT NULL,
    alias             text NOT NULL CHECK (length(alias) BETWEEN 1 AND 200),
    match_mode        text NOT NULL DEFAULT 'word_boundary'
                      CHECK (match_mode IN ('word_boundary','exact_case','substring','regex')),
    case_sensitive    boolean NOT NULL DEFAULT false,
    language_code     text,
    is_negative       boolean NOT NULL DEFAULT false,
    requires_context  boolean NOT NULL DEFAULT false,
    created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (entity_id, alias, match_mode, is_negative),
    FOREIGN KEY (entity_id, workspace_id) REFERENCES core.entities(id, workspace_id)
        ON DELETE CASCADE
);

CREATE TABLE core.entity_domains (
    entity_id     uuid NOT NULL,
    workspace_id  uuid NOT NULL,
    domain_id     integer NOT NULL REFERENCES core.domains(id),
    match_scope   text NOT NULL DEFAULT 'registrable'
                  CHECK (match_scope IN ('host','registrable','path_prefix')),
    path_prefix   text,
    PRIMARY KEY (entity_id, domain_id, match_scope),
    CHECK ((match_scope = 'path_prefix') = (path_prefix IS NOT NULL)),
    FOREIGN KEY (entity_id, workspace_id) REFERENCES core.entities(id, workspace_id)
        ON DELETE CASCADE
);

CREATE INDEX entity_domains_domain_id ON core.entity_domains (domain_id);

CREATE TABLE core.project_entities (
    project_id    uuid NOT NULL,
    entity_id     uuid NOT NULL,
    workspace_id  uuid NOT NULL,
    role          text NOT NULL CHECK (role IN ('own','competitor','watch')),
    is_primary    boolean NOT NULL DEFAULT false,
    track_seo     boolean NOT NULL DEFAULT true,
    track_ai      boolean NOT NULL DEFAULT true,
    color         text CHECK (color ~ '^#[0-9a-f]{6}$'),
    added_at      timestamptz NOT NULL DEFAULT now(),
    removed_at    timestamptz,
    PRIMARY KEY (project_id, entity_id),
    CHECK (NOT is_primary OR role = 'own'),
    FOREIGN KEY (project_id, workspace_id) REFERENCES core.projects(id, workspace_id)
        ON DELETE CASCADE,
    FOREIGN KEY (entity_id, workspace_id) REFERENCES core.entities(id, workspace_id)
        ON DELETE CASCADE
);

CREATE UNIQUE INDEX project_one_primary_own ON core.project_entities (project_id)
    WHERE role = 'own' AND is_primary AND removed_at IS NULL;

CREATE INDEX project_entities_entity_id ON core.project_entities (entity_id);

CREATE VIEW core.project_domain_roles WITH (security_invoker = true) AS
SELECT pe.project_id, pe.workspace_id, pe.entity_id, pe.role,
       ed.domain_id, ed.match_scope, ed.path_prefix
FROM core.project_entities pe
JOIN core.entity_domains ed
  ON ed.entity_id = pe.entity_id AND ed.workspace_id = pe.workspace_id
WHERE pe.removed_at IS NULL;

CREATE TABLE core.taxonomy_vocabularies (
    id                uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id      uuid NOT NULL REFERENCES auth.workspaces(id) ON DELETE CASCADE,
    project_id        uuid,
    kind              text NOT NULL CHECK (kind IN ('topic','cluster','product','service','market',
                                                     'campaign','persona','tag','custom')),
    name              text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
    is_hierarchical   boolean NOT NULL DEFAULT false,
    is_single_valued  boolean NOT NULL DEFAULT false,
    UNIQUE NULLS NOT DISTINCT (workspace_id, project_id, kind, name),
    UNIQUE (id, workspace_id),
    FOREIGN KEY (project_id, workspace_id) REFERENCES core.projects(id, workspace_id)
        ON DELETE CASCADE
);

CREATE TABLE core.taxonomy_terms (
    id             uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id   uuid NOT NULL,
    vocabulary_id  uuid NOT NULL,
    parent_id      uuid,
    name           text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
    slug           citext NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    path           text NOT NULL,
    source         text NOT NULL DEFAULT 'manual'
                   CHECK (source IN ('manual','import','auto_cluster','ai_suggestion')),
    description    text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE NULLS NOT DISTINCT (vocabulary_id, parent_id, slug),
    UNIQUE (id, workspace_id),
    CHECK (parent_id IS DISTINCT FROM id),
    FOREIGN KEY (vocabulary_id, workspace_id)
        REFERENCES core.taxonomy_vocabularies(id, workspace_id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id, workspace_id) REFERENCES core.taxonomy_terms(id, workspace_id)
        ON DELETE CASCADE
);

CREATE INDEX taxonomy_terms_vocabulary_path
    ON core.taxonomy_terms (vocabulary_id, path text_pattern_ops)
"""

_TENANT_TABLES = (
    "core.entities",
    "core.entity_aliases",
    "core.entity_domains",
    "core.project_entities",
    "core.taxonomy_vocabularies",
    "core.taxonomy_terms",
)
_CRUD = "SELECT, INSERT, UPDATE, DELETE"


def upgrade() -> None:
    for statement in statements(_TABLES):
        op.execute(statement)
    seed = text(
        "INSERT INTO core.domain_categories (code, label, description) "
        "VALUES (:code, :label, :description)"
    )
    for code, label, description in _CATEGORIES:
        op.get_bind().execute(seed, {"code": code, "label": label, "description": description})
    for table in _TENANT_TABLES:
        for statement in tenant_isolation(table):
            op.execute(statement)
    script = [
        *grants("core.domain_categories", api="SELECT"),
        *grants("core.domains", api="SELECT, INSERT"),
        *grants("core.locations", api="SELECT", worker="SELECT, INSERT, UPDATE"),
        *grants("core.provider_location_map", api="SELECT", worker="SELECT, INSERT, UPDATE"),
        *grants("core.entities", api=_CRUD),
        *grants("core.entity_aliases", api=_CRUD),
        *grants("core.entity_domains", api="SELECT, INSERT, DELETE"),
        *grants("core.project_entities", api="SELECT, INSERT, UPDATE"),
        *grants("core.taxonomy_vocabularies", api=_CRUD),
        *grants("core.taxonomy_terms", api=_CRUD),
        "GRANT SELECT ON core.project_domain_roles TO app_api",
    ]
    for statement in script:
        op.execute(statement)


def downgrade() -> None:
    # Local development only.
    op.execute("DROP VIEW core.project_domain_roles")
    op.execute(
        "DROP TABLE core.taxonomy_terms, core.taxonomy_vocabularies, core.project_entities, "
        "core.entity_domains, core.entity_aliases, core.entities"
    )
    op.execute(
        "ALTER TABLE core.projects DROP CONSTRAINT projects_default_location_id_fkey, "
        "DROP CONSTRAINT projects_primary_domain_id_fkey, "
        "DROP CONSTRAINT projects_id_workspace_id_key"
    )
    op.execute(
        "DROP TABLE core.provider_location_map, core.locations, core.domains, "
        "core.domain_categories"
    )
