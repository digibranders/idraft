import type { CardRegistration } from '@/features/layouts';
import { CARD_HEIGHT, type TopicCardKey } from './card-heights';
import { topicSkeleton } from './card-skeleton';

/**
 * The cards of the topics family (WP-36): the catalog key of each card and where its code is. A card listed here
 * replaces its pending placeholder (../registry.ts); the contract is section 5 of
 * docs/superpowers/plans/2026-11-13-ai-wp-33-overview-shell.md. Each file starts as a re-export of the pending
 * card and is replaced by its task, so this map does not change again. The skeleton of each is as tall as the
 * card's frame (`CARD_HEIGHT`, one source).
 */
export const TOPIC_CARDS: Readonly<Record<TopicCardKey, CardRegistration>> = {
  'ai.topic_heatmap': {
    load: () => import('./topic-heatmap-card'),
    skeleton: topicSkeleton(CARD_HEIGHT['ai.topic_heatmap']),
  },
  'ai.topic_extremes': {
    load: () => import('./topic-extremes-card'),
    skeleton: topicSkeleton(CARD_HEIGHT['ai.topic_extremes']),
  },
  'ai.topic_engine_gap': {
    load: () => import('./topic-engine-gap-card'),
    skeleton: topicSkeleton(CARD_HEIGHT['ai.topic_engine_gap']),
  },
  'ai.engine_disagreement': {
    load: () => import('./engine-disagreement-card'),
    skeleton: topicSkeleton(CARD_HEIGHT['ai.engine_disagreement']),
  },
  'ai.topic_movers': {
    load: () => import('./topic-movers-card'),
    skeleton: topicSkeleton(CARD_HEIGHT['ai.topic_movers']),
  },
  'ai.topic_contribution': {
    load: () => import('./topic-contribution-card'),
    skeleton: topicSkeleton(CARD_HEIGHT['ai.topic_contribution']),
  },
  'ai.topic_trends': {
    load: () => import('./topic-trends-card'),
    skeleton: topicSkeleton(CARD_HEIGHT['ai.topic_trends']),
  },
  'ai.topic_small_multiples': {
    load: () => import('./topic-small-multiples-card'),
    skeleton: topicSkeleton(CARD_HEIGHT['ai.topic_small_multiples']),
  },
  'ai.prompt_heatmap': {
    load: () => import('./prompt-heatmap-card'),
    skeleton: topicSkeleton(CARD_HEIGHT['ai.prompt_heatmap']),
  },
  'ai.top_prompts': {
    load: () => import('./top-prompts-card'),
    skeleton: topicSkeleton(CARD_HEIGHT['ai.top_prompts']),
  },
  'ai.citation_vs_mention': {
    load: () => import('./citation-vs-mention-card'),
    skeleton: topicSkeleton(CARD_HEIGHT['ai.citation_vs_mention']),
  },
};
