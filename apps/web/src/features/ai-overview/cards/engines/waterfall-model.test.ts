import { describe, expect, it } from 'vitest';

import { engineCells, promptRow, type Counts } from './engines-fixtures';
import { pairPrompts } from './prompt-pairs';
import {
  buildWaterfall,
  waterfallDomain,
  type WaterfallBar,
  type WaterfallMetric,
  type WaterfallModel,
} from './waterfall-model';
import type { PromptSummaryRow } from '@/lib/api/types';
import { engineRates } from '@/lib/rates/strip-model';

const CHATGPT = 'chatgpt_web';
const EPSILON = 1e-9;

interface Prompt {
  id: string;
  mentioned: Counts;
  cited?: Counts;
}

const rowOf = ({ id, mentioned, cited }: Prompt): PromptSummaryRow =>
  promptRow(id, [engineCells(CHATGPT, { mentioned, ...(cited === undefined ? {} : { cited }) })], {
    text: `Text ${id}`,
  });

/** The strip's own rate of the window: the figure the card's start and end bars must equal (R12). */
function stripRate(prompts: readonly Prompt[], metric: WaterfallMetric): number | null {
  return engineRates(prompts.map(rowOf), CHATGPT)[metric].value;
}

function waterfall(
  now: readonly Prompt[],
  before: readonly Prompt[],
  metric: WaterfallMetric = 'mentioned',
): WaterfallModel {
  return buildWaterfall({
    pairs: pairPrompts(now.map(rowOf), before.map(rowOf), [CHATGPT]),
    engine: CHATGPT,
    metric,
    start: stripRate(before, metric),
    end: stripRate(now, metric),
  });
}

function barsOf(model: WaterfallModel): WaterfallBar[] {
  if (model.state !== 'ok') throw new Error(`Expected a waterfall, got ${model.state}`);
  return model.bars;
}

const bar = (bars: WaterfallBar[], id: WaterfallBar['id']): WaterfallBar => {
  const found = bars.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`No bar ${id}`);
  return found;
};

/** start + rose + fell + too few + prompt set changed, which must be the end. */
const total = (bars: WaterfallBar[]): number =>
  ['start', 'rose', 'fell', 'tooFew', 'setChanged'].reduce(
    (sum, id) => sum + bar(bars, id as WaterfallBar['id']).value,
    0,
  );

// Four prompts in both windows (a up, b down, c with too few answers, d unchanged), g only before, e only now
const BEFORE: Prompt[] = [
  { id: 'a', mentioned: [2, 8] },
  { id: 'b', mentioned: [6, 8] },
  { id: 'c', mentioned: [1, 2] },
  { id: 'd', mentioned: [4, 4] },
  { id: 'g', mentioned: [3, 4] },
];
const NOW: Prompt[] = [
  { id: 'a', mentioned: [6, 8] },
  { id: 'b', mentioned: [2, 8] },
  { id: 'c', mentioned: [2, 2] },
  { id: 'd', mentioned: [4, 4] },
  { id: 'e', mentioned: [3, 4] },
];

