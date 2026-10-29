/*
 * Illustrative data for the product mock. Nothing here is a customer or a measurement.
 * Rank series run oldest to newest; a lower number is a better position.
 */

export type KeywordRow = {
  keyword: string;
  rank: number | null; // null: beyond the depth checked
  previous: number | null;
  path: string;
  volume: string;
  difficulty: number;
  intent: 'Commercial' | 'Informational' | 'Transactional';
  features: readonly string[];
  series: readonly number[];
};

export const KEYWORDS: readonly KeywordRow[] = [
  { keyword: 'ai overview tracker', rank: 3, previous: 5, path: '/ai-visibility', volume: '1.9K', difficulty: 38, intent: 'Commercial', features: ['Featured snippet', 'People also ask'], series: [9, 8, 8, 7, 6, 6, 5, 5, 5, 4, 4, 3, 3, 3] },
  { keyword: 'rank tracker for agencies', rank: 2, previous: 2, path: '/product', volume: '3.6K', difficulty: 41, intent: 'Commercial', features: ['People also ask'], series: [4, 4, 3, 3, 3, 2, 3, 2, 2, 2, 2, 2, 2, 2] },
  { keyword: 'ai search visibility', rank: 6, previous: 11, path: '/how-it-works', volume: '2.4K', difficulty: 37, intent: 'Informational', features: ['AI Overview'], series: [19, 17, 16, 15, 14, 12, 12, 11, 10, 9, 8, 7, 6, 6] },
  { keyword: 'how to track ai overviews', rank: 9, previous: 8, path: '/rank-tracking', volume: '880', difficulty: 29, intent: 'Informational', features: ['AI Overview', 'Video'], series: [12, 11, 10, 9, 9, 8, 8, 8, 7, 8, 8, 9, 9, 9] },
  { keyword: 'best seo software', rank: 14, previous: 17, path: '/product', volume: '8.9K', difficulty: 68, intent: 'Commercial', features: ['Shopping'], series: [22, 21, 20, 20, 19, 18, 18, 17, 17, 16, 15, 15, 14, 14] },
  { keyword: 'serp features tracker', rank: 4, previous: 4, path: '/rank-tracking', volume: '1.3K', difficulty: 33, intent: 'Commercial', features: ['Featured snippet'], series: [7, 6, 6, 5, 5, 5, 4, 4, 4, 4, 4, 4, 4, 4] },
  { keyword: 'free rank tracker', rank: null, previous: 24, path: '', volume: '22.2K', difficulty: 72, intent: 'Transactional', features: [], series: [18, 19, 20, 20, 21, 22, 22, 23, 24, 24, 25, 26, 27, 28] },
  { keyword: 'keyword rank checker', rank: 11, previous: 13, path: '/rank-tracking', volume: '14.8K', difficulty: 63, intent: 'Transactional', features: ['People also ask'], series: [20, 19, 18, 17, 16, 15, 15, 14, 14, 13, 13, 12, 11, 11] },
];

export type Engine = 'ChatGPT' | 'Gemini' | 'AI Mode' | 'AI Overview';

export type PromptRow = {
  id: string;
  prompt: string;
  topic: string;
  results: Record<Engine, { named: boolean; position: number | null; cited: boolean }>;
  answer: readonly { text: string; mention?: boolean; rival?: boolean }[];
  sources: readonly { domain: string; own?: boolean }[];
};

