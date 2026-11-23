'use client';

import dynamic from 'next/dynamic';
import { useCallback, useMemo, type ReactElement } from 'react';

import { useElementWidth } from './use-element-width';
import { Skeleton } from '@/components/ui/skeleton';
import { columns3dOption, type ColumnItem } from '@/lib/charts/rich-columns';
import type { ChartTokens } from '@/lib/design/read-tokens';

// ECharts loads on the client only, after the page; the chart holds its height meanwhile
const EChart = dynamic(() => import('./echart').then((module) => module.EChart), {
  ssr: false,
  loading: () => <Skeleton shape="block" className="h-full w-full" />,
});

export interface ColumnsChartProps {
  items: readonly ColumnItem[];
  /** What the chart shows, for people who cannot see it: the names and shares, in order. */
  label: string;
  height: number;
  /** Opens the competitor of a column (not called for your own, which opens nothing). */
  onOpen: (id: string) => void;
}

/**
 * Brands as 3D columns (15-data-visualization.md section 1a). The chart is a picture: every column's name and share is in
 * `label`, and the list of brands beside it holds the buttons that open a competitor from the keyboard.
 */
export function ColumnsChart({ items, label, height, onOpen }: ColumnsChartProps): ReactElement {
  // The caller builds `items` on every render; the chart redraws, and so animates, only when what it shows changes
  const signature = JSON.stringify(items);
  const stable = useMemo(() => JSON.parse(signature) as ColumnItem[], [signature]);
  const [wrapper, width] = useElementWidth<HTMLDivElement>();
  const option = useCallback((tokens: ChartTokens) => columns3dOption({ items: stable, tokens, width }), [stable, width]);
  // Your own column opens nothing, so only the others show the hand
  const opensAt = useCallback((index: number) => stable[index]?.own === false, [stable]);
  const pick = useCallback(
    (index: number) => {
      const item = stable[index];
      if (item !== undefined && !item.own) onOpen(item.id);
    },
    [stable, onOpen],
  );
  return (
    <div ref={wrapper} role="img" aria-label={label}>
      <EChart option={option} height={height} onPick={pick} opensAt={opensAt} />
    </div>
  );
}
