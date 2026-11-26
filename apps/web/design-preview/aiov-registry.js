/**
 * The cards of the AI visibility Overview as the layout sees them: key, title, what it shows, the widths it can take
 * and the builder that draws it. Keys are those of the layout catalog (src/lib/layouts/catalog.ts); the redesign adds
 * `ai.visibility_split`, `ai.position_distribution`, `ai.sentiment_by_engine`,
 * `traffic.ai_referrals` and `ai.unlinked_mentions` (spec section 5).
 */
import { gapCard, headlineRow, outcomeCard, sovCard, sovOverTimeCard, trendCard } from './aiov-cards-core.js';
import { calendarCard, changesCard, domainsCard, fanoutCard, groupExtremesCard, groupHeatmapCard, groupPromptsCard, groupVersusAllCard, ownPagesCard, positionCard, referralCard, sentimentCard, sourceTypesCard, unlinkedCard } from './aiov-cards-more.js';

/** The group select decides what the group card shows: every group as a heat map, or the prompts of the one chosen. */
const heatmapOrPrompts = (ctx) => (ctx.scope.group === 'all' ? groupHeatmapCard(ctx) : groupPromptsCard(ctx));
/** The strongest and weakest groups need all groups; with one group chosen the card compares it with all groups. */
const extremes = (ctx) => (ctx.scope.group === 'all' ? groupExtremesCard(ctx) : groupVersusAllCard(ctx));

export const CARD_GROUPS = ['Overview', 'Competitors', 'Groups', 'Citations', 'Prompt tracking', 'Traffic', 'Activity'];

export const CARD_REGISTRY = [
  { key: 'ai.visibility_split', title: 'AI visibility rate (headline)', description: 'AI visibility rate with its four outcomes, and the key numbers beside it.', group: 'Overview', widths: ['full'], build: headlineRow },
  { key: 'ai.rate_trend_by_engine', title: 'Rate by platform over time', description: 'Visibility, mention, citation or share of voice over the weekly runs.', group: 'Overview', widths: ['two_thirds', 'full', 'half'], build: trendCard },
  { key: 'ai.outcome_mix', title: 'Outcome split by platform', description: 'Mentioned and cited, mentioned only, cited only and neither, per platform.', group: 'Overview', widths: ['third', 'half'], build: outcomeCard },
  { key: 'ai.share_of_voice', title: 'Share of voice', description: 'Your share of tracked-brand mentions beside each competitor.', group: 'Competitors', widths: ['half', 'third'], build: sovCard },
  { key: 'ai.sov_over_time', title: 'Share of voice over time', description: 'The share of every tracked brand over the weekly runs, stacked to 100%.', group: 'Competitors', widths: ['half', 'two_thirds', 'full'], build: sovOverTimeCard },
  { key: 'ai.lost_to_competitor', title: 'Lost to competitor', description: 'For each competitor, the prompts where they are mentioned more often than you, and where you lead.', group: 'Competitors', widths: ['half', 'full'], build: gapCard },
  { key: 'ai.topic_heatmap', title: 'Groups by platform', description: 'A rate for every group on every platform. With one group chosen, its prompts.', group: 'Groups', widths: ['two_thirds', 'full'], build: heatmapOrPrompts },
  { key: 'ai.topic_extremes', title: 'Strongest and weakest groups', description: 'The groups where the brand is strongest and weakest. With one group chosen, how it compares with all groups.', group: 'Groups', widths: ['third', 'half'], build: extremes },
  { key: 'sources.top_domains', title: 'Top cited domains', description: 'The domains answers cite most, with your site highlighted.', group: 'Citations', widths: ['half', 'third'], build: domainsCard },
  { key: 'ai.citation_share_by_domain_type', title: 'Citations by domain type', description: 'Citation units by domain type, as a treemap.', group: 'Citations', widths: ['half', 'third'], build: sourceTypesCard },
  { key: 'sources.own_pages', title: 'Your pages cited', description: 'The pages of your domain that answers cite.', group: 'Citations', widths: ['half', 'third'], build: ownPagesCard },
  { key: 'ai.unlinked_mentions', title: 'Mentioned, not cited', description: 'Prompts that mention you without citing you.', group: 'Citations', widths: ['half', 'third'], build: unlinkedCard },
  { key: 'ai.position_distribution', title: 'Mention position', description: 'Whether the brand is mentioned first, second, third or later.', group: 'Prompt tracking', widths: ['half', 'third', 'full'], build: positionCard },
  { key: 'ai.sentiment_by_engine', title: 'Sentiment by platform', description: 'The tone of the mentions as four shares, per platform.', group: 'Prompt tracking', widths: ['half', 'third'], build: sentimentCard },
  { key: 'traffic.ai_referrals', title: 'AI referral visits', description: 'Visits from AI platforms and the pages they land on. Needs GA4.', group: 'Traffic', widths: ['full', 'two_thirds'], build: referralCard },
  { key: 'ai.fanout_top', title: 'Top fan-out queries', description: 'The fan-out queries ChatGPT ran to build its answers. ChatGPT only.', group: 'Prompt tracking', widths: ['half', 'third', 'full'], build: fanoutCard },
  { key: 'activity.key_changes', title: 'Key changes', description: 'Changes beyond normal variation and collection events.', group: 'Activity', widths: ['half', 'third', 'full'], build: changesCard },
  { key: 'ops.answer_calendar', title: 'Run calendar', description: 'One cell per weekly run and platform, with partial runs marked.', group: 'Activity', widths: ['full', 'half'], build: calendarCard },
];

