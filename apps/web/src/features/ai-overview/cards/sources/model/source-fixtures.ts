import type { OverviewScope } from '../../../scope/scope-model';
import type {
  DomainRole,
  EngineCode,
  MetricCell,
  SourceDomainPage,
  SourceDomainRow,
  SourcesMeta,
} from '@/lib/citations/types';

/**
 * Builders of the source reads for the tests of the sources family: counts written as counts, every builder typed
 * by the generated schema so a field the API adds breaks here and not silently. Not a test file.
 */

/** The item at `index`, or a failed test: indexing under `noUncheckedIndexedAccess` without a non-null assertion. */
export function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`No item at index ${String(index)} of ${String(items.length)}`);
  return item;
}

/** The default scope of the Overview on Nov 12, 2026: 28 days, compared, every engine, branded left out. */
export function scopeOf(patch: Partial<OverviewScope> = {}): OverviewScope {
  return {
    range: { from: '2026-10-16', to: '2026-11-12', days: 28 },
    rangeValue: { kind: 'preset', preset: '28d' },
    compare: true,
    previous: { from: '2026-09-18', to: '2026-10-15' },
    country: null,
    engines: null,
    topic: null,
    branded: 'excluded',
    ...patch,
  };
}

/** The window of `scopeOf()` and the one before it, as the API writes them in `meta`. */
export const WINDOW = { from: '2026-10-16', to: '2026-11-12', timezone: 'UTC' } as const;
export const PREVIOUS_WINDOW = { from: '2026-09-18', to: '2026-10-15', timezone: 'UTC' } as const;

export const ENGINES_ALL: readonly EngineCode[] = ['chatgpt_web', 'gemini_web', 'google_ai_mode'];

/** `units` of `total` units in scope, over `answers` valid answers. */
export function shareCell(units: number, total: number, answers = 100): MetricCell {
  return { numerator: units, denominator: total, n_observations: answers, value: units === 0 ? null : units / total };
}

export interface DomainRowOptions {
  domain: string;
  role?: DomainRole;
  units: number;
  /** The units of every domain in scope: the denominator of the share. */
  total?: number;
  answers?: number;
  prompts?: number;
  /** Valid answers in scope, `n_observations` of the share. */
  valid?: number;
  /** Units per engine, in the order of `meta.engine_codes`. */
  engines?: readonly (readonly [EngineCode, number])[];
  /** Units and citing answers in the window before; left out when not compared. */
  previous?: { units: number; answers: number };
  entityId?: string | null;
}

export function domainRow({
  domain,
  role = 'third_party',
  units,
  total = 1000,
  answers = units,
  prompts = 10,
  valid = 100,
  engines = [['chatgpt_web', units]],
  previous,
  entityId = null,
}: DomainRowOptions): SourceDomainRow {
  return {
    registrable_domain: domain,
    domain_role: role,
    role_entity_id: entityId,
    citation_units: units,
    observations: answers,
    prompts,
    engines: engines.map(([engine_code, citation_units]) => ({ engine_code, citation_units })),
    first_seen_at: '2026-10-17T09:00:00Z',
    last_seen_at: '2026-11-11T09:00:00Z',
    source_share: shareCell(units, total, valid),
    ...(previous === undefined ? {} : { previous: { citation_units: previous.units, observations: previous.answers } }),
  };
}

export interface MetaOptions {
  units?: number;
  answers?: number;
  citing?: number;
  engines?: readonly EngineCode[];
  includeBranded?: boolean;
  /** Valid answers in the window before; given means the read was compared. */
  previousAnswers?: number;
  byRole?: Partial<Record<DomainRole, number>>;
}

export function sourcesMeta({
  units = 1000,
  answers = 120,
  citing = 100,
  engines = ENGINES_ALL,
  includeBranded = false,
  previousAnswers,
  byRole = { own: 100, competitor: 200, third_party: 700 },
}: MetaOptions = {}): SourcesMeta {
  return {
    window: WINDOW,
    include_branded: includeBranded,
    engine_codes: [...engines],
    answers,
    answers_citing: citing,
    citation_units: units,
    by_role: (['own', 'competitor', 'third_party'] as const).map((domain_role) => ({
      domain_role,
      citation_units: byRole[domain_role] ?? 0,
      observations: 0,
    })),
    ...(previousAnswers === undefined ? {} : { compare_window: PREVIOUS_WINDOW, previous_answers: previousAnswers }),
  };
}

export function domainPage(
  rows: readonly SourceDomainRow[],
  meta: SourcesMeta = sourcesMeta(),
  total: number = rows.length,
): SourceDomainPage {
  return { data: [...rows], meta, page: { limit: 50, offset: 0, total } };
}
