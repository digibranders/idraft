/**
 * Where a search volume sparkline's line and last point fall in its box (15-data-visualization.md section 9):
 * the months oldest first, higher volume higher up, on a scale of the keyword's own lowest and highest month
 * (volumes differ by orders of magnitude from one keyword to the next, so rows show the shape, and the cell's
 * tooltip the numbers); a month with no volume breaks the line. The canvas only draws what this returns.
 */

export const SPARK_WIDTH = 64;
export const SPARK_HEIGHT = 20;
const PAD = 2.5;

export interface SparkPoint {
  x: number;
  y: number;
}

export interface SparklineGeometry {
  /** Runs of months with a volume; a month without one ends a run. */
  segments: SparkPoint[][];
  /** The latest month, when it has a volume. */
  last: SparkPoint | null;
}

/** A month's volume, or `null` where the provider sent none. */
export type SparkValue = number | null;

/**
 * `minSpan` (opt in) is the least range the box stands for, in the values' own unit: a series that moves less
 * than it is drawn around the middle of that range, so a rate that moves a point or two stays flat
 * (15-data-visualization.md section 9, "Rates": 0.2 for a share). Without it a series fills the box.
 */
export function sparklineGeometry(
  values: readonly SparkValue[],
  width: number = SPARK_WIDTH,
  height: number = SPARK_HEIGHT,
  minSpan = 0,
): SparklineGeometry {
  const known = values.filter((value): value is number => value !== null);
  const lowest = Math.min(...known);
  const highest = Math.max(...known);
  const range = Math.max(highest - lowest, minSpan);
  const low = highest - lowest >= minSpan ? lowest : (lowest + highest) / 2 - minSpan / 2;
  const segments: SparkPoint[][] = [];
  const step = values.length > 1 ? (width - PAD * 2) / (values.length - 1) : 0;
  let run: SparkPoint[] | null = null;
  for (const [index, value] of values.entries()) {
    if (value === null) {
      run = null;
      continue;
    }
    // A series that never moves sits in the middle of the box
    const share = range === 0 ? 0.5 : (value - low) / range;
    const at = { x: values.length > 1 ? PAD + index * step : width / 2, y: PAD + (1 - share) * (height - PAD * 2) };
    if (run === null) {
      run = [at];
      segments.push(run);
    } else {
      run.push(at);
    }
  }
  const last = values.at(-1) === null || values.length === 0 ? null : (segments.at(-1)?.at(-1) ?? null);
  return { segments, last };
}

export interface SparklineSummary {
  /** The months in the series, those without a volume included. */
  months: number;
  /** The volumes of the first and the last month that has one, and the highest. */
  first: number | null;
  last: number | null;
  peak: number | null;
}

/** The numbers of a sparkline's accessible name (20-accessibility.md: "from 1,300 to 1,900, peak 2,400"). */
export function sparklineSummary(values: readonly SparkValue[]): SparklineSummary {
  const known = values.filter((value): value is number => value !== null);
  return {
    months: values.length,
    first: known[0] ?? null,
    last: known.at(-1) ?? null,
    peak: known.length === 0 ? null : Math.max(...known),
  };
}
