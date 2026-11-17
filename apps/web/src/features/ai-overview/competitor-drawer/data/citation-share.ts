import type { Schemas } from '@/lib/api/types';
import { MIN_OBSERVATIONS, type Counts } from '@/lib/stats';

type Competitors = Schemas['AiCompetitorsResponse'];
type Cell = Competitors['data'][number]['by_engine'][number]['citation_share'];

/**
 * Citation share of you and one competitor over the platforms of the page scope (OV-DRW-10): the share of the platform's
 * citation units that are pages of the brand's own domain, from `GET ai/competitors` (`citation_share` of each entity
 * and engine). One platform is its own value; All platforms is the equal-weight average of the platforms where both
 * brands have a share (R3). A platform with fewer than 4 valid answers, or a value the API withholds, has none, and
 * "none" is never 0 (R6). `ownCounts` and `rivalCounts` are the citation units behind each (added up over the
 * platforms of an average), which the gap icon tests; `null` where the API sends no whole count.
 */
export interface CitationShare {
  own: number | null;
  rival: number | null;
  ownCounts: Counts | null;
  rivalCounts: Counts | null;
}

const NONE: CitationShare = { own: null, rival: null, ownCounts: null, rivalCounts: null };

/** `n_observations` of this key is the engine's valid answers (the schema says so), which is what R2 counts. */
const valueOf = (cell: { citation_share: Cell } | undefined): number | null =>
  cell === undefined || cell.citation_share.value === null || cell.citation_share.n_observations < MIN_OBSERVATIONS
    ? null
    : cell.citation_share.value;

/** The units of a cell as counts, when the API gives both whole. */
function unitsOf(cell: { citation_share: Cell } | undefined): Counts | null {
  const { numerator, denominator } = cell?.citation_share ?? { numerator: null, denominator: null };
  return Number.isInteger(numerator) && Number.isInteger(denominator) && (numerator ?? 0) <= (denominator ?? 0)
    ? { k: numerator ?? 0, n: denominator ?? 0 }
    : null;
}

const sumOf = (counts: readonly (Counts | null)[]): Counts | null =>
  counts.some((entry) => entry === null)
    ? null
    : counts.reduce<Counts>((total, entry) => ({ k: total.k + (entry?.k ?? 0), n: total.n + (entry?.n ?? 0) }), {
        k: 0,
        n: 0,
      });

export function citationShareOf(
  response: Competitors,
  codes: readonly string[],
  ownId: string,
  rivalId: string,
): CitationShare {
  const own = response.data.find((row) => row.entity.entity_id === ownId);
  const rival = response.data.find((row) => row.entity.entity_id === rivalId);
  if (own === undefined || rival === undefined) return NONE;
  const used = codes.flatMap((code) => {
    const ownCell = own.by_engine.find((entry) => entry.engine_code === code);
    const rivalCell = rival.by_engine.find((entry) => entry.engine_code === code);
    const ownValue = valueOf(ownCell);
    const rivalValue = valueOf(rivalCell);
    return ownValue === null || rivalValue === null
      ? []
      : [{ ownValue, rivalValue, ownUnits: unitsOf(ownCell), rivalUnits: unitsOf(rivalCell) }];
  });
  if (used.length === 0) return NONE;
  const mean = (pick: (entry: (typeof used)[number]) => number): number =>
    used.reduce((total, entry) => total + pick(entry), 0) / used.length;
  return {
    own: mean((entry) => entry.ownValue),
    rival: mean((entry) => entry.rivalValue),
    ownCounts: sumOf(used.map((entry) => entry.ownUnits)),
    rivalCounts: sumOf(used.map((entry) => entry.rivalUnits)),
  };
}