export const cardDef = (key) => CARD_REGISTRY.find((card) => card.key === key);

/**
 * The smallest height of each card, the tallest it gets in any scope. A card keeps its place and its height whatever
 * the Platform and Group selects say, so the cards below it do not jump when the scope changes. Measured in px at the
 * widths the default layout gives the cards; stacked on a phone the cards are as tall as their content.
 */
export const MIN_HEIGHT = {
  'ai.visibility_split': '@4xl:min-h-[203px]',
  'ai.rate_trend_by_engine': '@2xl:min-h-[430px]',
  'ai.outcome_mix': '@2xl:min-h-[430px]',
  'ai.share_of_voice': '@2xl:min-h-[306px]',
  'ai.sov_over_time': '@2xl:min-h-[362px]',
  'ai.lost_to_competitor': '@2xl:min-h-[306px]',
  'ai.topic_heatmap': '@2xl:min-h-[585px]',
  'ai.topic_extremes': '@2xl:min-h-[518px]',
  'sources.top_domains': '@2xl:min-h-[450px]',
  'ai.citation_share_by_domain_type': '@2xl:min-h-[298px]',
  'sources.own_pages': '@2xl:min-h-[306px]',
  'ai.unlinked_mentions': '@2xl:min-h-[491px]',
  'ai.position_distribution': '@2xl:min-h-[450px]',
  'ai.sentiment_by_engine': '@2xl:min-h-[450px]',
  'traffic.ai_referrals': '@2xl:min-h-[520px] @4xl:min-h-[346px]',
  'ai.fanout_top': '@2xl:min-h-[346px]',
  'activity.key_changes': '@2xl:min-h-[350px]',
  'ops.answer_calendar': '@2xl:min-h-[214px]',
};

export const WIDTH_LABEL = { third: 'Third', half: 'Half', two_thirds: 'Two thirds', full: 'Full' };
/** Grid classes of a width: the 12-column grid of the page (from 768 px a half is 6, and a third is 6 until 1280 px). */
export const WIDTH_CLASS = {
  third: '@2xl:col-span-6 @4xl:col-span-4',
  half: '@2xl:col-span-6',
  two_thirds: '@2xl:col-span-12 @4xl:col-span-8',
  full: '@2xl:col-span-12',
};
