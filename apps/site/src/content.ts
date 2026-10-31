export const ACCESS_HREF = '/request-access';
export const CONTACT_EMAIL = 'hello@idraft.ai';
export const SIGN_IN_HREF = 'https://app.idraft.ai';

export const PRODUCT_LINKS = [
  { label: 'Rank tracking', href: '/rank-tracking', body: 'Daily Google positions, honest about every gap.' },
  { label: 'AI visibility', href: '/ai-visibility', body: 'What ChatGPT, Gemini and Google AI say about you.' },
  { label: 'Sources and rivals', href: '/sources', body: 'Who the answers cite, and who is gaining on you.' },
] as const;

export const NAV_LINKS = [
  { label: 'How it works', href: '/how-it-works' },
  { label: 'Features', href: '/features' },
  { label: 'About', href: '/about' },
] as const;

/** Everything idraft does beyond the three product pages. */
export const MORE_FEATURES = [
  { title: 'Website audit', body: 'Crawl your site and list the technical and content issues that hold pages back: crawlability, broken links and redirects, indexing, duplicate content, structured data and Core Web Vitals, tied to the keywords and prompts you track.' },
  { title: 'Page performance', body: 'Clicks, impressions, CTR and position for each URL from Search Console, compared month over month, with each page flagged as growing, stable or slipping.' },
  { title: 'Discovery', body: 'Suggestions for keywords and prompts to track next, found from your rankings, your rivals and the questions people ask AI, waiting in an inbox you approve.' },
  { title: 'Competitors', body: 'Every rival you follow, on the same keywords and prompts, with who is gaining in search and in AI answers.' },
  { title: 'Reports', body: 'Share a view with a client or a boss: rankings, AI answers and sources in one report, with the evidence behind each number.' },
  { title: 'Integrations', body: 'Search Console, analytics and other first-party sources sit next to the data idraft collects.' },
] as const;

export const STORY_STEPS = [
  {
    title: 'Your position, every day',
    body: 'Daily Google rankings for each keyword, country and device, with the page that ranks and how it moved.',
  },
  {
    title: 'Their answer, every prompt',
    body: 'The same topics asked to ChatGPT, Gemini and Google AI, with who gets named and which sources they cite.',
  },
  {
    title: 'The gap, in one view',
    body: 'Keywords and prompts sit side by side, so you see where you rank but go unmentioned, and where AI names you without a click.',
  },
] as const;

export const FAQ_ITEMS = [
  {
    q: 'What does idraft track?',
    a: 'Your Google rankings for the keywords you choose, and how ChatGPT, Gemini, Google AI Overviews and AI Mode answer the prompts you choose, including which brands and sources they name.',
  },
  {
    q: 'How is it different from a rank tracker?',
    a: 'A rank tracker stops at the ten blue links. idraft keeps rankings and AI answers on one record per topic, so you can compare them and see where the two disagree.',
  },
  {
    q: 'Is there one visibility score?',
    a: 'No. A single score hides how it was made. idraft shows the parts, such as mention rate and citation rate, each with the number of checks behind it.',
  },
  {
    q: 'Can I trust the numbers?',
    a: 'Every check is stored with its date. A missed check shows as a gap, never as a guess, and estimates are labeled as estimates.',
  },
  {
    q: 'Is it only rankings and AI answers?',
    a: 'No. Rankings and AI answers are the core, and around them are a website audit, page performance, discovery, competitor tracking, reports and integrations, all on the same record per topic. See the features page for the full list.',
  },
  {
    q: 'How do I get access?',
    a: 'We are onboarding teams by invitation. Request access and we will reply with next steps.',
  },
] as const;
