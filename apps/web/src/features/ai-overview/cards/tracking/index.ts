import { skeletonOf } from '../engines/card-skeleton';
import type { CardRegistration } from '@/features/layouts';

/**
 * The cards of the prompt tracking family (O-sources-tracking): mention position and sentiment by platform. A card
 * listed here replaces its pending placeholder (../registry.ts). The skeleton is the panel of the card with its
 * legend and one row for each platform, as tall as the card the preview draws.
 */
export const TRACKING_CARDS: Readonly<Record<string, CardRegistration>> = {
  'ai.position_distribution': {
    load: () => import('./position-card'),
    skeleton: skeletonOf(240),
  },
  'ai.sentiment_by_engine': {
    load: () => import('./sentiment-card'),
    skeleton: skeletonOf(240),
  },
};
