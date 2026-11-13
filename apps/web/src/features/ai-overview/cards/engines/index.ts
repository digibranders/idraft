import { skeletonOf } from './card-skeleton';
import type { CardRegistration } from '@/features/layouts';

/**
 * The cards of the engines family (WP-34): the catalog key of each card and where its code is. A card listed here
 * replaces its pending placeholder (../registry.ts); the contract is section 5 of
 * docs/superpowers/plans/2026-11-13-ai-wp-33-overview-shell.md.
 */
export const ENGINE_CARDS: Readonly<Record<string, CardRegistration>> = {
  'ai.change_summary': { load: () => import('./change-summary-card'), skeleton: skeletonOf(140, ['row']) },
  'ai.rate_trend_by_engine': { load: () => import('./rate-trend-card'), skeleton: skeletonOf(280, ['chart-280']) },
  'ai.mention_trend': { load: () => import('./mention-trend-card'), skeleton: skeletonOf(180, ['chart-240']) },
  'ai.prompt_movers': { load: () => import('./prompt-movers-card'), skeleton: skeletonOf(240, ['row']) },
  'ai.period_comparison': { load: () => import('./period-comparison-card'), skeleton: skeletonOf(180, ['chart-240']) },
  'ai.change_waterfall': { load: () => import('./change-waterfall-card'), skeleton: skeletonOf(240, ['chart-140']) },
  'ai.by_engine': { load: () => import('./by-engine-card'), skeleton: skeletonOf(180, ['chart-180']) },
  'ai.outcome_mix': { load: () => import('./outcome-mix-card'), skeleton: skeletonOf(180, ['chart-280']) },
  'ai.answer_funnel': {
    load: () => import('./answer-funnel-card'),
    skeleton: skeletonOf(180, ['chart-280', 'chart-280']),
  },
  'ai.sample_coverage': {
    load: () => import('./sample-coverage-card'),
    skeleton: skeletonOf(180, ['chart-280', 'chart-240']),
  },
  'ai.engine_agreement': { load: () => import('./engine-agreement-card'), skeleton: skeletonOf(180, ['chart-280']) },
  'ai.country_breakdown': { load: () => import('./country-breakdown-card'), skeleton: skeletonOf(240, ['chart-180']) },
};
