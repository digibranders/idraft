'use client';

import type { ComponentType, ReactElement } from 'react';

import { Skeleton, type SkeletonHeight } from '@/components/ui/skeleton';

/**
 * The stand-in of each card of the family while its code arrives (WP-37 plan D7): the panel of
 * `../../pending-skeleton.tsx` with the body at the height of the card's frame, so nothing moves when the card
 * replaces it. The height is the `ChartHeight` of the card's `ChartFrame` (140, 180, 240 or 280 px, DS 15).
 */
export const SKELETON_HEIGHTS: Readonly<Record<string, 140 | 180 | 240 | 280>> = {
  'activity.collection_status': 180,
  'ops.engines': 180,
  'ops.ai_spend': 140,
};

const BODY: Readonly<Record<140 | 180 | 240 | 280, SkeletonHeight>> = {
  140: 'chart-140',
  180: 'chart-180',
  240: 'chart-240',
  280: 'chart-280',
};

function skeletonOf(height: 140 | 180 | 240 | 280): ComponentType {
  function ActivityCardSkeleton(): ReactElement {
    return (
      <div data-height={height} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
        <Skeleton shape="text-14" widthPct={48} />
        <Skeleton shape="block" height={BODY[height]} />
      </div>
    );
  }
  return ActivityCardSkeleton;
}

/** By catalog key, for `CardRegistration.skeleton` in `ACTIVITY_CARDS`. */
export const ACTIVITY_SKELETONS: Readonly<Record<string, ComponentType>> = Object.fromEntries(
  Object.entries(SKELETON_HEIGHTS).map(([key, height]) => [key, skeletonOf(height)]),
);
