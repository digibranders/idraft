"""AI prompt tracking, slice 1: engines, project engines, prompts with versions and terms,
answers with their citations, and what extraction finds in them.

Table definitions follow docs/04-data-model.md sections 8.1 to 8.5 (panels, fan-out, retrieval
results and claims wait for their slices), with these choices (plan
`docs/superpowers/plans/2026-11-11-ai-prompts-a-data-and-prompts-api.md`):

- Every tenant table carries `workspace_id`, `ai.derivations` and `ai.prompt_terms` included
  (doc 04 has none on them), and keys between tenant tables include it (decision A1). A
  prompt's current version is one of its own versions, checked at commit, so a prompt and its
  first version are written in one transaction in either order.
- The answer tables are partitioned by month on `observed_at`, which is part of every key that
  names an answer. One answer per task: `(collection_task_id, observed_at)` is unique, so ingest
  can run twice. Answers keep their raw payload by key. Entities and URLs carry no key: they
  are historical facts.
- The API keeps prompts and engines; the worker writes answers and what it found in them,
  append-only. The worker reads entity aliases from now on: extraction matches them.
- The raw payload of an answer is read through a definer function, because `ops.raw_payloads`
  has no workspace (review log F8), as for SERP snapshots.
- The engines and their task prices are seeded (docs/07 sections 1 and 7.1; billed at these
  prices in spike S-04 on 2026-11-11).
- The base plan (owner, 2026-11-11) allows 150 active prompts: the quota default becomes 150,
  and quotas still at the old default of 1,000 move to it (decision A3).

Revision ID: 0018
Revises: 0017
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from alembic import op
from sqlalchemy import text

from idraft.db.ddl import column_grant, grants, statements, tenant_isolation

revision: str = "0018"
down_revision: str | None = "0017"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None

_TABLES = """
CREATE TABLE ai.engines (
    code                text PRIMARY KEY CHECK (length(code) BETWEEN 1 AND 100),
    label               text NOT NULL,
    observation_class   text NOT NULL
                        CHECK (observation_class IN ('consumer_ui','official_api','serp_ai')),
    vendor              text NOT NULL,
    exposes_citations   boolean NOT NULL,
    exposes_fanout      boolean NOT NULL,
    is_active           boolean NOT NULL DEFAULT true
);

CREATE TABLE ai.project_engines (
    project_id      uuid NOT NULL,
    engine_code     text NOT NULL REFERENCES ai.engines(code),
    workspace_id    uuid NOT NULL,
    location_ids    integer[] NOT NULL CHECK (cardinality(location_ids) BETWEEN 1 AND 50),
    replicates      smallint NOT NULL DEFAULT 1 CHECK (replicates BETWEEN 1 AND 20),
    provider_code   text NOT NULL REFERENCES ops.providers(code),
    provider_params jsonb NOT NULL DEFAULT '{}',
    is_enabled      boolean NOT NULL DEFAULT true,
    PRIMARY KEY (project_id, engine_code),
    FOREIGN KEY (project_id, workspace_id) REFERENCES core.projects(id, workspace_id)
        ON DELETE CASCADE
);

