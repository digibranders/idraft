import type { ReactElement } from 'react';

import { Skeleton } from '@/components/ui/skeleton';

/**
 * The stand-in of a card while its code arrives: the panel of `ChartFrame` with a title line and a 180 px body, so
 * it is as tall as the pending card and the card of the family that replaces it (heights of DS 15).
 */
export function PendingSkeleton(): ReactElement {
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <Skeleton shape="text-14" widthPct={48} />
      <Skeleton shape="block" height="chart-180" />
    </div>
  );
}
