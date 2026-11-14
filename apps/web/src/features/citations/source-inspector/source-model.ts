import { byEngineOrder } from '@/components/app/engine/order';
import { unitShare, type EngineTotals, type UnitShare } from '@/lib/citations/share-model';
import type {
  CitationRow,
  DomainRole,
  EngineCode,
  SourcePageRow,
  SourcesMeta,
  SourcesWeek,
  SourceWeekUnits,
} from '@/lib/citations/types';

/**
 * The figures of the source inspector (WB-SRC-01), worked out from the reads of one cited page. Pure: numbers in,
 * numbers out, no text. A share always carries its units and its total, and a figure that cannot be told is `null`,
 * never 0.
 */

/** The id of a source in the address is the numeric `url_id`: a positive whole number, written plainly. */
export function parseUrlId(id: string): number | null {
  if (!/^[1-9]\d*$/.test(id)) return null;
  const value = Number(id);
  return Number.isSafeInteger(value) ? value : null;
}

/** Who the page is, as its newest citation names it. The title is provider text: show it as text, never as markup. */
export interface SourceIdentity {
  urlId: number;
  url: string;
  host: string;
  registrable: string;
  role: DomainRole;
  /** The tracked entity the role belongs to (a competitor); `null` for a third party and for the own domain. */
  roleEntityId: string | null;
  title: string | null;
  /** When the newest of the citations read was made. */
  lastCitedAt: string;
}

/** The identity from the newest of the citations; `null` when no answer in scope cites the page. */
export function identityOf(rows: readonly CitationRow[]): SourceIdentity | null {
  const newest = rows.reduce<CitationRow | null>(
    (latest, row) => (latest === null || Date.parse(row.observed_at) > Date.parse(latest.observed_at) ? row : latest),
    null,
  );
  return newest === null
    ? null
    : {
        urlId: newest.url_id,
        url: newest.url,
        host: newest.host,
        registrable: newest.registrable_domain,
        role: newest.domain_role,
        roleEntityId: newest.role_entity_id,
        title: newest.title,
        lastCitedAt: newest.observed_at,
      };
}

/**
 * The row of the page among the pages of its domain; `null` when it is past the 200 the read lists. The API gives a
 * page once for each role and entity it was cited in, so the row is the one of the role the newest citation names
 * (the role the header shows); only when no row has it does the first row of the page stand in.
 */
export function pageRowOf(
  pages: readonly SourcePageRow[],
  identity: Pick<SourceIdentity, 'urlId' | 'role' | 'roleEntityId'>,
): SourcePageRow | null {
  const ofPage = pages.filter((page) => page.url_id === identity.urlId);
  return (
    ofPage.find((page) => page.domain_role === identity.role && page.role_entity_id === identity.roleEntityId) ??
    ofPage[0] ??
    null
  );
}

/**
 * One engine of the breakdown. `units` is `null` when the row lists no figure for the engine; `total` is `null`
 * while the engine's own units are not known; `share` is only for an engine with both and a total above 0 (no unit on
 * an engine is not a share of 0%).
 */
export interface SourceEngineFigure {
  code: EngineCode;
  units: number | null;
  total: number | null;
  share: number | null;
}

export interface SourceFigures {
  units: number;
  /** The row's share of every unit in scope, with the counts it is of. */
  share: UnitShare;
  /** Valid answers in scope, citing or not. */
  answersInScope: number;
  answers: number;
  prompts: number;
  /** One for each engine in scope, in the fixed engine order. */
  engines: SourceEngineFigure[];
  /** The engines whose units on the page are above 0; `null` when the row does not list every engine. */
  enginesCiting: number | null;
}

/** The strip and the engine table of one page, from its row, the read's `meta` and the engines' own units. */
export function figuresOf(row: SourcePageRow, meta: SourcesMeta, totals: EngineTotals | null): SourceFigures {
  const engines = byEngineOrder(meta.engine_codes, (code) => code).map((code): SourceEngineFigure => {
    const units = row.engines.find((engine) => engine.engine_code === code)?.citation_units ?? null;
    const total = totals?.get(code) ?? null;
    return {
      code,
      units,
      total,
      share: units === null || total === null || total === 0 ? null : units / total,
    };
  });
  return {
    units: row.citation_units,
    share: unitShare(row.source_share),
    answersInScope: meta.answers,
    answers: row.observations,
    prompts: row.prompts,
    engines,
    enginesCiting: engines.some((engine) => engine.units === null)
      ? null
      : engines.filter((engine) => (engine.units ?? 0) > 0).length,
  };
}

/** The counts a point is of. */
export interface SourceTrendCell {
  units: number;
  total: number;
}

export interface SourceTrend {
  /** The `week_start` of each week of the scope, oldest first. */
  weeks: string[];
  /** The page's share of the scope's units that week; `null` is a gap: nothing to be a share of. */
  values: (number | null)[];
  /** The counts of each value; `null` where the value is a gap. */
  cells: (SourceTrendCell | null)[];
}

/**
 * The weekly share of the page over the scope's weeks (all engines together, which the chart says). A week in which
 * the scope had no unit is a gap, as is a week the page has no point for (the API zero fills, so a missing one is a
 * fault, not a 0); a week with units and none for the page is a real 0. `null` when there is nothing to draw.
 */
export function trendOf(
  series: readonly SourceWeekUnits[] | null | undefined,
  scopeWeeks: readonly SourcesWeek[] | null | undefined,
): SourceTrend | null {
  if (series === undefined || series === null || scopeWeeks === undefined || scopeWeeks === null) return null;
  const cells = scopeWeeks.map((week): SourceTrendCell | null => {
    const point = series.find((candidate) => candidate.week_start === week.week_start);
    return point === undefined || week.citation_units === 0
      ? null
      : { units: point.citation_units, total: week.citation_units };
  });
  return cells.some((cell) => cell !== null)
    ? {
        weeks: scopeWeeks.map((week) => week.week_start),
        values: cells.map((cell) => (cell === null ? null : cell.units / cell.total)),
        cells,
      }
    : null;
}
