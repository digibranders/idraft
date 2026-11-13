import { COMPETITOR_SKELETONS } from './skeletons';
import type { CardRegistration } from '@/features/layouts';

/**
 * The cards of the competitors family (WP-35): the catalog key of each card and where its code is. A card listed
 * here replaces its pending placeholder (../registry.ts); the contract is section 5 of
 * docs/superpowers/plans/2026-11-13-ai-wp-33-overview-shell.md.
 */
export const COMPETITOR_CARDS: Readonly<Record<string, CardRegistration>> = {
  'ai.share_of_voice': {
    load: () => import('./share-of-voice-card'),
    skeleton: COMPETITOR_SKELETONS['ai.share_of_voice'],
  },
  'ai.lost_to_competitor': {
    load: () => import('./lost-to-card'),
    skeleton: COMPETITOR_SKELETONS['ai.lost_to_competitor'],
  },
  'ai.opportunities': {
    load: () => import('./opportunities-card'),
    skeleton: COMPETITOR_SKELETONS['ai.opportunities'],
  },
  'ai.competitor_trend': {
    load: () => import('./competitor-trend-card'),
    skeleton: COMPETITOR_SKELETONS['ai.competitor_trend'],
  },
  'ai.sov_over_time': {
    load: () => import('./sov-over-time-card'),
    skeleton: COMPETITOR_SKELETONS['ai.sov_over_time'],
  },
  'ai.sov_rank': { load: () => import('./sov-rank-card'), skeleton: COMPETITOR_SKELETONS['ai.sov_rank'] },
  'ai.co_mentions': {
    load: () => import('./co-mentions-card'),
    skeleton: COMPETITOR_SKELETONS['ai.co_mentions'],
  },
  'ai.competitor_table': {
    load: () => import('./competitor-table-card'),
    skeleton: COMPETITOR_SKELETONS['ai.competitor_table'],
  },
};
