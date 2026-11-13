import type { CardRegistration } from '@/features/layouts';
import { PendingSkeleton } from '../pending-skeleton';
import type { TopicCardKey } from './card-heights';

/**
 * The cards of the topics family (WP-36): the catalog key of each card and where its code is. A card listed here
 * replaces its pending placeholder (../registry.ts); the contract is section 5 of
 * docs/superpowers/plans/2026-11-13-ai-wp-33-overview-shell.md. Each file starts as a re-export of the pending
 * card and is replaced by its task, so this map does not change again (T3 swaps the skeletons).
 */
export const TOPIC_CARDS: Readonly<Record<TopicCardKey, CardRegistration>> = {
  'ai.topic_heatmap': { load: () => import('./topic-heatmap-card'), skeleton: PendingSkeleton },
  'ai.topic_extremes': { load: () => import('./topic-extremes-card'), skeleton: PendingSkeleton },
  'ai.topic_engine_gap': { load: () => import('./topic-engine-gap-card'), skeleton: PendingSkeleton },
  'ai.engine_disagreement': { load: () => import('./engine-disagreement-card'), skeleton: PendingSkeleton },
  'ai.topic_movers': { load: () => import('./topic-movers-card'), skeleton: PendingSkeleton },
  'ai.topic_contribution': { load: () => import('./topic-contribution-card'), skeleton: PendingSkeleton },
  'ai.topic_trends': { load: () => import('./topic-trends-card'), skeleton: PendingSkeleton },
  'ai.topic_small_multiples': { load: () => import('./topic-small-multiples-card'), skeleton: PendingSkeleton },
  'ai.prompt_heatmap': { load: () => import('./prompt-heatmap-card'), skeleton: PendingSkeleton },
  'ai.top_prompts': { load: () => import('./top-prompts-card'), skeleton: PendingSkeleton },
  'ai.citation_vs_mention': { load: () => import('./citation-vs-mention-card'), skeleton: PendingSkeleton },
};
