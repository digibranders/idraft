import type { Route } from 'next';
import { describe, expect, it } from 'vitest';

import {
  PROMPT_HEAT_EXPORT_HEAD,
  promptHeatRows,
  type PromptHeatLinks,
  type PromptHeatOptions,
  type PromptHeatWords,
} from './prompt-heat-model';
import { engineCells, promptRow } from './topic-card-test-kit';
import type { EngineInfo } from './model-types';
import type { PromptSummaryRow } from '@/lib/api/types';
import type { NamedTerm } from '@/lib/keywords/taxonomy-reads';

/*
 * The model of the prompt heat map (CH-11): which prompts, in which order, what each cell says and where it leads.
 * The words and the links come in as arguments, so these tests read what the model decides and not how English is
 * written.
 */

const CRM = 'crm';
const PRICING = 'pricing';
const SECURITY = 'security';

const TREE: NamedTerm[] = [
  { termId: CRM, name: 'CRM', parentId: null, path: 'CRM' },
  { termId: PRICING, name: 'Pricing', parentId: CRM, path: 'CRM / Pricing' },
  { termId: SECURITY, name: 'Security', parentId: null, path: 'Security' },
];

const ENGINES: readonly EngineInfo[] = [
  { code: 'chatgpt_web', label: 'ChatGPT' },
  { code: 'gemini_web', label: 'Gemini' },
];

type Pair = readonly [number, number];

/** Counts are `[k, n]` of valid answers on each engine; a prompt's cell has whole counts. */
function prompt(id: string, text: string, topics: string[], chatgpt: Pair, gemini: Pair): PromptSummaryRow {
  return promptRow(id, text, topics, [
    engineCells('chatgpt_web', { mentioned: chatgpt }),
    engineCells('gemini_web', { mentioned: gemini }),
  ]);
}

// In the order the API gives them: the order asked is the model's, not the input's. Averages: high 85%, mid 40%,
// low 5%; the thin prompt has no engine with 4 answers and the silent one has no answer, so neither has a rate.
const PROMPTS: PromptSummaryRow[] = [
  prompt('high', 'Best CRM', [CRM], [9, 10], [8, 10]),
  prompt('mid', 'CRM pricing', [PRICING], [5, 10], [3, 10]),
  prompt('low', 'Is it secure', [SECURITY], [1, 10], [0, 10]),
  prompt('thin', 'Rare question', [], [2, 3], [1, 2]),
  prompt('none', 'Never answered', [], [0, 0], [0, 0]),
];

const WORDS: PromptHeatWords = {
  rowHeader: 'Prompt',
  averageHead: (count) => `avg of ${String(count)}`,
  avgLabel: (count) => (count === 1 ? '1 engine' : `avg of ${String(count)}`),
  percent: (value) => (value === null ? 'n/a' : `${String(Math.round(value * 100))}%`),
  cellTip: (value) => `${value.state}:${String(value.successes)}/${String(value.answers)}`,
  lastValid: (iso) => (iso === null ? 'no valid answer yet' : `last valid ${iso.slice(0, 10)}`),
  rowName: (text, path) => (path === null ? text : `${text} (${path})`),
  cellSubject: (name, engine, value, last) => `${name} on ${engine}: ${value}. ${last}`,
  averageSubject: (name, average, value, last) => `${name}, ${average}: ${value}. ${last}`,
  averageNone: (name, value, last) => `${name}, average of the engines: ${value}. ${last}`,
  averageValue: (percent, counts, note) => `${percent}, ${counts}. ${note}`,
  averageNote: (engines) => `Equal weight average of ${engines}`,
  averageOnly: (engines) => `${engines} only`,
  engineCount: (engine, value) => `${engine} ${String(value.answers)}`,
  noAnswers: 'no answers',
  thin: (answers) => `${String(answers)} answers`,
  list: (items) => items.join(' and '),
};

const LINKS: PromptHeatLinks = { prompt: (id) => `/prompt/${id}` as Route };

const OPTIONS: PromptHeatOptions = { sort: 'least_named', rows: 10 };

const run = (
  over: Partial<PromptHeatOptions> = {},
  prompts: readonly PromptSummaryRow[] = PROMPTS,
  engines: readonly EngineInfo[] = ENGINES,
  links: PromptHeatLinks = LINKS,
) => promptHeatRows({ prompts, engines, tree: TREE }, { ...OPTIONS, ...over }, WORDS, links);

const ids = (list: readonly { id: string }[]): string[] => list.map((row) => row.id);

