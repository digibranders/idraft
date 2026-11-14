import type { SeriesRole } from '@/lib/charts/category-chart';

/** What the three weekly cards and the rank axis share: the role of a colour slot and the reads of an ECharts option. */

/** Slot 1 is the own brand, 2 to 6 are the palette; a brand without a slot is drawn as "other". */
export function roleOf(slot: number): SeriesRole {
  switch (slot) {
    case 1:
      return { kind: 'brand' };
    case 2:
    case 3:
    case 4:
    case 5:
    case 6:
      return { kind: 'palette', index: slot };
    default:
      return { kind: 'other' };
  }
}

/** One series of the option the frame built, as far as the cards read it. */
export interface SeriesOption {
  id?: string;
  name?: string;
  color?: string;
  itemStyle?: Record<string, unknown>;
  [key: string]: unknown;
}

/** The part of an axis tooltip parameter the cards read. */
export interface TooltipParam {
  dataIndex?: number;
  axisValueLabel?: string;
}

export const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
