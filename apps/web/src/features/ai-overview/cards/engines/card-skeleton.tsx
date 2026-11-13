import type { ReactElement } from 'react';

import type { ChartHeight } from '@/components/app/chart/chart-frame';
import { Skeleton, type SkeletonHeight } from '@/components/ui/skeleton';

const BLOCK: Readonly<Record<ChartHeight, SkeletonHeight>> = {
  140: 'chart-140',
  180: 'chart-180',
  240: 'chart-240',
  280: 'chart-280',
};

/**
 * The stand-in of a card of the family while its code arrives: the panel of `ChartFrame` with a title line, a meta
 * line and a body of the card's own `height`, so the card does not grow or shrink when it replaces the stand-in
 * (`PendingSkeleton` is the same at 180 px). Call it once per card at module level, as `index.ts` does.
 */
export function skeletonOf(height: ChartHeight): () => ReactElement {
  const block = BLOCK[height];
  return function CardSkeleton(): ReactElement {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <div className="flex flex-col">
          <Skeleton shape="text-14" widthPct={48} />
          <Skeleton shape="text-13" widthPct={72} />
        </div>
        <Skeleton shape="block" height={block} />
      </div>
    );
  };
}
