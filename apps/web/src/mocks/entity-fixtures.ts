import { MOCK_CREATED_AT, MOCK_PROJECTS } from './fixtures';
import { mockId } from './mock-ids';
import type {
  StoredAlias,
  StoredDomain,
  StoredEntity,
  StoredRole,
  StoredTerm,
  StoredVocabulary,
} from './entities-state';
import type { DomainCategory, Location } from '@/lib/api/types';

/**
 * The entity and taxonomy fixtures of the Digibranders workspace (19 sections 3.4 and 3.5), and the registries
 * every workspace reads (19 section 3.2.5). Fynix, the agency's own project, has its brand, five competitors
 * and one watched publication; Cleanstart has its brand and one competitor. Rows are written in the stored
 * form of ./entities-state.ts, which leaves defaults out. The names are invented for the mocks.
 */

const [fynixSeed, cleanstartSeed] = MOCK_PROJECTS;
const FYNIX_PROJECT = fynixSeed?.project_id ?? '';
const CLEANSTART_PROJECT = cleanstartSeed?.project_id ?? '';

const entityId = (n: number): string => mockId('entity', n);
const aliasId = (n: number): string => mockId('alias', n);
const domainRowId = (n: number): string => mockId('domain', n);
const vocabularyId = (n: number): string => mockId('vocabulary', n);
const termId = (n: number): string => mockId('term', n);

/** The ids tests and screens refer to by name. */
export const MOCK_ENTITY_IDS = {
  fynix: entityId(1),
  brightwave: entityId(2),
  rankforge: entityId(3),
  northlight: entityId(4),
  clickvantage: entityId(5),
  meridian: entityId(6),
  seoWeekly: entityId(7),
  fynixAudit: entityId(8),
  cleanstart: entityId(9),
  sparkle: entityId(10),
} as const;

export const MOCK_ALIAS_IDS = {
  rankforgeCapital: aliasId(7),
  clickvantagePattern: aliasId(11),
} as const;

export const MOCK_VOCABULARY_IDS = { topics: vocabularyId(1), services: vocabularyId(2) } as const;

export const MOCK_TERM_IDS = {
  seo: termId(1),
  technicalSeo: termId(2),
  localSeo: termId(3),
  contentMarketing: termId(4),
  blogStrategy: termId(5),
  paidSearch: termId(6),
} as const;

const at = MOCK_CREATED_AT;
const id = MOCK_ENTITY_IDS;

export const MOCK_ENTITIES: readonly StoredEntity[] = [
  { entity_id: id.fynix, entity_type: 'brand', canonical_name: 'Fynix', created_at: at },
  { entity_id: id.brightwave, entity_type: 'brand', canonical_name: 'Brightwave Digital', created_at: at },
  {
    entity_id: id.rankforge,
    entity_type: 'brand',
    canonical_name: 'Rankforge',
    description: 'SEO agency for B2B software companies.',
    created_at: at,
  },
  {
    entity_id: id.northlight,
    entity_type: 'brand',
    canonical_name: 'Northlight SEO',
    // "Northlight" is also a common word, so it counts only near one of its hints
    is_ambiguous: true,
    disambiguation_hints: ['seo', 'agency', 'search'],
    created_at: at,
  },
  { entity_id: id.clickvantage, entity_type: 'brand', canonical_name: 'Clickvantage', created_at: at },
  { entity_id: id.meridian, entity_type: 'brand', canonical_name: 'Meridian Growth', created_at: at },
  { entity_id: id.seoWeekly, entity_type: 'organization', canonical_name: 'SEO Weekly', created_at: at },
  {
    entity_id: id.fynixAudit,
    entity_type: 'product',
    canonical_name: 'Fynix Audit',
    parent_entity_id: id.fynix,
    created_at: at,
  },
  { entity_id: id.cleanstart, entity_type: 'brand', canonical_name: 'Cleanstart', created_at: at },
  { entity_id: id.sparkle, entity_type: 'brand', canonical_name: 'Sparkle & Co', created_at: at },
];

const alias = (n: number, entity: string, text: string, extra: Partial<StoredAlias> = {}): StoredAlias => ({
  alias_id: aliasId(n),
  entity_id: entity,
  alias: text,
  created_at: at,
  ...extra,
});

