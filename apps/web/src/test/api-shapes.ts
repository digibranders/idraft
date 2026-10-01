import { z } from 'zod';

import type {
  AliasTestResult,
  DomainCategory,
  DomainRef,
  Entity,
  EntityDetail,
  EntityDomain,
  EntityRef,
  Location,
  Project,
  ProjectDomain,
  ProjectEntity,
  Term,
  TermNode,
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
