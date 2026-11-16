/**
 * The text behind every "i" button of the Overview. One shape everywhere: `what` says in plain words what the card or
 * number shows, `how` says how it is counted and what it leaves out. Neither contains a figure that changes with the
 * data, so the text is true for any scope. Cards are keyed by card key, headline numbers by measure.
 */

/** @typedef {{ what: string, how: string }} Info */

/** @type {Record<string, Info>} */
export const CARD_INFO = {
  'ai.visibility_split': {
    what: 'How often AI answers mention or cite your brand.',
    how: 'The share of valid answers that name your brand, link to your site, or both. It equals 100% minus the answers that do neither. Each prompt counts once. The bar splits the rate into the four outcomes. Each tile beside it has its own info button.',
  },
  'ai.rate_trend_by_engine': {
    what: 'How the chosen rate changes from week to week.',
    how: 'One point for each weekly run, one line for each platform, with their average dashed. For a single platform the shaded band is the 95% range the true rate likely sits in. With Compare on, a dashed vertical line separates the previous 28 days from the current 28 days.',
  },
  'ai.outcome_mix': {
    what: 'What happens to your brand in each platform’s answers.',
    how: 'Each answer is named and linked, named only, cited only, or neither. The four shares add up to 100% of valid answers. Named only means your brand is mentioned and none of your pages is linked.',
  },
  'ai.share_of_voice': {
    what: 'How much of the brand talk in answers is about you, compared with your competitors.',
    how: 'Your mentions divided by all mentions of you and the tracked competitors. It depends on which competitors are tracked: adding one lowers every other share. Click a competitor to open it.',
  },
  'ai.sov_over_time': {
    what: 'How the split of brand mentions between you and your competitors changes week by week.',
    how: 'Each week adds up to 100% of the mentions of the tracked brands.',
  },
  'ai.lost_to_competitor': {
    what: 'Where each competitor is named more often than you, and where you are named more often than them.',
    how: 'Counted in prompts. A brand leads a prompt when it is named in at least 2 more answers than the other and the prompt has at least 4 valid answers; a closer result is mostly noise and is not counted. Click a name or a number to see the prompts.',
  },
  'ai.topic_heatmap': {
    what: 'How each group of prompts performs on each platform.',
    how: 'Pick a measure; each cell is that rate for the group’s prompts on that platform. Every prompt belongs to one group, so the groups add up to the total. A hatched cell has fewer than 4 valid answers and shows no rate. Click a cell to open the group.',
  },
  'ai.top_prompts': {
    what: 'The prompts of this group and how your brand does on each.',
    how: 'Rates are averaged over the platforms in scope. Prompts with fewer than 4 valid answers are not listed.',
  },
  'ai.topic_extremes': {
    what: 'The groups where your brand does best and worst.',
    how: 'Groups are ranked by the chosen measure, averaged over the platforms, with each group’s prompt count. It needs at least 4 groups with a rate.',
  },
  'sources.top_domains': {
    what: 'The websites AI answers cite most often.',
    how: 'A page is counted once for each answer that cites it. Each share is a part of all citations in scope.',
  },
  'ai.citation_share_by_domain_type': {
    what: 'What kinds of websites AI answers cite.',
    how: 'The areas add up to all citations in scope, grouped as your own site, competitors, review sites, publishers, community and others.',
  },
  'sources.own_pages': {
    what: 'Which pages of your own site AI answers cite.',
    how: 'Each page’s share of all the citations that go to your domain.',
  },
  'ai.unlinked_mentions': {
    what: 'Prompts where AI names your brand but links to none of your pages.',
    how: 'Counted per prompt, from the answers that name the brand without citing it.',
  },
  'ai.position_distribution': {
    what: 'Where your brand comes in the order of brands named in an answer.',
    how: 'The position is among the brands you track, not every brand in the answer. 1 means named first, and a lower average is better.',
  },
  'ai.sentiment_by_engine': {
    what: 'The tone AI uses when it names your brand.',
    how: 'The share of mentions that are positive, neutral, negative or mixed, shown as four shares and never one score. Tone is rule-based, with a model check on low-confidence mentions. Sample data until sentiment is collected.',
  },
  'traffic.ai_referrals': {
    what: 'Visits to your site that come from AI platforms.',
    how: 'Sessions from chatgpt.com and gemini.google.com, as Google Analytics classifies them. Google AI Mode and AI Overview visits cannot be told apart from Google organic. Sample data until Google Analytics is connected.',
  },
  'ai.fanout_top': {
    what: 'The extra searches ChatGPT runs to build its answers.',
    how: 'Only ChatGPT shows them. A query is listed when it appears in at least 2 answers.',
  },
  'activity.key_changes': {
    what: 'The changes in the last 28 days that deserve your attention.',
    how: 'Only changes beyond normal week-to-week variation are listed, together with collection events.',
  },
  'ops.answer_calendar': {
    what: 'When each weekly collection run happened and how it went.',
    how: 'Each cell is one weekly run. A partial run keeps the answers that completed; answers that failed count as collection problems, not as a miss for your brand.',
  },
  // The competitor drawer
  'competitor.summary': {
    what: 'You and this competitor side by side on each measure.',
    how: 'The gap is your value minus theirs. Rates are prompt-weighted, each prompt counting once. Share of voice depends on which competitors are tracked.',
  },
  'competitor.trend': {
    what: 'How your mention rate and theirs change week by week.',
    how: 'One point for each weekly run. The 8 weeks are the previous 28 days and the current 28 days.',
  },
  'competitor.platforms': {
    what: 'You and this competitor on each platform.',
    how: 'A platform with fewer than 4 valid answers shows n/a. AI Overview is read from rank checks and counts only the checks that showed one.',
  },
  'competitor.groups': {
    what: 'The groups where this kind of lead happens most.',
    how: 'Click a group to narrow the prompt list below to it. Click it again to clear.',
  },
  'competitor.prompts': {
    what: 'The prompts behind the lead you picked, the largest difference first.',
    how: 'A brand leads a prompt when it is named in at least 2 more answers than the other, over the platforms in scope. A smaller difference is mostly noise and counts as equal. A prompt needs at least 4 valid answers, and those with fewer are left out.',
  },
  'competitor.sources.theirs': {
    what: 'The websites AI cites in answers that name this competitor.',
    how: 'Each domain’s share of the citations in those answers. Their own domain ranks high because their pages are cited more when they are named.',
  },
  'competitor.sources.yours': {
    what: 'The websites AI cites in answers that name you.',
    how: 'The same count as for the competitor, over the answers that name you.',
  },
  'competitor.sources.gap': {
    what: 'Websites that AI cites next to this competitor and does not cite next to you.',
    how: 'Taken from the top cited domains of each side. These are the places to look for a citation of your own.',
  },
};

