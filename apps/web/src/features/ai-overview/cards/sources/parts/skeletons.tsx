import type { ComponentType } from 'react';

import { skeletonOf } from '../../engines/card-skeleton';
import type { ChartHeight } from '@/components/app/chart/chart-frame';

/**
 * The stand-in of each card of the sources family while its code arrives (WP-37 plan D7): the panel of
 * `skeletonOf` with the body at the height of the card's `ChartFrame`, so nothing moves when the card arrives. The
 * table lists every card of the family, by catalog key, with its frame height (DS 15: 140, 180, 240 or 280 px).
 */
export const SOURCE_SKELETON_HEIGHTS: Readonly<Record<string, ChartHeight>> = {
  'sources.top_domains': 280,
  'sources.own_pages': 280,
  'ai.citation_share_by_domain_type': 180,
  'ai.fanout_top': 240,
  'sources.new_lost': 280,
  'sources.diversity': 240,
};

/** By catalog key, for `CardRegistration.skeleton` in `SOURCE_CARDS`. */
export const SOURCE_SKELETONS: Readonly<Record<string, ComponentType>> = Object.fromEntries(
  Object.entries(SOURCE_SKELETON_HEIGHTS).map(([key, height]) => [key, skeletonOf(height)]),
);
