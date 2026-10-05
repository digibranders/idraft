"""Rank collection: SERP snapshots, features, rank observations, current state and rank events.

Table definitions follow docs/04-data-model.md sections 7.3 to 7.6 and docs/09-rank-tracking-
methodology.md section 4.1, with these choices (plan `docs/superpowers/plans/2026-10-05-rank-
collection.md`, decisions R6 and R7):

- Every tenant table carries `workspace_id`, and keys between tenant tables include it. The
  current state and the current results gain it (doc 04 has none), and the snapshot refers to
  its tracked keyword through `(id, project_id, workspace_id)`.
- One snapshot per task: `(collection_task_id, observed_at)` is unique, so ingest can run
  twice. `(id, observed_at, workspace_id)` is unique so that features and observations refer to
  their snapshot with the workspace.
- The state gains `consecutive_beyond` (the two-check debounce of `new_ranking` and
  `lost_ranking`), `last_ranked_rank` (how deep a check must look to say the keyword is gone)
  and `previous_depth_requested` (the depth the previous check looked at).
- Observation tables are append-only for the worker: SELECT and INSERT. The state is changed in
  named columns only, and the current results are replaced (INSERT and DELETE).
- Rows of entities (`entity_id`, `other_entity_id`) and URLs are historical facts and carry no
  key: an entity may be removed later, and the arrays of ids cannot carry keys.
- The worker reads what ingest resolves ranks against: entities, their domains, the project's
  roles and a keyword's competitor overrides. The raw payload of a snapshot is read through a
  definer function, because `ops.raw_payloads` has no workspace (review log F8).
- SERP prices go in the price book (docs/27-cost-model.md section 1).
- Schedules of the `seo_rank` workload made before the workload existed start at their next
  window instead of having their past windows recorded as missed (review log F72).

Revision ID: 0013
Revises: 0012
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from alembic import op
from sqlalchemy import text

from sightline.db.ddl import column_grant, grants, statements, tenant_isolation

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None

_EVENT_TYPES = (
    "entered_top_3",
    "entered_top_10",
    "entered_top_20",
    "entered_top_100",
    "lost_top_3",
    "lost_top_10",
    "lost_top_20",
    "lost_top_100",
    "new_ranking",
    "lost_ranking",
    "rank_drop",
    "rank_gain",
    "url_changed",
    "feature_gained",
    "feature_lost",
    "aio_appeared",
    "aio_disappeared",
    "aio_citation_gained",
    "aio_citation_lost",
    "overtaken_by",
    "overtook",
)
_EVENT_TYPE_LIST = ", ".join(f"'{name}'" for name in _EVENT_TYPES)

# code, label, ownable (a domain can own it: it has source URLs), docs/06 section 5.4.
_FEATURE_TYPES = (
    ("ai_overview", "AI Overview", True),
    ("featured_snippet", "Featured snippet", True),
    ("people_also_ask", "People also ask", True),
    ("local_pack", "Local pack", True),
    ("knowledge_graph", "Knowledge graph", True),
    ("top_stories", "Top stories", True),
    ("video", "Video", True),
    ("images", "Images", True),
    ("discussions_and_forums", "Discussions and forums", True),
    ("perspectives", "Perspectives", True),
    ("shopping", "Shopping", True),
    ("related_searches", "Related searches", False),
    ("social_posts", "Social posts", True),
    ("answer_box", "Answer box", True),
    ("ads", "Ads", True),
    ("sitelinks", "Sitelinks", True),
)

_TABLES = f"""
CREATE TABLE seo.serp_feature_types (
    code                text PRIMARY KEY CHECK (length(code) BETWEEN 1 AND 100),
    label               text NOT NULL,
    ownable             boolean NOT NULL,
    tracked_by_default  boolean NOT NULL DEFAULT true
);

