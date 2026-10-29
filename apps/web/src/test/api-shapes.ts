import { z } from 'zod';

import type {
  AliasTestResult,
  BudgetStatus,
  CostMeta,
  CostRow,
  ImportRow,
  KeywordImport,
  Operation,
  Price,
  Run,
  RunDetail,
  Schedule,
  BulkArchiveResult,
  BulkCreateResult,
  BulkUpdateResult,
  CompetitorOverride,
  CompetitorSet,
  ConfigVersion,
  DomainCategory,
  DomainRef,
  Entity,
  EntityDetail,
  EntityDomain,
  EntityRef,
  GroupRef,
  Keyword,
  KeywordDetail,
  KeywordGroup,
  KeywordGroupNode,
  KeywordMetrics,
  KeywordMetricsHistory,
  Location,
  MetricValue,
  Project,
  ProjectDomain,
  ProjectEntity,
  ProjectSettings,
  Term,
  TermAssignmentResult,
  TermNode,
  TermRef,
  TrackedKeyword,
  TrackedKeywordDetail,
  TrackedKeywordRow,
  CompetitorRank,
  UrlRef,
  Vocabulary,
} from '@/lib/api/types';

/**
 * Runtime shapes of the API payloads the mock handlers' tests read. Each is typed as the generated schema type,
 * so a contract change breaks it at compile time, and a test parses an answer with it instead of trusting a
 * cast: a mock that answers the wrong shape fails the test.
 */

const ENTITY_TYPE = z.enum(['brand', 'product', 'organization', 'person', 'other']);
const ROLE = z.enum(['own', 'competitor', 'watch']);
const STATUS = z.enum(['accepted', 'uncertain', 'discarded']);
const MATCH_SCOPE = z.enum(['path_prefix', 'host', 'registrable']);

const USER_REF = z.object({ user_id: z.string(), name: z.string(), email: z.string() });

const DOMAIN_REF: z.ZodType<DomainRef> = z.object({
  domain_id: z.number(),
  host: z.string(),
  registrable_domain: z.string(),
  category: z.string().nullable(),
  category_source: z.enum(['seed_list', 'rule', 'llm', 'manual', 'tenant_override']).nullable(),
});

export const ENTITY_DOMAIN: z.ZodType<EntityDomain> = z.object({
  entity_domain_id: z.string(),
  entity_id: z.string(),
  domain: DOMAIN_REF,
  match_scope: MATCH_SCOPE,
  path_prefix: z.string().nullable(),
});

const ENTITY_FIELDS = {
  entity_id: z.string(),
  entity_type: ENTITY_TYPE,
  canonical_name: z.string(),
  parent_entity_id: z.string().nullable(),
  description: z.string().nullable(),
  is_ambiguous: z.boolean(),
  disambiguation_hints: z.array(z.string()),
  alias_count: z.number(),
  domains: z.array(ENTITY_DOMAIN),
  created_at: z.string(),
  updated_at: z.string(),
};

export const ENTITY: z.ZodType<Entity> = z.object(ENTITY_FIELDS);

const ALIAS = z.object({
  alias_id: z.string(),
  entity_id: z.string(),
  alias: z.string(),
  match_mode: z.enum(['word_boundary', 'exact_case', 'substring', 'regex']),
  case_sensitive: z.boolean(),
  language_code: z.string().nullable(),
  is_negative: z.boolean(),
  requires_context: z.boolean(),
  created_by: USER_REF.nullable(),
  created_at: z.string(),
});

export const ALIASES = z.array(ALIAS);

export const ENTITY_DETAIL: z.ZodType<EntityDetail> = z.object({
  ...ENTITY_FIELDS,
  aliases: z.array(ALIAS),
  projects: z.array(
    z.object({ project_id: z.string(), role: ROLE, is_primary: z.boolean(), removed_at: z.string().nullable() }),
  ),
});

