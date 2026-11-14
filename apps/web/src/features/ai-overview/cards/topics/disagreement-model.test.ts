import { describe, expect, it } from 'vitest';

import { disagreementRows, NotWholeCountError, type DisagreementRow } from './disagreement-model';
import type { TopicNode } from './model-types';
import { NO_TOPIC } from './topic-nodes';
import { engineCells, promptRow } from './topic-card-test-kit';
import type { PromptSummaryRow } from '@/lib/api/types';

const CHATGPT = 'chatgpt_web';
const GEMINI = 'gemini_web';
const AI_MODE = 'google_ai_mode';
type Pair = readonly [k: number, n: number];

/** A prompt with `[k, n]` named answers over valid answers per engine; an engine left out has no cell at all. */
function prompt(id: string, counts: Record<string, Pair>): PromptSummaryRow {
  return promptRow(
    id,
    `prompt ${id}`,
    [],
    Object.entries(counts).map(([code, mentioned]) => engineCells(code, { mentioned })),
  );
}

/** A topic row of the tree holding these prompts (`null` members: the tree does not hold the topic yet). */
function topic(name: string, members: readonly PromptSummaryRow[] | null, over: Partial<TopicNode> = {}): TopicNode {
  return {
    key: name,
    termId: name,
    name,
    path: [name],
    parentKey: null,
    level: 1,
    promptCount: members?.length ?? 0,
    engines: [],
    members,
    lastValidAt: null,
    children: [],
    ...over,
  };
}

const TWO = [CHATGPT, GEMINI];
const pairsOf = (rows: readonly DisagreementRow[]): string[] =>
  rows.map((row) => `${row.node.name}: ${row.yes} yes, ${row.no} no, ${String(row.count)}`);

