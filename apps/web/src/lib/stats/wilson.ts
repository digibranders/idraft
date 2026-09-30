/**
 * Wilson score interval for a binomial proportion (docs/17-statistical-methodology.md section 3.2).
 * Used for every AI rate: it keeps near-nominal coverage for small n and for rates near 0 or 1, where
 * the textbook interval fails. Mirrors core.wilson_lower and core.wilson_upper in the database.
 */
export interface Interval {
  low: number;
  high: number;
}

/** Two-sided 95%. */
export const Z_95 = 1.959964;

const isCount = (value: number): boolean => Number.isInteger(value) && value >= 0;

/** Null when there are no observations or the counts cannot be real (k above n, negative, fractional). */
export function wilsonInterval(k: number, n: number, z: number = Z_95): Interval | null {
  if (!isCount(k) || !isCount(n) || n === 0 || k > n) return null;
  const p = k / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denominator;
  // At k = 0 and k = n the bound is exactly 0 or 1; rounding must not leave it a hair inside
  return { low: k === 0 ? 0 : Math.max(0, centre - half), high: k === n ? 1 : Math.min(1, centre + half) };
}
