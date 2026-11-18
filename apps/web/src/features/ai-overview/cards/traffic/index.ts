import { skeletonOf } from '../engines/card-skeleton';
import type { CardRegistration } from '@/features/layouts';

/**
 * The cards of the traffic family (O-sources-tracking): AI referral visits. A card listed here replaces its pending
 * placeholder (../registry.ts). The card needs no read: the API has no referral route yet, so it says GA4 is not
 * connected (backend request 5 of docs/ai-visibility/backend-requests-overview.md).
 */
export const TRAFFIC_CARDS: Readonly<Record<string, CardRegistration>> = {
  'traffic.ai_referrals': { load: () => import('./referrals-card'), skeleton: skeletonOf(180) },
};
