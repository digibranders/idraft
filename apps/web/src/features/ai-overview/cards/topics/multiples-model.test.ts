import { describe, expect, it } from 'vitest';

import { MULTIPLES_EXPORT_HEADER, multiplesFileName, multiplesModel, multiplesPanels } from './multiples-model';
import type { TopicData } from './model-types';
import { engineCells, topicRow, type WeekSpec } from './topic-card-test-kit';
import { buildTopicNodes, topicDescendants } from './topic-nodes';
import type { TrendWords } from './trend-model';
import type { RateTipWords } from '@/lib/charts/rate-tip';

/** The model of the topic small multiples (CH-33): one panel per top level topic, on one engine. */

const RATE_TIP: RateTipWords = {
  value: (ratio) => `${String(Math.round(ratio * 100))}%`,
  answers: (k, n) => `${String(k)} of ${String(n)} answers`,
  interval: (band) => `${String(Math.round(band.low * 100))}% to ${String(Math.round(band.high * 100))}%`,
  prompts: (count) => `${String(count)} prompts`,
  thin: (n) => `${String(n)} answers, too few`,
  pooled: (weeks) => `pooled ${String(weeks)}`,
  noAnswers: 'No answers',
};
const WORDS: TrendWords & { panelName: (topic: string, prompts: number) => string } = {
  rateTip: RATE_TIP,
  share: (value, answers) => `${String(Math.round(value * 100))}% share, ${String(answers)}`,
  pooledTo: (weeks, to) => `${String(weeks)} weeks to ${to}`,
  panelName: (topic, prompts) => `${topic} (${String(prompts)} prompts)`,
};

const WEEKS: WeekSpec[] = [
  { weekStart: '2026-10-19', prompts: 10, mentioned: [4, 20] },
  { weekStart: '2026-10-26', prompts: 5, mentioned: [10, 40], pool: { weeks: 4 } },
];

/** Eight top level topics with 8, 7, ... 1 prompts. Gemini has a series for every one; ChatGPT for none. */
const NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel'] as const;
function nodes() {
  const rows = NAMES.map((name, index) =>
    topicRow(name.toLowerCase(), name, 8 - index, [
      engineCells('chatgpt_web', { mentioned: [3, 12], prompts: 8 - index }),
      engineCells('gemini_web', { mentioned: [3, 12], prompts: 8 - index, series: WEEKS }),
    ]),
  );
  return buildTopicNodes({
    topics: rows,
    prompts: [],
    tree: [],
    descendants: topicDescendants([], []),
    kept: null,
    noTopicName: '',
  });
}

const ENGINES: TopicData['engines'] = [
  { code: 'chatgpt_web', label: 'ChatGPT' },
  { code: 'gemini_web', label: 'Gemini' },
];

describe('multiplesModel', () => {
  it('panels per top topic by prompts', () => {
    const six = multiplesModel({ nodes: nodes(), engines: ENGINES, code: 'gemini_web', count: 6 });
    if (six.state !== 'ok') throw new Error('The engine is asked');
    expect(six.trend.rows.map((row) => row.node.name)).toEqual([
      'Alpha',
      'Bravo',
      'Charlie',
      'Delta',
      'Echo',
      'Foxtrot',
    ]);
    expect(six.trend.total).toBe(8);
    const nine = multiplesModel({ nodes: nodes(), engines: ENGINES, code: 'gemini_web', count: 9 });
    if (nine.state !== 'ok') throw new Error('The engine is asked');
    expect(nine.trend.rows).toHaveLength(8);
    // One engine: one cell in each row
    expect(six.trend.rows.every((row) => row.cells.length === 1 && row.cells[0]?.engine.code === 'gemini_web')).toBe(
      true,
    );
  });

  it('every panel has the engine role of the chosen engine', () => {
    const model = multiplesModel({ nodes: nodes(), engines: ENGINES, code: 'gemini_web', count: 6 });
    if (model.state !== 'ok') throw new Error('The engine is asked');
    const panels = multiplesPanels(model, WORDS);
    expect(panels).toHaveLength(6);
    for (const entry of panels) expect(entry.panel.role).toEqual({ kind: 'palette', index: 2 });
    expect(panels[0]?.panel.name).toBe('Alpha (8 prompts)');
  });

  it('cellText says k of n answers and prompts, and the pooling', () => {
    const model = multiplesModel({ nodes: nodes(), engines: ENGINES, code: 'gemini_web', count: 6 });
    if (model.state !== 'ok') throw new Error('The engine is asked');
    const [first] = multiplesPanels(model, WORDS);
    expect(first?.panel.cellText[0]).toContain('4 of 20 answers');
    expect(first?.panel.cellText[0]).toContain('10 prompts');
    expect(first?.panel.cellText[0]).not.toContain('weeks to');
    expect(first?.panel.cellText[1]).toContain('10 of 40 answers');
    expect(first?.panel.cellText[1]).toContain('4 weeks to 2026-11-12');
  });

  it('an engine not asked is an empty state', () => {
    expect(multiplesModel({ nodes: nodes(), engines: ENGINES, code: 'google_ai_mode', count: 6 })).toEqual({
      state: 'not_asked',
    });
    expect(multiplesModel({ nodes: nodes(), engines: [], code: 'chatgpt_web', count: 6 })).toEqual({
      state: 'not_asked',
    });
  });

  it('an engine with no series in a topic has no points there, not zeros', () => {
    const model = multiplesModel({ nodes: nodes(), engines: ENGINES, code: 'chatgpt_web', count: 6 });
    if (model.state !== 'ok') throw new Error('The engine is asked');
    const [first] = multiplesPanels(model, WORDS);
    expect(first?.hasSeries).toBe(false);
    // No topic sends a series on ChatGPT, so there are no weeks to draw and no point, which is not a point at 0
    expect(first?.panel.points).toEqual([]);
    expect(first?.panel.cellText).toEqual([]);
  });

  it('names the export file and its columns', () => {
    expect(multiplesFileName('gemini_web')).toBe('topic-trends-gemini_web');
    expect(MULTIPLES_EXPORT_HEADER).toEqual(['topic', 'engine', 'week', 'rate_percent', 'answers', 'status']);
  });
});
