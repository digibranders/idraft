import type { Schemas } from '@/lib/api/types';
import { MIN_OBSERVATIONS } from '@/lib/stats';

type Competitors = Schemas['AiCompetitorsResponse'];

/**
 * Citation share of you and one competitor over the platforms of the page scope (OV-DRW-10): the share of the platform's
 * citation units that are pages of the brand's own domain, from `GET ai/competitors` (`citation_share` of each entity
 * and engine). One platform is its own value; All platforms is the equal-weight average of the platforms where both
 * brands have a share (R3). A platform with fewer than 4 citation units, or a value the API withholds, has none, and
 * "none" is never 0 (R6).
 */
export interface CitationShare {
  own: number | null;
  rival: number | null;
}

const NONE: CitationShare = { own: null, rival: null };

const valueOf = (cell: Competitors['data'][number]['by_engine'][number] | undefined): number | null =>
  cell === undefined || cell.citation_share.value === null || (cell.citation_share.denominator ?? 0) < MIN_OBSERVATIONS
    ? null
    : cell.citation_share.value;

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
    const ownValue = valueOf(own.by_engine.find((entry) => entry.engine_code === code));
    const rivalValue = valueOf(rival.by_engine.find((entry) => entry.engine_code === code));
    return ownValue === null || rivalValue === null ? [] : [{ ownValue, rivalValue }];
  });
  if (used.length === 0) return NONE;
  const mean = (pick: (entry: (typeof used)[number]) => number): number =>
    used.reduce((total, entry) => total + pick(entry), 0) / used.length;
  return { own: mean((entry) => entry.ownValue), rival: mean((entry) => entry.rivalValue) };
}
