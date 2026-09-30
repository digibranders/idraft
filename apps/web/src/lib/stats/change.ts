/**
 * Whether a change between two periods is detectable (docs/17-statistical-methodology.md section 6).
 * A delta is colored only when its 95% interval excludes zero; otherwise it is "within normal variation".
 *
 * This is the unpaired comparison (section 6.2): the Newcombe hybrid score interval, built from the two
 * Wilson intervals. The paired bootstrap of section 6.1 is the API's job; the client mirrors this one
 * for single prompts and for previews.
 */
import { rateOf, type Counts } from './rates';
import { Z_95, wilsonInterval, type Interval } from './wilson';

/** Interval of (current rate minus previous rate), or null when either period has no observations. */
export function differenceInterval(current: Counts, previous: Counts, z: number = Z_95): Interval | null {
  const a = wilsonInterval(current.k, current.n, z);
  const b = wilsonInterval(previous.k, previous.n, z);
  if (!a || !b) return null;
  const p1 = current.k / current.n;
  const p2 = previous.k / previous.n;
  const d = p1 - p2;
  return {
    low: d - Math.sqrt((p1 - a.low) ** 2 + (b.high - p2) ** 2),
    high: d + Math.sqrt((a.high - p1) ** 2 + (p2 - b.low) ** 2),
  };
}

/** True or false when both periods have a rate to show; null when either is insufficient. */
export function isDetectableChange(current: Counts, previous: Counts, z: number = Z_95): boolean | null {
  if (rateOf(current) === null || rateOf(previous) === null) return null;
  const interval = differenceInterval(current, previous, z);
  if (!interval) return null;
  return interval.low > 0 || interval.high < 0;
}