CREATE TABLE seo.serp_snapshots (
    id                     bigint GENERATED ALWAYS AS IDENTITY,
    observed_at            timestamptz NOT NULL,
    observed_date          date NOT NULL,
    workspace_id           uuid NOT NULL,
    project_id             uuid NOT NULL,
    tracked_keyword_id     uuid NOT NULL,
    config_version         integer NOT NULL,
    collection_task_id     bigint,
    observation_class      text NOT NULL DEFAULT 'serp' CHECK (observation_class = 'serp'),
    provider_code          text NOT NULL,
    provider_endpoint      text NOT NULL,
    provider_task_id       text,
    se_domain              text,
    location_id            integer NOT NULL,
    language_code          text NOT NULL,
    device                 text NOT NULL CHECK (device IN ('desktop','mobile')),
    os                     text,
    depth_requested        smallint NOT NULL CHECK (depth_requested BETWEEN 1 AND 700),
    depth_returned         smallint NOT NULL CHECK (depth_returned BETWEEN 0 AND 700),
    se_results_count       bigint,
    item_types             text[] NOT NULL,
    organic_url_ids        bigint[] NOT NULL,
    organic_domain_ids     integer[] NOT NULL,
    organic_abs_positions  smallint[] NOT NULL,
    has_ai_overview        boolean NOT NULL,
    ai_overview_state      text CHECK (ai_overview_state IN
                               ('absent','present','present_async_loaded','present_not_loaded')),
    has_ai_mode_link       boolean,
    raw_payload_id         bigint NOT NULL REFERENCES ops.raw_payloads(id),
    parser_version         smallint NOT NULL,
    canonicalizer_version  smallint NOT NULL,
    cost_usd               numeric(14,6),
    served_from_cache      boolean NOT NULL DEFAULT false,
    extras                 jsonb CHECK (extras IS NULL OR octet_length(extras::text) <= 8192),
    superseded_by          bigint,
    PRIMARY KEY (id, observed_at),
    CONSTRAINT serp_snapshots_identity_key
        UNIQUE (id, observed_at, workspace_id, project_id, tracked_keyword_id),
    UNIQUE (collection_task_id, observed_at),
    CHECK (cardinality(organic_url_ids) = cardinality(organic_domain_ids)
           AND cardinality(organic_url_ids) = cardinality(organic_abs_positions)),
    FOREIGN KEY (tracked_keyword_id, project_id, workspace_id)
        REFERENCES seo.tracked_keywords(id, project_id, workspace_id) ON DELETE CASCADE
) PARTITION BY RANGE (observed_at);

CREATE INDEX serp_snapshots_keyword_observed
    ON seo.serp_snapshots (tracked_keyword_id, observed_at DESC);

CREATE INDEX serp_snapshots_project_date ON seo.serp_snapshots (project_id, observed_date);

CREATE INDEX serp_snapshots_observed_brin
    ON seo.serp_snapshots USING brin (observed_at) WITH (pages_per_range = 64);

CREATE TABLE seo.serp_features (
    id                     bigint GENERATED ALWAYS AS IDENTITY,
    observed_at            timestamptz NOT NULL,
    serp_snapshot_id       bigint NOT NULL,
    workspace_id           uuid NOT NULL,
    project_id             uuid NOT NULL,
    tracked_keyword_id     uuid NOT NULL,
    feature_type           text NOT NULL REFERENCES seo.serp_feature_types(code),
    ordinal                smallint NOT NULL CHECK (ordinal >= 1),
    rank_absolute          smallint,
    source_url_ids         bigint[] NOT NULL DEFAULT '{{}}',
    source_domain_ids      integer[] NOT NULL DEFAULT '{{}}',
    owned_by_project       boolean NOT NULL,
    owned_position         smallint,
    competitor_entity_ids  uuid[] NOT NULL DEFAULT '{{}}',
    payload                jsonb CHECK (payload IS NULL OR octet_length(payload::text) <= 4096),
    parser_version         smallint NOT NULL,
    PRIMARY KEY (id, observed_at),
    CHECK (cardinality(source_url_ids) = cardinality(source_domain_ids)),
    FOREIGN KEY (serp_snapshot_id, observed_at, workspace_id, project_id, tracked_keyword_id)
        REFERENCES seo.serp_snapshots(id, observed_at, workspace_id, project_id, tracked_keyword_id)
        ON DELETE CASCADE
) PARTITION BY RANGE (observed_at);

CREATE INDEX serp_features_keyword_type
    ON seo.serp_features (tracked_keyword_id, feature_type, observed_at DESC);

CREATE INDEX serp_features_snapshot ON seo.serp_features (serp_snapshot_id);