export const MOCK_ALIASES: readonly StoredAlias[] = [
  alias(1, id.fynix, 'Fynix'),
  alias(2, id.fynix, 'Fynix Digital'),
  alias(3, id.brightwave, 'Brightwave'),
  alias(4, id.brightwave, 'Brightwave Digital'),
  alias(5, id.rankforge, 'Rankforge'),
  alias(6, id.rankforge, 'Rank Forge'),
  // An investment firm of the same name: a mention of it is not the agency
  alias(7, id.rankforge, 'Rankforge Capital', { is_negative: true }),
  alias(8, id.northlight, 'Northlight'),
  alias(9, id.northlight, 'Northlight SEO'),
  alias(10, id.clickvantage, 'Clickvantage'),
  alias(11, id.clickvantage, 'Click\\s?Vantage', { match_mode: 'regex' }),
  alias(12, id.meridian, 'Meridian Growth'),
  alias(13, id.seoWeekly, 'SEO Weekly', { case_sensitive: true }),
  alias(14, id.fynixAudit, 'Fynix Audit'),
  alias(15, id.cleanstart, 'Cleanstart'),
  alias(16, id.sparkle, 'Sparkle & Co'),
  alias(17, id.sparkle, 'Sparkle and Co'),
];

const domain = (n: number, entity: string, host: string, extra: Partial<StoredDomain> = {}): StoredDomain => ({
  entity_domain_id: domainRowId(n),
  entity_id: entity,
  host,
  ...extra,
});

export const MOCK_ENTITY_DOMAINS: readonly StoredDomain[] = [
  domain(1, id.fynix, 'fynix.digital'),
  domain(2, id.brightwave, 'brightwave.co.uk'),
  domain(3, id.rankforge, 'rankforge.com'),
  domain(4, id.northlight, 'northlightseo.com'),
  domain(5, id.clickvantage, 'clickvantage.io'),
  domain(6, id.meridian, 'meridiangrowth.com'),
  domain(7, id.seoWeekly, 'seoweekly.news'),
  // The publication's column on a shared platform: only its own pages count
  domain(8, id.seoWeekly, 'medium.com', { match_scope: 'path_prefix', path_prefix: '/seo-weekly' }),
  domain(9, id.cleanstart, 'cleanstart.com'),
  domain(10, id.sparkle, 'sparkleandco.com'),
];

const role = (
  project: string,
  entity: string,
  extra: Omit<StoredRole, 'project_id' | 'entity_id' | 'added_at'>,
): StoredRole => ({
  project_id: project,
  entity_id: entity,
  added_at: at,
  ...extra,
});

/** Own is colour 1 and competitors 2 to 6; a watched entity has none, so the client picks. */
export const MOCK_ROLES: readonly StoredRole[] = [
  role(FYNIX_PROJECT, id.fynix, { role: 'own', is_primary: true, color_index: 1 }),
  role(FYNIX_PROJECT, id.brightwave, { role: 'competitor', color_index: 2 }),
  role(FYNIX_PROJECT, id.rankforge, { role: 'competitor', color_index: 3 }),
  role(FYNIX_PROJECT, id.northlight, { role: 'competitor', color_index: 4 }),
  role(FYNIX_PROJECT, id.clickvantage, { role: 'competitor', color_index: 5 }),
  role(FYNIX_PROJECT, id.meridian, { role: 'competitor', color_index: 6 }),
  role(FYNIX_PROJECT, id.seoWeekly, { role: 'watch', track_seo: false }),
  role(CLEANSTART_PROJECT, id.cleanstart, { role: 'own', is_primary: true, color_index: 1 }),
  role(CLEANSTART_PROJECT, id.sparkle, { role: 'competitor', color_index: 2 }),
];

export const MOCK_VOCABULARIES: readonly StoredVocabulary[] = [
  { vocabulary_id: MOCK_VOCABULARY_IDS.topics, kind: 'topic', name: 'Topics', is_hierarchical: true },
  {
    vocabulary_id: MOCK_VOCABULARY_IDS.services,
    project_id: FYNIX_PROJECT,
    kind: 'service',
    name: 'Services',
    is_single_valued: true,
  },
];