describe('disagreementRows', () => {
  it('a prompt counts when A named it once and B had at least 4 answers and none named it', () => {
    const model = disagreementRows(
      [
        topic('SEO', [
          prompt('p1', { [CHATGPT]: [1, 4], [GEMINI]: [0, 4] }),
          prompt('p2', { [CHATGPT]: [0, 4], [GEMINI]: [0, 4] }),
        ]),
      ],
      TWO,
      10,
    );
    expect(pairsOf(model.rows)).toEqual(['SEO: chatgpt_web yes, gemini_web no, 1']);
    expect(model.rows[0]).toMatchObject({ total: 2, examples: ['prompt p1'] });
  });

  it('a prompt with 3 answers on B is undecided and counted apart', () => {
    const model = disagreementRows(
      [
        topic('SEO', [
          prompt('p1', { [CHATGPT]: [2, 4], [GEMINI]: [0, 3] }),
          prompt('p2', { [CHATGPT]: [2, 4], [GEMINI]: [0, 0] }),
        ]),
      ],
      TWO,
      10,
    );
    expect(model.rows).toEqual([]);
    expect(model.undecided).toBe(2);
  });

  it('an engine with no cell at all is undecided as the one that misses, never a miss', () => {
    const model = disagreementRows([topic('SEO', [prompt('p1', { [CHATGPT]: [2, 4] })])], TWO, 10);
    expect(model.rows).toEqual([]);
    expect(model.undecided).toBe(1);
  });

  it('numerator 0 with 4 answers is a miss, not unknown', () => {
    const miss = disagreementRows([topic('SEO', [prompt('p1', { [CHATGPT]: [1, 1], [GEMINI]: [0, 4] })])], TWO, 10);
    expect(pairsOf(miss.rows)).toEqual(['SEO: chatgpt_web yes, gemini_web no, 1']);
    expect(miss.undecided).toBe(0);
    // One answer fewer and the same zero is unknown
    const unknown = disagreementRows([topic('SEO', [prompt('p1', { [CHATGPT]: [1, 1], [GEMINI]: [0, 3] })])], TWO, 10);
    expect(unknown.rows).toEqual([]);
  });

  it('an engine that named the brand is not a miss, whatever its answers', () => {
    const model = disagreementRows([topic('SEO', [prompt('p1', { [CHATGPT]: [2, 4], [GEMINI]: [1, 3] })])], TWO, 10);
    expect(model.rows).toEqual([]);
    expect(model.undecided).toBe(0);
  });

  it('pairs are ordered: ChatGPT yes Gemini no differs from Gemini yes ChatGPT no', () => {
    const model = disagreementRows(
      [
        topic('SEO', [
          prompt('p1', { [CHATGPT]: [2, 4], [GEMINI]: [0, 4] }),
          prompt('p2', { [CHATGPT]: [0, 4], [GEMINI]: [3, 5] }),
          prompt('p3', { [CHATGPT]: [0, 4], [GEMINI]: [3, 5] }),
        ]),
      ],
      TWO,
      10,
    );
    expect(pairsOf(model.rows)).toEqual([
      'SEO: gemini_web yes, chatgpt_web no, 2',
      'SEO: chatgpt_web yes, gemini_web no, 1',
    ]);
  });

  it('a prompt in two topics counts in both', () => {
    const shared = prompt('p1', { [CHATGPT]: [2, 4], [GEMINI]: [0, 4] });
    const model = disagreementRows([topic('SEO', [shared]), topic('Email', [shared])], TWO, 10);
    expect(pairsOf(model.rows)).toEqual([
      'Email: chatgpt_web yes, gemini_web no, 1',
      'SEO: chatgpt_web yes, gemini_web no, 1',
    ]);
  });

  it('a prompt left out for too few answers is counted once, however many topics hold it', () => {
    const shared = prompt('p1', { [CHATGPT]: [2, 4], [GEMINI]: [0, 3] });
    const model = disagreementRows([topic('SEO', [shared]), topic('Email', [shared])], TWO, 10);
    expect(model.undecided).toBe(1);
  });

  it('rows with count 0 are not listed', () => {
    const model = disagreementRows(
      [topic('SEO', [prompt('p1', { [CHATGPT]: [2, 4], [GEMINI]: [2, 4] })]), topic('Empty', [])],
      TWO,
      10,
    );
    expect(model.rows).toEqual([]);
    expect(model.found).toBe(0);
  });

  it('ordering and top N', () => {
    const win = (id: string): PromptSummaryRow => prompt(id, { [CHATGPT]: [2, 4], [GEMINI]: [0, 4] });
    const nodes = [
      topic('Zeta', [win('a')]),
      topic('Beta', [win('b'), win('c')]),
      topic('Alpha', [win('d'), win('e')]),
      topic('Gamma', [win('f'), win('g'), win('h')]),
    ];
    const all = disagreementRows(nodes, TWO, 10);
    // Most prompts first, a tie goes to the topic name
    expect(all.rows.map((row) => row.node.name)).toEqual(['Gamma', 'Alpha', 'Beta', 'Zeta']);
    const cut = disagreementRows(nodes, TWO, 2);
    expect(cut.rows.map((row) => row.node.name)).toEqual(['Gamma', 'Alpha']);
    expect(cut.found).toBe(4);
  });

  it('a tie in count and name goes to the order the engines are asked in', () => {
    const model = disagreementRows(
      [
        topic('SEO', [
          prompt('p1', { [CHATGPT]: [0, 4], [GEMINI]: [2, 4], [AI_MODE]: [0, 4] }),
          prompt('p2', { [CHATGPT]: [2, 4], [GEMINI]: [0, 4], [AI_MODE]: [2, 4] }),
        ]),
      ],
      [CHATGPT, GEMINI, AI_MODE],
      10,
    );
    // ChatGPT yes: Gemini no (p2) and Gemini yes: ChatGPT no (p1), AI Mode no (p1); each 1
    expect(model.rows.map((row) => `${row.yes}>${row.no}`)).toEqual([
      'chatgpt_web>gemini_web',
      'gemini_web>chatgpt_web',
      'gemini_web>google_ai_mode',
      'google_ai_mode>gemini_web',
    ]);
  });

  it('leaves only', () => {
    const child = prompt('p1', { [CHATGPT]: [2, 4], [GEMINI]: [0, 4] });
    const sibling = prompt('p2', { [CHATGPT]: [0, 4], [GEMINI]: [0, 4] });
    const leaf = topic('Technical', [child], { level: 2, parentKey: 'SEO' });
    const parent = topic('SEO', [child, sibling], { children: [leaf] });
    const model = disagreementRows([parent, topic(NO_TOPIC, [child])], TWO, 10);
    // The parent is not listed beside its child, and the prompts without a topic are no topic
    expect(pairsOf(model.rows)).toEqual(['Technical: chatgpt_web yes, gemini_web no, 1']);
  });

  it('a topic the tree does not hold yet has no members and no row', () => {
    const model = disagreementRows([topic('SEO', null)], TWO, 10);
    expect(model.rows).toEqual([]);
    expect(model.answered).toBe(false);
  });

  it('says whether any answer exists and which asked engine has none', () => {
    const model = disagreementRows(
      [topic('SEO', [prompt('p1', { [CHATGPT]: [2, 4], [GEMINI]: [0, 4] })])],
      [CHATGPT, GEMINI, AI_MODE],
      10,
    );
    expect(model).toMatchObject({ answered: true, silent: [AI_MODE], topics: 1 });
    const none = disagreementRows([topic('SEO', [prompt('p1', { [CHATGPT]: [0, 0] })])], TWO, 10);
    expect(none.answered).toBe(false);
  });

  it('a count that is not whole is an error by name, never a guess', () => {
    const odd = promptRow('p1', 'odd', [], [engineCells(CHATGPT, { mentioned: [1.5, 4] })]);
    expect(() => disagreementRows([topic('SEO', [odd])], TWO, 10)).toThrow(NotWholeCountError);
  });
});