CREATE TABLE seo.domain_rank_observations (
    serp_snapshot_id               bigint NOT NULL,
    observed_at                    timestamptz NOT NULL,
    observed_date                  date NOT NULL,
    workspace_id                   uuid NOT NULL,
    project_id                     uuid NOT NULL,
    tracked_keyword_id             uuid NOT NULL,
    entity_id                      uuid NOT NULL,
    role                           text NOT NULL CHECK (role IN ('own','competitor')),
    organic_rank                   smallint CHECK (organic_rank BETWEEN 1 AND 700),
    absolute_rank                  smallint,
    ranking_url_id                 bigint,
    ranking_title                  text,
    ranking_snippet                text,
    all_organic_ranks              smallint[] NOT NULL DEFAULT '{{}}',
    all_url_ids                    bigint[] NOT NULL DEFAULT '{{}}',
    result_count                   smallint NOT NULL DEFAULT 0,
    owned_feature_types            text[] NOT NULL DEFAULT '{{}}',
    cited_in_ai_overview           boolean,
    ai_overview_citation_position  smallint,
    depth_requested                smallint NOT NULL,
    is_valid                       boolean NOT NULL DEFAULT true,
    PRIMARY KEY (tracked_keyword_id, entity_id, observed_at, serp_snapshot_id),
    CHECK ((organic_rank IS NULL) = (ranking_url_id IS NULL)),
    CHECK (cardinality(all_organic_ranks) = cardinality(all_url_ids)),
    FOREIGN KEY (serp_snapshot_id, observed_at, workspace_id, project_id, tracked_keyword_id)
        REFERENCES seo.serp_snapshots(id, observed_at, workspace_id, project_id, tracked_keyword_id)
        ON DELETE CASCADE
) PARTITION BY RANGE (observed_at);

CREATE INDEX domain_rank_observations_snapshot
    ON seo.domain_rank_observations (serp_snapshot_id, observed_at);

CREATE INDEX domain_rank_observations_project_date
    ON seo.domain_rank_observations (project_id, observed_date, role);

CREATE INDEX domain_rank_observations_url
    ON seo.domain_rank_observations (ranking_url_id, observed_at DESC)
    WHERE ranking_url_id IS NOT NULL;

CREATE TABLE seo.tracked_keyword_state (
    tracked_keyword_id       uuid PRIMARY KEY,
    workspace_id             uuid NOT NULL,
    project_id               uuid NOT NULL,
    last_snapshot_id         bigint,
    last_observed_at         timestamptz,
    current_rank             smallint CHECK (current_rank BETWEEN 1 AND 700),
    current_absolute_rank    smallint,
    current_url_id           bigint,
    previous_rank            smallint,
    previous_observed_at     timestamptz,
    previous_depth_requested smallint,
    rank_change              smallint,
    best_rank                smallint,
    best_rank_at             timestamptz,
    worst_rank               smallint,
    first_ranked_at          timestamptz,
    feature_types_present    text[] NOT NULL DEFAULT '{{}}',
    owned_feature_types      text[] NOT NULL DEFAULT '{{}}',
    has_ai_overview          boolean,
    cited_in_ai_overview     boolean,
    aio_state                text CHECK (aio_state IN ('absent','present_not_cited',
                                 'present_cited','not_loaded','unknown')),
    aio_citation_position    smallint,
    aio_observation_id       bigint,
    current_depth_requested  smallint,
    target_url_match         boolean,
    url_changed_at           timestamptz,
    consecutive_failures     smallint NOT NULL DEFAULT 0,
    consecutive_beyond       smallint NOT NULL DEFAULT 0,
    last_ranked_rank         smallint,
    is_stale                 boolean NOT NULL DEFAULT false,
    updated_at               timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (tracked_keyword_id, project_id, workspace_id)
        REFERENCES seo.tracked_keywords(id, project_id, workspace_id) ON DELETE CASCADE
) WITH (fillfactor = 80);

CREATE INDEX tracked_keyword_state_project_rank
    ON seo.tracked_keyword_state (project_id, current_rank);

