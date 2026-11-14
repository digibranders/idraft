import type { ComponentType, ReactElement } from 'react';

import type { ChartHeight } from '@/components/app/chart/chart-frame';
import { Skeleton, type SkeletonHeight } from '@/components/ui/skeleton';

const BLOCK: Readonly<Record<ChartHeight, SkeletonHeight>> = {
  140: 'chart-140',
  180: 'chart-180',
  240: 'chart-240',
  280: 'chart-280',
};

/**
 * The stand-in of a topics card while its code arrives: the panel of `ChartFrame` with a title line and a block
 * of the card's frame height (`CARD_HEIGHT`), so nothing moves when the card replaces it. At 180 it is the pending
 * skeleton exactly. Call it once per card at module level: the registry keeps the component it returns.
 */
export function topicSkeleton(height: ChartHeight): ComponentType {
  return function TopicCardSkeleton(): ReactElement {
    return (
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
        <Skeleton shape="text-14" widthPct={48} />
        <Skeleton shape="block" height={BLOCK[height]} />
      </div>
    );
  };
}
