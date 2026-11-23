import type { Route } from 'next';
import { describe, expect, it } from 'vitest';

import type { EngineValue } from './engine-values';
import { heatFileName, heatRows, showsAverage, type HeatLinks, type HeatWords } from './heatmap-model';
import { engineCells, topicRow } from './topic-card-test-kit';
import { buildTopicNodes, topicDescendants } from './topic-nodes';
import { term } from '@/features/prompts/topics-by-engine/cells.test-fixtures';
import type { TopicSummaryRow } from '@/lib/api/types';

const TREE = [
  term('seo', 'SEO'),
  term('tech', 'Technical SEO', 'seo', 'SEO / Technical SEO'),
  term('ads', 'Paid Search'),
];

const percent = (value: number | null): string => (value === null ? 'n/a' : `${String(Math.round(value * 100))}%`);
const WORDS: HeatWords = {
  rowHeader: 'Group',
  promptsHeader: 'Prompts',
  averageHead: (count) => `avg of ${String(count)}`,
  avgLabel: (count) => `avg of ${String(count)}`,
  percent,
  integer: (count) => String(count),
  cellTip: (value: EngineValue) =>
    value.state === 'ok' ? `${percent(value.value)} of ${String(value.answers)}` : value.state,
  cellSubject: (group, platform, value) => `${group} on ${platform}: ${value}`,
  averageSubject: (group, average, value) => `${group}, ${average}: ${value}`,
  averageNone: (group, value) => `${group}, average: ${value}`,
  averageValue: (value, counts, note) => `${value}, ${counts}. ${note}`,
  averageNote: (platforms) => `average of ${platforms}`,
  averageOnly: (platforms) => `${platforms} only`,
  engineCount: (platform, value) => `${platform} ${String(value.answers)}`,
  noAnswers: 'no answers',
  thin: (answers) => `${String(answers)} answers`,
  list: (items) => items.join(' and '),
  notCollected: (group, platform) => `${group} on ${platform}: not collected yet`,
};
const LINKS: HeatLinks = {
  row: (key) => `/ai?topic=${key}` as Route,
  cell: (key, code) => `/ai?topic=${key}&engine=${code}` as Route,
};
const UNAVAILABLE = [{ code: 'google_ai_overview', label: 'AI Overview' }];
const ENGINES = [
  { code: 'chatgpt_web' as const, label: 'ChatGPT' },
  { code: 'gemini_web' as const, label: 'Gemini' },
  { code: 'google_ai_mode' as const, label: 'AI Mode' },
];

const OUTCOMES = { both: [3, 10], named: [2, 10], cited: [1, 10], neither: [4, 10] } as const;

function model(topics: TopicSummaryRow[], measure: 'visibility' | 'mention' = 'visibility') {
  const nodes = buildTopicNodes({
    topics,
    prompts: [],
    tree: TREE,
    descendants: topicDescendants(TREE, []),
    kept: null,
    noTopicName: '',
  });
  return heatRows({ nodes, engines: ENGINES }, { measure }, WORDS, LINKS, UNAVAILABLE);
}

const TOPICS = [
  topicRow('seo', 'SEO', 9, []),
  topicRow('tech', 'Technical SEO', 5, [
    engineCells('chatgpt_web', { mentioned: [6, 10], outcomes: OUTCOMES, prompts: 5 }),
    engineCells('gemini_web', {
      mentioned: [2, 3],
      outcomes: { both: [1, 3], named: [1, 3], cited: [0, 3], neither: [1, 3] },
      prompts: 5,
    }),
    engineCells('google_ai_mode', { mentioned: [0, 0], prompts: 5 }),
  ]),
  topicRow('ads', 'Paid Search', 4, [
    engineCells('chatgpt_web', { mentioned: [4, 10], outcomes: OUTCOMES, prompts: 4 }),
    engineCells('gemini_web', { mentioned: [5, 10], outcomes: OUTCOMES, prompts: 4 }),
    engineCells('google_ai_mode', { mentioned: [0, 0], prompts: 4 }),
  ]),
];

describe('the columns', () => {
  it('are the platforms in order, the platform that is not collected, then the average of the asked ones', () => {
    expect(model(TOPICS).columns.map((column) => column.label)).toEqual([
      'ChatGPT',
      'Gemini',
      'AI Mode',
      'AI Overview',
      'avg of 3',
    ]);
  });

  it('have no average column from one platform', () => {
    expect(showsAverage(1)).toBe(false);
    expect(showsAverage(2)).toBe(true);
  });
});

describe('the rows', () => {
  it('are one per group with no group below it, flat, with its prompts', () => {
    const { rows, total } = model(TOPICS);
    expect(rows.map((row) => row.name)).toEqual(['Technical SEO', 'Paid Search']);
    expect(rows.map((row) => row.prompts)).toEqual(['5', '4']);
    expect(total).toBe(2);
  });

  it('leads each row and platform cell to the group, and the average cell to the group on the chosen platform', () => {
    const [tech] = model(TOPICS).rows;
    expect(tech?.href).toBe('/ai?topic=tech');
    expect(tech?.cells[0]?.href).toBe('/ai?topic=tech&engine=chatgpt_web');
    expect(tech?.cells.at(-1)?.href).toBe('/ai?topic=tech');
  });
});

