/**
 * The text behind every "i" button of the Overview. One shape everywhere: `what` says in plain words what the card or
 * number shows, `how` says how it is counted and what it leaves out. Neither contains a figure that changes with the
 * data, so the text is true for any scope. Cards are keyed by card key, headline numbers by measure.
 */

/** @typedef {{ what: string, how: string }} Info */

/** @type {Record<string, Info>} */
export const CARD_INFO = {
  'ai.visibility_split': {
    what: 'How often AI answers mention your brand or cite your site.',
    how: 'The share of valid answers that mention your brand, cite a page of your site, or both. It equals 100% minus the answers that do neither. Each prompt counts once. The bar splits the rate into the four outcomes. Each tile beside it has its own info button.',
  },
  'ai.rate_trend_by_engine': {
    what: 'How the chosen rate changes from week to week.',
    how: 'One point for each weekly run, one line for each platform, with their average dashed. For a single platform the shaded band is the 95% range the true rate likely sits in. With Compare on, a dashed vertical line separates the previous 28 days from the current 28 days.',
  },
  'ai.outcome_mix': {
    what: 'What happens to your brand in each platform\'s answers.',
    how: 'Each valid answer is mentioned and cited, mentioned only, cited only, or neither. The four shares add up to 100%. Mentioned only means your brand is mentioned and none of your pages is cited.',
  },
  'ai.share_of_voice': {
    what: 'How much of the brand talk in answers is about you, compared with your competitors.',
    how: 'In each answer that mentions you or a tracked competitor, the brands mentioned share that answer equally. Your share is the average of those shares across such answers. It depends on which competitors are tracked: adding one lowers every other share. Watched brands do not count. Click a competitor to open it.',
  },
  'ai.sov_over_time': {
    what: 'How the split of brand mentions between you and your competitors changes week by week.',
    how: 'Each week adds up to 100% of the tracked brands\' shares of voice.',
  },
  'ai.lost_to_competitor': {
    what: 'Where each competitor is mentioned more often than you, and where you are mentioned more often than them.',
    how: 'Counted in prompts. A brand leads a prompt when it is mentioned in at least 2 more answers than the other and the prompt has at least 4 valid answers; a closer result is mostly noise and is not counted. Click a name or a number to see the prompts.',
  },
  'ai.topic_heatmap': {
    what: 'How each group of prompts performs on each platform.',
    how: 'Pick a measure; each cell is that rate for the group\'s prompts on that platform. Every prompt belongs to one group, so the groups add up to the total. A hatched cell has fewer than 4 valid answers and shows no rate. Click a cell to open the group.',
  },
  'ai.top_prompts': {
    what: 'The prompts of this group and how your brand does on each.',
    how: 'Rates are averaged over the platforms in scope. Prompts with fewer than 4 valid answers are not listed.',
  },
  'ai.topic_extremes': {
    what: 'The groups where your brand does best and worst.',
    how: 'Groups are ranked by the chosen measure, averaged over the platforms, with each group\'s prompt count. It needs at least 4 groups with a rate.',
  },
  'ai.group_vs_all': {
    what: 'How the chosen group compares with all groups, on each platform.',
    how: 'The bar is the group\'s rate for the chosen measure. The note beside it is the rate for all groups and the gap in points. A platform with fewer than 4 valid answers in the group shows no rate.',
  },
  'sources.top_domains': {
    what: 'The domains AI answers cite most often.',
    how: 'A page is counted once for each answer that cites it. Each share is a part of all citations in scope.',
  },
  'ai.citation_share_by_domain_type': {
    what: 'What kinds of domains AI answers cite.',
    how: 'The areas add up to all citations in scope, grouped by domain type: your site, competitors, review sites, publishers, community and other.',
  },
  'sources.own_pages': {
    what: 'Which pages of your site AI answers cite.',
    how: 'Each page\'s share of all the citations that go to your domains.',
  },
  'ai.unlinked_mentions': {
    what: 'Prompts where AI mentions your brand but cites none of your pages.',
    how: 'Counted per prompt, from the answers that mention your brand without citing your site.',
  },
  'ai.position_distribution': {
    what: 'Where your brand comes in the order of brands mentioned in an answer.',
    how: 'The mention position is among the brands you track, not every brand in the answer. 1 means mentioned first, and lower is better. It is not a Google rank.',
  },
  'ai.sentiment_by_engine': {
    what: 'The tone AI uses when it mentions your brand.',
    how: 'The share of mentions that are positive, neutral, negative or mixed, shown as four shares and never one score. Tone is rule-based, with a model check on low-confidence mentions.',
  },
  'traffic.ai_referrals': {
    what: 'Visits to your site that come from AI platforms.',
    how: 'A visit is a session as Google Analytics counts it, from chatgpt.com and gemini.google.com as Google Analytics classifies them. Google AI Mode and Google AI Overview visits cannot be told apart from Google organic.',
  },
  'ai.fanout_top': {
    what: 'The extra searches ChatGPT runs to build its answers.',
    how: 'Only ChatGPT shows them. A fan-out query is listed when it appears in at least 2 answers.',
  },
  'activity.key_changes': {
    what: 'The changes in the last 28 days that deserve your attention.',
    how: 'Only detectable changes are listed, together with collection events.',
  },
  'ops.answer_calendar': {
    what: 'When each weekly run happened and how it went.',
    how: 'Each cell is one weekly run. A partial run keeps the answers that completed; failed answers count as collection problems, not as a miss for your brand.',
  },
  // The competitor drawer
  'competitor.summary': {
    what: 'You and this competitor side by side on each measure.',
    how: 'The gap is your value minus theirs. Rates count each prompt once. Share of voice depends on which competitors are tracked.',
  },
  'competitor.trend': {
    what: 'How your mention rate and theirs change week by week.',
    how: 'One point for each weekly run. The 8 weeks are the previous 28 days and the current 28 days.',
  },
  'competitor.platforms': {
    what: 'You and this competitor on each platform.',
    how: 'A platform with fewer than 4 valid answers shows n/a. Google AI Overview is read from rank checks and counts only the checks that showed one.',
  },
  'competitor.groups': {
    what: 'The groups where this kind of lead happens most.',
    how: 'Click a group to narrow the prompt list below to it. Click it again to clear.',
  },
  'competitor.prompts': {
    what: 'The prompts behind the lead you picked, the largest difference first.',
    how: 'A brand leads a prompt when it is mentioned in at least 2 more answers than the other, over the platforms in scope. A smaller difference is mostly noise and counts as equal. A prompt needs at least 4 valid answers; those with fewer are left out.',
  },
  'competitor.sources.theirs': {
    what: 'The domains AI cites in answers that mention this competitor.',
    how: 'Each domain\'s share of the citations in those answers. Their domain ranks high because their pages are cited more when they are mentioned.',
  },
  'competitor.sources.yours': {
    what: 'The domains AI cites in answers that mention you.',
    how: 'The same count as for the competitor, over the answers that mention you.',
  },
  'competitor.sources.gap': {
    what: 'Domains that AI cites next to this competitor and does not cite next to you.',
    how: 'Taken from the top cited domains of each side. These are the places to look for a citation of your own.',
  },
};

