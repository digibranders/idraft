/**
 * Rank display and rank-change classification.
 * Rank semantics are inverted: 1 is best. A numeric decrease is an improvement.
 * Spec: docs/design-system/22-content-formatting.md section 3 and 25-component-inventory.md (RankCell, RankDelta).
 * Methodology: docs/09-rank-tracking-methodology.md (depth-aware nulls), docs/17-statistical-methodology.md section 10.
 */

export interface RankObservation {
  /** Organic rank, or null when not found within `depth`. */
  rank: number | null;
  /** Depth requested for the check (10, 20, 50, 100). */
  depth: number;
}

export type RankBucket = 'top3' | 'top10' | 'top20' | 'top50' | 'top100' | 'beyond';

export const RANK_BUCKETS: ReadonlyArray<{ id: RankBucket; label: string; min: number; max: number }> = [
  { id: 'top3', label: '1 to 3', min: 1, max: 3 },
  { id: 'top10', label: '4 to 10', min: 4, max: 10 },
  { id: 'top20', label: '11 to 20', min: 11, max: 20 },
  { id: 'top50', label: '21 to 50', min: 21, max: 50 },
  { id: 'top100', label: '51 to 100', min: 51, max: 100 },
];

export function rankBucket(obs: RankObservation): RankBucket {
  if (obs.rank === null) return 'beyond';
  for (const b of RANK_BUCKETS) if (obs.rank >= b.min && obs.rank <= b.max) return b.id;
  return 'beyond';
}

/** Rank in a table cell: "3", or ">20" when beyond depth. */
export function formatRankCell(obs: RankObservation): string {
  return obs.rank === null ? `>${obs.depth}` : String(obs.rank);
}

/** Rank inside sentences, tooltips and timelines: "#3", or "not in top 20". */
export function formatRankInline(obs: RankObservation): string {
  return obs.rank === null ? `not in top ${obs.depth}` : `#${obs.rank}`;
}

/** Accessible description: "rank 3" or "not in top 20". */
export function describeRank(obs: RankObservation): string {
  return obs.rank === null ? `not in top ${obs.depth}` : `rank ${obs.rank}`;
}

export type RankChangeKind =
  | 'improved'
  | 'declined'
  | 'unchanged'
  | 'entered'          // beyond depth before, ranked now
  | 'dropped'          // ranked before, beyond depth now
  | 'unchanged_beyond' // beyond depth in both checks (or consistent across depths)
  | 'first_check';

export interface RankChange {
  kind: RankChangeKind;
  /** Positions moved, always positive, only for improved and declined. */
  positions: number | null;
  /**
   * Whether the change exceeds the keyword's normal movement and may be colored.
   * Rule: |change| > max(2, 2 x mean absolute daily change over the last 30 ranked checks).
   * entered and dropped are always emphasized.
   */
  emphasized: boolean;
}

export function classifyRankChange(
  previous: RankObservation | null,
  current: RankObservation,
  meanAbsDailyChange: number | null = null,
): RankChange {
  if (previous === null) return { kind: 'first_check', positions: null, emphasized: false };
  const commonDepth = Math.min(previous.depth, current.depth);
  const prevWithin = previous.rank !== null && previous.rank <= commonDepth;
  const currWithin = current.rank !== null && current.rank <= commonDepth;

  if (prevWithin && currWithin) {
    const diff = (previous.rank as number) - (current.rank as number);
    if (diff === 0) return { kind: 'unchanged', positions: 0, emphasized: false };
    const threshold = Math.max(2, 2 * (meanAbsDailyChange ?? 0));
    return {
      kind: diff > 0 ? 'improved' : 'declined',
      positions: Math.abs(diff),
      emphasized: Math.abs(diff) > threshold,
    };
  }
  if (!prevWithin && currWithin) return { kind: 'entered', positions: null, emphasized: true };
  if (prevWithin && !currWithin) return { kind: 'dropped', positions: null, emphasized: true };
  return { kind: 'unchanged_beyond', positions: null, emphasized: false };
}

export type ChangeTone = 'positive' | 'negative' | 'neutral';

export interface RankChangeDisplay {
  /** Visible text: "↑5", "↓3", "0", "New", "Lost", or "" */
  text: string;
  /** Screen reader text: "improved 5 positions" */
  label: string;
  tone: ChangeTone;
}

export function formatRankChange(change: RankChange): RankChangeDisplay {
  switch (change.kind) {
    case 'improved':
      return {
        text: `↑${change.positions}`,
        label: `improved ${change.positions} ${change.positions === 1 ? 'position' : 'positions'}`,
        tone: change.emphasized ? 'positive' : 'neutral',
      };
    case 'declined':
      return {
        text: `↓${change.positions}`,
        label: `declined ${change.positions} ${change.positions === 1 ? 'position' : 'positions'}`,
        tone: change.emphasized ? 'negative' : 'neutral',
      };
    case 'unchanged':
      return { text: '0', label: 'no change', tone: 'neutral' };
    case 'entered':
      return { text: 'New', label: 'entered the tracked depth', tone: 'positive' };
    case 'dropped':
      return { text: 'Lost', label: 'dropped out of the tracked depth', tone: 'negative' };
    case 'unchanged_beyond':
      return { text: '', label: 'still beyond tracked depth', tone: 'neutral' };
    case 'first_check':
      return { text: '', label: 'first check', tone: 'neutral' };
  }
}
