import { compareEngines, type Comparison, type EngineValue } from './engine-values';
import type { TopicNode } from './model-types';
import { leavesOf } from './topic-nodes';
import { topicEngineRows, type TopicEngineRow } from './topic-rows';
import type { CellMetric } from '@/lib/rates/rate-model';

/** One engine of a topic on the shared 0 to 100 percent axis. */
export interface GapEngine {
  code: string;
  value: EngineValue;
  /** The rate as a percent; `null` without a rate (too few answers, or none): no dot is drawn for it. */
  position: number | null;
}

export interface GapRow {
  row: TopicEngineRow;
  /** One per asked engine, in the order asked. */
  engines: GapEngine[];
  /** Best minus weakest, in points, exact. */
  points: number;
  /** What can be said of the gap, from the counts only. */
  comparison: Comparison;
}

/** The reading of a gap; the card words it and the export writes it as `too_few` and the like. */
export type Verdict = 'within' | 'detectable' | 'tooFew' | 'share' | 'equal' | 'zero';

export function verdictOf(comparison: Comparison): Verdict {
  if (comparison.kind === 'gap') return comparison.test === 'too-few' ? 'tooFew' : comparison.test;
  // `none` needs fewer than two engines with a rate, which a listed row never has
  return comparison.kind === 'none' ? 'tooFew' : comparison.kind;
}

/** The columns of the card's export block: per engine its rate, answers and status, then the spread and the reading. */
export const gapExportHeader = (codes: readonly string[]): string[] => [
  'topic',
  ...codes.flatMap((code) => [`${code}_rate_percent`, `${code}_answers`, `${code}_status`]),
  'spread_points',
  'reading',
];

export const gapFileName = (metric: string): string => `engine-gap-${metric}`;

export interface GapModel {
  rows: GapRow[];
  /** Leaf topics that could be compared (before the cut to `count`). */
  total: number;
}

/**
 * The leaf topics that have a rate on at least two of the asked engines, the largest spread first (a tie goes to the
 * prompts a topic holds, then its name), cut to `count`. Engines are never pooled: each keeps its own value.
 */
export function gapRows(
  nodes: readonly TopicNode[],
  codes: readonly string[],
  metric: CellMetric,
  count: number,
): GapModel {
  const all = topicEngineRows(leavesOf(nodes), codes, metric).flatMap((row): GapRow[] =>
    row.spread === null
      ? []
      : [
          {
            row,
            engines: row.values.map((value) => ({
              code: value.code,
              value,
              position: value.state === 'ok' && value.value !== null ? value.value * 100 : null,
            })),
            points: row.spread.spread,
            comparison: compareEngines(row.values, metric),
          },
        ],
  );
  const ordered = all.sort(
    (a, b) =>
      b.points - a.points ||
      b.row.node.promptCount - a.row.node.promptCount ||
      a.row.node.name.localeCompare(b.row.node.name),
  );
  return { rows: ordered.slice(0, count), total: ordered.length };
}
