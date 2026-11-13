import { describe, expect, it } from 'vitest';

import {
  MAX_WEEKS,
  PROMPT_WEEK_EXPORT_HEADER,
  defaultTopic,
  hasAnyAnswer,
  hasPooledPoint,
  promptWeekExport,
  promptWeekGrid,
  topicChoices,
  type PromptWeekInput,
} from './prompt-week-model';
import type { TopicNode } from '../model-types';
import { topicDescendants } from '../topic-nodes';
import { WINDOW, engineCells, promptRow, type WeekSpec } from '../topic-card-test-kit';
import type { PromptSummaryRow } from '@/lib/api/types';
import type { NamedTerm } from '@/lib/keywords/taxonomy-reads';

/*
 * The model of the prompt by week heat map (CH-12): which prompts, which weeks, and what each cell holds. A cell is
 * the pooled weekly point the API sends for a prompt; the model reads it and never pools. Words are not here.
 */

const CRM = 'crm';
const PRICING = 'pricing';
const SECURITY = 'security';

const TREE: NamedTerm[] = [
  { termId: CRM, name: 'CRM', parentId: null, path: 'CRM' },
  { termId: PRICING, name: 'Pricing', parentId: CRM, path: 'CRM / Pricing' },
  { termId: SECURITY, name: 'Security', parentId: null, path: 'Security' },
];
const DESCENDANTS = topicDescendants(TREE, []);

const W1 = '2026-10-05';
const W2 = '2026-10-12';
const W3 = '2026-10-19';
const W4 = '2026-10-26';
const W5 = '2026-11-02';

type Pair = readonly [number, number];

/** A pooled weekly point of a prompt: k of n answers over `weeks` weeks ending that Monday. */
const week = (weekStart: string, mentioned: Pair, weeks = 4): WeekSpec => ({
  weekStart,
  prompts: 1,
  mentioned,
  pool: { weeks },
});

function prompt(id: string, text: string, topics: string[], series: readonly WeekSpec[] | undefined): PromptSummaryRow {
  return promptRow(id, text, topics, [
    engineCells('chatgpt_web', { mentioned: [1, 2], ...(series === undefined ? {} : { series }) }),
    engineCells('gemini_web', { mentioned: [1, 2] }),
  ]);
}

const input = (prompts: readonly PromptSummaryRow[], over: Partial<PromptWeekInput> = {}): PromptWeekInput => ({
  prompts,
  termId: CRM,
  descendants: DESCENDANTS,
  code: 'chatgpt_web',
  metric: 'mentioned',
  ...over,
});

const ALL = [
  prompt('p1', 'Best CRM for startups', [CRM], [week(W1, [2, 8]), week(W2, [3, 8]), week(W3, [4, 8])]),
  prompt('p2', 'CRM pricing compared', [PRICING], [week(W2, [1, 8]), week(W3, [2, 8])]),
  prompt('p3', 'Is it secure', [SECURITY], [week(W1, [8, 8])]),
  prompt('p4', 'Never filed', [], [week(W1, [8, 8])]),
];

describe('the rows', () => {
  it('rows are the prompts of the topic and below', () => {
    const grid = promptWeekGrid(input(ALL));
    expect(grid.rows.map((row) => row.promptId).sort()).toEqual(['p1', 'p2']);
    // The same topic seen from the child: only its own prompts
    expect(promptWeekGrid(input(ALL, { termId: PRICING })).rows.map((row) => row.promptId)).toEqual(['p2']);
  });

  it('a topic the tree does not hold gives no rows and never every prompt', () => {
    expect(promptWeekGrid(input(ALL, { termId: 'invented' })).rows).toEqual([]);
  });

  it('prompts without a topic are never the rows of a topic', () => {
    const grid = promptWeekGrid(input(ALL, { termId: SECURITY }));
    expect(grid.rows.map((row) => row.promptId)).toEqual(['p3']);
  });

  it('rows ordered by the last value then text', () => {
    const rows = [
      prompt('a', 'Zeta', [CRM], [week(W5, [4, 8])]),
      prompt('b', 'Alpha', [CRM], [week(W5, [4, 8])]),
      prompt('c', 'Low', [CRM], [week(W5, [1, 8])]),
      prompt('d', 'High', [CRM], [week(W5, [7, 8])]),
      // Its newest week is thin and the one before is a rate: the rate is its last value
      prompt('e', 'Earlier', [CRM], [week(W4, [6, 8]), week(W5, [3, 3])]),
      // No rate in any week: last, whichever way the rows run
      prompt('f', 'Aardvark', [CRM], [week(W5, [0, 0])]),
      // A real rate of 0% (0 of 8) is a rate: it ranks before the prompt with no rate, though its text sorts after
      prompt('g', 'Zero', [CRM], [week(W5, [0, 8])]),
    ];
    expect(promptWeekGrid(input(rows)).rows.map((row) => row.text)).toEqual([
      'High',
      'Earlier',
      'Alpha',
      'Zeta',
      'Low',
      'Zero',
      'Aardvark',
    ]);
  });
});

