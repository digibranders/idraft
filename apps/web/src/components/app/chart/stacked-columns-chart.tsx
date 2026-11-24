'use client';

import dynamic from 'next/dynamic';
import { useCallback, useMemo, type ReactElement } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { stackedColumnsOption, type StackedRow, type StackedSegment } from '@/lib/charts/rich-stacked';
import type { ChartTokens } from '@/lib/design/read-tokens';

// ECharts loads on the client only, after the page; the chart holds its height meanwhile
const EChart = dynamic(() => import('./echart').then((module) => module.EChart), {
  ssr: false,
  loading: () => <Skeleton shape="block" className="h-full w-full" />,
});

export interface StackedColumnsChartProps {
  rows: readonly StackedRow[];
  segments: readonly StackedSegment[];
  /** What the columns show, for people who cannot see them. */
  label: string;
  height: number;
}

/** One stacked 100% column per subject (15-data-visualization.md section 1a); the exact shares are in a table beside it. */
export function StackedColumnsChart({ rows, segments, label, height }: StackedColumnsChartProps): ReactElement {
  // The caller builds `rows` on every render; the chart redraws, and so animates, only when what it shows changes
  const signature = JSON.stringify([rows, segments]);
  const stable = useMemo(() => JSON.parse(signature) as [StackedRow[], StackedSegment[]], [signature]);
  const option = useCallback(
    (tokens: ChartTokens) => stackedColumnsOption({ rows: stable[0], segments: stable[1], tokens }),
    [stable],
  );
  return (
    <div role="img" aria-label={label}>
      <EChart option={option} height={height} />
    </div>
  );
}
