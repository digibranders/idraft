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
  'ai.visibility_split': 'xl:min-h-[203px]',
  'ai.rate_trend_by_engine': 'md:min-h-[430px]',
  'ai.outcome_mix': 'md:min-h-[430px]',
  'ai.share_of_voice': 'md:min-h-[306px]',
  'ai.sov_over_time': 'md:min-h-[362px]',
  'ai.lost_to_competitor': 'md:min-h-[306px]',
  'ai.topic_heatmap': 'md:min-h-[585px]',
  'ai.topic_extremes': 'md:min-h-[518px]',
  'sources.top_domains': 'md:min-h-[450px]',
  'ai.citation_share_by_domain_type': 'md:min-h-[298px]',
  'sources.own_pages': 'md:min-h-[306px]',
  'ai.unlinked_mentions': 'md:min-h-[491px]',
  'ai.position_distribution': 'md:min-h-[450px]',
  'ai.sentiment_by_engine': 'md:min-h-[450px]',
  'traffic.ai_referrals': 'md:min-h-[520px] xl:min-h-[346px]',
  'ai.fanout_top': 'md:min-h-[346px]',
  'activity.key_changes': 'md:min-h-[350px]',
  'ops.answer_calendar': 'md:min-h-[214px]',
};

/** The class that gives a card its smallest height; none for a card the preview does not size. */
export function cardMinHeight(type: string): string {
  return Object.hasOwn(MIN_HEIGHT, type) ? (MIN_HEIGHT[type] ?? '') : '';
}