/** A seeded generator (mulberry32): the sets are the same on every run. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generatedSet(random: () => number, ids: readonly string[]): Prompt[] {
  const whole = (limit: number): number => Math.floor(random() * (limit + 1));
  return ids.flatMap((id): Prompt[] => {
    // About one prompt in five is not asked in the window
    if (random() < 0.2) return [];
    const n = whole(10);
    const cn = whole(10);
    return [{ id, mentioned: [whole(n), n], cited: [whole(cn), cn] }];
  });
}

describe('buildWaterfall', () => {
  it('adds start, rose, fell, too few answers and the prompt set change up to the end', () => {
    const bars = barsOf(waterfall(NOW, BEFORE));
    expect(bar(bars, 'start').value).toBeCloseTo(0.65, 12);
    expect(bar(bars, 'rose').value).toBeCloseTo(0.125, 12);
    expect(bar(bars, 'fell').value).toBeCloseTo(-0.125, 12);
    expect(bar(bars, 'tooFew').value).toBeCloseTo(0.125, 12);
    expect(bar(bars, 'setChanged').value).toBeCloseTo(-0.025, 12);
    expect(bar(bars, 'end').value).toBeCloseTo(0.75, 12);
    expect(Math.abs(total(bars) - bar(bars, 'end').value)).toBeLessThan(EPSILON);
    expect(bars.map((entry) => entry.id)).toEqual(['start', 'rose', 'fell', 'tooFew', 'setChanged', 'end']);
  });

  it('adds up to the end within 1e-9 on 200 generated prompt sets, for mention and for citation', () => {
    const random = seeded(20261114);
    const ids = Array.from({ length: 12 }, (_, index) => `p${String(index)}`);
    let checked = 0;
    for (let round = 0; round < 200; round += 1) {
      const now = generatedSet(random, ids);
      const before = generatedSet(random, ids);
      for (const metric of ['mentioned', 'cited'] as const) {
        const model = waterfall(now, before, metric);
        // A window under 4 valid answers has no rate: no waterfall, which another test pins
        if (model.state !== 'ok') continue;
        checked += 1;
        expect(Math.abs(total(model.bars) - bar(model.bars, 'end').value)).toBeLessThan(EPSILON);
        expect(bar(model.bars, 'start').value).toBe(stripRate(before, metric));
        expect(bar(model.bars, 'end').value).toBe(stripRate(now, metric));
      }
    }
    // The generator mostly makes sets with a rate, so the property is checked on most of them
    expect(checked).toBeGreaterThan(300);
  });

  it('sends a prompt added or left to the prompt set remainder and counts them', () => {
    const model = waterfall(NOW, BEFORE);
    if (model.state !== 'ok') throw new Error('Expected a waterfall');
    expect(model.added).toBe(1);
    expect(model.left).toBe(1);
    expect(bar(model.bars, 'setChanged').prompts).toBe(2);
    // Neither the added prompt nor the one that left is in a part that names prompts
    expect(bar(model.bars, 'rose').top?.text).toBe('Text a');
  });

  it('puts prompts under 4 valid answers in either window only in too few answers', () => {
    const bars = barsOf(
      waterfall(
        [
          { id: 'a', mentioned: [8, 8] },
          { id: 'b', mentioned: [0, 3] },
        ],
        [
          { id: 'a', mentioned: [4, 8] },
          { id: 'b', mentioned: [3, 8] },
        ],
      ),
    );
    expect(bar(bars, 'rose').prompts).toBe(1);
    expect(bar(bars, 'fell').prompts).toBe(0);
    expect(bar(bars, 'fell').value).toBe(0);
    expect(bar(bars, 'tooFew').prompts).toBe(1);
    // b went from 3 of 8 to 0 of 3: its fall is signed into too few answers, over the 2 prompts of both windows
    expect(bar(bars, 'tooFew').value).toBeCloseTo(-0.1875, 12);
  });

  it('has no waterfall while the start or the end rate is unknown', () => {
    const pairs = pairPrompts(NOW.map(rowOf), BEFORE.map(rowOf), [CHATGPT]);
    expect(buildWaterfall({ pairs, engine: CHATGPT, metric: 'mentioned', start: null, end: 0.7 }).state).toBe(
      'unknown',
    );
    expect(buildWaterfall({ pairs, engine: CHATGPT, metric: 'mentioned', start: 0.6, end: null }).state).toBe(
      'unknown',
    );
    expect(buildWaterfall({ pairs: null, engine: CHATGPT, metric: 'mentioned', start: 0.6, end: 0.7 }).state).toBe(
      'unknown',
    );
  });

  it('carries the prompt counts of each bar and names the largest prompt of each part', () => {
    const bars = barsOf(
      waterfall(
        [
          { id: 'a', mentioned: [6, 8] },
          { id: 'b', mentioned: [8, 8] },
          { id: 'c', mentioned: [1, 8] },
          { id: 'd', mentioned: [0, 8] },
          { id: 'e', mentioned: [4, 8] },
        ],
        [
          { id: 'a', mentioned: [4, 8] },
          { id: 'b', mentioned: [2, 8] },
          { id: 'c', mentioned: [2, 8] },
          { id: 'd', mentioned: [8, 8] },
          { id: 'e', mentioned: [4, 8] },
        ],
      ),
    );
    expect(bar(bars, 'start').prompts).toBe(5);
    expect(bar(bars, 'end').prompts).toBe(5);
    expect(bar(bars, 'rose').prompts).toBe(2);
    expect(bar(bars, 'fell').prompts).toBe(2);
    expect(bar(bars, 'rose').top).toEqual({ text: 'Text b', points: 0.75 });
    expect(bar(bars, 'fell').top).toEqual({ text: 'Text d', points: -1 });
  });

  it('reads the citation denominator of the cited cell, not the mention one', () => {
    // 8 valid answers for the mention, 2 for the citation: a citation change on it is too few answers
    const now: Prompt[] = [
      { id: 'a', mentioned: [4, 8], cited: [2, 2] },
      { id: 'b', mentioned: [4, 8], cited: [6, 8] },
    ];
    const before: Prompt[] = [
      { id: 'a', mentioned: [4, 8], cited: [0, 2] },
      { id: 'b', mentioned: [4, 8], cited: [2, 8] },
    ];
    const bars = barsOf(waterfall(now, before, 'cited'));
    expect(bar(bars, 'tooFew').prompts).toBe(1);
    expect(bar(bars, 'rose').prompts).toBe(1);
    expect(bar(bars, 'start').value).toBe(stripRate(before, 'cited'));
    // The same prompts on the mention rate did not change at all
    expect(bar(barsOf(waterfall(now, before, 'mentioned')), 'rose').prompts).toBe(0);
  });

  it('gives an axis that holds every bar and 0', () => {
    for (const [now, before] of [
      [NOW, BEFORE],
      [BEFORE, NOW],
    ] as const) {
      const bars = barsOf(waterfall(now, before));
      const [low, high] = waterfallDomain(bars);
      expect(low).toBeLessThanOrEqual(0);
      for (const entry of bars) {
        expect(low).toBeLessThanOrEqual(Math.min(entry.from, entry.to));
        expect(high).toBeGreaterThanOrEqual(Math.max(entry.from, entry.to));
      }
    }
    expect(waterfallDomain([])).toEqual([0, 0.1]);
  });

  it('lays the floating bars end to end on the rate axis', () => {
    const bars = barsOf(waterfall(NOW, BEFORE));
    expect(bar(bars, 'start')).toMatchObject({ from: 0, to: bar(bars, 'start').value });
    expect(bar(bars, 'rose').from).toBeCloseTo(bar(bars, 'start').value, 12);
    expect(bar(bars, 'fell').from).toBeCloseTo(bar(bars, 'rose').to, 12);
    expect(bar(bars, 'end')).toMatchObject({ from: 0, to: bar(bars, 'end').value });
    expect(bar(bars, 'setChanged').to).toBeCloseTo(bar(bars, 'end').value, 12);
  });
});
