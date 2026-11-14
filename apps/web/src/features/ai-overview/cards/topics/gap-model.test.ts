import { describe, expect, it } from 'vitest';

import type { Comparison, EngineValue } from './engine-values';
import { gapRows, verdictOf } from './gap-model';
import type { TopicNode } from './model-types';
import { NO_TOPIC } from './topic-nodes';
import { engine, weighted } from '@/features/prompts/topics-by-engine/cells-fixtures';

const CODES = ['chatgpt_web', 'gemini_web', 'google_ai_mode'] as const;

/** A leaf topic whose engines have `[k, n]` of valid answers (null: no cells for that engine). */
function leaf(
  name: string,
  prompts: number,
  counts: readonly (readonly [number, number] | null)[],
  over: Partial<TopicNode> = {},
): TopicNode {
  return {
    key: name,
    termId: name,
    name,
    path: [name],
    parentKey: null,
    level: 1,
    promptCount: prompts,
    engines: counts.flatMap((count, place) =>
      count === null
        ? []
        : [
            engine(CODES[place] ?? 'x', {
              mentioned: weighted(count[0], count[1], prompts),
              share_of_voice: weighted(count[0], count[1], prompts),
            }),
          ],
    ),
    members: null,
    lastValidAt: null,
    children: [],
    ...over,
  };
}

const names = (model: ReturnType<typeof gapRows>): string[] => model.rows.map((row) => row.row.node.name);

