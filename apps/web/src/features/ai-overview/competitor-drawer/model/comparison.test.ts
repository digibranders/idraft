import { describe, expect, it } from 'vitest';

import { compareInScope, platformRows } from './comparison';
import {
  cell,
  competitor,
  engine,
  entityCells,
  id,
  own,
  promptRow,
  share,
  summaryOf,
} from '../../cards/competitors/model/summary-fixtures';
import { trackedSetOf } from '../../cards/competitors/model/tracked-set';

const HUBSPOT = competitor(2, 'HubSpot');
const ENTITIES = [own(), HUBSPOT];

/** One prompt on one platform: `n` valid answers, you named in `you`, HubSpot in `rival`. */
function onPlatform(code: string, n: number, you: number, rival: number) {
  return engine(code, {
    mentioned: cell(you, n),
    share: share(you + rival, n),
    entities: [entityCells(own(), cell(you, n), share(you, n)), entityCells(HUBSPOT, cell(rival, n), share(rival, n))],
  });
}

function read(prompts: ReturnType<typeof promptRow>[], codes: string[], average: boolean) {
  const summary = summaryOf({ entities: ENTITIES, prompts });
  return compareInScope(summary, codes, trackedSetOf(summary, null), id(2), average);
}

describe('compareInScope', () => {
  it('on one platform gives each rate with the answers behind it', () => {
    const result = read(
      [promptRow(1, [onPlatform('chatgpt_web', 8, 4, 2)]), promptRow(2, [onPlatform('chatgpt_web', 8, 2, 6)])],
      ['chatgpt_web'],
      false,
    );
    // Each prompt counts once: the mean of 4/8 and 2/8, the mean of 2/8 and 6/8
    expect(result?.mention.own).toEqual({ value: 0.375, answers: 16, successes: 6, counts: { k: 6, n: 16 } });
    expect(result?.mention.rival).toEqual({ value: 0.5, answers: 16, successes: 8, counts: { k: 8, n: 16 } });
    expect(result?.mention.platforms).toBe(1);
    // Share of voice is x of y brand mentions: your 6 mentions of the 14 that you and HubSpot have together
    expect(result?.share.own.value).toBeCloseTo(6 / 14);
    expect(result?.share.own.successes).toBe(6);
    expect(result?.share.own.answers).toBe(14);
  });

  it('on All platforms averages the platforms and keeps no count, because answers are never pooled (R3)', () => {
    const result = read(
      [promptRow(1, [onPlatform('chatgpt_web', 8, 4, 2), onPlatform('gemini_web', 8, 0, 4)])],
      ['chatgpt_web', 'gemini_web'],
      true,
    );
    expect(result?.mention.own.value).toBeCloseTo(0.25);
    expect(result?.mention.rival.value).toBeCloseTo(0.375);
    expect(result?.mention.platforms).toBe(2);
    expect(result?.mention.own.answers).toBeNull();
    // The gap of an average is tested on the counts of the platforms in it, added up
    expect(result?.mention.own.counts).toEqual({ k: 4, n: 16 });
    expect(result?.mention.rival.counts).toEqual({ k: 6, n: 16 });
  });

  it('leaves out a platform where either brand has under 4 valid answers, and never turns it into 0', () => {
    const result = read(
      [promptRow(1, [onPlatform('chatgpt_web', 8, 4, 2), onPlatform('gemini_web', 3, 0, 3)])],
      ['chatgpt_web', 'gemini_web'],
      true,
    );
    expect(result?.mention.platforms).toBe(1);
    expect(result?.mention.own.value).toBeCloseTo(0.5);
    const none = read([promptRow(1, [onPlatform('chatgpt_web', 3, 0, 3)])], ['chatgpt_web'], false);
    expect(none?.mention.own.value).toBeNull();
    expect(none?.mention.rival.value).toBeNull();
    expect(none?.mention.platforms).toBe(0);
  });

  it('is null while the summary carries no entity cells', () => {
    const summary = summaryOf({ entities: ENTITIES, prompts: [promptRow(1, [engine('chatgpt_web')])] });
    expect(compareInScope(summary, ['chatgpt_web'], trackedSetOf(summary, null), id(2), false)).toBeNull();
  });
});

describe('platformRows', () => {
  it('has one row per platform on its own figures, null where a brand has under 4 answers', () => {
    const summary = summaryOf({
      entities: ENTITIES,
      prompts: [promptRow(1, [onPlatform('chatgpt_web', 8, 4, 2), onPlatform('gemini_web', 3, 1, 1)])],
    });
    const rows = platformRows(
      summary,
      ['chatgpt_web', 'gemini_web', 'google_ai_mode'],
      trackedSetOf(summary, null),
      id(2),
    );
    expect(rows).toEqual([
      { code: 'chatgpt_web', own: 0.5, rival: 0.25, ownCounts: { k: 4, n: 8 }, rivalCounts: { k: 2, n: 8 } },
      { code: 'gemini_web', own: null, rival: null, ownCounts: null, rivalCounts: null },
    ]);
  });
});
