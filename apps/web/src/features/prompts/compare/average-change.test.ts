import { describe, expect, it } from 'vitest';

import { averageChange } from './average-change';
import { cell, engineOf, projectEngine } from './change-test-data';
import type { ChangeTipOptions, ChangeWords, ChangeGap } from './change-words';

/** Words that name what they were asked, so a test reads which sentence the helper chose. */
const words: ChangeWords = {
  tip: (change, options: ChangeTipOptions) =>
    change === null
      ? ''
      : `tip ${JSON.stringify({ engines: change.engines, shown: options.shown, engine: options.engine, metric: options.metric })}`,
  label: () => 'label',
  gap: (reason: ChangeGap) => `gap ${reason}`,
};

const CHATGPT = projectEngine('chatgpt_web');
const GEMINI = projectEngine('gemini_web');
const RANGE = 'Sep 18 to Oct 15';

const run = (
  cells: Parameters<typeof averageChange>[0]['cells'],
  engines = [CHATGPT, GEMINI],
  range: string | null = RANGE,
  metric: 'mentioned' | 'share_of_voice' = 'mentioned',
): ReturnType<typeof averageChange> => averageChange({ cells, engines, metric, range, words });

describe('averageChange', () => {
  it('names the one engine of several that has a rate in both periods', () => {
    const { change, tip } = run([
      engineOf('chatgpt_web', cell(30, 60), cell(12, 60)),
      engineOf('gemini_web', cell(40, 80), null),
    ]);
    expect(change?.engines).toBe(1);
    expect(tip).toContain('"engine":"ChatGPT"');
    // The average on screen is over both engines: the tip is told so
    expect(tip).toContain('"shown":2');
  });

  it('does not name an engine when two took part, and gives the count of the average shown', () => {
    const { change, tip } = run([
      engineOf('chatgpt_web', cell(30, 60), cell(12, 60)),
      engineOf('gemini_web', cell(40, 80), cell(20, 80)),
    ]);
    expect(change?.engines).toBe(2);
    expect(tip).toContain('"engines":2');
    expect(tip).not.toContain('"engine":');
  });

  it('counts only engines with a rate now in the average shown (the partial wording)', () => {
    // Gemini has 3 answers now: it is not in the average shown, and ChatGPT alone has the change
    const { tip } = run([
      engineOf('chatgpt_web', cell(30, 60), cell(12, 60)),
      engineOf('gemini_web', cell(1, 3), cell(20, 80)),
    ]);
    expect(tip).toContain('"shown":1');
  });

  it('says there is no previous period when no engine has a previous cell', () => {
    const { change, tip } = run([
      engineOf('chatgpt_web', cell(30, 60), null),
      engineOf('gemini_web', cell(40, 80), null),
    ]);
    expect(change).toBeNull();
    expect(tip).toBe('gap noPrevious');
  });

  it('says no engine has a rate in both periods when engines have a previous but none a rate in both', () => {
    const { change, tip } = run([
      engineOf('chatgpt_web', cell(30, 60), cell(1, 3)),
      engineOf('gemini_web', cell(1, 3), cell(20, 80)),
    ]);
    expect(change).toBeNull();
    expect(tip).toBe('gap noEngineInBoth');
  });

  it('says too few answers for a single engine shown', () => {
    const { change, tip } = run([engineOf('chatgpt_web', cell(30, 60), cell(1, 3))], [CHATGPT]);
    expect(change).toBeNull();
    expect(tip).toBe('gap tooFew');
  });

  it('gives no reason while the response was not compared, and none for a row not read', () => {
    expect(run([engineOf('chatgpt_web', cell(30, 60), null)], [CHATGPT], null)).toEqual({ change: null, tip: '' });
    expect(run(undefined)).toEqual({ change: null, tip: 'gap noPrevious' });
  });

  it('passes the metric to the words, so share of voice can say it has no test', () => {
    const shares: readonly [ReturnType<typeof cell>, ReturnType<typeof cell>] = [cell(30, 60), cell(12, 60)];
    const { tip } = run(
      [engineOf('chatgpt_web', cell(30, 60), cell(12, 60), shares)],
      [CHATGPT],
      RANGE,
      'share_of_voice',
    );
    expect(tip).toContain('"metric":"share_of_voice"');
  });
});
