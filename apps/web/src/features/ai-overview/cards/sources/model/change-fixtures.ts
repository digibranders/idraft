import { PREVIOUS_WINDOW, WINDOW } from './source-fixtures';
import type {
  DomainRole,
  EngineCode,
  SourceChangePage,
  SourceChangeRow,
  SourceDiversity,
  SourceDiversityEngine,
} from '@/lib/citations/types';
import type { Schemas } from '@/lib/api/types';

/**
 * Builders of the new and lost reads and of the diversity read for the tests of the sources family: counts written
 * as counts, typed by the generated schema. Not a test file.
 */

export interface ChangeRowOptions {
  domain: string;
  role?: DomainRole;
  /** Citation units in the window (0 for a lost domain). */
  now?: number;
  /** Citation units in the comparison window (0 for a new domain). */
  before?: number;
  entityId?: string | null;
}

export function changeRow({
  domain,
  role = 'third_party',
  now = 0,
  before = 0,
  entityId = null,
}: ChangeRowOptions): SourceChangeRow {
  return {
    registrable_domain: domain,
    domain_role: role,
    role_entity_id: entityId,
    current_units: now,
    previous_units: before,
    first_seen_at: now > 0 ? '2026-10-20T09:00:00Z' : null,
    last_seen_at: now > 0 ? '2026-11-10T09:00:00Z' : null,
  };
}

export interface ChangePageOptions {
  /** `page.total`: the rows the route holds, which can be more than the rows it sent. */
  total?: number;
  minSupport?: number;
  engines?: readonly EngineCode[];
}

/** The page of one kind; the windows are those the route answers for it (`lost` reads the two windows after its support). */
export function changePage(
  kind: 'new' | 'lost',
  rows: readonly SourceChangeRow[],
  { total = rows.length, minSupport = 2, engines = ['chatgpt_web', 'gemini_web'] }: ChangePageOptions = {},
): SourceChangePage {
  return {
    data: [...rows],
    page: { offset: 0, limit: 50, total },
    meta: {
      window: WINDOW,
      compare_window: PREVIOUS_WINDOW,
      include_branded: false,
      engine_codes: [...engines],
      kind,
      min_support: minSupport,
    },
  };
}

export function diversityWeek(
  weekStart: string,
  units: number,
  domains: number,
  effective: number | null,
): Schemas['DiversityWeek'] {
  return { week_start: weekStart, citation_units: units, distinct_domains: domains, effective_sources: effective };
}

export interface DiversityEngineOptions {
  answers?: number;
  citing?: number;
  units?: number;
  domains?: number;
  effective?: number | null;
  /** Left out (`undefined`) when the read was made without `include=series`. */
  weeks?: readonly Schemas['DiversityWeek'][] | undefined;
}

export function diversityEngine(
  code: EngineCode,
  { answers = 120, citing = 100, units = 400, domains = 40, effective = 18.6, weeks }: DiversityEngineOptions = {},
): SourceDiversityEngine {
  return {
    engine_code: code,
    answers,
    answers_citing: citing,
    citation_units: units,
    distinct_domains: domains,
    effective_sources: { value: effective, numerator: units * units, denominator: 1, n_observations: answers },
    ...(weeks === undefined ? {} : { series: [...weeks] }),
  };
}

export interface DiversityOptions {
  /** Registrable domains over every engine in scope. */
  distinct?: number;
  /** The equal-weight mean of the engines with units, as the API states it. */
  average?: number | null;
}

export function diversityRead(
  engines: readonly SourceDiversityEngine[],
  { distinct = 412, average = 18.6 }: DiversityOptions = {},
): SourceDiversity {
  return {
    data: [...engines],
    meta: {
      window: WINDOW,
      include_branded: false,
      engine_codes: engines.map((engine) => engine.engine_code),
      distinct_domains: distinct,
      effective_sources_engine_average: average,
    },
  };
}
