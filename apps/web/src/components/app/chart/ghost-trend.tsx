'use client';

import dynamic from 'next/dynamic';
import type { ReactElement } from 'react';

import { ghostTrendOption } from '@/lib/charts/ghost-trend';

// ECharts loads on the client only; the drawing is decoration, so nothing holds its place while it loads
const EChart = dynamic(() => import('./echart').then((module) => module.EChart), { ssr: false });

/**
 * A faint dashed curve in the lower half of the empty state of a trend chart, behind the words (15-data-visualization.md
 * section 1a). It is a drawing of what is coming, hidden from assistive technology, and answers no pointer.
 */
export function GhostTrend({ height }: { height: number }): ReactElement {
  return (
    <div aria-hidden="true" data-slot="ghost-trend" className="pointer-events-none absolute inset-x-0 bottom-0">
      <EChart option={ghostTrendOption} height={Math.round(height / 2)} />
    </div>
  );
}
