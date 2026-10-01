import { z } from 'zod';

import type {
  AliasTestResult,
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

export const TRACKED_KEYWORD_ROW: z.ZodType<TrackedKeywordRow> = z.object({
  ...TRACKED_KEYWORD_FIELDS,
  metrics: KEYWORD_METRICS.nullable().exactOptional(),
  groups: z.array(GROUP_REF).nullable().exactOptional(),
  terms: z.array(TERM_REF).nullable().exactOptional(),
  competitors: z.array(COMPETITOR_OVERRIDE).nullable().exactOptional(),
});

export const TRACKED_KEYWORD_DETAIL: z.ZodType<TrackedKeywordDetail> = z.object({
  ...TRACKED_KEYWORD_FIELDS,
  metrics: KEYWORD_METRICS.nullable(),
  groups: z.array(GROUP_REF),
  terms: z.array(TERM_REF),
  competitor_overrides: z.array(COMPETITOR_OVERRIDE),
  schedule: z.object({ schedule_id: z.string(), name: z.string(), next_run_at: z.string() }).nullable(),
  config_history_count: z.number(),
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
