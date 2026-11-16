/**
 * The cards of the AI visibility Overview as the layout sees them: key, title, what it shows, the widths it can take
 * and the builder that draws it. Keys are those of the layout catalog (src/lib/layouts/catalog.ts); the redesign adds
 * `ai.visibility_split`, `ai.position_distribution`, `ai.sentiment_by_engine`,
 * `traffic.ai_referrals` and `ai.unlinked_mentions` (spec section 5).
 */
import { gapCard, headlineRow, outcomeCard, sovCard, sovOverTimeCard, trendCard } from './aiov-cards-core.js';
import { calendarCard, changesCard, domainsCard, fanoutCard, groupExtremesCard, groupHeatmapCard, groupPromptsCard, ownPagesCard, positionCard, referralCard, sentimentCard, sourceTypesCard, unlinkedCard } from './aiov-cards-more.js';

/** The group select decides what the group card shows: every group as a heat map, or the prompts of the one chosen. */
const heatmapOrPrompts = (ctx) => (ctx.scope.group === 'all' ? groupHeatmapCard(ctx) : groupPromptsCard(ctx));
/** The strongest and weakest groups only exist while all groups are in scope. */
const extremes = (ctx) => (ctx.scope.group === 'all' ? groupExtremesCard(ctx) : null);

export const CARD_GROUPS = ['Overview', 'Competitors', 'Groups', 'Citations', 'Prompt tracking', 'Traffic', 'Activity'];

export const CARD_REGISTRY = [
  { key: 'ai.visibility_split', title: 'Headline numbers', description: 'AI Visibility with its four outcomes, and the key numbers beside it.', group: 'Overview', widths: ['full'], build: headlineRow },
  { key: 'ai.rate_trend_by_engine', title: 'Trend over time', description: 'Visibility, mention, citation or share of voice over the weekly runs.', group: 'Overview', widths: ['two_thirds', 'full', 'half'], build: trendCard },
  { key: 'ai.outcome_mix', title: 'What answers do with the brand', description: 'Named and linked, named only, cited only and neither, per platform.', group: 'Overview', widths: ['third', 'half'], build: outcomeCard },
  { key: 'ai.share_of_voice', title: 'Share of voice', description: 'Your share of tracked-brand mentions beside each competitor.', group: 'Competitors', widths: ['half', 'third'], build: sovCard },
  { key: 'ai.sov_over_time', title: 'Share of voice over time', description: 'The share of every tracked brand over the weekly runs, stacked to 100%.', group: 'Competitors', widths: ['half', 'two_thirds', 'full'], build: sovOverTimeCard },
  { key: 'ai.lost_to_competitor', title: 'Competitor gap', description: 'The mention gap to each competitor and the prompts where they lead.', group: 'Competitors', widths: ['half', 'full'], build: gapCard },
  { key: 'ai.topic_heatmap', title: 'Groups by platform', description: 'A rate for every group on every platform. With one group chosen, its prompts.', group: 'Groups', widths: ['two_thirds', 'full'], build: heatmapOrPrompts },
  { key: 'ai.topic_extremes', title: 'Strongest and weakest groups', description: 'The groups where the brand is strongest and weakest. All groups only.', group: 'Groups', widths: ['third', 'half'], build: extremes },
  { key: 'sources.top_domains', title: 'Top cited domains', description: 'The domains answers cite most, with your own highlighted.', group: 'Citations', widths: ['half', 'third'], build: domainsCard },
  { key: 'ai.citation_share_by_domain_type', title: 'Sources by type', description: 'Citation units by source type, as a treemap.', group: 'Citations', widths: ['half', 'third'], build: sourceTypesCard },
  { key: 'sources.own_pages', title: 'Your pages cited', description: 'The pages of your domain that answers cite.', group: 'Citations', widths: ['half', 'third'], build: ownPagesCard },
  { key: 'ai.unlinked_mentions', title: 'Unlinked brand mentions', description: 'Prompts that name you without citing you.', group: 'Citations', widths: ['half', 'third'], build: unlinkedCard },
  { key: 'ai.position_distribution', title: 'Where the brand is named', description: 'Whether the brand is named first, second, third or later.', group: 'Prompt tracking', widths: ['half', 'third', 'full'], build: positionCard },
  { key: 'ai.sentiment_by_engine', title: 'Brand sentiment', description: 'The tone of the mentions as four shares, per platform.', group: 'Prompt tracking', widths: ['half', 'third'], build: sentimentCard },
  { key: 'traffic.ai_referrals', title: 'AI referral traffic', description: 'Sessions from AI platforms and the pages they land on. Needs GA4.', group: 'Traffic', widths: ['full', 'two_thirds'], build: referralCard },
  { key: 'ai.fanout_top', title: 'Fan-out queries', description: 'The searches ChatGPT ran to build its answers. ChatGPT only.', group: 'Prompt tracking', widths: ['half', 'third', 'full'], build: fanoutCard },
  { key: 'activity.key_changes', title: 'Key changes', description: 'Changes beyond normal variation and collection events.', group: 'Activity', widths: ['half', 'third', 'full'], build: changesCard },
  { key: 'ops.answer_calendar', title: 'Collection runs', description: 'One cell per weekly run and platform, with partial runs marked.', group: 'Activity', widths: ['full', 'half'], build: calendarCard },
];

export const cardDef = (key) => CARD_REGISTRY.find((card) => card.key === key);

export const WIDTH_LABEL = { third: 'Third', half: 'Half', two_thirds: 'Two thirds', full: 'Full' };
/** Grid classes of a width: the 12-column grid of the page (from 768 px a half is 6, and a third is 6 until 1280 px). */
export const WIDTH_CLASS = {
  third: 'md:col-span-6 xl:col-span-4',
  half: 'md:col-span-6',
  two_thirds: 'md:col-span-12 xl:col-span-8',
  full: 'md:col-span-12',
};