/** @type {Record<string, Info>} */
export const MEASURE_INFO = {
  visibility: {
    what: 'How often AI answers mention or cite your brand.',
    how: 'The share of valid answers that name or cite it, which is 100% minus the answers that do neither. Each prompt counts once.',
  },
  mention: {
    what: 'How often AI answers name your brand.',
    how: 'The share of valid answers that mention the brand. Each prompt counts once.',
  },
  sov: {
    what: 'Your share of all brand mentions.',
    how: 'Your mentions divided by the mentions of you and the tracked competitors, so it depends on which competitors are tracked.',
  },
  citation: {
    what: 'How often AI answers link to your site.',
    how: 'The share of valid answers that cite a page of your domain.',
  },
  position: {
    what: 'How early your brand is named in an answer.',
    how: 'The mean order among the tracked brands. 1 means named first, and lower is better.',
  },
  recommendation: {
    what: 'How often AI recommends your brand.',
    how: 'The share of valid answers that recommend it. An answer that does not name the brand counts as not recommending it. Sample data until recommendations are classified.',
  },
  sentiment: {
    what: 'How positive the tone is when AI names your brand.',
    how: 'The share of classified mentions with a positive tone. The Brand sentiment card shows all four shares. Sample data until sentiment is collected.',
  },
  prompts: {
    what: 'How many prompts are tracked in this view.',
    how: 'Each prompt is counted once, however many platforms answer it.',
  },
  runs: {
    what: 'How many weekly collection runs are behind these numbers.',
    how: 'Prompts are asked on the schedule of their panel, so a run may hold only some of them.',
  },
};

/** Both parts as one sentence run, for a tooltip and for screen readers. */
export const infoText = (info) => (typeof info === 'string' ? info : `${info.what} How it’s counted: ${info.how}`);
