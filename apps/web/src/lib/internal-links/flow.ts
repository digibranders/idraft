import { tierPosition, type TierNameLike } from './tiers';

/** Fill steps of a non-zero cell: indexes 1 to 6 of `SEQUENTIAL_BINS`, the lightest bin left for nothing. */
const STEPS = 6;

/** The bin index of a cell, or `null` for a zero cell (no fill, tertiary text, as the mock draws it). */
export function flowLevel(value: number, max: number): number | null {
  if (value <= 0 || max <= 0) return null;
  return Math.min(STEPS, Math.ceil((value / max) * STEPS));
}

export interface FlowCellLike<TTier extends TierNameLike> {
  from_tier: TTier | null;
  to_tier: TTier | null;
  links: number;
}

/**
 * The sentence above the matrix (mock `il-flow.js` `sentence`): the tier, other than T1, that sends the most links
 * to T1. `null` when the workspace has no T1 in the flow; `from: null, links: 0` when nothing reaches it.
 */
export function strongestSenderToT1<TTier extends TierNameLike>(
  cells: readonly FlowCellLike<TTier>[],
): { from: TTier | null; links: number; top: TTier } | null {
  const top = cells.map((cell) => cell.to_tier).find((tier) => tier !== null && tierPosition(tier) === 1);
  if (top === undefined || top === null) return null;
  const senders = cells.filter(
    (cell) =>
      cell.to_tier !== null &&
      tierPosition(cell.to_tier) === 1 &&
      (cell.from_tier === null || tierPosition(cell.from_tier) !== 1),
  );
  const best = senders.reduce<FlowCellLike<TTier> | null>(
    (current, cell) => (current === null || cell.links > current.links ? cell : current),
    null,
  );
  if (best === null || best.links === 0) return { from: null, links: 0, top };
  return { from: best.from_tier, links: best.links, top };
}

export interface TierStatLike<TTier> {
  tier: TTier | null;
  pages: number;
  average_depth: number | null;
}

/** Each tier's share of the crawl's pages, for the strip (no equity: decision W4). */
export function tierShares<TTier>(stats: readonly TierStatLike<TTier>[]): {
  total: number;
  rows: (TierStatLike<TTier> & { share: number })[];
} {
  const total = stats.reduce((sum, stat) => sum + stat.pages, 0);
  return { total, rows: stats.map((stat) => ({ ...stat, share: total === 0 ? 0 : stat.pages / total })) };
}