const term = (n: number, vocabulary: string, name: string, slug: string, parent?: string): StoredTerm => ({
  term_id: termId(n),
  vocabulary_id: vocabulary,
  name,
  slug,
  created_at: at,
  ...(parent === undefined ? {} : { parent_id: parent }),
});

const topics = MOCK_VOCABULARY_IDS.topics;
const services = MOCK_VOCABULARY_IDS.services;
const terms = MOCK_TERM_IDS;

export const MOCK_TERMS: readonly StoredTerm[] = [
  term(1, topics, 'SEO', 'seo'),
  term(2, topics, 'Technical SEO', 'technical-seo', terms.seo),
  term(3, topics, 'Local SEO', 'local-seo', terms.seo),
  term(4, topics, 'Content Marketing', 'content-marketing'),
  term(5, topics, 'Blog Strategy', 'blog-strategy', terms.contentMarketing),
  term(6, topics, 'Paid Search', 'paid-search'),
  term(7, services, 'SEO Audit', 'seo-audit'),
  term(8, services, 'Content Strategy', 'content-strategy'),
  term(9, services, 'Link Building', 'link-building'),
];

const country = (location_id: number, name: string, country_iso: string): Location => ({
  location_id,
  name,
  country_iso,
  location_type: 'Country',
  parent_id: null,
  supports: ['serp'],
});

/**
 * A city of DataForSEO's list. Its parent there is usually a state or region, which the fixture leaves out,
 * so here it is the country.
 */
const city = (location_id: number, name: string, country_iso: string, parent_id: number): Location => ({
  location_id,
  name,
  country_iso,
  location_type: 'City',
  parent_id,
  supports: ['serp'],
});

/** DataForSEO location codes (the Google Ads geo target ids), names and types as DataForSEO gives them. */
export const MOCK_LOCATIONS: readonly Location[] = [
  country(2840, 'United States', 'US'),
  country(2826, 'United Kingdom', 'GB'),
  country(2276, 'Germany', 'DE'),
  country(2356, 'India', 'IN'),
  country(2250, 'France', 'FR'),
  country(2124, 'Canada', 'CA'),
  country(2036, 'Australia', 'AU'),
  country(2724, 'Spain', 'ES'),
  country(2380, 'Italy', 'IT'),
  country(2528, 'Netherlands', 'NL'),
  country(2076, 'Brazil', 'BR'),
  country(2392, 'Japan', 'JP'),
  city(1023191, 'New York,New York,United States', 'US', 2840),
  city(1013962, 'Los Angeles,California,United States', 'US', 2840),
  city(1006886, 'London,England,United Kingdom', 'GB', 2826),
  city(1003854, 'Berlin,Berlin,Germany', 'DE', 2276),
  city(1007785, 'Mumbai,Maharashtra,India', 'IN', 2356),
  city(1006094, 'Paris,Ile-de-France,France', 'FR', 2250),
];

/** The categories of 14-citation-intelligence.md section 4, with the labels the backend seeds. */
export const MOCK_DOMAIN_CATEGORIES: readonly DomainCategory[] = [
  { code: 'news', label: 'News', description: 'News publishers and magazines' },
  { code: 'review_aggregator', label: 'Review aggregator', description: 'Sites that collect and rank product reviews' },
  { code: 'ugc_forum', label: 'Forum', description: 'Forums, Q&A and other user-generated discussion' },
  { code: 'social', label: 'Social', description: 'Social networks' },
  { code: 'video', label: 'Video', description: 'Video platforms' },
  { code: 'wiki_reference', label: 'Wiki or reference', description: 'Encyclopedias and reference works' },
  { code: 'vendor_site', label: 'Vendor site', description: "A company's own site about its products" },
  { code: 'marketplace', label: 'Marketplace', description: 'Marketplaces and app stores' },
  { code: 'directory', label: 'Directory', description: 'Business and software directories' },
  { code: 'government', label: 'Government', description: 'Government sites' },
  { code: 'education', label: 'Education', description: 'Universities, schools and course sites' },
  { code: 'blog_independent', label: 'Independent blog', description: 'Blogs not run by a vendor or publisher' },
  { code: 'affiliate', label: 'Affiliate', description: 'Sites that earn from referral links' },
  { code: 'docs', label: 'Documentation', description: 'Product and developer documentation' },
  { code: 'other', label: 'Other', description: 'Anything not in another category' },
];
