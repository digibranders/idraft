import { describe, expect, it } from 'vitest';

import type { TopicData } from './model-types';
import { engineCells, topicRow, type TermSpec, type WeekSpec } from './topic-card-test-kit';
import { buildTopicNodes, topicDescendants } from './topic-nodes';
import {
  buildTrend,
  chartPoint,
  ceilingOf,
  pointText,
  trendExportRows,
  trendPanels,
  TREND_EXPORT_HEADER,
  weekLabels,
  type TrendWords,
} from './trend-model';
import { rateCeilingOf } from '@/components/app/chart/small-multiples';
import type { RateTipWords } from '@/lib/charts/rate-tip';
import type { NamedTerm } from '@/lib/keywords/taxonomy-reads';

/*
 * The model of the topic trends (CH-45) as plain data: which topics, which weeks, which points, and the one ceiling.
 * The words come in as arguments, so these tests read what the model decides and not how English is written.
 */

const TERMS: readonly TermSpec[] = [
  { id: 'seo', name: 'SEO tools', parent: null },
  { id: 'email', name: 'Email', parent: null },
  { id: 'crm', name: 'CRM', parent: null },
  { id: 'pricing', name: 'Pricing', parent: null },
  { id: 'support', name: 'Support', parent: null },
  { id: 'startups', name: 'Startups', parent: 'crm' },
];
const TREE: NamedTerm[] = TERMS.map((term) => ({
  termId: term.id,
  name: term.name,
  parentId: term.parent,
  path: term.name,
}));

const ENGINES: TopicData['engines'] = [
  { code: 'chatgpt_web', label: 'ChatGPT' },
  { code: 'gemini_web', label: 'Gemini' },
];

const RATE_TIP: RateTipWords = {
  value: (ratio) => `${String(Math.round(ratio * 100))}%`,
  answers: (k, n) => `${String(k)} of ${String(n)} answers`,
  interval: (band) => `${String(Math.round(band.low * 100))}% to ${String(Math.round(band.high * 100))}%`,
  prompts: (count) => `${String(count)} prompts`,
  thin: (n) => `${String(n)} answers, too few`,
  pooled: (weeks) => `pooled ${String(weeks)}`,
  noAnswers: 'No answers',
};
const WORDS: TrendWords = {
  rateTip: RATE_TIP,
  share: (value, answers) => `${String(Math.round(value * 100))}% share, ${String(answers)} answers name a brand`,
  pooledTo: (weeks, to) => `${String(weeks)} weeks to ${to}`,
};

const W1 = '2026-10-19';
const W2 = '2026-10-26';
const W3 = '2026-11-02';
const W4 = '2026-11-09';

/** Four weeks: a good one, a thin one (3 answers), one with no valid answer, and one pooled over 4 weeks. */
const SEO_WEEKS: WeekSpec[] = [
  { weekStart: W1, prompts: 10, mentioned: [4, 20] },
  { weekStart: W2, prompts: 3, mentioned: [1, 3] },
  { weekStart: W3, prompts: 9, mentioned: [0, 0] },
  { weekStart: W4, prompts: 5, mentioned: [10, 40], pool: { weeks: 4 } },
];
const EMAIL_WEEKS: WeekSpec[] = [
  { weekStart: '2026-10-12', prompts: 8, mentioned: [5, 10] },
  { weekStart: W1, prompts: 8, mentioned: [25, 50], sov: [20, 50] },
  { weekStart: W4, prompts: 8, mentioned: [30, 50], sov: [10, 50] },
];

function nodes(count = 5) {
  const rows = [
    topicRow('seo', 'SEO tools', 12, [
      engineCells('chatgpt_web', { mentioned: [15, 63], prompts: 12, series: SEO_WEEKS }),
      engineCells('gemini_web', { mentioned: [8, 40], prompts: 12, series: SEO_WEEKS }),
    ]),
    topicRow('email', 'Email', 8, [
      engineCells('chatgpt_web', { mentioned: [60, 110], prompts: 8, series: EMAIL_WEEKS }),
      // Gemini sends no series for Email: it has no weekly points, which is not a row of zeros
      engineCells('gemini_web', { mentioned: [30, 50], prompts: 8 }),
    ]),
    topicRow('crm', 'CRM', 6, [engineCells('chatgpt_web', { mentioned: [3, 12], prompts: 6, series: SEO_WEEKS })]),
    topicRow('pricing', 'Pricing', 6, [
      engineCells('chatgpt_web', { mentioned: [3, 12], prompts: 6, series: SEO_WEEKS }),
    ]),
    topicRow('support', 'Support', 2, [
      engineCells('chatgpt_web', { mentioned: [3, 12], prompts: 2, series: SEO_WEEKS }),
    ]),
    // More prompts than any top level topic, and below one: it must not be a panel row
    topicRow('startups', 'Startups', 20, [
      engineCells('chatgpt_web', { mentioned: [3, 12], prompts: 20, series: SEO_WEEKS }),
    ]),
  ];
  return {
    all: buildTopicNodes({
      topics: rows,
      prompts: [],
      tree: TREE,
      descendants: topicDescendants(TREE, []),
      kept: null,
      noTopicName: '',
    }),
    count,
  };
}