const ENTITY_REF: z.ZodType<EntityRef> = z.object({
  entity_id: z.string(),
  canonical_name: z.string(),
  entity_type: ENTITY_TYPE,
  role: ROLE.nullable(),
  color_index: z.number().nullable(),
});

export const PROJECT_ENTITY: z.ZodType<ProjectEntity> = z.object({
  project_id: z.string(),
  entity: ENTITY_REF,
  role: ROLE,
  is_primary: z.boolean(),
  track_seo: z.boolean(),
  track_ai: z.boolean(),
  color_index: z.number().nullable(),
  added_at: z.string(),
  removed_at: z.string().nullable(),
  alias_count: z.number(),
  domains: z.array(ENTITY_DOMAIN),
});

export const PROJECT_DOMAIN: z.ZodType<ProjectDomain> = z.object({
  entity: ENTITY_REF,
  domain: DOMAIN_REF,
  match_scope: MATCH_SCOPE,
  path_prefix: z.string().nullable(),
});

export const ALIAS_TEST_RESULT: z.ZodType<AliasTestResult> = z.object({
  mentions: z.array(
    z.object({
      entity: ENTITY_REF,
      spans: z.array(
        z.object({
          start: z.number(),
          end: z.number(),
          alias_id: z.string().nullable(),
          match_method: z.enum([
            'alias_word',
            'alias_exact',
            'alias_substring',
            'alias_regex',
            'alias_name',
            'alias_domain',
            'via_product',
          ]),
          score: z.number(),
          via_entity_id: z.string().nullable(),
          status: STATUS,
        }),
      ),
      confidence: z.number(),
      status: STATUS,
    }),
  ),
  negatives_applied: z.array(z.object({ start: z.number(), end: z.number(), alias_id: z.string() })),
  skipped_alias_ids: z.array(z.string()),
});

