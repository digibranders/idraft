import { describe, expect, it } from 'vitest';

import { cell, engine, weighted } from './cells-fixtures';
import { bestEngine, bestWorst, engineChange, engineGapOf, engineValue, type EngineValue } from './engine-values';
import { MIN_OBSERVATIONS } from '@/lib/stats';

const CODES = ['chatgpt_web', 'gemini_web', 'google_ai_mode'] as const;

/** The mention rate of one engine per `[valid answers that count, valid answers]`, in the order of `CODES`. */
const mentionValues = (...counts: ([k: number, n: number] | null)[]): EngineValue[] => {
  const cells = counts.flatMap((count, at) =>
    count === null ? [] : [engine(CODES[at] ?? 'other', { mentioned: cell(count[0], count[1]) })],
  );
  return CODES.slice(0, counts.length).map((code) => engineValue(cells, code, 'mentioned'));
};

/** An engine with a rate of exactly `value` over 10 answers, for a test of what the rates do together. */
const valued = (code: string, value: number): EngineValue => ({
  code,
  state: 'ok',
  value,
  answers: 10,
  successes: 3,
  prompts: null,
  observations: 10,
  reason: null,
});

describe('engineValue: one engine of one row as a rate with the counts behind it', () => {
  it('reads a topic cell as its percent, the answers behind it and the prompts it weights', () => {
    const cells = [engine('chatgpt_web', { mentioned: weighted(3, 8, 4, 10) })];
    expect(engineValue(cells, 'chatgpt_web', 'mentioned')).toEqual({
      code: 'chatgpt_web',
      state: 'ok',
      value: 3 / 8,
      answers: 8,
      successes: 3,
      prompts: 4,
      observations: 10,
      reason: null,
    });
  });

  it('reads a prompt cell by its denominator, with no prompt count', () => {
    const cells = [engine('gemini_web', { mentioned: cell(2, 5, 6) })];
    expect(engineValue(cells, 'gemini_web', 'mentioned')).toEqual({
      code: 'gemini_web',
      state: 'ok',
      value: 0.4,
      answers: 5,
      successes: 2,
      prompts: null,
      observations: 6,
      reason: null,
    });
  });

  it('is insufficient under 4 valid answers and none with no answer, never 0', () => {
    const few = engineValue([engine('a', { mentioned: cell(1, MIN_OBSERVATIONS - 1) })], 'a', 'mentioned');
    expect(few.state).toBe('insufficient');
    expect(few.value).toBeNull();
    expect(few.answers).toBe(MIN_OBSERVATIONS - 1);

    const noAnswer = engineValue([engine('a')], 'a', 'mentioned');
    expect(noAnswer).toMatchObject({ state: 'none', value: null, answers: 0, successes: null, reason: 'noAnswers' });
    // An engine the row has no cells for is the same: no answer, not a rate of 0
    expect(engineValue([], 'a', 'mentioned')).toMatchObject({ state: 'none', value: null, prompts: null });
    expect(engineValue(undefined, 'a', 'mentioned')).toMatchObject({ state: 'none', value: null });
  });

  it('gives the reason a share of voice is missing: no answers, none valid, no brand named', () => {
    const reasonOf = (cells: ReturnType<typeof engine>): EngineValue['reason'] =>
      engineValue([cells], 'a', 'share_of_voice').reason;
    expect(reasonOf(engine('a'))).toBe('noAnswers');
    // Answers came in, none of them valid
    expect(reasonOf(engine('a', { mentioned: cell(0, 0, 3) }))).toBe('noneValid');
    // Valid answers, none names a tracked brand
    expect(reasonOf(engine('a', { mentioned: cell(1, 6), share_of_voice: cell(0, 0, 6) }))).toBe('noBrandNamed');
  });

  it('counts the answers that name a brand for share of voice and gives no count of successes', () => {
    const value = engineValue([engine('a', { share_of_voice: cell(2.5, 5, 9) })], 'a', 'share_of_voice');
    expect(value).toMatchObject({ state: 'ok', value: 0.5, answers: 5, successes: null, observations: 9 });
  });

  it('takes the prompts of a share of voice from the Mentioned cell of the same engine, which weights them', () => {
    const topic = engine('a', { mentioned: weighted(3, 8, 4, 10), share_of_voice: cell(2.5, 5, 10) });
    expect(engineValue([topic], 'a', 'share_of_voice').prompts).toBe(4);
    // A prompt's Mentioned cell weights nothing, so there is no count of prompts
    const prompt = engine('a', { mentioned: cell(3, 8), share_of_voice: cell(2.5, 5) });
    expect(engineValue([prompt], 'a', 'share_of_voice').prompts).toBeNull();
  });
});

