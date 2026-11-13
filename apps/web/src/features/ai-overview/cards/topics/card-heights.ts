import type { ChartHeight } from '@/components/app/chart/chart-frame';

/** The catalog keys of the topics family (WP-36), the same eleven `index.ts` registers. */
export const TOPIC_CARD_KEYS = [
  'ai.topic_heatmap',
  'ai.topic_extremes',
  'ai.topic_engine_gap',
  'ai.engine_disagreement',
  'ai.topic_movers',
  'ai.topic_contribution',
  'ai.topic_trends',
  'ai.topic_small_multiples',
  'ai.prompt_heatmap',
  'ai.top_prompts',
  'ai.citation_vs_mention',
] as const;

export type TopicCardKey = (typeof TOPIC_CARD_KEYS)[number];

/**
 * The height of each card's chart frame, and so of its skeleton (one source, so nothing moves when the card
 * arrives). A first guess: the task that finishes a card may change its entry.
 */
export const CARD_HEIGHT: Readonly<Record<TopicCardKey, ChartHeight>> = {
  'ai.topic_heatmap': 280,
  'ai.topic_extremes': 240,
  'ai.topic_engine_gap': 240,
  'ai.engine_disagreement': 180,
  'ai.topic_movers': 240,
  'ai.topic_contribution': 240,
  'ai.topic_trends': 280,
  'ai.topic_small_multiples': 280,
  'ai.prompt_heatmap': 280,
  'ai.top_prompts': 180,
  'ai.citation_vs_mention': 280,
};