describe('the columns', () => {
  it('columns are the Mondays of the series, at most 14', () => {
    const grid = promptWeekGrid(input(ALL));
    expect(grid.weeks).toEqual([W1, W2, W3]);
    const mondays = Array.from({ length: 16 }, (_, index) => {
      const day = new Date(Date.UTC(2026, 6, 6 + 7 * index));
      return day.toISOString().slice(0, 10);
    });
    const long = promptWeekGrid(
      input([
        prompt(
          'x',
          'Long',
          [CRM],
          mondays.map((monday) => week(monday, [4, 8])),
        ),
      ]),
    );
    expect(MAX_WEEKS).toBe(14);
    expect(long.weeks).toEqual(mondays.slice(2));
  });

  it('the union of the weeks of every prompt, and a prompt lacks the weeks it has no point for', () => {
    const grid = promptWeekGrid(input(ALL));
    const pricing = grid.rows.find((row) => row.promptId === 'p2');
    expect(pricing?.cells.map((cell) => cell?.weekStart ?? null)).toEqual([null, W2, W3]);
  });
});

describe('the cells', () => {
  it('a pooled point carries weeks and window', () => {
    const [row] = promptWeekGrid(input([prompt('x', 'One', [CRM], [week(W4, [5, 8], 4)])])).rows;
    const point = row?.cells[0];
    expect(point).toMatchObject({ weekStart: W4, value: 0.625, k: 5, n: 8, weeks: 4, pooled: true, showsPool: true });
    expect(point?.window).toEqual({ ...WINDOW });
  });

  it('a point under 4 answers is thin with its answers', () => {
    const [row] = promptWeekGrid(input([prompt('x', 'Thin', [CRM], [week(W4, [2, 3])])])).rows;
    expect(row?.cells[0]).toMatchObject({ thin: true, n: 3 });
  });

  it('a week without a valid answer is a gap and never 0', () => {
    const [row] = promptWeekGrid(input([prompt('x', 'Gap', [CRM], [week(W3, [0, 0]), week(W4, [5, 8])])])).rows;
    const gap = row?.cells[0];
    expect(gap?.value).toBeNull();
    expect(gap?.n).toBe(0);
    expect(row?.latest).toBe(0.625);
  });

  it('an engine without a series gives rows without points', () => {
    const rows = [prompt('x', 'With', [CRM], [week(W3, [5, 8])]), prompt('y', 'Without', [CRM], undefined)];
    const grid = promptWeekGrid(input(rows));
    const without = grid.rows.find((row) => row.promptId === 'y');
    expect(without?.cells).toEqual([null]);
    expect(without?.latest).toBeNull();
    // An engine that has no series for any prompt has no weeks and nothing to draw
    const none = promptWeekGrid(input(rows, { code: 'gemini_web' }));
    expect(none.weeks).toEqual([]);
    expect(hasAnyAnswer(none)).toBe(false);
  });

  it('share of voice has no count of successes and says so', () => {
    const series: WeekSpec[] = [{ weekStart: W4, prompts: 1, mentioned: [5, 8], sov: [3, 6], pool: { weeks: 4 } }];
    const [row] = promptWeekGrid(input([prompt('x', 'Share', [CRM], series)], { metric: 'share_of_voice' })).rows;
    expect(row?.cells[0]).toMatchObject({ k: null, n: 6, thin: false });
  });
});