describe('the order', () => {
  it('sort least named is ascending by the average and rows without a rate are last', () => {
    // The two without a rate tie, so the text decides: Never answered, Rare question
    expect(ids(run({ sort: 'least_named' }).rows)).toEqual(['low', 'mid', 'high', 'none', 'thin']);
  });

  it('sort most named is descending by the average and rows without a rate are still last', () => {
    expect(ids(run({ sort: 'most_named' }).rows)).toEqual(['high', 'mid', 'low', 'none', 'thin']);
  });

  it('a tie in the average goes to the prompt text', () => {
    const tied = [prompt('b', 'Beta', [], [5, 10], [5, 10]), prompt('a', 'Alpha', [], [5, 10], [5, 10])];
    expect(ids(run({}, tied).rows)).toEqual(['a', 'b']);
  });

  it('the rows given are not changed', () => {
    run();
    expect(PROMPTS.map((row) => row.prompt_id)).toEqual(['high', 'mid', 'low', 'thin', 'none']);
  });
});

describe('the cut', () => {
  it('the cut is after the sort: the worst prompts are never the ones cut away', () => {
    // high comes first in the input; cutting first would show high and mid
    const model = run({ rows: 2, sort: 'least_named' });
    expect(ids(model.rows)).toEqual(['low', 'mid']);
    expect(model).toMatchObject({ total: 5, shown: 2 });
    expect(ids(run({ rows: 2, sort: 'most_named' }).rows)).toEqual(['high', 'mid']);
  });

  it('a prompt without a rate does not take the place of one that has a rate', () => {
    expect(ids(run({ rows: 3, sort: 'least_named' }).rows)).toEqual(['low', 'mid', 'high']);
    expect(ids(run({ rows: 3, sort: 'most_named' }).rows)).toEqual(['high', 'mid', 'low']);
  });

  it('a cut larger than the prompts shows them all', () => {
    expect(run({ rows: 20 })).toMatchObject({ total: 5, shown: 5 });
  });
});

describe('a row', () => {
  it('a prompt in two topics is one row', () => {
    const two = [prompt('p', 'CRM and security', [SECURITY, PRICING], [5, 10], [5, 10])];
    expect(run({}, two).rows).toHaveLength(1);
  });

  it('the topic path is the first topic the tree holds', () => {
    const two = [
      prompt('p', 'CRM and security', ['unknown', PRICING, SECURITY], [5, 10], [5, 10]),
      prompt('q', 'No topic at all', [], [5, 10], [5, 10]),
    ];
    const rows = run({}, two).rows;
    expect(rows.map((row) => row.path)).toEqual(['CRM / Pricing', null]);
    expect(rows.map((row) => row.name)).toEqual(['CRM and security (CRM / Pricing)', 'No topic at all']);
    expect(rows.map((row) => row.text)).toEqual(['CRM and security', 'No topic at all']);
  });

  it('the name of a row and the cell of each engine link to the prompt, the average cell leads nowhere', () => {
    const [first] = run().rows;
    expect(first?.href).toBe('/prompt/low');
    expect(first?.cells.map((cell) => cell.href)).toEqual(['/prompt/low', '/prompt/low', undefined]);
  });

  it('a link that cannot be made (null) leaves the row and its cells as text', () => {
    const [first] = run({}, PROMPTS, ENGINES, { prompt: () => null }).rows;
    expect(first?.href).toBeUndefined();
    expect(first?.cells.every((cell) => cell.href === undefined)).toBe(true);
  });
});

describe('the columns', () => {
  it('one column per asked engine, then the average from two engines', () => {
    expect(run().columns).toEqual([
      { id: 'chatgpt_web', label: 'ChatGPT', engine: 'chatgpt_web' },
      { id: 'gemini_web', label: 'Gemini', engine: 'gemini_web' },
      { id: 'average', label: 'avg of 2', engine: null },
    ]);
    expect(run().rows.every((row) => row.cells.length === 3)).toBe(true);
  });

  it('engines outside the filter are not columns and take no part in the order', () => {
    const only = [{ code: 'chatgpt_web', label: 'ChatGPT' }] as const;
    const model = run({ sort: 'least_named' }, PROMPTS, only);
    expect(model.columns.map((column) => column.id)).toEqual(['chatgpt_web']);
    expect(model.rows.every((row) => row.cells.length === 1)).toBe(true);
    // ChatGPT alone: low 10%, mid 50%, high 90%; the thin prompt has 3 answers there and no rate
    expect(ids(model.rows)).toEqual(['low', 'mid', 'high', 'none', 'thin']);
  });

  it('an engine without a valid answer in any row is named, and a row of cells with no answer stays', () => {
    const three: readonly EngineInfo[] = [...ENGINES, { code: 'google_ai_mode', label: 'AI Mode' }];
    const model = run({}, PROMPTS, three);
    expect(model.unanswered).toEqual(['AI Mode']);
    expect(model.columns.map((column) => column.label)).toEqual(['ChatGPT', 'Gemini', 'AI Mode', 'avg of 3']);
    expect(model.rows[0]?.cells[2]).toMatchObject({ state: 'none', text: '', value: null });
  });
});