describe('the cells', () => {
  it('print the rate of the chosen measure with its counts in their words', () => {
    const [tech] = model(TOPICS).rows;
    expect(tech?.cells[0]).toMatchObject({
      state: 'ok',
      text: '60%',
      tip: 'Technical SEO on ChatGPT: 60% of 10',
    });
  });

  it('are hatched under 4 answers with no percent and not clickable', () => {
    const [tech] = model(TOPICS).rows;
    expect(tech?.cells[1]).toMatchObject({ state: 'insufficient', text: '', answers: 3, value: null });
    expect(tech?.cells[1]?.tip).toContain('insufficient');
    expect(tech?.cells[1]?.href).toBeUndefined();
  });

  it('are n/a with no answer, and the platform that is not collected says so and leads nowhere', () => {
    const [tech] = model(TOPICS).rows;
    expect(tech?.cells[2]).toMatchObject({ state: 'none', text: '' });
    expect(tech?.cells[2]?.href).toBeUndefined();
    expect(tech?.cells[3]).toMatchObject({
      state: 'none',
      text: '',
      tip: 'Technical SEO on AI Overview: not collected yet',
    });
    expect(tech?.cells[3]?.href).toBeUndefined();
  });

  it('are not links when they have no rate: a hatched average opens nothing either', () => {
    const [row] = model([
      topicRow('ads', 'Paid Search', 4, [
        engineCells('chatgpt_web', {
          mentioned: [2, 3],
          outcomes: { both: [1, 3], named: [1, 3], cited: [0, 3], neither: [1, 3] },
          prompts: 4,
        }),
        engineCells('gemini_web', { mentioned: [0, 0], prompts: 4 }),
        engineCells('google_ai_mode', { mentioned: [0, 0], prompts: 4 }),
      ]),
    ]).rows;
    expect(row?.cells.map((cell) => cell.href)).toEqual([undefined, undefined, undefined, undefined, undefined]);
    // The group name still opens the group
    expect(row?.href).toBe('/ai?topic=ads');
  });

  it('average the platforms that show a rate, once each, and say which took part', () => {
    const [tech, ads] = model(TOPICS).rows;
    // Technical SEO: only ChatGPT shows a rate, so the average is that platform alone
    expect(tech?.cells[4]?.tip).toContain('ChatGPT only');
    // Paid Search: (0.6 + 0.6) / 2 over ChatGPT and Gemini
    expect(ads?.cells[4]).toMatchObject({ text: '60%' });
    expect(ads?.cells[4]?.tip).toContain('avg of 2');
    expect(ads?.cells[4]?.tip).toContain('ChatGPT and Gemini');
  });

  it('read the mention cells for the mention measure', () => {
    const [tech] = model(TOPICS, 'mention').rows;
    expect(tech?.cells[0]?.text).toBe('60%');
    expect(tech?.cells[1]).toMatchObject({ state: 'insufficient' });
  });
});

describe('the answers', () => {
  it('say whether any group is answered and which asked platform has no valid answer in any', () => {
    const result = model(TOPICS);
    expect(result.answered).toBe(true);
    expect(result.unanswered).toEqual(['AI Mode']);
  });

  it('are none when no outcome holds a valid answer', () => {
    expect(
      model([topicRow('ads', 'Paid Search', 4, [engineCells('chatgpt_web', { mentioned: [0, 0], prompts: 4 })])])
        .answered,
    ).toBe(false);
  });

  it('write the table as numbers with an empty cell and a status where a rate is unknown', () => {
    const { exportTable } = model(TOPICS);
    expect(exportTable.header.slice(0, 5)).toEqual([
      'group',
      'prompts',
      'chatgpt_web_rate',
      'chatgpt_web_answers',
      'chatgpt_web_status',
    ]);
    const [tech] = exportTable.rows;
    expect(tech?.slice(0, 5)).toEqual(['SEO / Technical SEO', 5, 60, 10, 'ok']);
    expect(tech?.slice(8, 11)).toEqual([null, 0, 'no_answers']);
  });
});

describe('names', () => {
  it('tell two groups of one name apart by their path', () => {
    const tree = [
      term('a', 'A'),
      term('a1', 'Pricing', 'a', 'A / Pricing'),
      term('b', 'B'),
      term('b1', 'Pricing', 'b', 'B / Pricing'),
    ];
    const topics = [topicRow('a1', 'Pricing', 3, []), topicRow('b1', 'Pricing', 2, [])];
    const nodes = buildTopicNodes({
      topics,
      prompts: [],
      tree,
      descendants: topicDescendants(tree, []),
      kept: null,
      noTopicName: '',
    });
    expect(
      heatRows({ nodes, engines: ENGINES }, { measure: 'mention' }, WORDS, LINKS, UNAVAILABLE).rows.map(
        (row) => row.name,
      ),
    ).toEqual(['A / Pricing', 'B / Pricing']);
  });

  it('name a group by its path and the file by the measure', () => {
    expect(model(TOPICS).rows[0]?.name).toBe('Technical SEO');
    expect(heatFileName('sov')).toBe('group-heat-map-sov');
  });
});
