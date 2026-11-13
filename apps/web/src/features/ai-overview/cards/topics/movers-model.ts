import type { TopicNode } from './model-types';
import { commonPrompts, topicChange } from './topic-change';
import { leavesOf } from './topic-nodes';
import type { RateChange } from '@/lib/compare/change-model';
import type { CellMetric } from '@/lib/rates/rate-model';
import { differenceInterval, type Interval } from '@/lib/stats';

/** Which way a mover may have moved: both, only gains, only losses. */
export type Direction = 'both' | 'up' | 'down';

/** One leaf topic on one engine, with its change when it has one. */
export interface MoverPair {
  /** `<topic key>:<engine code>`: a row is a topic and an engine. */
  id: string;
  node: TopicNode;
  /** The topic in the window before; `undefined` when it was not there. */
  before: TopicNode | undefined;
  code: string;
  /** `null` when the topic is not in the window before or either side has no rate (never a move from or to 0). */
  change: RateChange | null;
}

export interface MoverRow extends MoverPair {
  change: RateChange;
  /**
   * The 95% interval of the change on the pooled answers of both windows, in the unit of `change.points`. `null` when
   * it cannot be made (share of voice has no count) or the estimate lies outside it: the weighted change and the
   * pooled counts then disagree, and an interval made up for it would claim more than the counts say.
   */
  interval: Interval | null;
  /** How many prompts the topic has in both windows; `null` when either window's prompt rows are not read. */
  prompts: { both: number; now: number } | null;
}

export interface MoversModel {
  /** Detectable moves first (largest absolute change first), then the changes no test could judge; cut to `count`. */
  listed: MoverRow[];
  /** Moves that would be listed but did not fit in `count`. */
  hidden: number;
  /** Changes judged within normal variation, folded into one line. */
  quiet: number;
  /** Pairs with no change: not in the window before, or a side with no rate. */
  incomparable: number;
  /** Pairs with a change, before the direction was applied. */
  compared: number;
  /** Every pair, for the export. */
  all: MoverPair[];
}

/** Two rates are one when they differ by no more than the float noise of the sums that made them. */
const SAME = 1e-9;

function intervalOf(change: RateChange): Interval | null {
  const { now, before } = change;
  if (now.successes === null || before.successes === null) return null;
  const interval = differenceInterval({ k: now.successes, n: now.answers }, { k: before.successes, n: before.answers });
  if (interval === null) return null;
  return change.points >= interval.low && change.points <= interval.high ? interval : null;
}

const keepsDirection = (points: number, direction: Direction): boolean =>
  direction === 'both' || (direction === 'up' ? points > 0 : points < 0);

/** Detectable first, then by absolute points, then by name and engine: the same input is always the same order. */
function byMove(a: MoverRow, b: MoverRow): number {
  const rank = (row: MoverRow): number => (row.change.detectable === true ? 0 : 1);
  const gap = Math.abs(b.change.points) - Math.abs(a.change.points);
  return (
    rank(a) - rank(b) ||
    (Math.abs(gap) > SAME ? gap : 0) ||
    a.node.name.localeCompare(b.node.name) ||
    a.code.localeCompare(b.code)
  );
}

/**
 * The topics that gained or lost the most between two windows, one row per leaf topic and asked engine (the topic
 * rows below which there are none: a parent is not listed beside its own subtopics, and the row of no topic is not a
 * topic). A change needs a rate on both sides. `previousNodes` is `null` while there is no paired previous window.
 */
export function moversModel(
  nodes: readonly TopicNode[],
  previousNodes: ReadonlyMap<string, TopicNode> | null,
  codes: readonly string[],
  metric: CellMetric,
  direction: Direction,
  count: number,
): MoversModel {
  const all = leavesOf(nodes).flatMap((node) =>
    codes.map((code): MoverPair => {
      const before = previousNodes?.get(node.key);
      return { id: `${node.key}:${code}`, node, before, code, change: topicChange(node, before, code, metric) };
    }),
  );
  const changed = all.flatMap((pair): MoverRow[] =>
    pair.change === null
      ? []
      : [
          {
            ...pair,
            change: pair.change,
            interval: intervalOf(pair.change),
            prompts: pair.before === undefined ? null : commonPrompts(pair.node.members, pair.before.members),
          },
        ],
  );
  const kept = changed.filter((row) => keepsDirection(row.change.points, direction));
  const moves = kept.filter((row) => row.change.detectable !== false).sort(byMove);
  return {
    listed: moves.slice(0, count),
    hidden: Math.max(0, moves.length - count),
    quiet: kept.length - moves.length,
    incomparable: all.length - changed.length,
    compared: changed.length,
    all,
  };
}

/** The reading of a pair, as the export writes it. */
export function readingOf(pair: MoverPair): 'detectable' | 'within' | 'untested' | 'not_compared' {
  if (pair.change === null) return 'not_compared';
  if (pair.change.detectable === null) return 'untested';
  return pair.change.detectable ? 'detectable' : 'within';
}

/** The columns of the card's export block: data names, not words for a person. */
export const MOVERS_EXPORT_HEADER = [
  'topic',
  'engine',
  'now_rate_percent',
  'now_answers',
  'now_status',
  'before_rate_percent',
  'before_answers',
  'before_status',
  'change_points',
  'reading',
] as const;

export const moversFileName = (metric: string): string => `topic-movers-${metric}`;

/** The change in points to two places for the export; `null` (an empty cell) when there is none. */
export const changePointsOf = (change: RateChange | null): number | null =>
  change === null ? null : Math.round(change.points * 10000) / 100;