const trendOf = (count = 5, metric: 'mentioned' | 'share_of_voice' | 'cited' = 'mentioned') =>
  buildTrend({ nodes: nodes().all, engines: ENGINES, metric, count });

describe('buildTrend', () => {
  it('top N topics by prompts then name, top level only', () => {
    const model = trendOf(3);
    // Startups (20 prompts) is below CRM; CRM and Pricing tie on 6 prompts and the name decides
    expect(model.rows.map((row) => row.node.name)).toEqual(['SEO tools', 'Email', 'CRM']);
    expect(model.total).toBe(5);
    expect(trendOf(6).rows.map((row) => row.node.name)).toEqual(['SEO tools', 'Email', 'CRM', 'Pricing', 'Support']);
  });

  it('one cell per asked engine in the order given', () => {
    const [first] = trendOf(3).rows;
    expect(first?.cells.map((cell) => cell.engine.code)).toEqual(['chatgpt_web', 'gemini_web']);
  });

  it('a week without a valid answer is a gap', () => {
    const seo = trendOf(3).rows[0]?.cells[0]?.points;
    // The weeks are those of every series: Email starts a week earlier, so SEO tools has no point in the first
    expect(seo?.[0]).toBeNull();
    const gap = seo?.[3];
    expect(gap?.weekStart).toBe(W3);
    expect(gap?.value).toBeNull();
    expect(chartPoint(gap ?? null, 'mentioned', WORDS)).toBeNull();
    // The week the engine has no point for at all is a gap too
    const email = trendOf(3).rows[1]?.cells[0]?.points;
    expect(email?.map((point) => point?.value ?? null)).toEqual([0.5, 0.5, null, null, 0.6]);
    expect(chartPoint(email?.[2] ?? null, 'mentioned', WORDS)).toBeNull();
  });

  it('a thin point is hollow with no band', () => {
    const [, good, thin] = trendOf(3).rows[0]?.cells[0]?.points ?? [];
    expect(chartPoint(thin ?? null, 'mentioned', WORDS)).toMatchObject({ thin: true, band: null });
    expect(chartPoint(thin ?? null, 'mentioned', WORDS)?.value).toBeCloseTo(1 / 3);
    expect(chartPoint(thin ?? null, 'mentioned', WORDS)?.tip).toBe('3 answers, too few');
    expect(chartPoint(good ?? null, 'mentioned', WORDS)?.thin).toBe(false);
    expect(chartPoint(good ?? null, 'mentioned', WORDS)?.band).not.toBeNull();
  });

  it('a pooled point carries its weeks and window', () => {
    const pooled = trendOf(3).rows[0]?.cells[0]?.points?.[4];
    expect(pooled).toMatchObject({ pooled: true, weeks: 4, showsPool: true });
    expect(pooled?.window).toEqual({ from: '2026-10-16', to: '2026-11-12', timezone: 'UTC' });
    const tip = chartPoint(pooled ?? null, 'mentioned', WORDS)?.tip ?? '';
    expect(tip).toContain('10 of 40 answers');
    expect(tip).toContain('4 weeks to 2026-11-12');
    // A week that stands alone says nothing of pooling
    expect(chartPoint(trendOf(3).rows[0]?.cells[0]?.points?.[1] ?? null, 'mentioned', WORDS)?.tip).not.toContain(
      'weeks to',
    );
  });

  it('an engine without a series has no points (not zeros)', () => {
    const model = trendOf(3);
    const cell = model.rows[1]?.cells[1];
    expect(cell?.engine.code).toBe('gemini_web');
    expect(cell?.points).toBeNull();
    const panel = trendPanels(model, 'mentioned', WORDS, (row, c) => `${row.node.name}, ${c.engine.label}`).find(
      (entry) => entry.cell === cell,
    );
    expect(panel?.hasSeries).toBe(false);
    expect(panel?.panel.points).toEqual(model.weeks.map(() => null));
    expect(panel?.panel.cellText).toEqual(model.weeks.map(() => null));
  });

  it('the weeks are the union of every series, oldest first', () => {
    // Email on ChatGPT starts a week earlier than the others and has no point for Oct 26 or Nov 2
    expect(trendOf(3).weeks).toEqual(['2026-10-12', W1, W2, W3, W4]);
    expect(weekLabels(['2026-10-12', W1, '2027-01-04'])).toEqual(['Oct 12, 2026', 'Oct 19', 'Jan 4, 2027']);
  });

  it('share of voice has no count and no band, and says the answers that name a brand', () => {
    const point = trendOf(3, 'share_of_voice').rows[1]?.cells[0]?.points?.[1];
    expect(point?.k).toBeNull();
    const drawn = chartPoint(point ?? null, 'share_of_voice', WORDS);
    expect(drawn?.band).toBeNull();
    expect(drawn?.tip).toContain('answers name a brand');
    expect(drawn?.tip).not.toContain('of 50 answers');
    expect(pointText(point ?? null, 'share_of_voice', WORDS)).toBe(drawn?.tip);
  });
});

