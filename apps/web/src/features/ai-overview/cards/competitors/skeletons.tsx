'use client';

import type { ComponentType, ReactElement } from 'react';

import { Skeleton, type SkeletonHeight } from '@/components/ui/skeleton';

/**
 * The stand-in of each card of the family while its code arrives (D-13): the panel of `pending-skeleton.tsx` with
 * the body at the height of the card's frame, so nothing moves when the card replaces it. The height is the
 * `ChartHeight` of the card's `ChartFrame` (140, 180, 240 or 280 px, DS 15).
 */
export const SKELETON_HEIGHTS: Readonly<Record<string, 240 | 280>> = {
  'ai.share_of_voice': 280,
  'ai.lost_to_competitor': 240,
  'ai.opportunities': 240,
  'ai.competitor_trend': 240,
  'ai.sov_over_time': 280,
  'ai.sov_rank': 240,
  'ai.co_mentions': 280,
  'ai.competitor_table': 280,
};

const BODY: Readonly<Record<240 | 280, SkeletonHeight>> = { 240: 'chart-240', 280: 'chart-280' };

function skeletonOf(height: 240 | 280): ComponentType {
  function CompetitorCardSkeleton(): ReactElement {
    return (
      <div data-height={height} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
        <Skeleton shape="text-14" widthPct={48} />
        <Skeleton shape="block" height={BODY[height]} />
      </div>
    );
  }
  return CompetitorCardSkeleton;
}

/** By catalog key, for `CardRegistration.skeleton` in `COMPETITOR_CARDS`. */
export const COMPETITOR_SKELETONS: Readonly<Record<string, ComponentType>> = Object.fromEntries(
  Object.entries(SKELETON_HEIGHTS).map(([key, height]) => [key, skeletonOf(height)]),
);
