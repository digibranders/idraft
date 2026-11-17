/**
 * The Cited domains tab (OV-DRW-40 to OV-DRW-42). The domains AI cites in the answers that mention each of you are not
 * collected yet (backend request 6 of `docs/ai-visibility/backend-requests-overview.md`), so this is the shape the read
 * will have. The overlap is metric C7: the Jaccard value of the two top 8 sets, computed here from them.
 */

/** A domain and its share of the citations in the answers that mention one brand, 0 to 1. */
export interface CitedDomain {
  domain: string;
  share: number;
  /** A competitor's or your own site is no place to look for a citation (only third-party domains are listed as a gap). */
  thirdParty: boolean;
}

/** The two lists of one competitor, each already limited to its top domains and sorted by share, largest first. */
export interface CompetitorSources {
  theirs: CitedDomain[];
  yours: CitedDomain[];
}

/** The size of the sets the overlap and the gap are read from. */
export const TOP = 8;

export interface SourceComparison {
  /** Jaccard overlap of the two top sets, 0 to 1. */
  overlap: number;
  /** The third-party domains in their top set and not in yours, in the order of their list. */
  onlyTheirs: string[];
}

export function compareSources({ theirs, yours }: CompetitorSources): SourceComparison {
  const top = (list: readonly CitedDomain[]): Set<string> => new Set(list.slice(0, TOP).map((entry) => entry.domain));
  const a = top(theirs);
  const b = top(yours);
  const shared = [...a].filter((domain) => b.has(domain)).length;
  const union = a.size + b.size - shared;
  return {
    overlap: union === 0 ? 0 : shared / union,
    onlyTheirs: theirs
      .slice(0, TOP)
      .filter((entry) => entry.thirdParty && !b.has(entry.domain))
      .map((entry) => entry.domain),
  };
}
