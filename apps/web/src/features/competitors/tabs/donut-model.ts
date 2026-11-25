import type { SeriesRole } from '@/lib/charts/category-chart';

export interface DonutSlice {
  id: string;
  name: string;
  value: number;
  role: SeriesRole;
}

/** The most slices a donut draws: the six colours of the palette. The rest are one grey slice. */
export const MAX_SLICES = 6;

/**
 * The slices of a donut from brands with a value: those with nothing to show are left out (a zero is no slice, an
 * unknown is no number), the largest come first unless the order is natural, and a seventh brand onward are summed into one "other" slice.
 */
export function toSlices(
  items: readonly { id: string; name: string; value: number | null; role: SeriesRole }[],
  otherName: string,
  { sorted = true }: { sorted?: boolean } = {},
): DonutSlice[] {
  const present = items.flatMap((item) =>
    item.value !== null && item.value > 0 ? [{ ...item, value: item.value }] : [],
  );
  // A natural order (rank bands) is kept; brands go largest first
  const positive = sorted ? present.sort((a, b) => b.value - a.value) : present;
  if (positive.length <= MAX_SLICES) return positive;
  const kept = positive.slice(0, MAX_SLICES - 1);
  const rest = positive.slice(MAX_SLICES - 1).reduce((sum, item) => sum + item.value, 0);
  return [...kept, { id: 'other', name: otherName, value: rest, role: { kind: 'other' } }];
}

/** A slice's share of the whole, 0 to 1; 0 when there is nothing to divide. */
export const shareOf = (value: number, slices: readonly DonutSlice[]): number => {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  return total === 0 ? 0 : value / total;
};
