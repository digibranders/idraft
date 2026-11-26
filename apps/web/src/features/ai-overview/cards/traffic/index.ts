import { skeletonOf } from '../engines/card-skeleton';
import type { CardRegistration } from '@/features/layouts';

/**
 * The cards of the traffic family (O-sources-tracking): AI referral visits. A card listed here replaces its pending
 * placeholder (../registry.ts). The card reads `fp/ai-referrals` (WP-69) once the project has a live GA4 property, and
 * until then says GA4 is not connected or not collected yet. It draws five bars at most, so a card with visits is no
 * taller than the smallest height of its type (states/card-min-height.ts) and the cards below it do not move.
 */
export const TRAFFIC_CARDS: Readonly<Record<string, CardRegistration>> = {
  'traffic.ai_referrals': { load: () => import('./referrals-card'), skeleton: skeletonOf(180) },
};