CREATE TABLE ai.prompts (
    id                 uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id       uuid NOT NULL,
    project_id         uuid NOT NULL,
    current_version_id uuid,
    language_code      text NOT NULL CHECK (language_code ~ '^[a-z]{2}$'),
    country_iso        char(2) CHECK (country_iso ~ '^[A-Z]{2}$'),
    intent             text NOT NULL DEFAULT 'unknown'
                       CHECK (intent IN ('informational','navigational','commercial',
                                         'transactional','local','unknown')),
    funnel_stage       text NOT NULL DEFAULT 'unknown'
                       CHECK (funnel_stage IN ('tofu','mofu','bofu','retention','unknown')),
    is_branded         boolean NOT NULL DEFAULT false,
    prompt_type        text NOT NULL DEFAULT 'question'
                       CHECK (prompt_type IN ('question','comparison','recommendation','how_to',
                                              'definition','local','transactional','other')),
    importance         smallint NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
    expected_frequency text NOT NULL DEFAULT 'weekly'
                       CHECK (expected_frequency IN ('daily','weekly','monthly')),
    source             text NOT NULL DEFAULT 'manual'
                       CHECK (source IN ('manual','csv_import','api','seo_keyword','gsc_query',
                                         'bing_query','paa','autocomplete','related_search',
                                         'competitor_keyword','site_crawl','faq',
                                         'support_ticket','fanout','llm_variant','llm_mentions',
                                         'ai_demand_estimate')),
    creation_method    text NOT NULL DEFAULT 'human'
                       CHECK (creation_method IN ('human','template','llm_generated','imported')),
    persona_term_id    uuid,
    is_active          boolean NOT NULL DEFAULT true,
    created_by         uuid REFERENCES auth.users(id),
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    deleted_at         timestamptz,
    CONSTRAINT prompts_id_workspace_id_key UNIQUE (id, workspace_id),
    FOREIGN KEY (project_id, workspace_id) REFERENCES core.projects(id, workspace_id)
        ON DELETE CASCADE,
    FOREIGN KEY (persona_term_id, workspace_id)
        REFERENCES core.taxonomy_terms(id, workspace_id)
);

CREATE INDEX prompts_live_project ON ai.prompts (project_id) WHERE deleted_at IS NULL;

-- The workspace's active prompts: what the quota counts.
CREATE INDEX prompts_active_workspace ON ai.prompts (workspace_id)
    WHERE is_active AND deleted_at IS NULL;

-- At most 2,000 characters: the longest prompt any engine takes (doc 07 section 3.1).
CREATE TABLE ai.prompt_versions (
    id               uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id     uuid NOT NULL,
    prompt_id        uuid NOT NULL,
    version_no       integer NOT NULL CHECK (version_no >= 1),
    text             text NOT NULL CHECK (length(text) BETWEEN 1 AND 2000),
    text_hash        bytea NOT NULL CHECK (length(text_hash) = 32),
    context_preamble text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    created_by       uuid REFERENCES auth.users(id),
    change_kind      text NOT NULL CHECK (change_kind IN ('initial','wording','typo','context')),
    change_reason    text,
    CONSTRAINT prompt_versions_prompt_id_version_no_key UNIQUE (prompt_id, version_no),
    CONSTRAINT prompt_versions_prompt_id_text_hash_key UNIQUE (prompt_id, text_hash),
    CONSTRAINT prompt_versions_id_workspace_id_key UNIQUE (id, workspace_id),
    CONSTRAINT prompt_versions_id_prompt_id_workspace_id_key UNIQUE (id, prompt_id, workspace_id),
    FOREIGN KEY (prompt_id, workspace_id) REFERENCES ai.prompts(id, workspace_id)
        ON DELETE CASCADE
);

