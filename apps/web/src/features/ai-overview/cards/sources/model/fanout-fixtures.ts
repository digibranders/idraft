import { WINDOW } from './source-fixtures';
import type { EngineCode, Schemas } from '@/lib/api/types';

/**
 * Builders of the fan-out read for the tests of the fan-out card: counts written as counts, every builder typed by
 * the generated schema so a field the API adds breaks here and not silently. Not a test file.
 */

type DomainRole = Schemas['FanoutCitedDomain']['domain_role'];

export interface FanoutRowOptions {
  /** The most common spelling of the query: provider text. */
  text: string;
  /** Answers that issued it. */
  observations: number;
  prompts?: number;
  engine?: EngineCode;
  /** The domains of the sources in those answers: domain, role, citation units. */
  cited?: readonly (readonly [string, DomainRole, number])[];
}

export function fanoutRow({
  text,
  observations,
  prompts = 3,
  engine = 'chatgpt_web',
  cited = [['g2.com', 'third_party', 12]],
}: FanoutRowOptions): Schemas['FanoutQueryRow'] {
  return {
    query_text: text,
    normalized_text: text.toLowerCase().replace(/\s+/g, ' ').trim(),
    engine_code: engine,
    observations,
    prompts,
    prompt_ids: Array.from({ length: prompts }, (_, place) => `prompt-${String(place + 1)}`),
    first_seen_at: '2026-10-17T09:00:00Z',
    last_seen_at: '2026-11-11T09:00:00Z',
    cited_domains: cited.map(([registrable_domain, domain_role, citation_units]) => ({
      registrable_domain,
      domain_role,
      citation_units,
      role_entity_id: null,
    })),
  };
}

export interface FanoutMetaOptions {
  /** Valid answers in scope on the engines that show fan-out. */
  answers?: number;
  withFanout?: number;
  truncated?: number;
  engines?: readonly EngineCode[];
  without?: readonly EngineCode[];
  minSupport?: number;
  includeBranded?: boolean;
}

export function fanoutMeta({
  answers = 96,
  withFanout = 80,
  truncated = 0,
  engines = ['chatgpt_web'],
  without = ['gemini_web', 'google_ai_mode'],
  minSupport = 2,
  includeBranded = false,
}: FanoutMetaOptions = {}): Schemas['FanoutMeta'] {
  return {
    window: WINDOW,
    include_branded: includeBranded,
    engine_codes: [...engines],
    engines_without_fanout: [...without],
    min_support: minSupport,
    answers,
    answers_truncated: truncated,
    answers_with_fanout: withFanout,
  };
}

export function fanoutPage(
  rows: readonly Schemas['FanoutQueryRow'][],
  meta: Schemas['FanoutMeta'] = fanoutMeta(),
  total: number = rows.length,
): Schemas['FanoutQueryPage'] {
  return { data: [...rows], meta, page: { limit: 50, offset: 0, total } };
}