describe('what the card needs to say', () => {
  it('hasAnyAnswer is true when a point has a valid answer, thin or not, and false for gaps only', () => {
    expect(hasAnyAnswer(promptWeekGrid(input(ALL)))).toBe(true);
    expect(hasAnyAnswer(promptWeekGrid(input([prompt('x', 'Gap', [CRM], [week(W3, [0, 0])])])))).toBe(false);
    // Answers under 4 are still answers: the grid shows them hatched with their count
    expect(hasAnyAnswer(promptWeekGrid(input([prompt('x', 'Thin', [CRM], [week(W3, [2, 3])])])))).toBe(true);
  });

  it('weeks are said to be pooled only when a point that shows a rate holds several', () => {
    const own = promptWeekGrid(input([prompt('x', 'Own', [CRM], [week(W3, [5, 8], 1)])]));
    expect(hasPooledPoint(own)).toBe(false);
    const many = promptWeekGrid(input([prompt('x', 'Many', [CRM], [week(W3, [5, 8], 1), week(W4, [5, 8], 4)])]));
    expect(hasPooledPoint(many)).toBe(true);
  });
});

describe('the export', () => {
  it('writes one row per prompt and week, an empty rate and a status where it is unknown, never 0', () => {
    const grid = promptWeekGrid(
      input([prompt('x', 'Export', [CRM], [week(W2, [0, 0]), week(W3, [2, 3]), week(W4, [5, 8])])]),
    );
    const table = promptWeekExport(grid);
    expect(table.header).toEqual([...PROMPT_WEEK_EXPORT_HEADER]);
    expect(table.header.slice(0, 2)).toEqual(['prompt', 'week_start']);
    const byWeek = new Map(table.rows.map((row) => [row[1], row]));
    const [, , rate, successes, answers, weeks, status] = byWeek.get(W4) ?? [];
    expect([rate, successes, answers, weeks, status]).toEqual([62.5, 5, 8, 4, 'ok']);
    expect(byWeek.get(W3)?.slice(2)).toEqual([null, 2, 3, 4, 'insufficient']);
    expect(byWeek.get(W2)?.slice(2)).toEqual([null, null, 0, 4, 'no_answers']);
  });

  it('a week a prompt has no point for is an empty row of the grid with a status', () => {
    const grid = promptWeekGrid(input(ALL));
    const table = promptWeekExport(grid);
    const missing = table.rows.find((row) => row[0] === 'CRM pricing compared' && row[1] === W1);
    expect(missing?.slice(2)).toEqual([null, null, 0, null, 'no_answers']);
    expect(table.rows).toHaveLength(grid.rows.length * grid.weeks.length);
  });
});

describe('the topics to choose from', () => {
  const node = (key: string | null, name: string, promptCount: number, children: TopicNode[] = []): TopicNode => ({
    key: key ?? '__none',
    termId: key,
    name,
    path: [name],
    parentKey: null,
    level: 1,
    promptCount,
    engines: [],
    members: null,
    lastValidAt: null,
    children,
  });
  const child = (key: string, name: string, promptCount: number, parent: string): TopicNode => ({
    ...node(key, name, promptCount),
    path: [parent, name],
    parentKey: parent,
    level: 2,
  });
  const NODES = [
    node(CRM, 'CRM', 5, [child(PRICING, 'Pricing', 2, 'CRM')]),
    node(SECURITY, 'Security', 3),
    node(null, 'Prompts without a topic', 9),
  ];

  it('are the real topics, each followed by its children, and never the prompts without a topic', () => {
    expect(topicChoices(NODES)).toEqual([
      { key: CRM, label: 'CRM' },
      { key: PRICING, label: 'CRM / Pricing' },
      { key: SECURITY, label: 'Security' },
    ]);
  });

  it('the default is the scope topic, else the topic with the most prompts', () => {
    const choices = topicChoices(NODES);
    expect(defaultTopic(choices, NODES, PRICING)).toBe(PRICING);
    expect(defaultTopic(choices, NODES, null)).toBe(CRM);
    // A scope topic that is not among the choices is not a topic of this card
    expect(defaultTopic(choices, NODES, 'gone')).toBe(CRM);
    expect(defaultTopic([], [], null)).toBeNull();
  });
});
