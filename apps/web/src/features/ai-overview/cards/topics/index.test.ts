import { describe, expect, it } from 'vitest';

import { TOPIC_CARDS } from './index';
import { CARD_TYPES } from '@/lib/layouts';

const FAMILY_KEYS = [
  'ai.topic_heatmap',
  'ai.topic_extremes',
  'ai.topic_movers',
  'ai.topic_engine_gap',
  'ai.engine_disagreement',
  'ai.topic_trends',
  'ai.topic_small_multiples',
  'ai.topic_contribution',
  'ai.prompt_heatmap',
  'ai.citation_vs_mention',
  'ai.top_prompts',
];

/** The cards of the other card packages (WP-33 plan section 5, item 12): WP-34, WP-35 and WP-37. */
const FOREIGN_KEYS = [
  // WP-34, engines
  'ai.rate_trend_by_engine',
  'ai.mention_trend',
  'ai.by_engine',
  'ai.outcome_mix',
  'ai.answer_funnel',
  'ai.sample_coverage',
  'ai.change_summary',
  'ai.prompt_movers',
  'ai.period_comparison',
  'ai.change_waterfall',
  'ai.engine_agreement',
  'ai.country_breakdown',
  // WP-35, competitors
  'ai.share_of_voice',
  'ai.competitor_trend',
  'ai.competitor_table',
  'ai.lost_to_competitor',
  'ai.co_mentions',
  'ai.sov_over_time',
  'ai.sov_rank',
  'ai.opportunities',
  'competitors.summary',
  'competitors.share_of_voice',
  // WP-37, sources and activity
  'sources.top_domains',
  'sources.own_pages',
  'sources.new_lost',
  'sources.diversity',
  'ai.fanout_top',
  'activity.key_changes',
  'activity.collection_status',
  'ops.answer_calendar',
  'ops.answer_status',
  'ops.engines',
  'ops.ai_spend',
  'ai.citation_share_by_domain_type',
];

describe('the topics family of the Overview cards', () => {
  it('lists exactly the eleven cards of the topics family', () => {
    expect(Object.keys(TOPIC_CARDS).sort()).toEqual([...FAMILY_KEYS].sort());
  });

  it('every key is an active ai_overview card type', () => {
    const active = new Set(
      CARD_TYPES.filter((type) => type.status === 'active' && type.screens.includes('ai_overview')).map(
        (type) => type.key,
      ),
    );
    for (const key of Object.keys(TOPIC_CARDS)) expect(active.has(key)).toBe(true);
  });

  it('lists no card of another package', () => {
    const keys = Object.keys(TOPIC_CARDS);
    for (const foreign of FOREIGN_KEYS) expect(keys).not.toContain(foreign);
  });

  it('every entry loads a default export that is a component', async () => {
    for (const [key, registration] of Object.entries(TOPIC_CARDS)) {
      const loaded = await registration.load();
      expect(typeof loaded.default, key).toBe('function');
    }
  });

  it('the registry accepts the family', async () => {
    // Loaded inside the test: the registry builds AI_OVERVIEW_CARDS at module level and throws on a typo key, which
    // would otherwise fail the whole file at load and not this test by name.
    const { cardEntries } = await import('../registry');
    expect(() => cardEntries([TOPIC_CARDS])).not.toThrow();
  });
});
