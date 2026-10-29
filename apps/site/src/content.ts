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
  { label: 'Roadmap', href: '/roadmap' },
  { label: 'About', href: '/about' },
] as const;

/** Planned work, in no promised order. Nothing here is a release date. */
export const PLANNED = [
  { title: 'Website audit', body: 'Crawl your site and list the technical and content issues that hold pages back, tied to the keywords and prompts you track.' },
  { title: 'Page performance', body: 'Clicks, impressions and position for each URL from Search Console, compared month over month.' },
  { title: 'Keyword and prompt discovery', body: 'Suggestions for what to track next, found from your rankings, your rivals and the questions people ask AI.' },
  { title: 'Integrations', body: 'Search Console, analytics and other first-party sources next to the data idraft collects.' },
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
    a: 'That is where idraft starts. A website audit and other SEO tools are planned, so the platform grows around the same record per topic. See the roadmap for what is planned.',
  },
  {
    q: 'How do I get access?',
    a: 'We are onboarding teams by invitation. Request access and we will reply with next steps.',
  },
] as const;