describe('bestWorst: the engines at the two ends of a row', () => {
  it('takes the best and the weakest engine among those with a rate', () => {
    const result = bestWorst(mentionValues([2, 8], [6, 8], [4, 8]));
    expect(result?.best?.code).toBe('gemini_web');
    expect(result?.worst.code).toBe('chatgpt_web');
    expect(result?.counted).toBe(3);
    expect(result?.leftOut).toEqual([]);
  });

  it('breaks a tie by the order the engines are shown in, for the best and for the weakest', () => {
    const bestTied = bestWorst(mentionValues([4, 8], [4, 8], [2, 8]));
    expect(bestTied?.best?.code).toBe('chatgpt_web');
    const worstTied = bestWorst(mentionValues([2, 8], [2, 8], [4, 8]));
    expect(worstTied?.worst.code).toBe('chatgpt_web');
  });

  it('leaves an engine with too few answers out and names it', () => {
    const result = bestWorst(mentionValues([2, 8], [3, 3], [6, 8]));
    expect(result?.counted).toBe(2);
    expect(result?.leftOut).toEqual(['gemini_web']);
    // The thin engine's 100 percent is not the best: it has no rate
    expect(result?.best?.code).toBe('google_ai_mode');
  });

  it('names an engine with no answer among those left out, and does not count it as 0', () => {
    const result = bestWorst(mentionValues([2, 8], [6, 8], null));
    // CODES has 3 entries but the third has no cell: `mentionValues` reads it as no answer
    expect(result?.leftOut).toEqual(['google_ai_mode']);
    expect(result?.worst.value).toBe(0.25);
  });

  it('has no gap under 2 engines with a rate', () => {
    expect(bestWorst(mentionValues([2, 8]))).toBeNull();
    expect(bestWorst(mentionValues([2, 8], [1, 2], null))).toBeNull();
    expect(bestWorst([])).toBeNull();
    expect(engineGapOf(mentionValues([2, 8], [1, 2]))).toBeNull();
  });

  it('has no best engine when every rate is 0', () => {
    const result = bestWorst(mentionValues([0, 8], [0, 6]));
    expect(result?.best).toBeNull();
    expect(result?.spread).toBe(0);
    expect(result?.worst.value).toBe(0);
  });

  it('gives the exact spread in points, not the spread of rounded percents', () => {
    // 5 of 8 is 62.5 percent and 1 of 8 is 12.5: 50 points. 7 of 9 is 77.78 percent, 3 of 9 is 33.33: 44.44 points
    expect(bestWorst(mentionValues([5, 8], [1, 8]))?.spread).toBeCloseTo(50, 10);
    const spread = bestWorst(mentionValues([7, 9], [3, 9]))?.spread ?? Number.NaN;
    expect(spread).toBeCloseTo((4 / 9) * 100, 10);
    // The rounded percents are 78 and 33, which would give 45
    expect(spread).not.toBeCloseTo(45, 1);
    expect(engineGapOf(mentionValues([7, 9], [3, 9]))).toBeCloseTo((4 / 9) * 100, 10);
  });

  it('treats rates that differ by float noise as one: the first engine shown stays best and weakest', () => {
    // 0.1 + 0.2 is 0.30000000000000004: the same 30 percent for every reader
    const noisy = [valued('a', 0.3), valued('b', 0.1 + 0.2), valued('c', 0.3)];
    expect(noisy[1]?.value).not.toBe(0.3);
    const result = bestWorst(noisy);
    expect(result?.best?.code).toBe('a');
    expect(result?.worst.code).toBe('a');
    expect(result?.spread).toBeCloseTo(0, 9);
    // The other way round: the noisy one is first, so it is both
    const other = bestWorst([valued('a', 0.1 + 0.2), valued('b', 0.3)]);
    expect(other?.best?.code).toBe('a');
    expect(other?.worst.code).toBe('a');
  });
});

