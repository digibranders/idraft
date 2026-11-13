import { ACTIVITY_SKELETONS } from './parts/skeletons';
import type { CardRegistration } from '@/features/layouts';

/**
 * The cards of the activity family (WP-37): the catalog key of each card and where its code is. A card listed
 * here replaces its pending placeholder (../registry.ts); the contract is section 5 of
 * docs/superpowers/plans/2026-11-13-ai-wp-33-overview-shell.md.
 */
export const ACTIVITY_CARDS: Readonly<Record<string, CardRegistration>> = {
  'activity.collection_status': {
    load: () => import('./collection-status-card'),
    skeleton: ACTIVITY_SKELETONS['activity.collection_status'],
  },
  'ops.engines': { load: () => import('./engines-card'), skeleton: ACTIVITY_SKELETONS['ops.engines'] },
  'ops.ai_spend': { load: () => import('./ai-spend-card'), skeleton: ACTIVITY_SKELETONS['ops.ai_spend'] },
  'ops.answer_calendar': {
    load: () => import('./answer-calendar-card'),
    skeleton: ACTIVITY_SKELETONS['ops.answer_calendar'],
  },
  'ops.answer_status': {
    load: () => import('./answer-status-card'),
    skeleton: ACTIVITY_SKELETONS['ops.answer_status'],
  },
};
