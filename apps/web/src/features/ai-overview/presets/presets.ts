/**
 * The four presets of the AI visibility screen (inventory overview-and-charts 9.5, final variants; WP-33 T6). The
 * Default is the built-in layout (`SCREENS.ai_overview.builtin`), so it is not an entry here. Every option is
 * written out, because sanitizing fills the defaults in and `definePresets` rejects a document it would change.
 *
 * Competitive differs from 9.5 on purpose: card 8 is `ai.sample_coverage` (third) and `ai.co_mentions` (card 9) is
 * two thirds, so no half row is left alone at 1280 px. Pending the owner's confirmation.
 */
import { definePresets, type LayoutPreset } from '@/features/layouts';
import type { LayoutDocument } from '@/lib/layouts';

export const PRESET_IDS = ['executive', 'seo_analyst', 'competitive', 'topic_owner'] as const;
export type PresetId = (typeof PRESET_IDS)[number];

/** For marketing leads: few cards, the story first. */
export const EXECUTIVE_LAYOUT: LayoutDocument = {
  schema: 1,
  numbers: [
    { id: 'mention-chatgpt', metric: 'ai.mention_rate', engine: 'chatgpt_web' },
    { id: 'mention-gemini', metric: 'ai.mention_rate', engine: 'gemini_web' },
    { id: 'mention-ai-mode', metric: 'ai.mention_rate', engine: 'google_ai_mode' },
    { id: 'sov-chatgpt', metric: 'ai.share_of_voice', engine: 'chatgpt_web' },
  ],
  cards: [
    { id: 'change-summary', type: 'ai.change_summary', width: 'full', options: { facts: '3' } },
    { id: 'rate-trend', type: 'ai.rate_trend_by_engine', width: 'full', options: { metric: 'mention' } },
    {
      id: 'share-of-voice-chatgpt',
      type: 'ai.share_of_voice',
      width: 'half',
      options: { engine: 'chatgpt_web', rows: '5' },
    },
    { id: 'topic-extremes', type: 'ai.topic_extremes', width: 'half', options: { metric: 'mention', rows: '3' } },
    { id: 'answer-funnel', type: 'ai.answer_funnel', width: 'half' },
    { id: 'period-comparison', type: 'ai.period_comparison', width: 'half', options: { metric: 'mention' } },
  ],
};

/** Pages, sources and citations. */
export const SEO_ANALYST_LAYOUT: LayoutDocument = {
  schema: 1,
  numbers: [
    { id: 'prompts', metric: 'ai.prompts_in_scope' },
    { id: 'citation-chatgpt', metric: 'ai.citation_rate', engine: 'chatgpt_web' },
    { id: 'citation-gemini', metric: 'ai.citation_rate', engine: 'gemini_web' },
    { id: 'citation-ai-mode', metric: 'ai.citation_rate', engine: 'google_ai_mode' },
    { id: 'citation-share-chatgpt', metric: 'ai.citation_share', engine: 'chatgpt_web' },
  ],
  cards: [
    { id: 'own-pages', type: 'sources.own_pages', width: 'half', options: { rows: '10' } },
    { id: 'top-domains', type: 'sources.top_domains', width: 'half', options: { role: 'third_party', rows: '10' } },
    {
      id: 'citation-vs-mention',
      type: 'ai.citation_vs_mention',
      width: 'half',
      options: { engine: 'chatgpt_web' },
    },
    { id: 'citation-share-by-domain-type', type: 'ai.citation_share_by_domain_type', width: 'half' },
    { id: 'fanout-top', type: 'ai.fanout_top', width: 'half', options: { rows: '10' } },
    {
      id: 'prompt-movers-chatgpt',
      type: 'ai.prompt_movers',
      width: 'half',
      options: { engine: 'chatgpt_web', direction: 'both', rows: '5' },
    },
    { id: 'opportunities', type: 'ai.opportunities', width: 'half', options: { rows: '8' } },
    { id: 'sample-coverage', type: 'ai.sample_coverage', width: 'half' },
  ],
};

