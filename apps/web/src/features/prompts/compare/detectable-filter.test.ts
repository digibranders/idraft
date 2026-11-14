import { describe, expect, it } from 'vitest';

import { comparedRowCount, keepPromptRows, keepTopicRows, narrowSummary } from './detectable-filter';
import { buildTopicTree } from '@/features/prompts/topic-tree';
import type {
  EngineSummary,
  MetricCell,
  PromptsSummary,
  PromptSummaryRow,
  Schemas,
  TopicSummaryRow,
} from '@/lib/api/types';
import type { NamedTerm } from '@/lib/keywords/taxonomy-reads';

type EngineCells = Schemas['EngineCells'];

const cell = (k: number, n: number): MetricCell => ({
  value: n === 0 ? null : k / n,
  numerator: k,
  denominator: n,
  n_observations: n,
  pooled: null,
});
const EMPTY = cell(0, 0);
const OUTCOMES = { cited_only: EMPTY, mentioned_and_cited: EMPTY, mentioned_only: EMPTY, neither: EMPTY };
const cells = (k: number, n: number): EngineCells => ({
  mentioned: cell(k, n),
  cited: EMPTY,
  share_of_voice: EMPTY,
  outcomes: OUTCOMES,
});
/** An engine that answered `now` (k of n) and, unless `before` is null, `before` in the window before. */
const engine = (code: string, now: [number, number], before: [number, number] | null): EngineSummary => ({
  engine_code: code,
  ...cells(...now),
  previous: before === null ? null : cells(...before),
});

/** 30 of 60 against 12 of 60: larger than normal variation. */
const DETECTABLE = engine('chatgpt_web', [30, 60], [12, 60]);
/** 31 of 60 against 27 of 60: within normal variation. */
const WITHIN = engine('chatgpt_web', [31, 60], [27, 60]);
const NO_PREVIOUS = engine('chatgpt_web', [30, 60], null);
const TOO_FEW = engine('chatgpt_web', [30, 60], [2, 3]);

const prompt = (id: string, engines: EngineSummary[], topics: string[] = []): PromptSummaryRow =>
  ({ prompt_id: id, topic_term_ids: topics, engines }) as unknown as PromptSummaryRow;
const topic = (termId: string | null, engines: EngineSummary[]): TopicSummaryRow =>
  ({ term_id: termId, name: termId, prompt_count: 1, engines }) as unknown as TopicSummaryRow;

const CODES = ['chatgpt_web'];

describe('keepPromptRows', () => {
  it('keeps a row whose mention change is detectable and drops within, null and no previous', () => {
    const rows = [
      prompt('detectable', [DETECTABLE]),
      prompt('within', [WITHIN]),
      prompt('no-previous', [NO_PREVIOUS]),
      prompt('too-few', [TOO_FEW]),
      prompt('no-engines', []),
    ];
    expect(keepPromptRows(rows, CODES, true).map((row) => row.prompt_id)).toEqual(['detectable']);
  });

  it('keeps nothing when comparison is off, whatever the rows carry', () => {
    expect(keepPromptRows([prompt('detectable', [DETECTABLE])], CODES, false)).toEqual([]);
  });

  it('reads only the engines shown', () => {
    const other = { ...DETECTABLE, engine_code: 'gemini_web' };
    const rows = [prompt('gemini-only', [other])];
    expect(keepPromptRows(rows, CODES, true)).toEqual([]);
    expect(keepPromptRows(rows, ['gemini_web'], true)).toHaveLength(1);
  });

  it('decides an average of engines on the engines that have a rate in both periods, pooled', () => {
    const first = engine('chatgpt_web', [34, 60], [24, 60]);
    const second = engine('gemini_web', [34, 60], [24, 60]);
    const codes = ['chatgpt_web', 'gemini_web'];
    // Each engine alone is within normal variation; their 68 of 120 against 48 of 120 together is not
    expect(keepPromptRows([prompt('one', [first])], codes, true)).toEqual([]);
    expect(keepPromptRows([prompt('both', [first, second])], codes, true)).toHaveLength(1);
  });
});

describe('keepTopicRows', () => {
  it('keeps a topic row by its own change', () => {
    const rows = [topic('a', [DETECTABLE]), topic('b', [WITHIN]), topic('c', [NO_PREVIOUS]), topic(null, [DETECTABLE])];
    expect(keepTopicRows(rows, CODES, true).map((row) => row.term_id)).toEqual(['a', null]);
    expect(keepTopicRows(rows, CODES, false)).toEqual([]);
  });

  it('leaves a child of a dropped parent at the top level of the tree', () => {
    const tree: NamedTerm[] = [
      { termId: 'p', name: 'p', parentId: null, path: 'p' },
      { termId: 'c', name: 'c', parentId: 'p', path: 'p / c' },
    ] as unknown as NamedTerm[];
    const rows = [topic('p', [WITHIN]), topic('c', [DETECTABLE])];
    const branches = buildTopicTree(keepTopicRows(rows, CODES, true), tree);
    expect(branches.map((branch) => [branch.row.term_id, branch.children.length])).toEqual([['c', 0]]);
  });
});

describe('narrowSummary', () => {
  const summary = {
    prompts: [prompt('x', [DETECTABLE])],
    topics: [topic('a', [DETECTABLE]), topic('b', [WITHIN])],
  } as unknown as PromptsSummary;

  it('keeps the kept topic rows and every prompt row', () => {
    const narrowed = narrowSummary(summary, CODES, true);
    expect(narrowed.topics.map((row) => row.term_id)).toEqual(['a']);
    expect(narrowed.prompts).toBe(summary.prompts);
  });
});

describe('comparedRowCount', () => {
  const summary = {
    prompts: [prompt('x', [DETECTABLE], ['a']), prompt('y', [WITHIN], ['b']), prompt('z', [NO_PREVIOUS], ['a'])],
    topics: [topic('a', [DETECTABLE]), topic('b', [WITHIN]), topic('c', [NO_PREVIOUS])],
  } as unknown as PromptsSummary;

  it('counts the rows that have a change to read, topic rows on the Topics tab and prompt rows on the Prompts tab', () => {
    expect(comparedRowCount(summary, 'topics', null, CODES)).toBe(2);
    expect(comparedRowCount(summary, 'prompts', null, CODES)).toBe(2);
  });

  it('counts only the rows a topic filter keeps', () => {
    expect(comparedRowCount(summary, 'topics', new Set(['a']), CODES)).toBe(1);
    expect(comparedRowCount(summary, 'prompts', new Set(['b']), CODES)).toBe(1);
  });

  it('is 0 without a summary', () => {
    expect(comparedRowCount(undefined, 'topics', null, CODES)).toBe(0);
  });
});
