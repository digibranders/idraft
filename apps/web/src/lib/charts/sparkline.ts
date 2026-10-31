import type { SparklinePoint } from '@/lib/api/types';

/**
 * Where a rank sparkline's line and last point fall in its box (15-data-visualization.md section 9): ranks
 * inverted, better up, on a scale fixed per table (1 to 20) so rows compare; a deeper rank sits on the bottom
 * edge; a check beyond the depth breaks the line. The canvas only draws what this returns.
 */

export const SPARK_WIDTH = 64;
export const SPARK_HEIGHT = 20;
const PAD = 2.5;
/** The rank at the bottom edge of every sparkline in a table. */
export const SPARK_RANK_SCALE = 20;

export interface SparkPoint {
  x: number;
  y: number;
}

export interface SparklineGeometry {
  /** Runs of ranked checks; a check beyond the depth ends a run. */
  segments: SparkPoint[][];
  /** The latest check, when it ranked. */
  last: SparkPoint | null;
}

type Point = Pick<SparklinePoint, 'rank' | 'state'>;

export function sparklineGeometry(
  points: readonly Point[],
  width: number = SPARK_WIDTH,
  height: number = SPARK_HEIGHT,
): SparklineGeometry {
  const segments: SparkPoint[][] = [];
  const step = points.length > 1 ? (width - PAD * 2) / (points.length - 1) : 0;
  let run: SparkPoint[] | null = null;
  for (const [index, point] of points.entries()) {
    if (point.state !== 'ranked' || point.rank === null) {
      run = null;
      continue;
    }
    const share = (Math.min(Math.max(point.rank, 1), SPARK_RANK_SCALE) - 1) / (SPARK_RANK_SCALE - 1);
    const at = { x: points.length > 1 ? PAD + index * step : width / 2, y: PAD + share * (height - PAD * 2) };
    if (run === null) {
      run = [at];
      segments.push(run);
    } else {
      run.push(at);
    }
  }
  const latest = points.at(-1);
  const last = latest?.state === 'ranked' && latest.rank !== null ? (segments.at(-1)?.at(-1) ?? null) : null;
  return { segments, last };
}

export interface SparklineSummary {
  checks: number;
  /** The first and last ranked checks' ranks, and the best. */
  first: number | null;
  last: number | null;
  best: number | null;
  /** Checks beyond the depth checked. */
  beyond: number;
}

/** The numbers of a sparkline's accessible name (20-accessibility.md: "from 9 to 4, best 3, 2 checks not in top 20"). */
export function sparklineSummary(points: readonly Point[]): SparklineSummary {
  const ranks = points.flatMap((point) => (point.state === 'ranked' && point.rank !== null ? [point.rank] : []));
  return {
    checks: points.length,
    first: ranks[0] ?? null,
    last: ranks.at(-1) ?? null,
    best: ranks.length === 0 ? null : Math.min(...ranks),
    beyond: points.length - ranks.length,
  };
}