/** Share of voice and who wins. */
export const COMPETITIVE_LAYOUT: LayoutDocument = {
  schema: 1,
  numbers: [
    { id: 'prompts', metric: 'ai.prompts_in_scope' },
    { id: 'sov-chatgpt', metric: 'ai.share_of_voice', engine: 'chatgpt_web' },
    { id: 'sov-gemini', metric: 'ai.share_of_voice', engine: 'gemini_web' },
    { id: 'sov-ai-mode', metric: 'ai.share_of_voice', engine: 'google_ai_mode' },
  ],
  cards: [
    {
      id: 'share-of-voice-chatgpt',
      type: 'ai.share_of_voice',
      width: 'half',
      options: { engine: 'chatgpt_web', rows: '10' },
    },
    {
      id: 'share-of-voice-gemini',
      type: 'ai.share_of_voice',
      width: 'half',
      options: { engine: 'gemini_web', rows: '10' },
    },
    {
      id: 'competitor-trend-chatgpt',
      type: 'ai.competitor_trend',
      width: 'full',
      options: { engine: 'chatgpt_web', competitors: '3' },
    },
    {
      id: 'lost-to-competitor-chatgpt',
      type: 'ai.lost_to_competitor',
      width: 'half',
      options: { engine: 'chatgpt_web', rows: '5' },
    },
    { id: 'competitor-table', type: 'ai.competitor_table', width: 'half', options: { metric: 'mention', rows: '5' } },
    { id: 'sov-over-time-chatgpt', type: 'ai.sov_over_time', width: 'two_thirds', options: { engine: 'chatgpt_web' } },
    { id: 'top-domains', type: 'sources.top_domains', width: 'third', options: { role: 'competitor', rows: '8' } },
    { id: 'sample-coverage', type: 'ai.sample_coverage', width: 'third' },
    { id: 'co-mentions-chatgpt', type: 'ai.co_mentions', width: 'two_thirds', options: { engine: 'chatgpt_web' } },
  ],
};

/** Topics first (owner requirement R-09). */
export const TOPIC_OWNER_LAYOUT: LayoutDocument = {
  schema: 1,
  numbers: [
    { id: 'prompts', metric: 'ai.prompts_in_scope' },
    { id: 'mention-chatgpt', metric: 'ai.mention_rate', engine: 'chatgpt_web' },
    { id: 'mention-gemini', metric: 'ai.mention_rate', engine: 'gemini_web' },
    { id: 'mention-ai-mode', metric: 'ai.mention_rate', engine: 'google_ai_mode' },
  ],
  cards: [
    {
      id: 'topic-heatmap',
      type: 'ai.topic_heatmap',
      width: 'full',
      options: { metric: 'mention', rows: '20', level: 'all', sort: 'prompts' },
    },
    { id: 'topic-extremes', type: 'ai.topic_extremes', width: 'half', options: { metric: 'mention', rows: '5' } },
    {
      id: 'topic-movers',
      type: 'ai.topic_movers',
      width: 'half',
      options: { metric: 'mention', direction: 'both', rows: '5' },
    },
    {
      id: 'topic-engine-gap',
      type: 'ai.topic_engine_gap',
      width: 'half',
      options: { metric: 'mention', rows: '10' },
    },
    { id: 'sample-coverage', type: 'ai.sample_coverage', width: 'half' },
    { id: 'topic-trends', type: 'ai.topic_trends', width: 'full', options: { metric: 'mention', topics: '6' } },
    { id: 'engine-disagreement', type: 'ai.engine_disagreement', width: 'half', options: { rows: '5' } },
    {
      id: 'topic-contribution-chatgpt',
      type: 'ai.topic_contribution',
      width: 'half',
      options: { engine: 'chatgpt_web', view: 'level' },
    },
  ],
};

export const OVERVIEW_PRESET_LAYOUTS: Readonly<Record<PresetId, LayoutDocument>> = {
  executive: EXECUTIVE_LAYOUT,
  seo_analyst: SEO_ANALYST_LAYOUT,
  competitive: COMPETITIVE_LAYOUT,
  topic_owner: TOPIC_OWNER_LAYOUT,
};

/**
 * The entries the Start from menu adds after the built-in layout, in the order of `PRESET_IDS`. Labels come from
 * messages, so the page builds this in `useMemo`; `definePresets` throws here, in the page's test, when a document
 * is not a valid `ai_overview` layout.
 */
export function buildOverviewPresets(labels: Readonly<Record<PresetId, string>>): readonly LayoutPreset[] {
  return definePresets(
    'ai_overview',
    PRESET_IDS.map((id) => ({ id, label: labels[id], document: OVERVIEW_PRESET_LAYOUTS[id] })),
  );
}