CREATE TABLE seo.serp_current_results (
    tracked_keyword_id  uuid NOT NULL,
    workspace_id        uuid NOT NULL,
    project_id          uuid NOT NULL,
    organic_rank        smallint NOT NULL CHECK (organic_rank BETWEEN 1 AND 20),
    serp_snapshot_id    bigint NOT NULL,
    absolute_rank       smallint,
    url_id              bigint NOT NULL REFERENCES core.urls(id),
    domain_id           integer NOT NULL REFERENCES core.domains(id),
    title               text,
    snippet             text,
    PRIMARY KEY (tracked_keyword_id, organic_rank),
    FOREIGN KEY (tracked_keyword_id, project_id, workspace_id)
        REFERENCES seo.tracked_keywords(id, project_id, workspace_id) ON DELETE CASCADE
) WITH (fillfactor = 80);

CREATE TABLE seo.rank_events (
    id                  bigint GENERATED ALWAYS AS IDENTITY,
    occurred_at         timestamptz NOT NULL,
    workspace_id        uuid NOT NULL,
    project_id          uuid NOT NULL,
    tracked_keyword_id  uuid NOT NULL,
    entity_id           uuid NOT NULL,
    event_type          text NOT NULL CHECK (event_type IN ({_EVENT_TYPE_LIST})),
    from_rank           smallint,
    to_rank             smallint,
    from_url_id         bigint,
    to_url_id           bigint,
    other_entity_id     uuid,
    feature_type        text,
    serp_snapshot_id    bigint NOT NULL,
    PRIMARY KEY (id, occurred_at),
    CHECK ((event_type IN ('feature_gained','feature_lost')) = (feature_type IS NOT NULL)),
    FOREIGN KEY (tracked_keyword_id, project_id, workspace_id)
        REFERENCES seo.tracked_keywords(id, project_id, workspace_id) ON DELETE CASCADE
) PARTITION BY RANGE (occurred_at);

CREATE INDEX rank_events_project_time ON seo.rank_events (project_id, occurred_at DESC, event_type);

CREATE INDEX rank_events_keyword_time ON seo.rank_events (tracked_keyword_id, occurred_at DESC);

INSERT INTO ops.partitioned_tables (parent)
VALUES ('seo.serp_snapshots'), ('seo.serp_features'), ('seo.domain_rank_observations'),
       ('seo.rank_events');

SELECT ops.maintain_partitions();
"""

# The raw payload of a snapshot of the current workspace, and nothing else of the table.
_RAW_LOOKUP = """
CREATE FUNCTION seo.serp_snapshot_raw(p_snapshot_id bigint)
RETURNS TABLE (
    storage text, object_key text, inline_body bytea, sha256 bytea, bytes_raw integer,
    bytes_stored integer, compression text, content_type text, fetched_at timestamptz,
    retention_class text, expires_at timestamptz)
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
    BEGIN ATOMIC
        SELECT r.storage, r.object_key, r.inline_body, r.sha256, r.bytes_raw, r.bytes_stored,
               r.compression, r.content_type, r.fetched_at, r.retention_class, r.expires_at
        FROM seo.serp_snapshots s
        JOIN ops.raw_payloads r ON r.id = s.raw_payload_id
        WHERE s.id = p_snapshot_id AND s.workspace_id = auth.current_workspace_id();
    END;

