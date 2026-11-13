import { byEngineOrder } from '@/components/app/engine/order';
import type { UnitShare } from '@/lib/citations/share-model';
import type { EngineCode, SourceDomainDetailData, SourcesMeta } from '@/lib/citations/types';

/**
 * The figures of the domain inspector, worked out from one read of `ai/sources/domains/{registrable_domain}`
 * (WB-DOM-02, WB-DOM-04). Pure: numbers in, numbers out, no text. A share always carries its units and its total,
 * and a figure that cannot be told is `null` (or an `unknown` row), never 0.
 */

const shareOf = (units: number, total: number): UnitShare => ({
  value: total === 0 ? null : units / total,
  units,
  total,
});

export interface DomainFigures {
  /** The units of every row of the domain: its roles added up. */
  units: number;
  /** Every unit in scope: the denominator of the share. */
  total: number;
  share: UnitShare;
  /** Valid answers in scope, citing or not. */
  answersInScope: number;
  /**
   * Answers that cite the domain and prompts whose answers cite it. The API counts both for each role apart, so
   * a domain read in several roles has no total of either: `null`, never a sum (an answer can cite two roles).
   */
  answers: number | null;
  prompts: number | null;
}

/** The strip of the inspector. `data.rows` is not empty: a domain that is not cited has no figures to draw. */
export function domainFigures(data: SourceDomainDetailData, meta: SourcesMeta): DomainFigures {
  const units = data.rows.reduce((sum, row) => sum + row.citation_units, 0);
  const [only, ...others] = data.rows;
  const single = only !== undefined && others.length === 0 ? only : null;
  return {
    units,
    total: meta.citation_units,
    share: shareOf(units, meta.citation_units),
    answersInScope: meta.answers,
    answers: single?.observations ?? null,
    prompts: single?.prompts ?? null,
  };
}

/**
 * One engine of the breakdown table: its share of the engine, with the counts it is of. `none`: the engine has no
 * citation in scope, so there is no share (it is not 0%); `asked` says whether it read any answer in scope, which
 * is what makes its 0 units and 0 answers true rather than unknown. `unknown`: the read has no series for an
 * engine in scope.
 */
export type EngineRow =
  | { code: EngineCode; state: 'share'; units: number; total: number; answers: number; share: number }
  | { code: EngineCode; state: 'none'; units: number; answers: number; asked: boolean }
  | { code: EngineCode; state: 'unknown' };

/**
 * A row for each engine in `engines`, in the fixed engine order. The units of the domain on an engine are the
 * rows' (roles added up); the engine's own units, the share's denominator, are the weekly `all_citation_units`
 * added up; the answers that cite the domain are the weekly `observations`, which count an answer once whatever
 * the roles. An engine of the read that is not in `engines` is left out.
 */
export function engineRows(data: SourceDomainDetailData, engines: readonly EngineCode[]): EngineRow[] {
  return byEngineOrder(engines, (code) => code).map((code): EngineRow => {
    const series = data.engines.find((engine) => engine.engine_code === code)?.series;
    if (series === undefined) return { code, state: 'unknown' };
    const units = data.rows.reduce(
      (sum, row) => sum + (row.engines.find((cell) => cell.engine_code === code)?.citation_units ?? 0),
      0,
    );
    const total = series.reduce((sum, week) => sum + week.all_citation_units, 0);
    const answers = series.reduce((sum, week) => sum + week.observations, 0);
    const asked = series.reduce((sum, week) => sum + week.answers, 0) > 0;
    return total === 0
      ? { code, state: 'none', units, answers, asked }
      : { code, state: 'share', units, total, answers, share: units / total };
  });
}