describe('trendPanels', () => {
  const nameOf = (row: { node: { name: string } }, cell: { engine: { label: string } }): string =>
    `${row.node.name}, ${cell.engine.label}`;

  it('one ceiling for every panel', () => {
    const model = trendOf(3);
    const panels = trendPanels(model, 'mentioned', WORDS, nameOf);
    expect(panels).toHaveLength(6);
    const ceiling = ceilingOf(panels);
    expect(ceiling).toBe(rateCeilingOf(panels.map((entry) => entry.panel)));
    // The first panel is the lowest: a ceiling worked out from it alone would be lower, and so would not fit the others
    const first = panels[0]?.panel;
    expect(first).toBeDefined();
    expect(rateCeilingOf(first === undefined ? [] : [first])).toBeLessThan(ceiling);
    for (const entry of panels) {
      for (const point of entry.panel.points) {
        expect(point?.band?.high ?? point?.value ?? 0).toBeLessThanOrEqual(ceiling);
      }
    }
  });

  it('every panel has the colour of its engine and a name that says topic and engine', () => {
    const panels = trendPanels(trendOf(3), 'mentioned', WORDS, nameOf);
    expect(panels.map((entry) => entry.panel.name)).toEqual([
      'SEO tools, ChatGPT',
      'SEO tools, Gemini',
      'Email, ChatGPT',
      'Email, Gemini',
      'CRM, ChatGPT',
      'CRM, Gemini',
    ]);
    expect(panels[0]?.panel.role).toEqual({ kind: 'brand' });
    expect(panels[1]?.panel.role).toEqual({ kind: 'palette', index: 2 });
  });

  it('the words of a week are the tooltip words: k of n answers and prompts', () => {
    const panel = trendPanels(trendOf(3), 'mentioned', WORDS, nameOf)[0]?.panel;
    // The first week is Email's alone: SEO tools has no point in it
    expect(panel?.cellText[0]).toBeNull();
    expect(panel?.cellText[1]).toContain('4 of 20 answers');
    expect(panel?.cellText[1]).toContain('10 prompts');
    expect(panel?.cellText[2]).toBe('3 answers, too few');
    expect(panel?.cellText[3]).toBeNull();
  });
});

describe('trendExportRows', () => {
  it('writes a row per topic, engine and week, an empty rate with a status for an unknown, never 0', () => {
    const model = trendOf(3);
    expect(TREND_EXPORT_HEADER).toEqual(['topic', 'engine', 'week', 'rate_percent', 'answers', 'status']);
    const rows = trendExportRows(model);
    expect(rows).toHaveLength(3 * 2 * model.weeks.length);
    expect(rows).toContainEqual(['SEO tools', 'chatgpt_web', W1, 20, 20, 'ok']);
    expect(rows).toContainEqual(['SEO tools', 'chatgpt_web', W2, null, 3, 'insufficient']);
    expect(rows).toContainEqual(['SEO tools', 'chatgpt_web', W3, null, 0, 'no_answers']);
    expect(rows).toContainEqual(['Email', 'gemini_web', W1, null, 0, 'no_series']);
    expect(rows.filter((row) => row[3] === 0)).toEqual([]);
  });
});