REVOKE ALL ON FUNCTION seo.serp_snapshot_raw(bigint) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION seo.serp_snapshot_raw(bigint) TO app_api;
"""

_TENANT_TABLES = (
    "seo.serp_snapshots",
    "seo.serp_features",
    "seo.domain_rank_observations",
    "seo.tracked_keyword_state",
    "seo.serp_current_results",
    "seo.rank_events",
)
# Everything the worker changes in a keyword's state; never the keys that place the row.
_STATE_WORKER_UPDATE = (
    "last_snapshot_id",
    "last_observed_at",
    "current_rank",
    "current_absolute_rank",
    "current_url_id",
    "previous_rank",
    "previous_observed_at",
    "previous_depth_requested",
    "rank_change",
    "best_rank",
    "best_rank_at",
    "worst_rank",
    "first_ranked_at",
    "feature_types_present",
    "owned_feature_types",
    "has_ai_overview",
    "cited_in_ai_overview",
    "aio_state",
    "aio_citation_position",
    "aio_observation_id",
    "current_depth_requested",
    "target_url_match",
    "url_changed_at",
    "consecutive_failures",
    "consecutive_beyond",
    "last_ranked_rank",
    "is_stale",
    "updated_at",
)

# docs/27-cost-model.md section 1, verified 2026-09-29: a page is 10 results.
_SERP_ENDPOINT = "serp/google/organic"
_SERP_PRICING_URL = "https://dataforseo.com/pricing/serp-api/google-serp-api"
_SERP_PRICES = (
    ("page", Decimal("0.0006"), '{"queue": "standard"}'),
    ("page", Decimal("0.0012"), '{"queue": "priority"}'),
    ("page", Decimal("0.002"), '{"queue": "live"}'),
    # Added to a standard task when an asynchronous AI Overview is fetched; refunded otherwise.
    ("task", Decimal("0.0006"), '{"queue": "standard", "async_ai_overview": true}'),
)

_WORKER_READS = (
    "core.entities",
    "core.entity_domains",
    "core.project_entities",
    "core.project_domain_roles",
    "seo.tracked_keyword_competitors",
)


def upgrade() -> None:
    for statement in statements(_TABLES):
        op.execute(statement)
    bind = op.get_bind()
    for code, label, ownable in _FEATURE_TYPES:
        bind.execute(
            text(
                "INSERT INTO seo.serp_feature_types (code, label, ownable) "
                "VALUES (:code, :label, :ownable)"
            ),
            {"code": code, "label": label, "ownable": ownable},
        )
    seed = text(
        "INSERT INTO ops.provider_price_book (provider_code, endpoint, price_unit, "
        "unit_price_usd, conditions, valid_from, source_url, verified_at) "
        "VALUES ('dataforseo', :endpoint, :unit, :price, CAST(:conditions AS jsonb), "
        ":valid_from, :url, :verified)"
    )
    for unit, price, conditions in _SERP_PRICES:
        bind.execute(
            seed,
            {
                "endpoint": _SERP_ENDPOINT,
                "unit": unit,
                "price": price,
                "conditions": conditions,
                "valid_from": date(2026, 7, 1),
                "url": _SERP_PRICING_URL,
                "verified": date(2026, 9, 29),
            },
        )
    for table in _TENANT_TABLES:
        for statement in tenant_isolation(table):
            op.execute(statement)
    script = [
        *grants("seo.serp_feature_types", api="SELECT", worker="SELECT, INSERT"),
        *grants("seo.serp_snapshots", api="SELECT", worker="SELECT, INSERT"),
        *grants("seo.serp_features", api="SELECT", worker="SELECT, INSERT"),
        *grants("seo.domain_rank_observations", api="SELECT", worker="SELECT, INSERT"),
        *grants("seo.rank_events", api="SELECT", worker="SELECT, INSERT"),
        *grants("seo.tracked_keyword_state", api="SELECT", worker="SELECT, INSERT"),
        column_grant(
            "seo.tracked_keyword_state",
            role="app_worker",
            privilege="UPDATE",
            columns=_STATE_WORKER_UPDATE,
        ),
        *grants("seo.serp_current_results", api="SELECT", worker="SELECT, INSERT, DELETE"),
        *(statement for table in _WORKER_READS for statement in grants(table, worker="SELECT")),
    ]
    for statement in script:
        op.execute(statement)
    for statement in statements(_RAW_LOOKUP):
        op.execute(statement)
    # Review log F72: a schedule made before the workload existed would have its past windows
    # recorded as missed once the planner knows the workload.
    op.execute(
        "UPDATE ops.schedules SET next_run_at = greatest(next_run_at, now()) "
        "WHERE workload = 'seo_rank' AND deleted_at IS NULL"
    )


def downgrade() -> None:
    # Local development only.
    op.execute("DROP FUNCTION seo.serp_snapshot_raw(bigint)")
    for table in _WORKER_READS:
        op.execute(f"REVOKE SELECT ON {table} FROM app_worker")
    op.execute(
        "DELETE FROM ops.partitioned_tables WHERE parent IN ('seo.serp_snapshots'::regclass, "
        "'seo.serp_features'::regclass, 'seo.domain_rank_observations'::regclass, "
        "'seo.rank_events'::regclass)"
    )
    op.execute(
        "DROP TABLE seo.rank_events, seo.serp_current_results, seo.tracked_keyword_state, "
        "seo.domain_rank_observations, seo.serp_features, seo.serp_snapshots, "
        "seo.serp_feature_types"
    )
    op.execute(
        "DELETE FROM ops.provider_price_book WHERE provider_code = 'dataforseo' "
        f"AND endpoint = '{_SERP_ENDPOINT}'"
    )