describe('gapRows', () => {
  it('needs two engines with a rate', () => {
    const model = gapRows(
      [
        leaf('One engine', 5, [[5, 10], null, null]),
        leaf('Thin partner', 5, [[5, 10], [1, 3], null]),
        leaf('Two engines', 5, [[8, 10], [2, 10], null]),
      ],
      CODES,
      'mentioned',
      10,
    );
    expect(names(model)).toEqual(['Two engines']);
    expect(model.total).toBe(1);
  });

  it('orders by spread in points, exact', () => {
    // 33.49% and 10.01% show as 33.5% and 10.0%: the spread is 23.48 points, not 23.5
    const model = gapRows(
      [
        leaf('Small', 5, [[55, 100], [50, 100], null]),
        leaf('Exact', 5, [[3349, 10000], [1001, 10000], null]),
        leaf('Big', 5, [[90, 100], [20, 100], null]),
      ],
      CODES,
      'mentioned',
      10,
    );
    expect(names(model)).toEqual(['Big', 'Exact', 'Small']);
    expect(model.rows[0]?.points).toBeCloseTo(70, 9);
    expect(model.rows[1]?.points).toBeCloseTo(23.48, 9);
    expect(model.rows[1]?.points).not.toBe(23.5);
  });

  it('a tie in spread goes to the prompts then the name', () => {
    const model = gapRows(
      [
        leaf('Beta', 5, [[8, 10], [4, 10], null]),
        leaf('Alpha', 5, [[8, 10], [4, 10], null]),
        leaf('Wide', 9, [[8, 10], [4, 10], null]),
      ],
      CODES,
      'mentioned',
      10,
    );
    expect(names(model)).toEqual(['Wide', 'Alpha', 'Beta']);
  });

  it('a thin engine is listed as answers and has no dot', () => {
    const [row] = gapRows(
      [
        leaf('Mixed', 5, [
          [8, 10],
          [2, 10],
          [1, 3],
        ]),
      ],
      CODES,
      'mentioned',
      10,
    ).rows;
    expect(row?.engines.map((entry) => entry.code)).toEqual([...CODES]);
    const [chat, gemini, mode] = row?.engines ?? [];
    expect(chat?.position).toBeCloseTo(80, 9);
    expect(gemini?.position).toBeCloseTo(20, 9);
    expect(mode?.position).toBeNull();
    expect(row?.engines[2]?.value).toMatchObject({ state: 'insufficient', answers: 3, value: null });
  });

  it('an engine with no answer at all has no dot either', () => {
    const [row] = gapRows(
      [
        leaf('Silent', 5, [
          [8, 10],
          [2, 10],
          [0, 0],
        ]),
      ],
      CODES,
      'mentioned',
      10,
    ).rows;
    expect(row?.engines[2]).toMatchObject({ position: null, value: { state: 'none' } });
  });

  it('the sentence is within, detectable or too few from counts only', () => {
    const kind = (counts: readonly (readonly [number, number] | null)[]): string | undefined => {
      const [row] = gapRows([leaf('T', 5, counts)], CODES, 'mentioned', 10).rows;
      const { comparison } = row ?? {};
      return comparison?.kind === 'gap' ? comparison.test : comparison?.kind;
    };
    // The same rates (50% against 40%) are within normal variation on 10 answers and detectable on 1000
    expect(kind([[5, 10], [4, 10], null])).toBe('within');
    expect(kind([[500, 1000], [400, 1000], null])).toBe('detectable');
    // An engine under 4 answers makes the whole row too thin to claim a difference
    expect(
      kind([
        [500, 1000],
        [100, 1000],
        [1, 3],
      ]),
    ).toBe('too-few');
  });

  it('share of voice has no test and says so', () => {
    const [row] = gapRows([leaf('T', 5, [[500, 1000], [100, 1000], null])], CODES, 'share_of_voice', 10).rows;
    expect(row?.comparison).toMatchObject({ kind: 'gap', test: 'share' });
  });

  it('an all-zero row is listed and its verdict is zero', () => {
    const model = gapRows([leaf('Nobody', 5, [[0, 10], [0, 10], null])], CODES, 'mentioned', 10);
    expect(model.rows).toHaveLength(1);
    expect(model.rows[0]?.points).toBe(0);
    expect(model.rows[0]?.comparison.kind).toBe('zero');
    expect(model.rows[0] === undefined ? null : verdictOf(model.rows[0].comparison)).toBe('zero');
  });

  it('equal rates have the equal verdict', () => {
    const [row] = gapRows([leaf('Same', 5, [[5, 10], [5, 10], null])], CODES, 'mentioned', 10).rows;
    expect(row === undefined ? null : verdictOf(row.comparison)).toBe('equal');
  });

  it('verdictOf names every kind of comparison', () => {
    const value = (code: string): EngineValue => ({
      code,
      state: 'ok',
      value: 0.5,
      answers: 10,
      successes: 5,
      prompts: 5,
      observations: 10,
      reason: null,
    });
    const gap = (test: 'within' | 'detectable' | 'too-few' | 'share'): Comparison => ({
      kind: 'gap',
      best: value('a'),
      worst: value('b'),
      points: 10,
      test,
      leftOut: [],
    });
    expect(verdictOf(gap('within'))).toBe('within');
    expect(verdictOf(gap('detectable'))).toBe('detectable');
    expect(verdictOf(gap('too-few'))).toBe('tooFew');
    expect(verdictOf(gap('share'))).toBe('share');
    expect(verdictOf({ kind: 'equal', value: 0.5, leftOut: [] })).toBe('equal');
    expect(verdictOf({ kind: 'zero', leftOut: [] })).toBe('zero');
    expect(verdictOf({ kind: 'none', leftOut: [] })).toBe('tooFew');
  });

  it('equal rates are listed with the equal sentence, after every gap', () => {
    const model = gapRows(
      [leaf('Same', 9, [[5, 10], [5, 10], null]), leaf('Apart', 3, [[9, 10], [1, 10], null])],
      CODES,
      'mentioned',
      10,
    );
    expect(names(model)).toEqual(['Apart', 'Same']);
    expect(model.rows[1]?.comparison.kind).toBe('equal');
  });

  it('top N, and the total says how many topics could be compared', () => {
    const topics = [1, 2, 3, 4].map((step) => leaf(`T${String(step)}`, 5, [[step * 2, 10], [0, 10], null]));
    const model = gapRows(topics, CODES, 'mentioned', 2);
    expect(names(model)).toEqual(['T4', 'T3']);
    expect(model.total).toBe(4);
  });

  it('leaves only, and the no topic row is not a topic', () => {
    const child = leaf('Local', 4, [[8, 10], [2, 10], null], { level: 2, parentKey: 'SEO' });
    const parent = leaf('SEO', 8, [[9, 10], [1, 10], null], { children: [child] });
    const unfiled = leaf('Unfiled', 4, [[9, 10], [1, 10], null], { key: NO_TOPIC, termId: null });
    expect(names(gapRows([parent, unfiled], CODES, 'mentioned', 10))).toEqual(['Local']);
  });
});