describe('bestEngine: the one engine a row points to', () => {
  it('names the engine with the highest rate, also when it is the only one with a rate', () => {
    expect(bestEngine([valued('a', 0.2), valued('b', 0.5), valued('c', 0.4)])?.code).toBe('b');
    const lone = [valued('a', 0.2), { ...valued('b', 0.5), state: 'insufficient' as const, value: null }];
    expect(bestEngine(lone)?.code).toBe('a');
  });

  it('gives a tie to the engine shown first, rates that differ by float noise being one rate', () => {
    expect(bestEngine([valued('a', 0.3), valued('b', 0.1 + 0.2)])?.code).toBe('a');
    expect(bestEngine([valued('a', 0.1 + 0.2), valued('b', 0.3)])?.code).toBe('a');
  });

  it('names none when the best rate is 0, and none when no engine has a rate', () => {
    expect(bestEngine([valued('a', 0), valued('b', 0)])).toBeNull();
    expect(bestEngine([])).toBeNull();
  });
});

describe('engineChange: the move of an engine since the compared window', () => {
  const withPrevious = (now: ReturnType<typeof weighted>, before: ReturnType<typeof weighted>, metric = 'mentioned') =>
    [engine('chatgpt_web', { [metric]: now, previous: { [metric]: before } })] as const;

  it('gives the move as a ratio and calls it detectable when the unpaired test on the pooled answers says so', () => {
    const change = engineChange(withPrevious(weighted(40, 80, 6), weighted(20, 80, 6)), 'chatgpt_web', 'mentioned');
    expect(change?.points).toBeCloseTo(0.25, 10);
    expect(change?.detectable).toBe(true);
  });

  it('calls a small move over few answers within normal variation', () => {
    const change = engineChange(withPrevious(weighted(5, 10, 2), weighted(4, 10, 2)), 'chatgpt_web', 'mentioned');
    expect(change?.points).toBeCloseTo(0.1, 10);
    expect(change?.detectable).toBe(false);
  });

  it('gives no test for share of voice, whose numerator is not a count', () => {
    const change = engineChange(
      withPrevious(weighted(40, 80, 6), weighted(20, 80, 6), 'share_of_voice'),
      'chatgpt_web',
      'share_of_voice',
    );
    expect(change?.detectable).toBeNull();
    expect(change?.points).toBeCloseTo(0.25, 10);
  });

  it('has no change without a compared window, or when the compared window has no answer on the engine', () => {
    const plain = [engine('chatgpt_web', { mentioned: weighted(4, 8, 2) })];
    expect(engineChange(plain, 'chatgpt_web', 'mentioned')).toBeNull();
    const none = [engine('chatgpt_web', { mentioned: weighted(4, 8, 2), previous: null })];
    expect(engineChange(none, 'chatgpt_web', 'mentioned')).toBeNull();
    expect(engineChange(undefined, 'chatgpt_web', 'mentioned')).toBeNull();
  });

  it('has no change when either side has too few answers for a rate, never a move from or to 0', () => {
    expect(engineChange(withPrevious(weighted(1, 3, 2), weighted(4, 10, 2)), 'chatgpt_web', 'mentioned')).toBeNull();
    expect(engineChange(withPrevious(weighted(4, 10, 2), weighted(0, 0, 0)), 'chatgpt_web', 'mentioned')).toBeNull();
  });
});
