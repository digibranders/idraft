import { formatPercent } from '@/lib/format';

/** Under half a tenth of a percent one decimal would round to 0.0%, so the share is said to be below 0.1%. */
const BELOW_TENTH = 0.0005;

/**
 * A share for a card cell: whole percents, one decimal under 1%, and `belowTenth` (the words "<0.1%") for a seen
 * share too small for that. Only a real 0 prints "0%", so a share that was seen is never shown as none.
 */
export function percentOf(value: number, belowTenth: string): string {
  if (value > 0 && value < BELOW_TENTH) return belowTenth;
  return formatPercent(value, { decimals: value > 0 && value < 0.01 ? 1 : 0 });
}
