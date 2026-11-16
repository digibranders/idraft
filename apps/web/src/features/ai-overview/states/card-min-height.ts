/**
 * The smallest height of each Overview card, the tallest it gets in any scope. A card keeps its place and its height
 * whatever the Platform and Group say, so the cards below it do not jump when the scope changes. The values are the
 * design preview's (`MIN_HEIGHT` in `aiov-registry.js`), measured at the widths the Default layout gives the cards;
 * stacked on a phone the cards are as tall as their content, so no class applies there.
 *
 * A card puts `cardMinHeight(type)` on its outermost element, and so does `ScopeUnavailableCard`. The class names are
 * written out whole, because Tailwind reads them from the source.
 */
const MIN_HEIGHT: Readonly<Record<string, string>> = {
  'ai.visibility_split': 'xl:min-h-50.75',
  'ai.rate_trend_by_engine': 'md:min-h-107.5',
  'ai.outcome_mix': 'md:min-h-107.5',
  'ai.share_of_voice': 'md:min-h-76.5',
  'ai.sov_over_time': 'md:min-h-90.5',
  'ai.lost_to_competitor': 'md:min-h-76.5',
  'ai.topic_heatmap': 'md:min-h-146.25',
  'ai.topic_extremes': 'md:min-h-129.5',
  'sources.top_domains': 'md:min-h-112.5',
  'ai.citation_share_by_domain_type': 'md:min-h-74.5',
  'sources.own_pages': 'md:min-h-76.5',
  'ai.unlinked_mentions': 'md:min-h-122.75',
  'ai.position_distribution': 'md:min-h-112.5',
  'ai.sentiment_by_engine': 'md:min-h-112.5',
  'traffic.ai_referrals': 'md:min-h-130 xl:min-h-86.5',
  'ai.fanout_top': 'md:min-h-86.5',
  'activity.key_changes': 'md:min-h-87.5',
  'ops.answer_calendar': 'md:min-h-53.5',
};

/** The class that gives a card its smallest height; none for a card the preview does not size. */
export function cardMinHeight(type: string): string {
  return Object.hasOwn(MIN_HEIGHT, type) ? (MIN_HEIGHT[type] ?? '') : '';
}
