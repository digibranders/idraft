export const ACCESS_HREF = 'mailto:hello@idraft.ai?subject=Request%20access%20to%20idraft';
export const SIGN_IN_HREF = 'https://app.idraft.ai';

export const NAV_LINKS = [
  { label: 'How it works', href: '#how' },
  { label: 'Product', href: '#product' },
  { label: 'Setup', href: '#setup' },
  { label: 'FAQ', href: '#faq' },
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

export const SETUP_STEPS = [
  {
    title: 'Add your site and rivals',
    body: 'Enter your domain and the competitors you watch, then choose the countries and devices that matter.',
  },
  {
    title: 'Add keywords and prompts',
    body: 'Paste or import the keywords you rank for and the questions people ask AI. Group them by topic.',
  },
  {
    title: 'Read one matrix',
    body: 'Rankings and AI answers land on the same rows, so a gap between them is easy to spot and easy to explain.',
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
    q: 'Can I trust the numbers?',
    a: 'Every check is stored with its date. A missed check shows as a gap, never as a guess, and estimates are labeled as estimates.',
  },
  {
    q: 'Who is it for?',
    a: 'SEO and content teams, in-house or at agencies, who are asked what AI search means for their brand and need an answer with evidence.',
  },
  {
    q: 'How do I get access?',
    a: 'We are onboarding teams by invitation. Request access and we will reply with next steps.',
  },
] as const;
