import { describe, expect, it } from 'vitest';

import { engineCells, promptRow } from './topic-card-test-kit';
import { topPromptsModel, type TopPromptsOptions } from './top-prompts-model';
import type { PromptSummaryRow } from '@/lib/api/types';

/*
 * The model of "prompts to look at": the most named, the least named, or the prompts whose rate changed most between
 * two windows. Plain data, so these tests read the decisions: which prompts rank, in which order, over which engines.
 */

type Pair = readonly [number, number];

const CODES = ['chatgpt_web', 'gemini_web'] as const;

/** A prompt with one `[k, n]` of valid answers per engine; a part left out is an engine with no answer. */
function prompt(id: string, text: string, counts: { chatgpt?: Pair; gemini?: Pair }): PromptSummaryRow {
  return promptRow(
    id,
    text,
    [],
    [
      ...(counts.chatgpt === undefined ? [] : [engineCells('chatgpt_web', { mentioned: counts.chatgpt })]),
      ...(counts.gemini === undefined ? [] : [engineCells('gemini_web', { mentioned: counts.gemini })]),
    ],
  );
}

const run = (
  prompts: readonly PromptSummaryRow[],
  previous: readonly PromptSummaryRow[] | null,
  over: Partial<TopPromptsOptions> = {},
) => topPromptsModel({ prompts, previousPrompts: previous, codes: CODES }, { show: 'least_named', rows: 5, ...over });

const ids = (list: readonly { id: string }[]): string[] => list.map((row) => row.id);

describe('most and least named', () => {
  // A has a rate on ChatGPT only (Gemini has 2 answers), B on both engines, C is 0% on ChatGPT, D has no rate at all.
  const PROMPTS = [
    prompt('a', 'Alpha', { chatgpt: [9, 10], gemini: [1, 2] }),
    prompt('b', 'Beta', { chatgpt: [5, 10], gemini: [5, 10] }),
    prompt('c', 'Gamma', { chatgpt: [0, 10] }),
    prompt('d', 'Delta', { chatgpt: [2, 3], gemini: [0, 0] }),
  ];

  it('most and least named use the equal weight average over engines with a rate', () => {
    const most = run(PROMPTS, null, { show: 'most_named' });
    expect(ids(most.listed)).toEqual(['a', 'b', 'c']);
    // A: only ChatGPT has a rate, so the average is ChatGPT's 90% over one engine, not 10 of 12 pooled
    expect(most.listed[0]?.average).toMatchObject({ state: 'ok', engines: 1 });
    expect(most.listed[0]?.average.value).toBeCloseTo(0.9, 12);
    expect(most.listed[1]?.average).toMatchObject({ engines: 2 });
    expect(ids(run(PROMPTS, null, { show: 'least_named' }).listed)).toEqual(['c', 'b', 'a']);
  });

  it('an engine with a large count does not outweigh one with a small count', () => {
    const lopsided = [prompt('x', 'Lopsided', { chatgpt: [10, 10], gemini: [0, 100] })];
    expect(run(lopsided, null).listed[0]?.average.value).toBeCloseTo(0.5, 12);
  });

  it('a prompt with no engine rate is counted apart, never ranked as 0', () => {
    const least = run(PROMPTS, null, { show: 'least_named' });
    // Gamma has a real 0% and ranks first; Delta (3 answers) would tie it if unknown were read as 0
    expect(ids(least.listed)).toEqual(['c', 'b', 'a']);
    expect(ids(least.left)).toEqual(['d']);
    expect(least.listed.every((row) => row.average.value !== null)).toBe(true);
    expect(ids(run(PROMPTS, null, { show: 'most_named' }).left)).toEqual(['d']);
  });

  it('the cut is after the sort', () => {
    expect(ids(run(PROMPTS, null, { show: 'least_named', rows: 2 }).listed)).toEqual(['c', 'b']);
    expect(ids(run(PROMPTS, null, { show: 'most_named', rows: 2 }).listed)).toEqual(['a', 'b']);
    // The count of the ranked prompts is that before the cut
    expect(run(PROMPTS, null, { rows: 2 }).ranked).toHaveLength(3);
  });

  it('a tie in the average goes to the prompt text', () => {
    const tied = [prompt('b', 'Beta', { chatgpt: [5, 10] }), prompt('a', 'Alpha', { chatgpt: [5, 10] })];
    expect(ids(run(tied, null).listed)).toEqual(['a', 'b']);
  });

  it('the previous window is not read for a named view', () => {
    const rows = run(PROMPTS, [], { show: 'most_named' });
    expect(ids(rows.listed)).toEqual(['a', 'b', 'c']);
    expect(rows.listed.every((row) => row.change === null)).toBe(true);
  });

  it('a value per asked engine is kept for the tip', () => {
    const [first] = run(PROMPTS, null, { show: 'most_named' }).listed;
    expect(first?.values.map((value) => [value.code, value.state, value.answers])).toEqual([
      ['chatgpt_web', 'ok', 10],
      ['gemini_web', 'insufficient', 2],
    ]);
  });
});

