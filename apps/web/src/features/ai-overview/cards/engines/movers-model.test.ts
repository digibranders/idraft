import { describe, expect, it } from 'vitest';

import { engineCells, promptRow, type Counts } from './engines-fixtures';
import { buildMovers, type Mover, type MoversModel } from './movers-model';
import { pairPrompts } from './prompt-pairs';
import { differenceInterval, isDetectableChange } from '@/lib/stats';

const CHATGPT = 'chatgpt_web';

/** One prompt asked on ChatGPT only, with its mention counts. */
const row = (id: string, counts: Counts, text?: string): ReturnType<typeof promptRow> =>
  promptRow(id, [engineCells(CHATGPT, { mentioned: counts })], text === undefined ? {} : { text });

const pairs = (now: ReturnType<typeof row>[], before: ReturnType<typeof row>[]): ReturnType<typeof pairPrompts> =>
  pairPrompts(now, before, [CHATGPT]);

function moversOf(model: MoversModel): Mover[] {
  if (model.state !== 'ok') throw new Error(`Expected movers, got ${model.state}`);
  return model.movers;
}

const ids = (movers: Mover[]): string[] => movers.map((mover) => mover.promptId);

describe('buildMovers', () => {
  it('gives the change in points per prompt and engine from the two windows counts', () => {
    const model = buildMovers({
      pairs: pairs([row('p1', [6, 8])], [row('p1', [2, 8])]),
      engine: CHATGPT,
      direction: 'both',
      rows: 5,
    });
    const [mover] = moversOf(model);
    expect(mover?.now).toEqual({ k: 6, n: 8, rate: 0.75 });
    expect(mover?.before).toEqual({ k: 2, n: 8, rate: 0.25 });
    expect(mover?.points).toBeCloseTo(0.5, 12);
  });

  it('uses differenceInterval for the interval and isDetectableChange for the verdict (parity)', () => {
    const model = buildMovers({
      pairs: pairs([row('p1', [6, 8]), row('p2', [5, 8])], [row('p1', [2, 8]), row('p2', [4, 8])]),
      engine: CHATGPT,
      direction: 'both',
      rows: 5,
    });
    for (const mover of moversOf(model)) {
      const now = { k: mover.now.k, n: mover.now.n };
      const before = { k: mover.before.k, n: mover.before.n };
      expect(mover.interval).toEqual(differenceInterval(now, before));
      expect(mover.detectable).toBe(isDetectableChange(now, before));
    }
    // 2 of 8 to 6 of 8 is larger than normal variation, 4 of 8 to 5 of 8 is not
    const byId = new Map(moversOf(model).map((mover) => [mover.promptId, mover]));
    expect(byId.get('p2')?.detectable).toBe(false);
  });

  it('leaves out prompts with fewer than 4 valid answers in either window and counts them', () => {
    const model = buildMovers({
      pairs: pairs(
        [row('p1', [6, 8]), row('p2', [1, 3]), row('p3', [4, 6])],
        [row('p1', [2, 8]), row('p2', [2, 8]), row('p3', [1, 2])],
      ),
      engine: CHATGPT,
      direction: 'both',
      rows: 5,
    });
    expect(ids(moversOf(model))).toEqual(['p1']);
    expect(model.state === 'ok' && model.leftOut).toBe(2);
    expect(model.state === 'ok' && model.compared).toBe(1);
  });

  it('does not count a prompt the engine never answered as left out', () => {
    const asked = pairPrompts(
      [promptRow('p1', [engineCells('gemini_web', { mentioned: [4, 8] })]), row('p2', [6, 8])],
      [promptRow('p1', [engineCells('gemini_web', { mentioned: [1, 8] })]), row('p2', [2, 8])],
      [CHATGPT, 'gemini_web'],
    );
    const model = buildMovers({ pairs: asked, engine: CHATGPT, direction: 'both', rows: 5 });
    expect(model.state === 'ok' && model.leftOut).toBe(0);
    expect(ids(moversOf(model))).toEqual(['p2']);
  });

  it('orders by the size of the change and breaks ties by prompt text', () => {
    const model = buildMovers({
      pairs: pairs(
        [row('a', [6, 8], 'beta'), row('b', [2, 8], 'alpha'), row('c', [8, 8], 'gamma'), row('d', [6, 8], 'alpha')],
        [row('a', [4, 8], 'beta'), row('b', [4, 8], 'alpha'), row('c', [0, 8], 'gamma'), row('d', [4, 8], 'alpha')],
      ),
      engine: CHATGPT,
      direction: 'both',
      rows: 8,
    });
    // c moved 100 points; a, b and d moved 25, and ties read alpha, alpha, beta (b and d share a text: id breaks it)
    expect(moversOf(model).map((mover) => mover.text)).toEqual(['gamma', 'alpha', 'alpha', 'beta']);
  });

  it('filters by direction after the ordering and caps at the Rows option', () => {
    const now = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id, index) => row(id, [8 - index, 8]));
    const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => row(id, [4, 8]));
    const all = pairs(now, before);
    // a +50, b +37.5, c +25, d +12.5, e 0, f -12.5, g -25
    // by size, with the 25 point tie of c and g and the 12.5 point tie of d and f read in text order
    expect(ids(moversOf(buildMovers({ pairs: all, engine: CHATGPT, direction: 'both', rows: 5 })))).toEqual([
      'a',
      'b',
      'c',
      'g',
      'd',
    ]);
    expect(ids(moversOf(buildMovers({ pairs: all, engine: CHATGPT, direction: 'up', rows: 5 })))).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
    expect(ids(moversOf(buildMovers({ pairs: all, engine: CHATGPT, direction: 'down', rows: 5 })))).toEqual(['g', 'f']);
    const capped = buildMovers({ pairs: all, engine: CHATGPT, direction: 'both', rows: 5 });
    // the six prompts that moved, five of them shown
    expect(capped.state === 'ok' && capped.moved).toBe(6);
  });

  it('does not treat a prompt that exists in one window only as a mover, and does not count it as left out', () => {
    const model = buildMovers({
      pairs: pairs([row('p1', [6, 8]), row('new', [8, 8])], [row('p1', [2, 8]), row('gone', [0, 8])]),
      engine: CHATGPT,
      direction: 'both',
      rows: 5,
    });
    expect(ids(moversOf(model))).toEqual(['p1']);
    expect(model.state === 'ok' && model.leftOut).toBe(0);
  });

  it('says there is nothing to compare when there are no pairs or the window before has no answers', () => {
    expect(buildMovers({ pairs: null, engine: CHATGPT, direction: 'both', rows: 5 })).toEqual({ state: 'noPrevious' });
    const empty = pairs([row('p1', [6, 8])], [row('p1', [0, 0, 0])]);
    expect(buildMovers({ pairs: empty, engine: CHATGPT, direction: 'both', rows: 5 })).toEqual({
      state: 'noPrevious',
    });
  });

  it('says no prompt can be compared when every prompt is under 4 valid answers in a window', () => {
    const model = buildMovers({
      pairs: pairs([row('p1', [1, 3]), row('p2', [2, 3])], [row('p1', [1, 8]), row('p2', [2, 8])]),
      engine: CHATGPT,
      direction: 'both',
      rows: 5,
    });
    expect(model).toEqual({ state: 'nonePaired', leftOut: 2 });
  });

  it('says no prompt moved when the compared prompts did not change or the direction has none', () => {
    const same = pairs([row('p1', [4, 8])], [row('p1', [4, 8])]);
    expect(buildMovers({ pairs: same, engine: CHATGPT, direction: 'both', rows: 5 })).toEqual({
      state: 'noneMoved',
      leftOut: 0,
      compared: 1,
    });
    const rose = pairs([row('p1', [6, 8])], [row('p1', [2, 8])]);
    expect(buildMovers({ pairs: rose, engine: CHATGPT, direction: 'down', rows: 5 }).state).toBe('noneMoved');
  });
});
