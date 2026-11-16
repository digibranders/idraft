/**
 * The presets of the AI visibility screen, as the design preview has them (`design-preview/aiov-layout.js`, spec
 * 2026-11-16-ai-overview-redesign-design.md section 5.1). The Default is the built-in layout
 * (`SCREENS.ai_overview.builtin`), so it is not an entry here. The headline card replaces the numbers strip, so no
 * preset has numbers (the zone is still on, so the list is empty, not absent). Every option is written out, because sanitizing fills the defaults in and `definePresets`
 * rejects a document it would change. Each preset fills complete rows of 12 columns at 1280 px.
 */
import { definePresets, type LayoutPreset } from '@/features/layouts';
import type { LayoutDocument } from '@/lib/layouts';

export const PRESET_IDS = ['executive', 'analyst', 'competitive'] as const;
export type PresetId = (typeof PRESET_IDS)[number];

const TREND = { metric: 'visibility' } as const;
const HEATMAP = { metric: 'visibility', rows: '10', level: 'top', sort: 'prompts' } as const;
const TOP_DOMAINS = { role: 'all', rows: '8' } as const;

/** The headline, the trend, who leads, where, and what changed. */
export const EXECUTIVE_LAYOUT: LayoutDocument = {
  schema: 1,
  numbers: [],
  cards: [
    { id: 'visibility-split', type: 'ai.visibility_split', width: 'full' },
    { id: 'rate-trend', type: 'ai.rate_trend_by_engine', width: 'two_thirds', options: { ...TREND } },
    { id: 'outcome-mix', type: 'ai.outcome_mix', width: 'third' },
    { id: 'share-of-voice', type: 'ai.share_of_voice', width: 'half', options: { rows: '10' } },
    { id: 'sov-over-time', type: 'ai.sov_over_time', width: 'half' },
    { id: 'topic-heatmap', type: 'ai.topic_heatmap', width: 'two_thirds', options: { ...HEATMAP } },
    { id: 'topic-extremes', type: 'ai.topic_extremes', width: 'third', options: { metric: 'mention', rows: '5' } },
    { id: 'top-domains', type: 'sources.top_domains', width: 'half', options: { ...TOP_DOMAINS } },
    { id: 'key-changes', type: 'activity.key_changes', width: 'half', options: { rows: '8' } },
    { id: 'ai-referrals', type: 'traffic.ai_referrals', width: 'full' },
  ],
};

/** Position, sentiment, unlinked mentions, your cited pages and collection health. */
export const ANALYST_LAYOUT: LayoutDocument = {
  schema: 1,
  numbers: [],
  cards: [
    { id: 'visibility-split', type: 'ai.visibility_split', width: 'full' },
    { id: 'rate-trend', type: 'ai.rate_trend_by_engine', width: 'two_thirds', options: { ...TREND } },
    { id: 'outcome-mix', type: 'ai.outcome_mix', width: 'third' },
    { id: 'position-distribution', type: 'ai.position_distribution', width: 'half' },
    { id: 'sentiment-by-engine', type: 'ai.sentiment_by_engine', width: 'half' },
    { id: 'unlinked-mentions', type: 'ai.unlinked_mentions', width: 'half' },
    { id: 'own-pages', type: 'sources.own_pages', width: 'half', options: { rows: '8' } },
    { id: 'topic-heatmap', type: 'ai.topic_heatmap', width: 'full', options: { ...HEATMAP } },
    { id: 'fanout-top', type: 'ai.fanout_top', width: 'half', options: { rows: '5' } },
    { id: 'key-changes', type: 'activity.key_changes', width: 'half', options: { rows: '8' } },
    { id: 'answer-calendar', type: 'ops.answer_calendar', width: 'full' },
  ],
};

/** Share of voice, the gap to each competitor and the sources behind it. */
export const COMPETITIVE_LAYOUT: LayoutDocument = {
  schema: 1,
  numbers: [],
  cards: [
    { id: 'visibility-split', type: 'ai.visibility_split', width: 'full' },
    { id: 'rate-trend', type: 'ai.rate_trend_by_engine', width: 'two_thirds', options: { ...TREND } },
    { id: 'outcome-mix', type: 'ai.outcome_mix', width: 'third' },
    { id: 'share-of-voice', type: 'ai.share_of_voice', width: 'half', options: { rows: '10' } },
    { id: 'sov-over-time', type: 'ai.sov_over_time', width: 'half' },
    { id: 'lost-to-competitor', type: 'ai.lost_to_competitor', width: 'full', options: { rows: '5' } },
    { id: 'top-domains', type: 'sources.top_domains', width: 'half', options: { ...TOP_DOMAINS } },
    { id: 'domain-type-share', type: 'ai.citation_share_by_domain_type', width: 'half' },
    { id: 'unlinked-mentions', type: 'ai.unlinked_mentions', width: 'half' },
    { id: 'own-pages', type: 'sources.own_pages', width: 'half', options: { rows: '8' } },
  ],
};

export const OVERVIEW_PRESET_LAYOUTS: Readonly<Record<PresetId, LayoutDocument>> = {
  executive: EXECUTIVE_LAYOUT,
  analyst: ANALYST_LAYOUT,
  competitive: COMPETITIVE_LAYOUT,
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