describe('largest change', () => {
  const show = { show: 'largest_change' } as const;

  it('largest change uses the engines with a rate in both windows', () => {
    // ChatGPT: 40% before, 80% now. Gemini: 90% now, but only 2 answers before, so it takes no part on either side.
    const now = [prompt('x', 'Ex', { chatgpt: [8, 10], gemini: [9, 10] })];
    const before = [prompt('x', 'Ex', { chatgpt: [4, 10], gemini: [1, 2] })];
    const [row] = run(now, before, show).listed;
    expect(row?.change?.engines).toBe(1);
    expect(row?.change?.points).toBeCloseTo(0.4, 12);
    expect(row?.change?.now.value).toBeCloseTo(0.8, 12);
    expect(row?.change?.before.value).toBeCloseTo(0.4, 12);
    expect(row?.took).toEqual(['chatgpt_web']);
  });

  it('the average change says how many engines took part', () => {
    const now = [prompt('x', 'Ex', { chatgpt: [8, 10], gemini: [6, 10] })];
    const before = [prompt('x', 'Ex', { chatgpt: [4, 10], gemini: [4, 10] })];
    const [row] = run(now, before, show).listed;
    expect(row?.change?.engines).toBe(2);
    expect(row?.took).toEqual(['chatgpt_web', 'gemini_web']);
    expect(row?.change?.points).toBeCloseTo(0.3, 12);
  });

  it('absent from the previous window is not compared', () => {
    const now = [prompt('new', 'New one', { chatgpt: [8, 10] }), prompt('old', 'Old one', { chatgpt: [8, 10] })];
    const before = [prompt('old', 'Old one', { chatgpt: [4, 10] })];
    const model = run(now, before, show);
    expect(ids(model.listed)).toEqual(['old']);
    expect(ids(model.left)).toEqual(['new']);
  });

  it('a prompt with no engine that has a rate in both windows is not compared, never a change from 0', () => {
    const now = [prompt('x', 'Ex', { chatgpt: [8, 10], gemini: [0, 0] })];
    const before = [prompt('x', 'Ex', { chatgpt: [1, 3], gemini: [5, 10] })];
    const model = run(now, before, show);
    expect(model.listed).toEqual([]);
    expect(ids(model.left)).toEqual(['x']);
    expect(model.left[0]?.change).toBeNull();
  });

  it('with no previous window nothing is compared', () => {
    const model = run([prompt('x', 'Ex', { chatgpt: [8, 10] })], null, show);
    expect(model.listed).toEqual([]);
    expect(ids(model.left)).toEqual(['x']);
  });

  it('detectable first then absolute points', () => {
    const now = [
      prompt('small', 'Small but sure', { chatgpt: [90, 200] }),
      prompt('within', 'Large but thin', { chatgpt: [8, 10] }),
      prompt('gain', 'Big gain', { chatgpt: [70, 100] }),
      prompt('loss', 'Big loss', { chatgpt: [20, 100] }),
    ];
    const before = [
      prompt('small', 'Small but sure', { chatgpt: [60, 200] }),
      prompt('within', 'Large but thin', { chatgpt: [5, 10] }),
      prompt('gain', 'Big gain', { chatgpt: [30, 100] }),
      prompt('loss', 'Big loss', { chatgpt: [65, 100] }),
    ];
    const model = run(now, before, show);
    // Loss 45 points, gain 40, small 15 (all detectable), then the 30 points that normal variation explains
    expect(ids(model.listed)).toEqual(['loss', 'gain', 'small', 'within']);
    expect(model.listed.map((row) => row.change?.detectable)).toEqual([true, true, true, false]);
  });

  it('a tie in the change goes to the prompt text', () => {
    const now = [prompt('b', 'Beta', { chatgpt: [8, 10] }), prompt('a', 'Alpha', { chatgpt: [8, 10] })];
    const before = [prompt('b', 'Beta', { chatgpt: [4, 10] }), prompt('a', 'Alpha', { chatgpt: [4, 10] })];
    expect(ids(run(now, before, show).listed)).toEqual(['a', 'b']);
  });

  it('the cut is after the sort', () => {
    const now = [
      prompt('a', 'A', { chatgpt: [55, 100] }),
      prompt('b', 'B', { chatgpt: [90, 100] }),
      prompt('c', 'C', { chatgpt: [70, 100] }),
    ];
    const before = [
      prompt('a', 'A', { chatgpt: [50, 100] }),
      prompt('b', 'B', { chatgpt: [20, 100] }),
      prompt('c', 'C', { chatgpt: [40, 100] }),
    ];
    const model = run(now, before, { ...show, rows: 2 });
    expect(ids(model.listed)).toEqual(['b', 'c']);
    expect(model.ranked).toHaveLength(3);
  });
});
