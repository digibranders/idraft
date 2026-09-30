/**
 * Panel sizing (docs/17-statistical-methodology.md section 7.2): how many prompts a panel needs to detect
 * a net change between two periods, given the share of prompts that flip. McNemar, paired design.
 * A published formula with no data in it, so the panel settings screen computes it in the client.
 */
const Z_ALPHA = 1.959964; // alpha 0.05, two-sided
const Z_BETA = 0.841621; // power 0.8

const isShare = (value: number): boolean => Number.isFinite(value) && value > 0 && value <= 1;

/** Prompts needed to detect a net change of `delta` when a share `flipRate` of prompts flips. */
export function requiredPrompts(flipRate: number, delta: number): number | null {
  // A net change cannot be larger than the share of prompts that changed at all
  if (!isShare(flipRate) || !Number.isFinite(delta) || delta <= 0 || delta > flipRate) return null;
  return (Z_ALPHA * Math.sqrt(flipRate) + Z_BETA * Math.sqrt(flipRate - delta * delta)) ** 2 / (delta * delta);
}

/** The smallest net change a panel of `prompts` can detect, as a ratio (0.05 is 5 points). */
export function detectableChange(prompts: number, flipRate: number): number | null {
  if (!Number.isFinite(prompts) || prompts <= 0 || !isShare(flipRate)) return null;
  const atLargest = requiredPrompts(flipRate, flipRate);
  if (atLargest === null || atLargest > prompts) return null;
  // requiredPrompts falls as delta grows, so the answer is found by halving the range
  let low = 0;
  let high = flipRate;
  for (let step = 0; step < 60; step += 1) {
    const middle = (low + high) / 2;
    const needed = requiredPrompts(flipRate, middle);
    if (needed === null || needed > prompts) low = middle;
    else high = middle;
  }
  return high;
}