ALTER TABLE ai.prompts ADD CONSTRAINT prompts_current_version_fk
    FOREIGN KEY (current_version_id, id, workspace_id)
    REFERENCES ai.prompt_versions(id, prompt_id, workspace_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX prompt_versions_text_trgm ON ai.prompt_versions USING gin (text gin_trgm_ops);

-- A prompt's duplicate check: the same text in the workspace (plan decision A2).
CREATE INDEX prompt_versions_workspace_hash ON ai.prompt_versions (workspace_id, text_hash);

CREATE TABLE ai.prompt_terms (
    prompt_id    uuid NOT NULL,
    term_id      uuid NOT NULL,
    workspace_id uuid NOT NULL,
    assigned_by  text NOT NULL DEFAULT 'manual'
                 CHECK (assigned_by IN ('manual','import','rule','ai_suggestion')),
    PRIMARY KEY (prompt_id, term_id),
    FOREIGN KEY (prompt_id, workspace_id) REFERENCES ai.prompts(id, workspace_id)
        ON DELETE CASCADE,
    FOREIGN KEY (term_id, workspace_id) REFERENCES core.taxonomy_terms(id, workspace_id)
        ON DELETE CASCADE
);

CREATE INDEX prompt_terms_term_id ON ai.prompt_terms (term_id);

CREATE TABLE ai.observations (
    id                    bigint GENERATED ALWAYS AS IDENTITY,
    observed_at           timestamptz NOT NULL,
    observed_date         date NOT NULL,
    workspace_id          uuid NOT NULL,
    project_id            uuid NOT NULL,
    engine_code           text NOT NULL REFERENCES ai.engines(code),
    observation_class     text NOT NULL
                          CHECK (observation_class IN ('consumer_ui','official_api','serp_ai')),
    prompt_id             uuid,
    prompt_version_id     uuid,
    serp_snapshot_id      bigint,
    serp_observed_at      timestamptz,
    tracked_keyword_id    uuid,
    query_text            text NOT NULL,
    collection_run_id     uuid,
    collection_task_id    bigint,
    replicate_index       smallint NOT NULL DEFAULT 1 CHECK (replicate_index BETWEEN 1 AND 20),
    location_id           integer,
    language_code         text,
    device                text,
    provider_code         text NOT NULL,
    provider_endpoint     text NOT NULL,
    provider_task_id      text,
    model_reported        text,
    model_requested       text,
    status                text NOT NULL
                          CHECK (status IN ('complete','partial','empty','refused','error')),
    answer_text           text,
    answer_markdown       text,
    answer_html_available boolean NOT NULL DEFAULT false,
    answer_char_count     integer,
    answer_hash           bytea,
    has_citations         boolean NOT NULL,
    citation_count        smallint NOT NULL DEFAULT 0,
    fanout_count          smallint NOT NULL DEFAULT 0,
    raw_payload_id        bigint NOT NULL REFERENCES ops.raw_payloads(id),
    adapter_version       smallint NOT NULL,
    normalizer_version    smallint NOT NULL,
    canonicalizer_version smallint NOT NULL,
    latency_ms            integer,
    cost_usd              numeric(14,6),
    retry_count           smallint NOT NULL DEFAULT 0,
    error_code            text,
    served_from_cache     boolean NOT NULL DEFAULT false,
    provider_extras       jsonb CHECK (provider_extras IS NULL
                                       OR octet_length(provider_extras::text) <= 16384),
    superseded_by         bigint,
    PRIMARY KEY (id, observed_at),
    CONSTRAINT observations_id_observed_at_workspace_id_key UNIQUE (id, observed_at, workspace_id),
    CONSTRAINT observations_one_per_task UNIQUE (collection_task_id, observed_at),
    CONSTRAINT subject_exactly_one CHECK (
        (prompt_version_id IS NOT NULL AND serp_snapshot_id IS NULL)
     OR (prompt_version_id IS NULL AND serp_snapshot_id IS NOT NULL)
     OR (prompt_version_id IS NULL AND serp_snapshot_id IS NULL AND tracked_keyword_id IS NOT NULL)
    )
) PARTITION BY RANGE (observed_at);

CREATE INDEX observations_project_engine_date
    ON ai.observations (project_id, engine_code, observed_date);

CREATE INDEX observations_prompt_engine_observed
    ON ai.observations (prompt_id, engine_code, observed_at DESC) WHERE prompt_id IS NOT NULL;

CREATE INDEX observations_keyword_engine_observed
    ON ai.observations (tracked_keyword_id, engine_code, observed_at DESC)
    WHERE tracked_keyword_id IS NOT NULL;

CREATE INDEX observations_serp_snapshot
    ON ai.observations (serp_snapshot_id) WHERE serp_snapshot_id IS NOT NULL;

CREATE INDEX observations_observed_brin ON ai.observations USING brin (observed_at);

CREATE TABLE ai.citations (
    observation_id      bigint NOT NULL,
    observed_at         timestamptz NOT NULL,
    citation_index      smallint NOT NULL CHECK (citation_index >= 1),
    workspace_id        uuid NOT NULL,
    project_id          uuid NOT NULL,
    engine_code         text NOT NULL,
    url_id              bigint NOT NULL,
    domain_id           integer NOT NULL,
    raw_url             text NOT NULL,
    title               text,
    source_name         text,
    citation_kind       text NOT NULL
                        CHECK (citation_kind IN ('inline','source_list','search_result',
                                                 'reference_card','product_card','footnote')),
    first_char_offset   integer,
    answer_block_index  smallint,
    occurrences         smallint NOT NULL DEFAULT 1,
    domain_role         text NOT NULL CHECK (domain_role IN ('own','competitor','third_party')),
    role_entity_id      uuid,
    referral_tag        text,
    flags               text[] NOT NULL DEFAULT '{}',
    PRIMARY KEY (observation_id, observed_at, citation_index),
    FOREIGN KEY (observation_id, observed_at, workspace_id)
        REFERENCES ai.observations (id, observed_at, workspace_id) ON DELETE CASCADE
) PARTITION BY RANGE (observed_at);

CREATE INDEX citations_project_domain_observed ON ai.citations (project_id, domain_id, observed_at);

CREATE INDEX citations_url_observed ON ai.citations (url_id, observed_at);

CREATE TABLE ai.derivations (
    id                     integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    workspace_id           uuid NOT NULL,
    project_id             uuid NOT NULL,
    extractor_version      smallint NOT NULL,
    entity_config_version  integer NOT NULL,
    recommendation_version smallint NOT NULL,
    sentiment_version      smallint NOT NULL,
    created_at             timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT derivations_identity UNIQUE (project_id, extractor_version, entity_config_version,
                                            recommendation_version, sentiment_version),
    CONSTRAINT derivations_id_workspace_id_key UNIQUE (id, workspace_id),
    FOREIGN KEY (project_id, workspace_id) REFERENCES core.projects(id, workspace_id)
        ON DELETE CASCADE
);

CREATE TABLE ai.entity_mentions (
    observation_id        bigint NOT NULL,
    observed_at           timestamptz NOT NULL,
    entity_id             uuid NOT NULL,
    derivation_id         integer NOT NULL,
    workspace_id          uuid NOT NULL,
    project_id            uuid NOT NULL,
    engine_code           text NOT NULL,
    role                  text NOT NULL CHECK (role IN ('own','competitor','watch','untracked')),
    mention_count         smallint NOT NULL,
    first_char_offset     integer NOT NULL,
    mention_order         smallint NOT NULL,
    prominence            numeric(5,4) NOT NULL,
    structured_rank       smallint,
    structured_list_size  smallint,
    is_recommended        boolean,
    recommendation_method text,
    sentiment             text CHECK (sentiment IN ('positive','neutral','negative','mixed')),
    sentiment_method      text,
    match_method          text NOT NULL,
    mention_status        text NOT NULL DEFAULT 'accepted'
                          CHECK (mention_status IN ('accepted','uncertain')),
    structured_list_index smallint,
    confidence            numeric(4,3) NOT NULL,
    evidence_spans        int4range[] NOT NULL,
    is_current            boolean NOT NULL DEFAULT true,
    PRIMARY KEY (observation_id, observed_at, entity_id, derivation_id),
    FOREIGN KEY (observation_id, observed_at, workspace_id)
        REFERENCES ai.observations (id, observed_at, workspace_id) ON DELETE CASCADE,
    FOREIGN KEY (derivation_id, workspace_id) REFERENCES ai.derivations (id, workspace_id)
) PARTITION BY RANGE (observed_at);

CREATE INDEX entity_mentions_project_entity_observed
    ON ai.entity_mentions (project_id, entity_id, observed_at) WHERE is_current;

CREATE TABLE ai.observation_facts (
    observation_id             bigint NOT NULL,
    observed_at                timestamptz NOT NULL,
    derivation_id              integer NOT NULL,
    workspace_id               uuid NOT NULL,
    project_id                 uuid NOT NULL,
    observed_date              date NOT NULL,
    engine_code                text NOT NULL,
    observation_class          text NOT NULL,
    prompt_id                  uuid,
    prompt_version_id          uuid,
    tracked_keyword_id         uuid,
    replicate_index            smallint NOT NULL,
    location_id                integer,
    is_valid                   boolean NOT NULL,
    own_mentioned              boolean NOT NULL,
    own_domain_cited           boolean NOT NULL,
    own_recommended            boolean,
    own_structured_rank        smallint,
    own_prominence             numeric(5,4),
    own_mention_order          smallint,
    own_sentiment              text,
    own_citation_count         smallint NOT NULL,
    total_citation_count       smallint NOT NULL,
    tracked_entities_mentioned smallint NOT NULL,
    competitor_mentions        uuid[] NOT NULL DEFAULT '{}',
    competitor_cited           uuid[] NOT NULL DEFAULT '{}',
    had_structured_list        boolean NOT NULL,
    is_current                 boolean NOT NULL DEFAULT true,
    computed_at                timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (observation_id, observed_at, derivation_id),
    FOREIGN KEY (observation_id, observed_at, workspace_id)
        REFERENCES ai.observations (id, observed_at, workspace_id) ON DELETE CASCADE,
    FOREIGN KEY (derivation_id, workspace_id) REFERENCES ai.derivations (id, workspace_id)
) PARTITION BY RANGE (observed_at);

CREATE INDEX observation_facts_project_date_engine
    ON ai.observation_facts (project_id, observed_date, engine_code) WHERE is_current;

CREATE INDEX observation_facts_prompt_engine_observed
    ON ai.observation_facts (prompt_id, engine_code, observed_at) WHERE is_current;

INSERT INTO ops.partitioned_tables (parent)
VALUES ('ai.observations'), ('ai.citations'), ('ai.entity_mentions'), ('ai.observation_facts');

SELECT ops.maintain_partitions();
"""

# The raw payload of an answer of the current workspace, and nothing else of the table.
_RAW_LOOKUP = """
CREATE FUNCTION ai.observation_raw(p_observation_id bigint)
RETURNS TABLE (
    storage text, object_key text, inline_body bytea, sha256 bytea, bytes_raw integer,
    bytes_stored integer, compression text, content_type text, fetched_at timestamptz,
    retention_class text, expires_at timestamptz)
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
    BEGIN ATOMIC
        SELECT r.storage, r.object_key, r.inline_body, r.sha256, r.bytes_raw, r.bytes_stored,
               r.compression, r.content_type, r.fetched_at, r.retention_class, r.expires_at
        FROM ai.observations o
        JOIN ops.raw_payloads r ON r.id = o.raw_payload_id
        WHERE o.id = p_observation_id AND o.workspace_id = auth.current_workspace_id();
    END;

REVOKE ALL ON FUNCTION ai.observation_raw(bigint) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION ai.observation_raw(bigint) TO app_api;
"""

_TENANT_TABLES = (
    "ai.project_engines",
    "ai.prompts",
    "ai.prompt_versions",
    "ai.prompt_terms",
    "ai.derivations",
    "ai.observations",
    "ai.citations",
    "ai.entity_mentions",
    "ai.observation_facts",
)
# Written by the worker only, and never changed.
_ANSWER_TABLES = (
    "ai.derivations",
    "ai.observations",
    "ai.citations",
    "ai.entity_mentions",
    "ai.observation_facts",
)
_PARTITIONED = ("ai.observations", "ai.citations", "ai.entity_mentions", "ai.observation_facts")
# What a prompt change may touch; its text, language, country and project never change.
_PROMPT_API_UPDATE = (
    "intent",
    "funnel_stage",
    "is_branded",
    "prompt_type",
    "importance",
    "is_active",
    "updated_at",
)

# code, label, observation class, vendor, exposes citations, exposes fan-out (docs/07 sections
# 1 and 2). The domain module `idraft.domain.ai_engines` holds the same values.
_ENGINES = (
    ("chatgpt_web", "ChatGPT", "consumer_ui", "openai", True, True),
    ("gemini_web", "Gemini", "consumer_ui", "google", True, False),
    ("google_ai_mode", "Google AI Mode", "serp_ai", "google", True, False),
)
_AI_ENDPOINTS = (
    "ai_optimization/chat_gpt/llm_scraper",
    "ai_optimization/gemini/llm_scraper",
    "serp/google/ai_mode",
)
# docs/07 section 7.1: per task, the same on the three endpoints.
_AI_PRICES = (
    (Decimal("0.0012"), '{"queue": "standard"}'),
    (Decimal("0.0024"), '{"queue": "priority"}'),
)
_AI_PRICING_URL = "https://dataforseo.com/pricing"
# The base plan's active prompt limit (`idraft.domain.ai_engines.BASE_PLAN`), and the default
# it replaces. A revision is frozen history, so it states the number rather than importing it.
_PROMPT_LIMIT = 150
_OLD_PROMPT_LIMIT = 1000


def upgrade() -> None:
    for statement in statements(_TABLES):
        op.execute(statement)
    bind = op.get_bind()
    for code, label, observation_class, vendor, citations, fanout in _ENGINES:
        bind.execute(
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
    seed = text(
        "INSERT INTO ops.provider_price_book (provider_code, endpoint, price_unit, "
        "unit_price_usd, conditions, valid_from, source_url, verified_at) "
        "VALUES ('dataforseo', :endpoint, 'task', :price, CAST(:conditions AS jsonb), "
        ":valid_from, :url, :verified)"
    )
    for endpoint in _AI_ENDPOINTS:
        for price, conditions in _AI_PRICES:
            bind.execute(
                seed,
                {
                    "endpoint": endpoint,
                    "price": price,
                    "conditions": conditions,
                    "valid_from": date(2026, 7, 1),
                    "url": _AI_PRICING_URL,
                    "verified": date(2026, 11, 11),
                },
            )
    for table in _TENANT_TABLES:
        for statement in tenant_isolation(table):
            op.execute(statement)
    script = [
        *grants("ai.engines", api="SELECT", worker="SELECT"),
        *grants("ai.project_engines", api="SELECT, INSERT, DELETE", worker="SELECT"),
        column_grant(
            "ai.project_engines",
            role="app_api",
            privilege="UPDATE",
            columns=("location_ids", "is_enabled"),
        ),
        *grants("ai.prompts", api="SELECT, INSERT", worker="SELECT"),
        column_grant("ai.prompts", role="app_api", privilege="UPDATE", columns=_PROMPT_API_UPDATE),
        *grants("ai.prompt_versions", api="SELECT, INSERT", worker="SELECT"),
        *grants("ai.prompt_terms", api="SELECT, INSERT, DELETE"),
        *(
            statement
            for table in _ANSWER_TABLES
            for statement in grants(table, api="SELECT", worker="SELECT, INSERT")
        ),
        # Extraction at ingest matches the project's aliases (spec section 4.4).
        *grants("core.entity_aliases", worker="SELECT"),
    ]
    for statement in script:
        op.execute(statement)
    for statement in statements(_RAW_LOOKUP):
        op.execute(statement)
    op.execute(
        "ALTER TABLE core.workspace_quotas "
        f"ALTER COLUMN max_active_prompts SET DEFAULT {_PROMPT_LIMIT}"
    )
    op.execute(
        f"UPDATE core.workspace_quotas SET max_active_prompts = {_PROMPT_LIMIT}, "
        f"updated_at = now() WHERE max_active_prompts = {_OLD_PROMPT_LIMIT}"
    )


def downgrade() -> None:
    # Local development only.
    op.execute(
        f"UPDATE core.workspace_quotas SET max_active_prompts = {_OLD_PROMPT_LIMIT} "
        f"WHERE max_active_prompts = {_PROMPT_LIMIT}"
    )
    op.execute(
        "ALTER TABLE core.workspace_quotas "
        f"ALTER COLUMN max_active_prompts SET DEFAULT {_OLD_PROMPT_LIMIT}"
    )
    op.execute("DROP FUNCTION ai.observation_raw(bigint)")
    op.execute("REVOKE SELECT ON core.entity_aliases FROM app_worker")
    parents = ", ".join(f"'{table}'::regclass" for table in _PARTITIONED)
    op.execute(f"DELETE FROM ops.partitioned_tables WHERE parent IN ({parents})")
    op.execute(
        "DROP TABLE ai.observation_facts, ai.entity_mentions, ai.citations, ai.observations, "
        "ai.derivations, ai.prompt_terms, ai.prompt_versions, ai.prompts, ai.project_engines, "
        "ai.engines"
    )
    endpoints = ", ".join(f"'{endpoint}'" for endpoint in _AI_ENDPOINTS)
    op.execute(
        "DELETE FROM ops.provider_price_book WHERE provider_code = 'dataforseo' "
        f"AND endpoint IN ({endpoints})"
    )
