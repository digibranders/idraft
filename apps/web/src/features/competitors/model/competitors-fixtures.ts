import type { components } from '@/lib/api/schema';

/**
 * Typed builders of the bodies of `GET {P}/ai/competitors`, for tests (never imported by the app). Each takes the
 * members a test cares about and fills the rest with a valid, plain value, so a test says only what it checks.
 */

type Schemas = components['schemas'];
export type AiCompetitorsResponse = Schemas['AiCompetitorsResponse'];
export type AiCompetitor = Schemas['AiCompetitor'];
export type AiCompetitorEngine = Schemas['AiCompetitorEngine'];
export type AiMetricValue = Schemas['AiMetricValue'];
export type AiMetricMeta = Schemas['AiMetricMeta'];

export const FIXTURE_WINDOW = { from: '2026-10-17', to: '2026-11-13', timezone: 'Europe/Berlin' } as const;
export const OWN_ID = '00000000-0000-4000-8000-000000000001';
export const HUBSPOT_ID = '00000000-0000-4000-8000-000000000002';
export const ZOHO_ID = '00000000-0000-4000-8000-000000000003';

const FILTERS: Schemas['AiFilters'] = {
  branded_only: false,
  country_iso: null,
  include_branded: false,
  term_id: null,
};

/** A value of one metric: a ratio with the counts behind it. */
export function metricValue(over: Partial<AiMetricValue> = {}): AiMetricValue {
  return {
    denominator: 100,
    filters: FILTERS,
    is_estimate: false,
    method: 'fixture',
    method_version: 1,
    metric: 'ai.share_of_voice',
    n_observations: 100,
    numerator: 30,
    unit: 'ratio',
    value: 0.3,
    window: FIXTURE_WINDOW,
    ...over,
  };
}

/** The values of one entity on one engine. */
export function engineCells(engineCode: string, over: Partial<AiCompetitorEngine> = {}): AiCompetitorEngine {
  return {
    citation_share: metricValue({ metric: 'ai.citation_share', engine_code: engineCode }),
    engine_code: engineCode,
    is_top_competitor: false,
    mention_rate: metricValue({
      metric: 'ai.mention_rate',
      engine_code: engineCode,
      numerator: 7.5,
      denominator: 25,
      n_prompts: 25,
      value: 0.3,
      pooled: { successes: 30, trials: 100 },
    }),
    recommendation_rate: metricValue({
      metric: 'ai.recommendation_rate',
      engine_code: engineCode,
      numerator: null,
      denominator: null,
      value: null,
      suppressed_reason: 'not_classified',
    }),
    share_of_voice: metricValue({ engine_code: engineCode }),
    ...over,
  };
}

/** One tracked entity of the set, with the engines asked for. */
export function competitorRow(
  entityId: string,
  name: string,
  role: 'own' | 'competitor',
  colorIndex: number | null,
  engines: readonly AiCompetitorEngine[] = [engineCells('chatgpt_web')],
): AiCompetitor {
  return {
    entity: { canonical_name: name, color_index: colorIndex, entity_id: entityId, entity_type: 'brand', role },
    by_engine: [...engines],
  };
}

/** The response of `ai/competitors`: the own brand and two competitors unless the test gives the rows. */
export function competitorsBody(
  rows: readonly AiCompetitor[] = [
    competitorRow(OWN_ID, 'Fynix', 'own', 1),
    competitorRow(HUBSPOT_ID, 'HubSpot', 'competitor', 2),
    competitorRow(ZOHO_ID, 'Zoho', 'competitor', 3),
  ],
  meta: Partial<AiMetricMeta> = {},
): AiCompetitorsResponse {
  return {
    data: [...rows],
    meta: {
      branded_only: false,
      engine_codes: ['chatgpt_web'],
      entities: rows.map((row) => ({
        entity_id: row.entity.entity_id,
        name: row.entity.canonical_name,
        role: row.entity.role === 'own' ? 'own' : 'competitor',
      })),
      entity_config_versions: [1],
      include_branded: false,
      notes: [],
      window: FIXTURE_WINDOW,
      ...meta,
    },
  };
}
