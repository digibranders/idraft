import type {
  DomainRole,
  EngineCode,
  EngineUnits,
  MetricCell,
  SourceDomainRow,
  SourcesMeta,
  SourcesWeek,
  SourceWeekUnits,
} from './types';

/**
 * What a share is, and the figures built from the reads (docs/16 C1). Pure: numbers in, numbers out, no text.
 * A share always carries its units and its total (a screen says "of N units" next to it), and a share that
 * cannot be told is `null`, never 0: no unit in scope, an engine with no citation, a period with no answers.
 */

/** Units over a total. `value` is null when the total is 0. */
export interface UnitShare {
  value: number | null;
  units: number;
  total: number;
}

const shareOf = (units: number, total: number): UnitShare => ({
  value: total === 0 ? null : units / total,
  units,
  total,
});

/** A source share as the API sends it: `numerator` units of the `denominator` units in scope. */
export const unitShare = (cell: MetricCell): UnitShare => shareOf(cell.numerator, cell.denominator);

/**
 * The own citation share: the own role over every unit in scope. Read from `meta`, which no row filter narrows,
 * so a role filter never changes it.
 */
export function ownShare(meta: Pick<SourcesMeta, 'by_role' | 'citation_units'>): UnitShare {
  const own = meta.by_role.find((entry) => entry.domain_role === 'own');
  return shareOf(own?.citation_units ?? 0, meta.citation_units);
}

/** The citation units of each role in scope, for the counts of the role filter. */
export function roleUnits(meta: Pick<SourcesMeta, 'by_role'>): Record<DomainRole, number> {
  const units: Record<DomainRole, number> = { own: 0, competitor: 0, third_party: 0 };
  for (const entry of meta.by_role) units[entry.domain_role] = entry.citation_units;
  return units;
}

/** Every unit in scope on each engine of the read. */
export type EngineTotals = ReadonlyMap<EngineCode, number>;

/** The units of each engine (the roles of `by_role_by_engine` added up); null when the read did not ask for the block. */
export function engineTotals(meta: Pick<SourcesMeta, 'by_role_by_engine'>): EngineTotals | null {
  const blocks = meta.by_role_by_engine;
  if (blocks === undefined || blocks === null) return null;
  return new Map(
    blocks.map((block) => [
      block.engine_code,
      block.own.citation_units + block.competitor.citation_units + block.third_party.citation_units,
    ]),
  );
}

/**
 * The share of one engine of a row: its units on that engine over every unit of that engine. Null when the
 * totals are not known, the engine is not in them or not in the row, or the engine has no unit at all (no
 * citation on it is not a share of 0%).
 */
export function engineShare(
  row: { engines: readonly EngineUnits[] },
  code: EngineCode,
  totals: EngineTotals | null,
): UnitShare | null {
  const total = totals?.get(code);
  const units = row.engines.find((engine) => engine.engine_code === code)?.citation_units;
  if (total === undefined || total === 0 || units === undefined) return null;
  return shareOf(units, total);
}

/** How a share moved against the period before. */
export interface ShareChange {
  /** The share now minus the share before, as a ratio: `formatPointsDelta` reads it as percentage points. */
  delta: number;
  now: UnitShare;
  previous: UnitShare;
}

/**
 * The change of a row's share: now (the row's own share) minus before (its previous units over the previous
 * period's total, which `meta` of the current read does not carry, so the caller reads it from the same route
 * over `compare_window`). Null when the period before has no answers, no total, or the row has no previous
 * block; the row's share now must be known too.
 */
export function shareChange(
  row: Pick<SourceDomainRow, 'source_share' | 'previous'>,
  meta: Pick<SourcesMeta, 'previous_answers'>,
  previousMeta: Pick<SourcesMeta, 'citation_units'> | null | undefined,
): ShareChange | null {
  const previousUnits = row.previous?.citation_units;
  if ((meta.previous_answers ?? 0) === 0 || previousMeta === undefined || previousMeta === null) return null;
  if (previousUnits === undefined) return null;
  const now = unitShare(row.source_share);
  const previous = shareOf(previousUnits, previousMeta.citation_units);
  if (now.value === null || previous.value === null) return null;
  return { delta: now.value - previous.value, now, previous };
}

/**
 * Whether a row is new: not cited in the period before, which had answers to cite from, and cited at least
 * `minSupport` times now. Null when it cannot be told (no compare, no answers before): nothing is marked.
 */
export function isNewSource(
  row: Pick<SourceDomainRow, 'citation_units' | 'previous'>,
  meta: Pick<SourcesMeta, 'previous_answers'>,
  minSupport: number,
): boolean | null {
  if ((meta.previous_answers ?? 0) === 0 || row.previous === undefined || row.previous === null) return null;
  return row.previous.citation_units === 0 && row.citation_units >= minSupport;
}

/** One week of a row's weekly share. `value` is null for a gap: no unit in scope that week, or no point for it. */
export interface WeekShare extends UnitShare {
  weekStart: string;
}

/**
 * A row's weekly points over the scope's weeks (the denominators are `meta.series`, which a row filter does not
 * narrow). One entry per week of `meta`, in its order. A week with no unit in scope is a gap, not 0%; a week
 * in which the scope had units and the row none is a real 0.
 */
export function weeklyShare(
  series: readonly SourceWeekUnits[] | null | undefined,
  metaSeries: readonly SourcesWeek[] | null | undefined,
): readonly WeekShare[] | null {
  if (series === undefined || series === null || metaSeries === undefined || metaSeries === null) return null;
  const unitsOf = new Map(series.map((week) => [week.week_start, week.citation_units]));
  return metaSeries.map((week) => {
    const units = unitsOf.get(week.week_start);
    const share = shareOf(units ?? 0, week.citation_units);
    return { weekStart: week.week_start, ...share, value: units === undefined ? null : share.value };
  });
}
