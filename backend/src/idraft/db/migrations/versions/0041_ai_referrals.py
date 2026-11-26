"""AI referral sessions per day and the versioned referrer rules (WP-69).

docs/18-first-party-integrations.md sections 7.3 and 7.4:

- `fp.ai_referrer_rules` is global and read only for the runtime roles. This revision seeds rule
  set version 1, the 20 rules of section 7.4. A new rule set is a new revision.
- `fp.ai_referral_daily` holds the classified series, one row per classifier and assistant and day.
  The section's DDL names the project and the integration with single-column keys; here both keys
  carry the workspace, as `fp.gsc_page_daily` does, so a row cannot point across tenants.

Revision ID: 0041
Revises: 0040
"""

from __future__ import annotations

from alembic import op

from idraft.db.ddl import grants, statements, tenant_isolation

revision: str = "0041"
down_revision: str | None = "0040"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None

_TABLES = """
CREATE TABLE fp.ai_referrer_rules (
    rule_set_version smallint NOT NULL,
    rule_id          smallint NOT NULL,
    match_field      text NOT NULL CHECK (match_field IN ('referrer_host','utm_source')),
    match_type       text NOT NULL CHECK (match_type IN ('exact','suffix')),
    pattern          text NOT NULL,  -- lowercased
    assistant_code   text NOT NULL,
    operator         text NOT NULL,
    confidence       text NOT NULL CHECK (confidence IN ('high','ambiguous')),
    notes            text,
    PRIMARY KEY (rule_set_version, rule_id),
    UNIQUE (rule_set_version, match_field, match_type, pattern)
);

CREATE TABLE fp.ai_referral_daily (
    project_id       uuid NOT NULL,
    integration_id   uuid NOT NULL,
    metric_date      date NOT NULL,  -- the GA4 property's date; UTC for Cloudflare and logs
    origin           text NOT NULL CHECK (origin IN ('ga4','cloudflare','server_logs')),
    classifier       text NOT NULL CHECK (classifier IN ('ga4_ai_assistant_channel','own_rules')),
    rules_version    smallint NOT NULL,  -- 0 for the GA4 channel
    assistant_code   text NOT NULL,  -- the rule's assistant, or the lowercased source for GA4
    landing_url_id   bigint NOT NULL DEFAULT 0,  -- 0 means all pages
    workspace_id     uuid NOT NULL,
    unit             text NOT NULL CHECK (unit IN ('sessions','requests')),
    sessions         integer,
    engaged_sessions integer,
    key_events       numeric(14,2),
    total_revenue    numeric(14,2),
    requests         bigint,
    is_current       boolean NOT NULL DEFAULT true,
    computed_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, integration_id, metric_date, classifier, rules_version,
                 assistant_code, landing_url_id),
    FOREIGN KEY (project_id, workspace_id) REFERENCES core.projects(id, workspace_id)
        ON DELETE CASCADE,
    FOREIGN KEY (integration_id, workspace_id) REFERENCES fp.integrations(id, workspace_id)
        ON DELETE CASCADE
);

CREATE INDEX ai_referral_daily_project_date ON fp.ai_referral_daily (project_id, metric_date)
    WHERE is_current;
"""

_SEED_RULES = """
INSERT INTO fp.ai_referrer_rules
    (rule_set_version, rule_id, match_field, match_type, pattern, assistant_code, operator,
     confidence)
VALUES
    (1, 1, 'referrer_host', 'exact', 'chatgpt.com', 'chatgpt', 'OpenAI', 'high'),
    (1, 2, 'referrer_host', 'exact', 'chat.openai.com', 'chatgpt', 'OpenAI', 'high'),
    (1, 3, 'referrer_host', 'exact', 'openai.com', 'chatgpt', 'OpenAI', 'ambiguous'),
    (1, 4, 'referrer_host', 'suffix', 'perplexity.ai', 'perplexity', 'Perplexity', 'high'),
    (1, 5, 'referrer_host', 'exact', 'gemini.google.com', 'gemini', 'Google', 'high'),
    (1, 6, 'referrer_host', 'exact', 'bard.google.com', 'gemini', 'Google', 'high'),
    (1, 7, 'referrer_host', 'exact', 'copilot.microsoft.com', 'copilot', 'Microsoft', 'high'),
    (1, 8, 'referrer_host', 'exact', 'copilot.cloud.microsoft', 'copilot', 'Microsoft', 'high'),
    (1, 9, 'referrer_host', 'exact', 'edgeservices.bing.com', 'copilot', 'Microsoft', 'high'),
    (1, 10, 'referrer_host', 'exact', 'claude.ai', 'claude', 'Anthropic', 'high'),
    (1, 11, 'referrer_host', 'exact', 'chat.deepseek.com', 'deepseek', 'DeepSeek', 'high'),
    (1, 12, 'referrer_host', 'exact', 'grok.com', 'grok', 'xAI', 'high'),
    (1, 13, 'referrer_host', 'exact', 'x.ai', 'grok', 'xAI', 'ambiguous'),
    (1, 14, 'referrer_host', 'exact', 'meta.ai', 'meta_ai', 'Meta', 'high'),
    (1, 15, 'referrer_host', 'exact', 'chat.mistral.ai', 'mistral', 'Mistral AI', 'high'),
    (1, 16, 'referrer_host', 'exact', 'you.com', 'you', 'You.com', 'high'),
    (1, 17, 'referrer_host', 'exact', 'duckduckgo.com', 'duckassist', 'DuckDuckGo', 'ambiguous'),
    (1, 18, 'utm_source', 'exact', 'chatgpt.com', 'chatgpt', 'OpenAI', 'high'),
    (1, 19, 'utm_source', 'exact', 'perplexity', 'perplexity', 'Perplexity', 'high'),
    (1, 20, 'utm_source', 'exact', 'copilot', 'copilot', 'Microsoft', 'high')
"""


def upgrade() -> None:
    for statement in statements(_TABLES):
        op.execute(statement)
    op.execute(_SEED_RULES)
    for statement in tenant_isolation("fp.ai_referral_daily"):
        op.execute(statement)
    script = [
        *grants("fp.ai_referrer_rules", api="SELECT", worker="SELECT"),
        *grants("fp.ai_referral_daily", api="SELECT", worker="SELECT, INSERT, DELETE"),
    ]
    for statement in script:
        op.execute(statement)


def downgrade() -> None:
    # Local development only: what the tables hold is lost.
    op.execute("DROP TABLE fp.ai_referral_daily, fp.ai_referrer_rules")
