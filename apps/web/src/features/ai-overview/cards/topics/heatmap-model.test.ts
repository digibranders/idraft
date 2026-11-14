import type { Route } from 'next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { engineValue } from './engine-values';
import { heatFileName, heatRows, type HeatLinks, type HeatOptions, type HeatWords } from './heatmap-model';
import type { TopicData, TopicNode } from './model-types';
import { engineCells, topicRow, type TermSpec } from './topic-card-test-kit';
import { buildTopicNodes, NO_TOPIC, topicDescendants } from './topic-nodes';
import { engineValue as engineValueOfWp20 } from '@/features/prompts/topics-by-engine/engine-values';
import type { PromptsSummary } from '@/lib/api/types';
import type { NamedTerm } from '@/lib/keywords/taxonomy-reads';
import type { CellMetric } from '@/lib/rates/rate-model';
import { setAiSeeded } from '@/mocks/ai-seed';
import { EVENTUS_WORLD } from '@/mocks/ai-prompt-world';
import { MOCK_WORKSPACE } from '@/mocks/fixtures';
import { dataOf, mockBrowser } from '@/test/mock-api';

/*
 * The model of the topic heat map (CH-04, CH-40): rows, columns, cells, the cut, the CSV and the export block, as
 * plain data. The words and the links come in as arguments, so these tests read what the model decides and not how
 * English is written.
 */

const CRM = 'crm';
const PRICING = 'pricing';
const SECURITY = 'security';
const SUPPORT = 'support';