describe('a cell', () => {
  const cellOf = (promptId: string, column: 0 | 1 | 2) => {
    const cell = run().rows.find((row) => row.id === promptId)?.cells[column];
    if (cell === undefined) throw new Error(`no cell ${promptId} ${String(column)}`);
    return cell;
  };

  it('an ok cell prints its percent and its answers', () => {
    expect(cellOf('high', 0)).toMatchObject({ state: 'ok', text: '90%', answers: 10, value: 0.9 });
  });

  it('a cell under 4 answers has no percent and no value, and keeps its answers', () => {
    expect(cellOf('thin', 0)).toMatchObject({ state: 'insufficient', text: '', value: null, answers: 3 });
  });

  it('a cell with no answers has no percent and no value, and is never 0', () => {
    const cell = cellOf('none', 0);
    expect(cell).toMatchObject({ state: 'none', text: '', value: null, answers: 0 });
    expect(cell.tip).toContain('none:null/0');
  });

  it('the tip says the prompt, the engine, the value and the last valid answer', () => {
    expect(cellOf('high', 0).tip).toBe('Best CRM on ChatGPT: ok:9/10. last valid 2026-11-11');
  });

  it('the tip of a prompt that was never answered says so', () => {
    const never = [{ ...prompt('n', 'Never', [], [0, 0], [0, 0]), last_valid_at: null }];
    expect(run({}, never).rows[0]?.cells[0]?.tip).toContain('no valid answer yet');
  });

  it('the average is the equal weight of the engines with a rate and says how many', () => {
    const cell = cellOf('high', 2);
    expect(cell).toMatchObject({ state: 'ok', text: '85%' });
    expect(cell.tip).toBe(
      'Best CRM, avg of 2: 85%, ChatGPT 10 and Gemini 10. Equal weight average of ChatGPT and Gemini. last valid 2026-11-11',
    );
  });

  it('an average over one engine with a rate says that engine only', () => {
    const one = [prompt('p', 'One engine', [], [8, 10], [1, 2])];
    const cell = run({}, one).rows[0]?.cells[2];
    expect(cell?.text).toBe('80%');
    expect(cell?.tip).toContain('1 engine: 80%, ChatGPT 10. ChatGPT only');
  });

  it('an average with no engine that has a rate has no percent and no count of engines', () => {
    expect(cellOf('none', 2)).toMatchObject({ state: 'none', text: '', value: null });
    expect(cellOf('none', 2).tip).toContain('average of the engines: no answers');
    expect(cellOf('thin', 2)).toMatchObject({ state: 'insufficient', text: '', value: null });
    expect(cellOf('thin', 2).tip).toContain('average of the engines: 3 answers');
  });
});

describe('the table and the export', () => {
  it('the CSV has the row name with its topic, the words of each cell and n/a where there is no answer', () => {
    const model = run({ sort: 'most_named' });
    expect(model.csv.header).toEqual(['Prompt', 'ChatGPT', 'Gemini', 'avg of 2']);
    expect(model.csv.rows[0]?.[0]).toBe('Best CRM (CRM)');
    expect(model.csv.rows[0]?.[1]).toBe(model.rows[0]?.cells[0]?.tip);
    const never = model.csv.rows.find((row) => row[0] === 'Never answered');
    expect(never?.slice(1)).toEqual(['n/a', 'n/a', 'n/a']);
  });

  it('the export has numbers, with an empty cell and a status where a rate is unknown, never 0', () => {
    const model = run({ sort: 'most_named' });
    expect(model.exportTable.header).toEqual([
      ...PROMPT_HEAT_EXPORT_HEAD,
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
    const byPrompt = new Map(model.exportTable.rows.map((row) => [row[0], row]));
    expect(byPrompt.get('Best CRM')?.slice(0, 8)).toEqual([
      'Best CRM',
      'CRM',
      '2026-11-11T09:00:00Z',
      90,
      10,
      'ok',
      80,
      10,
    ]);
    expect(byPrompt.get('Rare question')?.slice(3)).toEqual([
      null,
      3,
      'insufficient',
      null,
      2,
      'insufficient',
      null,
      0,
      'insufficient',
    ]);
    expect(byPrompt.get('Never answered')?.slice(3, 6)).toEqual([null, 0, 'no_answers']);
  });

  it('the export is of the rows shown', () => {
    expect(run({ rows: 2 }).exportTable.rows).toHaveLength(2);
  });

  it('answered says whether any prompt has a valid answer on an engine', () => {
    expect(run().answered).toBe(true);
    expect(run({}, [prompt('n', 'Never', [], [0, 0], [0, 0])]).answered).toBe(false);
  });
});