/** @type {Record<string, Info>} */
export const MEASURE_INFO = {
  visibility: {
    what: 'How often AI answers mention your brand or cite your site.',
    how: 'The share of valid answers that mention your brand or cite your site, which is 100% minus the answers that do neither. Each prompt counts once.',
  },
  mention: {
    what: 'How often AI answers mention your brand.',
    how: 'The share of valid answers whose text contains your brand name or one of its aliases. Each prompt counts once. A citation without the brand name in the text is not a mention.',
  },
  sov: {
    what: 'Your share of all brand mentions.',
    how: 'As on the Share of voice card: it depends on which competitors are tracked.',
  },
  citation: {
    what: 'How often AI answers cite your site.',
    how: 'The share of valid answers that cite at least one page of your domains. Several citations in one answer count once. A mention without a citation does not count.',
  },
  position: {
    what: 'How early your brand is mentioned in an answer.',
    how: 'The mean order among the tracked brands, over the answers that mention you. 1 means mentioned first, and lower is better. It is not a Google rank.',
  },
  recommendation: {
    what: 'How often AI recommends your brand.',
    how: 'The share of valid answers that recommend it. An answer that does not mention your brand counts as not recommending it. Answers whose recommendation could not be judged are left out.',
  },
  sentiment: {
    what: 'How positive the tone is when AI mentions your brand.',
    how: 'The share of judged mentions with a positive tone. The Sentiment card shows all four shares.',
  },
  prompts: {
    what: 'How many prompts are tracked in this view.',
    how: 'Each prompt is counted once, however many platforms answer it.',
  },
  runs: {
    what: 'How many weekly runs are behind these numbers.',
    how: 'Prompts are asked on their schedule, so a run may hold only some of them.',
  },
};

/** Both parts as one sentence run, for a tooltip and for screen readers. */
export const infoText = (info) => (typeof info === 'string' ? info : `${info.what} How it’s counted: ${info.how}`);
