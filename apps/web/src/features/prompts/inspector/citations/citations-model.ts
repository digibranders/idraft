import type { PromptCounts } from '../../inspector-reads';
import { STALE_AFTER_DAYS } from '../../history-model';
import type { FaviconMode } from '@/components/app/cells/domain-cell';
import { byEngineOrder } from '@/components/app/engine/order';
import { isNewSource } from '@/lib/citations/share-model';
import type { DomainRole, EngineUnits, SourceChangePage, SourcesMeta } from '@/lib/citations/types';
import type { ProjectEngine } from '@/lib/api/types';

/**
 * What the Citations tab of the prompt inspector decides from its reads (WB-PIC-01 to 04, 10). Pure: numbers and
 * rows in, rows out, no text. The shares themselves come from `@/lib/citations/share-model`.
 */

/** The engine choice that reads every enabled engine; any other value is an engine code. */
export const ALL_ENGINES = 'all';

/** Favicons are shown everywhere until the project setting exists (plan D16). */
export const FAVICON: FaviconMode = 'show';

/** The lists name the five most cited. */
export const TOP_LIMIT = 5;

/** The fewest citation units a row needs; one prompt has about 8 answers, so 3 is already strict (plan Q10). */
export const MIN_SUPPORT_OPTIONS = [1, 2, 3] as const;
export const DEFAULT_MIN_SUPPORT = 1;

const DAY_MS = 86_400_000;

export interface EngineColumn {
  code: string;
  label: string;
}

/** One count column for each engine, in the fixed engine order, for All engines with more than one engine. */
export function engineColumns(engines: readonly ProjectEngine[], chosen: string): EngineColumn[] {
  if (chosen !== ALL_ENGINES || engines.length < 2) return [];
  return byEngineOrder(engines, (entry) => entry.engine.engine_code).map((entry) => ({
    code: entry.engine.engine_code,
    label: entry.engine.label,
  }));
}

/**
 * A row's citation units on one engine, or null (n/a) where there are none to tell: the row does not list the
 * engine, or the engine has no valid answer in the window (the summary cell's denominator is 0), so 0 would say
 * "cited nowhere" about answers that do not exist. Without a summary cell for the engine the row is trusted.
 */
export function engineCell(
  row: { engines: readonly EngineUnits[] },
  code: string,
  counts: PromptCounts,
): number | null {
  const units = row.engines.find((entry) => entry.engine_code === code)?.citation_units;
  if (units === undefined) return null;
  const validAnswers = counts.row?.engines.find((entry) => entry.engine_code === code)?.cited.denominator;
  return validAnswers === 0 ? null : units;
}

export interface TopRow<TRow> {
  row: TRow;
  /** Cited now and not in the period before, which had answers to cite from. */
  isNew: boolean;
}

export interface TopRows<TRow> {
  rows: TopRow<TRow>[];
  /** False when the previous period has no answers: nothing can be told New, and the tab says so. */
  previousKnown: boolean;
}

/** The first `TOP_LIMIT` rows of a read, each with its New marker. */
export function topRows<TRow extends Parameters<typeof isNewSource>[0]>(
  rows: readonly TRow[],
  meta: Pick<SourcesMeta, 'previous_answers'>,
  minSupport: number,
): TopRows<TRow> {
  return {
    rows: rows.slice(0, TOP_LIMIT).map((row) => ({ row, isNew: isNewSource(row, meta, minSupport) === true })),
    previousKnown: (meta.previous_answers ?? 0) > 0,
  };
}

/** The own domain is cited in none of the answers read, though there are answers (0 answers is "nothing to count"). */
export function notCited(meta: Pick<SourcesMeta, 'answers' | 'by_role'>): boolean {
  const own = meta.by_role.find((entry) => entry.domain_role === 'own');
  return meta.answers > 0 && (own?.observations ?? 0) === 0;
}

export interface LostRow {
  key: string;
  domain: string;
  role: DomainRole;
  /** Citation units it had in the period before. */
  units: number;
}

/** The lost domains of a `sources/changes` read, with their units before. */
export function lostRows(page: Pick<SourceChangePage, 'data'>): LostRow[] {
  return page.data.map((row) => ({
    key: `${row.registrable_domain}:${row.domain_role}:${row.role_entity_id ?? ''}`,
    domain: row.registrable_domain,
    role: row.domain_role,
    units: row.previous_units,
  }));
}

/** The last valid answer when it is `STALE_AFTER_DAYS` days old or more, else null (also for no valid answer at all). */
export function staleSince(lastValidAt: string | null | undefined, now: Date): string | null {
  if (lastValidAt === null || lastValidAt === undefined) return null;
  return now.getTime() - Date.parse(lastValidAt) >= STALE_AFTER_DAYS * DAY_MS ? lastValidAt : null;
}