export const PROJECT: z.ZodType<Project> = z.object({
  project_id: z.string(),
  workspace_id: z.string(),
  name: z.string(),
  slug: z.string(),
  primary_domain: DOMAIN_REF.nullable(),
  default_location_id: z.number().nullable(),
  default_location: z
    .object({ location_id: z.number(), name: z.string(), country_iso: z.string(), location_type: z.string() })
    .nullable(),
  default_language_code: z.string().nullable(),
  timezone: z.string(),
  deep_check_weekday: z.number(),
  status: z.enum(['active', 'paused', 'archived']),
  data_version: z.number(),
  entity_config_version: z.number(),
  created_by: USER_REF.nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const VOCABULARY: z.ZodType<Vocabulary> = z.object({
  vocabulary_id: z.string(),
  project_id: z.string().nullable(),
  kind: z.enum(['topic', 'cluster', 'product', 'service', 'market', 'campaign', 'persona', 'tag', 'custom']),
  name: z.string(),
  is_hierarchical: z.boolean(),
  is_single_valued: z.boolean(),
  term_count: z.number(),
});

const TERM_FIELDS = {
  term_id: z.string(),
  vocabulary_id: z.string(),
  parent_id: z.string().nullable(),
  name: z.string(),
  slug: z.string(),
  path: z.string(),
  source: z.enum(['manual', 'import', 'auto_cluster', 'ai_suggestion']),
  description: z.string().nullable(),
  created_at: z.string(),
};

export const TERM: z.ZodType<Term> = z.object(TERM_FIELDS);

export const TERM_NODE: z.ZodType<TermNode> = z.object({
  ...TERM_FIELDS,
  keyword_count: z.number(),
  get children(): z.ZodArray<z.ZodType<TermNode>> {
    return z.array(TERM_NODE);
  },
});

export const LOCATION: z.ZodType<Location> = z.object({
  location_id: z.number(),
  name: z.string(),
  country_iso: z.string(),
  location_type: z.string(),
  parent_id: z.number().nullable(),
  supports: z.array(z.string()),
});

export const DOMAIN_CATEGORY: z.ZodType<DomainCategory> = z.object({
  code: z.string(),
  label: z.string(),
  description: z.string(),
});

/** `page` of a cursor list. */
export const CURSOR_PAGE = z.object({ limit: z.number(), next_cursor: z.string().nullable(), has_more: z.boolean() });

/** `page` of an offset list. */
export const OFFSET_PAGE = z.object({ offset: z.number(), limit: z.number(), total: z.number() });

// Step 5 part 1: keywords

const DEPTH_PROFILE = z.enum(['light', 'standard', 'deep', 'full', 'weekly', 'weekly_light', 'until_own_match_100']);
const DEVICE = z.enum(['desktop', 'mobile']);
const INTENT = z.enum(['informational', 'navigational', 'commercial', 'transactional', 'local', 'unknown']);
const METRIC_SOURCE = z.enum(['dataforseo_labs', 'dataforseo_google_ads', 'dataforseo_clickstream']);
const LOCATION_REF = z.object({
  location_id: z.number(),
  name: z.string(),
  country_iso: z.string(),
  location_type: z.string(),
});

export const KEYWORD: z.ZodType<Keyword> = z.object({
  keyword_id: z.string(),
  text: z.string(),
  normalized_text: z.string(),
  language_code: z.string(),
  created_at: z.string(),
});

export const METRIC_VALUE: z.ZodType<MetricValue> = z.object({
  metric: z.string(),
  value: z.number().nullable(),
  numerator: z.number().nullable(),
  denominator: z.number().nullable(),
  unit: z.enum(['ratio', 'count', 'rank', 'score', 'usd', 'clicks']),
  n_observations: z.number(),
  n_keywords: z.number().nullable().exactOptional(),
  window: z.object({ from: z.string(), to: z.string(), timezone: z.string() }),
  filters: z.record(z.string(), z.unknown()),
  is_estimate: z.boolean(),
  method: z.string(),
  method_version: z.number(),
  source: z.string().nullable().exactOptional(),
});

export const KEYWORD_METRICS: z.ZodType<KeywordMetrics> = z.object({
  source: METRIC_SOURCE,
  location_id: z.number(),
  language_code: z.string(),
  fetched_at: z.string(),
  data_month: z.string().nullable(),
  search_volume: METRIC_VALUE,
  cpc_usd: z.string().nullable(),
  competition: z.number().nullable(),
  competition_level: z.enum(['LOW', 'MEDIUM', 'HIGH']).nullable(),
  keyword_difficulty: z.number().nullable(),
  intent_main: z.string().nullable(),
  trend_pct_per_month: z.number().nullable(),
  is_seasonal: z.boolean().nullable(),
});

export const KEYWORD_DETAIL: z.ZodType<KeywordDetail> = z.object({
  keyword_id: z.string(),
  text: z.string(),
  normalized_text: z.string(),
  language_code: z.string(),
  created_at: z.string(),
  metrics: z.array(KEYWORD_METRICS),
  tracked: z.array(
    z.object({
      tracked_keyword_id: z.string(),
      project_id: z.string(),
      location_id: z.number(),
      language_code: z.string(),
      device: DEVICE,
      is_active: z.boolean(),
    }),
  ),
});

export const KEYWORD_METRICS_HISTORY: z.ZodType<KeywordMetricsHistory> = z.object({
  snapshots: z.array(
    z.object({
      snapshot_id: z.string(),
      fetched_at: z.string(),
      data_month: z.string().nullable(),
      search_volume: z.number().nullable(),
      monthly_searches: z.array(
        z.object({ year: z.number(), month: z.number(), search_volume: z.number().nullable() }),
      ),
      cpc_usd: z.string().nullable(),
      keyword_difficulty: z.number().nullable(),
      is_material_change: z.boolean(),
    }),
  ),
  trend: METRIC_VALUE,
  seasonality: z.object({
    index_by_month: z.array(z.object({ month: z.number(), index: z.number() })),
    is_seasonal: z.boolean().nullable(),
    method: z.string(),
  }),
});

const GROUP_REF: z.ZodType<GroupRef> = z.object({ group_id: z.string(), name: z.string(), path: z.string() });

const TERM_REF: z.ZodType<TermRef> = z.object({
  term_id: z.string(),
  vocabulary_id: z.string(),
  vocabulary_kind: z.string(),
  name: z.string(),
  path: z.string(),
});

const URL_REF: z.ZodType<UrlRef> = z.object({
  url_id: z.string(),
  canonical_url: z.string(),
  host: z.string(),
  path: z.string(),
  registrable_domain: z.string(),
});

const COMPETITOR_OVERRIDE: z.ZodType<CompetitorOverride> = z.object({
  entity: ENTITY_REF,
  mode: z.enum(['include', 'exclude']),
});

const RANK_CELL = z.object({
  state: z.enum(['ranked', 'beyond_depth', 'not_checked', 'failed']),
  rank: z.number().nullable(),
  absolute_rank: z.number().nullable(),
  depth_requested: z.number().nullable(),
  url: URL_REF.nullable(),
  observed_at: z.string().nullable(),
  serp_snapshot_id: z.string().nullable(),
});

const RANK_CHANGE = z.object({
  label: z.enum(['numeric', 'new', 'lost', 'unchanged_beyond', 'consistent_beyond', 'first_check']),
  value: z.number().nullable(),
  previous_rank: z.number().nullable(),
  previous_observed_at: z.string().nullable(),
});

/** The rank state every tracked keyword carries (doc 19 section 3.6.4). */
export const TRACKED_KEYWORD_STATE = z.object({
  current: RANK_CELL,
  change: RANK_CHANGE,
  best_rank: z.number().nullable(),
  best_rank_at: z.string().nullable(),
  worst_rank: z.number().nullable(),
  first_ranked_at: z.string().nullable(),
  feature_types_present: z.array(z.string()),
  owned_feature_types: z.array(z.string()),
  aio: z.object({
    state: z.enum(['absent', 'present_not_cited', 'present_cited', 'not_loaded', 'unknown']),
    citation_position: z.number().nullable(),
    observation_id: z.string().nullable(),
  }),
  target_url_match: z.boolean().nullable(),
  url_changed_at: z.string().nullable(),
  consecutive_failures: z.number(),
  is_stale: z.boolean(),
  last_observed_at: z.string().nullable(),
  ranking_url_count: z.number(),
});

const TRACKED_KEYWORD_FIELDS = {
  tracked_keyword_id: z.string(),
  project_id: z.string(),
  keyword: KEYWORD,
  location_id: z.number(),
  location: LOCATION_REF,
  language_code: z.string(),
  device: DEVICE,
  os: z.enum(['windows', 'macos', 'android', 'ios']).nullable(),
  search_engine: z.enum(['google', 'bing']),
  depth_profile: DEPTH_PROFILE,
  frequency: z.enum(['daily', 'weekly', 'custom']),
  schedule_id: z.string().nullable(),
  target_url: URL_REF.nullable(),
  priority: z.number(),
  business_value: z.string().nullable(),
  intent: INTENT,
  intent_source: z.enum(['provider', 'manual', 'rule']).nullable(),
  funnel_stage: z.enum(['tofu', 'mofu', 'bofu', 'retention', 'unknown']),
  source: z.enum(['manual', 'csv_import', 'api', 'gsc_import', 'discovery', 'bulk_paste']),
  is_active: z.boolean(),
  config_version: z.number(),
  created_by: USER_REF.nullable(),
  created_at: z.string(),
  updated_at: z.string(),
};

export const TRACKED_KEYWORD: z.ZodType<TrackedKeyword> = z.object(TRACKED_KEYWORD_FIELDS);

export const SPARKLINE_POINT = z.object({
  t: z.string(),
  rank: z.number().nullable(),
  depth: z.number(),
  state: z.enum(['ranked', 'beyond_depth']),
});

export const SPARKLINE = z.object({
  depth_mode: z.literal('daily_depth'),
  points: z.array(SPARKLINE_POINT),
});

export const COMPETITOR_RANK: z.ZodType<CompetitorRank> = z.object({
  entity: ENTITY_REF,
  current: RANK_CELL,
  change: RANK_CHANGE,
});

export const TRACKED_KEYWORD_ROW: z.ZodType<TrackedKeywordRow> = z.object({
  ...TRACKED_KEYWORD_FIELDS,
  metrics: KEYWORD_METRICS.nullable().exactOptional(),
  groups: z.array(GROUP_REF).nullable().exactOptional(),
  terms: z.array(TERM_REF).nullable().exactOptional(),
  competitors: z.array(COMPETITOR_OVERRIDE).nullable().exactOptional(),
  // The blocks of `include=sparkline,competitor_ranks,features,aio`
  sparkline: SPARKLINE.nullable().exactOptional(),
  competitor_ranks: z.array(COMPETITOR_RANK).nullable().exactOptional(),
  features: z.null().exactOptional(),
  aio: z.null().exactOptional(),
  state: TRACKED_KEYWORD_STATE,
});

export const TRACKED_KEYWORD_DETAIL: z.ZodType<TrackedKeywordDetail> = z.object({
  ...TRACKED_KEYWORD_FIELDS,
  metrics: KEYWORD_METRICS.nullable(),
  groups: z.array(GROUP_REF),
  terms: z.array(TERM_REF),
  competitor_overrides: z.array(COMPETITOR_OVERRIDE),
  schedule: z.object({ schedule_id: z.string(), name: z.string(), next_run_at: z.string() }).nullable(),
  config_history_count: z.number(),
  state: TRACKED_KEYWORD_STATE,
});

/** `page` of the tracked keyword list: a cursor page with the filtered total. */
export const TRACKED_KEYWORD_PAGE = z.object({
  limit: z.number(),
  next_cursor: z.string().nullable(),
  has_more: z.boolean(),
  total: z.number(),
});

export const COMPETITOR_SET: z.ZodType<CompetitorSet> = z.object({
  overrides: z.array(COMPETITOR_OVERRIDE),
  effective_competitors: z.array(ENTITY_REF),
});

export const CONFIG_VERSION: z.ZodType<ConfigVersion> = z.object({
  config_version: z.number(),
  depth_profile: DEPTH_PROFILE,
  target_url: URL_REF.nullable(),
  valid_from: z.string(),
  valid_to: z.string().nullable(),
  changed_by: USER_REF.nullable(),
  change_reason: z.string().nullable(),
});

export const BULK_CREATE_RESULT: z.ZodType<BulkCreateResult> = z.object({
  created: z.array(z.string()),
  restored: z.array(z.string()),
  skipped: z.array(z.object({ index: z.number(), existing_id: z.string() })),
  rejected: z.array(z.object({ index: z.number(), code: z.string(), message: z.string() })),
});

export const BULK_UPDATE_RESULT: z.ZodType<BulkUpdateResult> = z.object({
  matched: z.number(),
  updated: z.number(),
  config_versions_created: z.number(),
});

export const BULK_ARCHIVE_RESULT: z.ZodType<BulkArchiveResult> = z.object({
  matched: z.number(),
  updated: z.number(),
});

const KEYWORD_GROUP_FIELDS = {
  group_id: z.string(),
  parent_id: z.string().nullable(),
  name: z.string(),
  path: z.string(),
  keyword_count: z.number(),
  created_at: z.string(),
};

export const KEYWORD_GROUP: z.ZodType<KeywordGroup> = z.object(KEYWORD_GROUP_FIELDS);

export const KEYWORD_GROUP_NODE: z.ZodType<KeywordGroupNode> = z.object({
  ...KEYWORD_GROUP_FIELDS,
  get children(): z.ZodArray<z.ZodType<KeywordGroupNode>> {
    return z.array(KEYWORD_GROUP_NODE);
  },
});

export const TERM_ASSIGNMENT_RESULT: z.ZodType<TermAssignmentResult> = z.object({
  assignments_added: z.number(),
  assignments_removed: z.number(),
  subjects_matched: z.number(),
});

export const PROJECT_SETTINGS: z.ZodType<ProjectSettings> = z.object({
  version: z.literal(1),
  // The API fills each default, so an answer carries all five
  seo: z
    .object({
      default_device: z.enum(['desktop', 'mobile', 'both']),
      default_depth_profile: DEPTH_PROFILE,
      default_frequency: z.enum(['daily', 'weekly']),
      visibility_weight_scheme: z.enum(['uniform', 'priority', 'business_value']),
      visibility_volume_mode: z.enum(['annual_average', 'seasonal']),
    })
    .exactOptional(),
  entity_config_version: z.number(),
});

// Step 5 part 1: imports, schedules, runs and costs

const TASK_WORKLOAD = z.enum([
  'seo_rank',
  'ai_prompt',
  'ai_mode_keyword',
  'keyword_metrics',
  'discovery',
  'ai_benchmark',
  'gsc_sync',
  'bing_sync',
  'ga4_sync',
  'cloudflare_sync',
]);

const OPERATION: z.ZodType<Operation> = z.object({
  kind: z.enum(['collection_run', 'keyword_import']),
  status: z.enum([
    'queued',
    'running',
    'waiting_for_input',
    'succeeded',
    'succeeded_with_errors',
    'failed',
    'cancelled',
    'blocked',
  ]),
  progress: z.object({
    done: z.number(),
    total: z.number().nullable(),
    unit: z.enum(['tasks', 'rows', 'observations', 'days', 'items']),
  }),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
  error: z.object({ code: z.string(), detail: z.string() }).nullable(),
  links: z.object({
    self: z.string(),
    cancel: z.string().nullable().exactOptional(),
    result: z.string().nullable().exactOptional(),
  }),
});

export const KEYWORD_IMPORT: z.ZodType<KeywordImport> = z.object({
  import_id: z.string(),
  source: z.enum(['upload', 'paste', 'api']),
  original_filename: z.string().nullable(),
  status: z.enum([
    'uploaded',
    'parsing',
    'needs_mapping',
    'preview_ready',
    'writing',
    'completed',
    'completed_with_errors',
    'failed',
    'cancelled',
    'expired',
  ]),
  column_mapping: z.record(z.string(), z.string()),
  defaults: z.record(z.string(), z.unknown()),
  counts: z.object({
    rows_total: z.number(),
    new: z.number(),
    duplicate: z.number(),
    variant: z.number(),
    conflict: z.number(),
    invalid: z.number(),
    created: z.number(),
    skipped: z.number(),
    merged: z.number(),
  }),
  quota: z.object({ limit: z.number(), used: z.number(), would_use: z.number() }).nullable(),
  error_code: z.string().nullable(),
  created_by: USER_REF,
  created_at: z.string(),
  expires_at: z.string(),
  finished_at: z.string().nullable(),
  operation: OPERATION,
});

export const IMPORT_ROW: z.ZodType<ImportRow> = z.object({
  row_no: z.number(),
  part: z.number(),
  raw: z.record(z.string(), z.string()),
  keyword: z.string().nullable(),
  normalized_text: z.string().nullable(),
  location_id: z.number().nullable(),
  language_code: z.string().nullable(),
  device: z.string().nullable(),
  outcome: z.enum(['new', 'duplicate', 'variant', 'conflict', 'invalid']),
  reason_code: z.string().nullable(),
  reason: z.string().nullable(),
  existing_tracked_keyword_id: z.string().nullable(),
  action: z.enum(['create', 'skip', 'merge', 'force_separate']),
});

export const SCHEDULE: z.ZodType<Schedule> = z.object({
  schedule_id: z.string(),
  project_id: z.string(),
  name: z.string(),
  workload: TASK_WORKLOAD,
  cadence: z.enum(['daily', 'weekly', 'monthly', 'cron']),
  cron_expr: z.string().nullable(),
  weekday: z.number().nullable(),
  month_day: z.number().nullable(),
  window_start_local: z.string(),
  window_hours: z.number(),
  timezone: z.string(),
  priority: z.enum(['high', 'standard', 'low']),
  provider_mode: z.enum(['standard_queue', 'priority_queue', 'live']),
  selector: z.object({
    all: z.literal(true).nullable().exactOptional(),
    groups: z.array(z.string()).nullable().exactOptional(),
    terms: z.array(z.string()).nullable().exactOptional(),
    priority_lte: z.number().nullable().exactOptional(),
    stale_days: z.number().nullable().exactOptional(),
  }),
  is_active: z.boolean(),
  next_run_at: z.string(),
  last_run_id: z.string().nullable(),
  created_at: z.string(),
});

const RUN_FIELDS = {
  run_id: z.string(),
  project_id: z.string(),
  schedule_id: z.string().nullable(),
  workload: TASK_WORKLOAD,
  trigger: z.enum(['schedule', 'manual', 'backfill', 'retry']),
  status: z.enum(['planned', 'running', 'completed', 'completed_with_errors', 'failed', 'cancelled', 'budget_blocked']),
  status_reason: z.string().nullable(),
  window_start: z.string(),
  window_end: z.string(),
  tasks_total: z.number(),
  tasks_succeeded: z.number(),
  tasks_failed: z.number(),
  estimated_cost_usd: z.string().nullable(),
  actual_cost_usd: z.string().nullable(),
  blocked_by_budget_id: z.string().nullable(),
  created_by: z
    .object({ actor_id: z.string(), actor_type: z.enum(['user', 'api_key', 'system']), label: z.string() })
    .nullable(),
  created_at: z.string(),
  completed_at: z.string().nullable(),
  operation: OPERATION,
};

export const RUN: z.ZodType<Run> = z.object(RUN_FIELDS);

export const RUN_DETAIL: z.ZodType<RunDetail> = z.object({
  ...RUN_FIELDS,
  tasks_by_status: z.record(z.string(), z.number()),
  config_snapshot: z.record(z.string(), z.unknown()),
});

export const COST_ROW: z.ZodType<CostRow> = z.object({
  keys: z.record(z.string(), z.string()),
  cost_usd: z.string(),
  request_count: z.number(),
  subjects: z.number(),
});

export const COST_META: z.ZodType<CostMeta> = z.object({
  total_cost_usd: z.string(),
  cost_sources: z.object({
    provider_reported: z.string(),
    computed_from_tokens: z.string(),
    price_book_estimate: z.string(),
  }),
});

export const BUDGET_STATUS: z.ZodType<BudgetStatus> = z.object({
  budget: z.object({
    budget_id: z.string(),
    project_id: z.string().nullable(),
    workload: z.enum([
      'seo_rank',
      'ai_prompt',
      'keyword_research',
      'ai_benchmark',
      'extraction_llm',
      'first_party',
      'all',
    ]),
    period: z.literal('month'),
    limit_usd: z.string(),
    soft_limit_pct: z.number(),
    action_on_hard: z.enum(['pause', 'alert_only']),
    created_at: z.string(),
  }),
  spent_usd: z.string(),
  committed_estimate_usd: z.string(),
  pct_used: z.number(),
  state: z.enum(['ok', 'soft_exceeded', 'hard_exceeded']),
  blocked_runs: z.number(),
});

export const PRICE: z.ZodType<Price> = z.object({
  price_id: z.string(),
  provider_code: z.string(),
  endpoint: z.string(),
  price_unit: z.string(),
  unit_price_usd: z.string(),
  conditions: z.record(z.string(), z.unknown()),
  valid_from: z.string(),
  valid_to: z.string().nullable(),
  source_url: z.string(),
  verified_at: z.string(),
});