const TERMS: readonly TermSpec[] = [
  { id: CRM, name: 'CRM', parent: null },
  { id: PRICING, name: 'Pricing', parent: CRM },
  { id: SECURITY, name: 'Security', parent: null },
  { id: SUPPORT, name: 'Support', parent: null },
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

/** Counts are `[k, n]`. Topic cells weight prompts, as the API sends them. */
const rows = [
  topicRow(CRM, 'CRM', 17, [
    engineCells('chatgpt_web', { mentioned: [64, 136], sov: [30, 80], prompts: 17 }),
    engineCells('gemini_web', { mentioned: [30, 100], sov: [10, 60], prompts: 17 }),
  ]),
  topicRow(PRICING, 'Pricing', 6, [
    engineCells('chatgpt_web', { mentioned: [0, 0], prompts: 6 }),
    engineCells('gemini_web', { mentioned: [12, 40], prompts: 6 }),
  ]),
  topicRow(SECURITY, 'Security', 9, [
    engineCells('chatgpt_web', { mentioned: [8, 10], prompts: 9 }),
    engineCells('gemini_web', { mentioned: [18, 50], prompts: 9 }),
  ]),
  topicRow(SUPPORT, 'Support', 4, [
    engineCells('chatgpt_web', { mentioned: [2, 3], prompts: 4 }),
    engineCells('gemini_web', { mentioned: [8, 20], prompts: 4 }),
  ]),
  topicRow(null, null, 3, [
    engineCells('chatgpt_web', { mentioned: [0, 0], prompts: 3 }),
    engineCells('gemini_web', { mentioned: [4, 10], prompts: 3 }),
  ]),
];

function nodesOf(source: typeof rows, tree: readonly NamedTerm[] = TREE): TopicNode[] {
  return buildTopicNodes({
    topics: source,
    prompts: [],
    tree,
    descendants: topicDescendants(tree, []),
    kept: null,
    noTopicName: '',
  });
}

const WORDS: HeatWords = {
  noTopic: 'No topic',
  rowHeader: 'Topic',
  promptsHeader: 'Prompts',
  averageHead: (count) => `avg of ${String(count)}`,
  avgLabel: (count) => (count === 1 ? '1 engine' : `avg of ${String(count)}`),
  percent: (value) => (value === null ? 'n/a' : `${String(Math.round(value * 100))}%`),
  integer: (count) => String(count),
  // The model hands the counted flag over: the tip records it so a test can read it back
  cellTip: (value, counted) =>
    `${value.state}:${String(value.successes)}/${String(value.answers)}:${counted ? 'counted' : 'share'}`,
  cellSubject: (topic, engine, value) => `${topic} on ${engine}: ${value}`,
  averageSubject: (topic, average, value) => `${topic}, ${average}: ${value}`,
  averageNone: (topic, value) => `${topic}, average of the engines: ${value}`,
  averageValue: (percent, counts, note) => `${percent}, ${counts}. ${note}`,
  averageNote: (engines) => `Equal weight average of ${engines}`,
  averageOnly: (engines) => `${engines} only`,
  engineCount: (engine, value) => `${engine} ${String(value.answers)}`,
  noAnswers: 'no answers',
  thin: (answers) => `${String(answers)} answers`,
  list: (items) => items.join(' and '),
};

const LINKS: HeatLinks = {
  row: (key) => `/topic/${key}` as Route,
  cell: (key, code) => `/topic/${key}/${code}` as Route,
};

const OPTIONS: HeatOptions = { metric: 'mention', level: 'top', sort: 'prompts', rows: 10 };

const run = (over: Partial<HeatOptions> = {}, nodes: readonly TopicNode[] = nodesOf(rows), links = LINKS) =>
  heatRows({ nodes, engines: ENGINES }, { ...OPTIONS, ...over }, WORDS, links);

const ids = (list: readonly { id: string }[]): string[] => list.map((row) => row.id);

describe('rows and the level', () => {
  it('level top gives the top level topics with no children and the no topic row last', () => {
    const model = run();
    expect(ids(model.rows)).toEqual([CRM, SECURITY, SUPPORT, NO_TOPIC]);
    expect(model.rows.every((row) => row.children === undefined)).toBe(true);
    expect(model.rows.at(-1)?.name).toBe('No topic');
  });

  it('level all gives a topic its second level topics as children, in the order asked', () => {
    const model = run({ level: 'all' });
    expect(model.rows.find((row) => row.id === CRM)?.children?.map((child) => child.id)).toEqual([PRICING]);
    expect(model.rows.find((row) => row.id === SECURITY)?.children).toBeUndefined();
  });

  it('the prompts column holds the prompt count as text', () => {
    expect(run().rows.map((row) => row.prompts)).toEqual(['17', '9', '4', '3']);
  });

  it('a row of the topic filter keeps only its topic and the ones below it', () => {
    const kept = buildTopicNodes({
      topics: rows,
      prompts: [],
      tree: TREE,
      descendants: topicDescendants(TREE, []),
      kept: new Set([CRM, PRICING]),
      noTopicName: '',
    });
    expect(ids(run({}, kept).rows)).toEqual([CRM]);
  });
});

describe('the order', () => {
  it('sort by prompts, rate and gap orders the rows and the no topic row stays last', () => {
    // Average rate: Security 58%, Support 40% (one engine has a rate), CRM 39%; the no topic row has 40% and still comes last
    expect(ids(run({ sort: 'prompts' }).rows)).toEqual([CRM, SECURITY, SUPPORT, NO_TOPIC]);
    expect(ids(run({ sort: 'rate' }).rows)).toEqual([SECURITY, SUPPORT, CRM, NO_TOPIC]);
    // Gap: Security 44 points, CRM 17, Support has one engine with a rate and so no gap
    expect(ids(run({ sort: 'gap' }).rows)).toEqual([SECURITY, CRM, SUPPORT, NO_TOPIC]);
  });

  it('level all orders the children in the same way', () => {
    const tree: NamedTerm[] = [...TREE, { termId: 'billing', name: 'Billing', parentId: CRM, path: 'CRM / Billing' }];
    const withBilling = [
      ...rows,
      topicRow('billing', 'Billing', 2, [
        engineCells('chatgpt_web', { mentioned: [9, 10], prompts: 2 }),
        engineCells('gemini_web', { mentioned: [9, 10], prompts: 2 }),
      ]),
    ];
    const model = run({ level: 'all', sort: 'rate' }, nodesOf(withBilling, tree));
    // Billing 90% before Pricing, which has one engine with a rate (30%)
    expect(model.rows.find((row) => row.id === CRM)?.children?.map((child) => child.id)).toEqual(['billing', PRICING]);
  });
});

describe('the cut', () => {
  it('rows cuts to N rows and says the total and how many are shown', () => {
    const model = run({ rows: 2 });
    expect(ids(model.rows)).toEqual([CRM, SECURITY]);
    expect(model).toMatchObject({ total: 4, shown: 2 });
  });

  it('a cut larger than the rows shows them all', () => {
    expect(run({ rows: 20 })).toMatchObject({ total: 4, shown: 4 });
  });

  it('the cut keeps the order asked', () => {
    expect(ids(run({ rows: 2, sort: 'rate' }).rows)).toEqual([SECURITY, SUPPORT]);
  });
});

describe('the columns', () => {
  it('one column per asked engine, then the average from two engines', () => {
    expect(run().columns).toEqual([
      { id: 'chatgpt_web', label: 'ChatGPT', engine: 'chatgpt_web' },
      { id: 'gemini_web', label: 'Gemini', engine: 'gemini_web' },
      { id: 'average', label: 'avg of 2', engine: null },
    ]);
  });

  it('three asked engines give three columns, then avg of 3, and a cell of each per row', () => {
    const three = [...ENGINES, { code: 'google_ai_mode', label: 'AI Mode' }] as const;
    const model = heatRows({ nodes: nodesOf(rows), engines: three }, OPTIONS, WORDS, LINKS);
    expect(model.columns.map((column) => column.label)).toEqual(['ChatGPT', 'Gemini', 'AI Mode', 'avg of 3']);
    expect(model.rows.every((row) => row.cells.length === 4)).toBe(true);
    // AI Mode has no cells in any row: it is named, and its cells are no answer
    expect(model.unanswered).toEqual(['AI Mode']);
    expect(model.rows[0]?.cells[2]).toMatchObject({ state: 'none', text: '' });
  });

  it('one asked engine has no average column and no average cell', () => {
    const model = heatRows(
      { nodes: nodesOf(rows), engines: [{ code: 'chatgpt_web', label: 'ChatGPT' }] },
      OPTIONS,
      WORDS,
      LINKS,
    );
    expect(model.columns.map((column) => column.id)).toEqual(['chatgpt_web']);
    expect(model.rows.every((row) => row.cells.length === 1)).toBe(true);
  });
});

describe('a cell', () => {
  const cellOf = (rowId: string, column: 0 | 1 | 2, over: Partial<HeatOptions> = {}) => {
    const cell = run(over).rows.find((row) => row.id === rowId)?.cells[column];
    if (cell === undefined) throw new Error(`no cell ${rowId} ${String(column)}`);
    return cell;
  };

  it('an ok cell prints its percent and links to the topic on that engine', () => {
    const cell = cellOf(CRM, 0);
    expect(cell).toMatchObject({ state: 'ok', text: '47%', answers: 136, href: `/topic/${CRM}/chatgpt_web` });
    expect(cell.value).toBeCloseTo(64 / 136);
  });

  it('a cell under 4 answers has no percent and no value, and keeps its answers and its link', () => {
    expect(cellOf(SUPPORT, 0)).toMatchObject({
      state: 'insufficient',
      text: '',
      value: null,
      answers: 3,
      href: `/topic/${SUPPORT}/chatgpt_web`,
    });
  });

  it('a cell with no answers has no percent, no value and no link, and is never 0', () => {
    const cell = cellOf(NO_TOPIC, 0);
    expect(cell).toMatchObject({ state: 'none', text: '', value: null, answers: 0 });
    expect(cell.href).toBeUndefined();
  });

  it('the tip is the subject and the words of the value, with the counted flag of the metric', () => {
    expect(cellOf(CRM, 0).tip).toBe('CRM on ChatGPT: ok:64/136:counted');
    expect(cellOf(CRM, 0, { metric: 'share_of_voice' }).tip).toBe('CRM on ChatGPT: ok:null/80:share');
  });

  it('a link that cannot be made (null) leaves the cell and the row as text', () => {
    const none: HeatLinks = { row: () => null, cell: () => null };
    const model = run({}, nodesOf(rows), none);
    expect(model.rows[0]?.href).toBeUndefined();
    expect(model.rows[0]?.cells[0]?.href).toBeUndefined();
  });

  it('the name of a row links to the topic drawer', () => {
    expect(run().rows[0]?.href).toBe(`/topic/${CRM}`);
  });

  it('the average is the equal weight of the engines with a rate and says how many', () => {
    const cell = cellOf(CRM, 2);
    expect(cell.state).toBe('ok');
    expect(cell.text).toBe('39%');
    expect(cell.tip).toMatch(
      /^CRM, avg of 2: 39%, ChatGPT 136 and Gemini 100\. Equal weight average of ChatGPT and Gemini$/,
    );
  });

  it('an average over one engine with a rate says that engine only', () => {
    const cell = cellOf(SUPPORT, 2);
    expect(cell.text).toBe('40%');
    expect(cell.tip).toMatch(/^Support, 1 engine: 40%, Gemini 20\. Gemini only$/);
  });

  it('an average with no engine that has a rate has no percent and says why', () => {
    const empty = run(
      {},
      nodesOf([topicRow(SECURITY, 'Security', 1, [engineCells('gemini_web', { mentioned: [0, 0] })])]),
    );
    const none = empty.rows[0]?.cells[2];
    expect(none).toMatchObject({ state: 'none', text: '', value: null });
    expect(none?.tip).toBe('Security, average of the engines: no answers');
  });
});

describe('the table and the CSV', () => {
  it('the CSV has the words of each cell, n/a where there is no answer, and the children after their parent', () => {
    const model = run({ level: 'all' });
    expect(model.csv.header).toEqual(['Topic', 'Prompts', 'ChatGPT', 'Gemini', 'avg of 2']);
    const crm = model.csv.rows.find((row) => row[0] === 'CRM');
    expect(crm).toEqual([
      'CRM',
      '17',
      model.rows[0]?.cells[0]?.tip,
      model.rows[0]?.cells[1]?.tip,
      model.rows[0]?.cells[2]?.tip,
    ]);
    const names = model.csv.rows.map((row) => row[0]);
    expect(names.indexOf('CRM / Pricing')).toBe(names.indexOf('CRM') + 1);
    // Pricing on ChatGPT has no answer: the CSV says n/a, never 0
    expect(model.csv.rows[names.indexOf('CRM / Pricing')]?.[2]).toBe('n/a');
  });

  it('the export block writes an unknown rate as an empty cell with a status, never 0', () => {
    const model = run({ level: 'all' });
    expect(model.exportTable.header).toEqual([
      'topic',
      'level',
      'prompts',
      'chatgpt_web_rate',
      'chatgpt_web_answers',
      'chatgpt_web_status',
      'gemini_web_rate',
      'gemini_web_answers',
      'gemini_web_status',
      'average_rate',
      'average_engines',
      'average_status',
    ]);
    const byName = new Map(model.exportTable.rows.map((row) => [String(row[0]), row]));
    expect(byName.get('CRM')?.slice(0, 9)).toEqual(['CRM', 1, 17, 47.06, 136, 'ok', 30, 100, 'ok']);
    // Support on ChatGPT has 3 answers: no rate, the answers it has, and the status that says why
    expect(byName.get('Support')?.slice(3, 6)).toEqual([null, 3, 'insufficient']);
    // The no topic row has no answer on ChatGPT
    expect(byName.get('No topic')?.slice(3, 6)).toEqual([null, 0, 'no_answers']);
    expect(byName.get('Pricing')?.[1]).toBe(2);
    // Whatever the engine, a rate is written only beside the status ok
    for (const row of model.exportTable.rows) {
      for (const at of [3, 6, 9]) expect(row[at] === null ? row[at + 2] !== 'ok' : row[at + 2] === 'ok').toBe(true);
    }
  });

  it('the menu file is named for the metric', () => {
    expect(heatFileName('mention')).toBe('topic-heat-map-mention');
    expect(heatFileName('share_of_voice')).toBe('topic-heat-map-share_of_voice');
  });

  it('the export block holds the rows shown, not the ones the cut left out', () => {
    expect(run({ rows: 2 }).exportTable.rows.map((row) => row[0])).toEqual(['CRM', 'Security']);
  });
});

describe('what the engines have', () => {
  it('says whether any cell has a valid answer', () => {
    expect(run().answered).toBe(true);
    const silent = nodesOf([topicRow(SECURITY, 'Security', 1, [engineCells('gemini_web', { mentioned: [0, 0] })])]);
    expect(run({}, silent).answered).toBe(false);
  });

  it('names the asked engines that have no valid answer in any row', () => {
    const onlyGemini = nodesOf([
      topicRow(SECURITY, 'Security', 5, [
        engineCells('chatgpt_web', { mentioned: [0, 0], prompts: 5 }),
        engineCells('gemini_web', { mentioned: [9, 10], prompts: 5 }),
      ]),
    ]);
    expect(run({}, onlyGemini).unanswered).toEqual(['ChatGPT']);
    expect(run().unanswered).toEqual([]);
  });

  it('an engine with only a thin cell is not named: it has answers', () => {
    const thin = nodesOf([
      topicRow(SECURITY, 'Security', 5, [
        engineCells('chatgpt_web', { mentioned: [1, 2], prompts: 5 }),
        engineCells('gemini_web', { mentioned: [9, 10], prompts: 5 }),
      ]),
    ]);
    expect(run({}, thin).unanswered).toEqual([]);
  });
});

/** Thursday 12 November 2026, noon UTC: the Thursday run of 02:00 has answered. */
const NOW = Date.parse('2026-11-12T12:00:00Z');
const SUMMARY = z.custom<PromptsSummary>(
  (value) => typeof value === 'object' && value !== null && 'prompts' in value && 'topics' in value,
);

describe('against the WP-20 engine values', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockImplementation(() => NOW);
    setAiSeeded(true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    setAiSeeded(false);
  });

  it('values equal the WP-20 engine values for every topic and engine of the Eventus summary', async () => {
    const path = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}/projects/${EVENTUS_WORLD.projectId}/ai/prompts-summary`;
    const answer = await mockBrowser('viewer').call('GET', `${path}?from=2026-10-16&to=2026-11-12`);
    const summary = dataOf(answer, SUMMARY);
    const tree: NamedTerm[] = EVENTUS_WORLD.terms.map((entry) => ({
      termId: entry.term_id,
      name: entry.name,
      parentId: entry.parent_id ?? null,
      path: entry.name,
    }));
    const nodes = buildTopicNodes({
      topics: summary.topics,
      prompts: summary.prompts,
      tree,
      descendants: topicDescendants(tree, []),
      kept: null,
      noTopicName: '',
    });
    const engines = [
      { code: 'chatgpt_web', label: 'ChatGPT' },
      { code: 'gemini_web', label: 'Gemini' },
      { code: 'google_ai_mode', label: 'AI Mode' },
    ] as const;
    const metrics: readonly [HeatOptions['metric'], CellMetric][] = [
      ['mention', 'mentioned'],
      ['citation', 'cited'],
      ['share_of_voice', 'share_of_voice'],
    ];
    let compared = 0;
    for (const [metric, cellMetric] of metrics) {
      const model = heatRows({ nodes, engines }, { metric, level: 'all', sort: 'prompts', rows: 1000 }, WORDS, LINKS);
      const flat = model.rows.flatMap((row) => [row, ...(row.children ?? [])]);
      for (const row of flat) {
        const node = nodes.flatMap((top) => [top, ...top.children]).find((entry) => entry.key === row.id);
        if (node === undefined) throw new Error(`no node for ${row.id}`);
        engines.forEach((engine, place) => {
          const original = engineValueOfWp20(node.engines, engine.code, cellMetric);
          const own = engineValue(node.engines, engine.code, cellMetric);
          expect(own).toEqual(original);
          expect(row.cells[place]).toMatchObject({
            state: original.state,
            answers: original.answers,
            value: original.state === 'ok' ? original.value : null,
          });
          compared += 1;
        });
      }
    }
    expect(compared).toBeGreaterThan(30);
  });
});