export const PROMPTS: readonly PromptRow[] = [
  {
    id: 'p1',
    prompt: 'What are the best SEO tools for agencies?',
    topic: 'Agency software',
    results: {
      ChatGPT: { named: true, position: 2, cited: true },
      Gemini: { named: true, position: 4, cited: false },
      'AI Mode': { named: false, position: null, cited: false },
      'AI Overview': { named: true, position: 3, cited: true },
    },
    answer: [
      { text: 'Agencies usually shortlist ' },
      { text: 'Brightlane', rival: true },
      { text: ', ' },
      { text: 'idraft', mention: true },
      { text: ' and ' },
      { text: 'Gridwise', rival: true },
      { text: ', because they combine daily rank checks with reporting that can be shared with clients. Review sites also point to ' },
      { text: 'idraft', mention: true },
      { text: ' for tracking AI answers next to Google positions.' },
    ],
    sources: [{ domain: 'idraft.ai', own: true }, { domain: 'agencyreview.co' }, { domain: 'searchdaily.com' }, { domain: 'martechnotes.io' }],
  },
  {
    id: 'p2',
    prompt: 'How do I track my brand in ChatGPT answers?',
    topic: 'AI visibility',
    results: {
      ChatGPT: { named: false, position: null, cited: false },
      Gemini: { named: true, position: 1, cited: true },
      'AI Mode': { named: true, position: 2, cited: true },
      'AI Overview': { named: false, position: null, cited: false },
    },
    answer: [
      { text: 'Teams run a fixed set of prompts on a schedule and record whether the brand is named and which sources are cited. ' },
      { text: 'idraft', mention: true },
      { text: ' and ' },
      { text: 'Northpeak', rival: true },
      { text: ' both offer this, with mention rate shown per engine.' },
    ],
    sources: [{ domain: 'idraft.ai', own: true }, { domain: 'searchdaily.com' }, { domain: 'northpeak.app' }],
  },
  {
    id: 'p3',
    prompt: 'Is there a rank tracker that also covers AI Overviews?',
    topic: 'Rank tracking',
    results: {
      ChatGPT: { named: true, position: 3, cited: false },
      Gemini: { named: false, position: null, cited: false },
      'AI Mode': { named: true, position: 1, cited: true },
      'AI Overview': { named: true, position: 2, cited: true },
    },
    answer: [
      { text: 'Yes. ' },
      { text: 'idraft', mention: true },
      { text: ' records the AI Overview as a SERP feature beside the organic rank, while ' },
      { text: 'Gridwise', rival: true },
      { text: ' tracks it as a separate report.' },
    ],
    sources: [{ domain: 'idraft.ai', own: true }, { domain: 'gridwise.io' }, { domain: 'seoweekly.net' }],
  },
];

export const ENGINES: readonly Engine[] = ['ChatGPT', 'Gemini', 'AI Mode', 'AI Overview'];

export type MatrixRow = { topic: string; rank: number | null; mentionRate: number; checks: number; verdict: 'Strong in both' | 'Ranks, not named' | 'Named, not ranking' | 'Neither yet' };

export const MATRIX: readonly MatrixRow[] = [
  { topic: 'AI Overview tracking', rank: 3, mentionRate: 62, checks: 24, verdict: 'Strong in both' },
  { topic: 'Agency reporting', rank: 2, mentionRate: 18, checks: 24, verdict: 'Ranks, not named' },
  { topic: 'AI search visibility', rank: 6, mentionRate: 71, checks: 36, verdict: 'Strong in both' },
  { topic: 'Competitor tracking', rank: 11, mentionRate: 9, checks: 24, verdict: 'Neither yet' },
  { topic: 'Free rank tracker', rank: null, mentionRate: 44, checks: 18, verdict: 'Named, not ranking' },
  { topic: 'SERP features', rank: 4, mentionRate: 15, checks: 18, verdict: 'Ranks, not named' },
];

export type SourceRow = { domain: string; kind: 'Publisher' | 'Review site' | 'Forum' | 'Competitor' | 'You'; citations: number };

export const SOURCES: readonly SourceRow[] = [
  { domain: 'searchdaily.com', kind: 'Publisher', citations: 142 },
  { domain: 'agencyreview.co', kind: 'Review site', citations: 118 },
  { domain: 'idraft.ai', kind: 'You', citations: 96 },
  { domain: 'gridwise.io', kind: 'Competitor', citations: 81 },
  { domain: 'seoweekly.net', kind: 'Publisher', citations: 64 },
  { domain: 'r/bigseo', kind: 'Forum', citations: 52 },
  { domain: 'martechnotes.io', kind: 'Publisher', citations: 37 },
];
