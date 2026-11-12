import { describe, expect, it } from 'vitest';

import { TREND_FLAT_BAND, trendDirection, trendPoints, type TrendPoint } from './trend-model';
import type { EngineSummary, MetricCell, WeekCells } from '@/lib/api/types';

const cell = (value: number | null, denominator = 4): MetricCell => ({
  value,
  numerator: value === null ? 0 : value * denominator,
  denominator: value === null ? 0 : denominator,
  n_observations: denominator,
});
const week = (weekStart: string, value: number | null): WeekCells => ({
  week_start: weekStart,
  mentioned: cell(value),
  cited: cell(null),
  share_of_voice: cell(null),
});
/** An engine row of a summary; `series` is left out when it is `undefined`. */
const engine = (code: string, series: readonly WeekCells[] | null | undefined): EngineSummary =>
  ({
    engine_code: code,
    mentioned: cell(0.5),
    cited: cell(0.25),
    share_of_voice: cell(null),
    ...(series === undefined ? {} : { series: series === null ? null : [...series] }),
  }) as unknown as EngineSummary;

const W1 = '2026-10-12';
const W2 = '2026-10-19';
const W3 = '2026-10-26';
const CODES = ['chatgpt_web', 'gemini_web'];

describe('the weekly mention rate of a row', () => {
  it('is not there while the summary has no series: not loaded, an older API or a read without it', () => {
    expect(trendPoints(CODES, undefined)).toBeNull();
    expect(trendPoints(CODES, [])).toBeNull();
    expect(trendPoints(CODES, [engine('chatgpt_web', undefined), engine('gemini_web', null)])).toBeNull();
  });

  it('is the equal weight average of the engines of each week, oldest week first', () => {
    const points = trendPoints(CODES, [
      engine('chatgpt_web', [week(W1, 0.2), week(W2, 0.4)]),
      engine('gemini_web', [week(W1, 0.4), week(W2, 0.8)]),
    ]);
    expect(points?.map((point) => point.weekStart)).toEqual([W1, W2]);
    expect(points?.[0]?.value).toBeCloseTo(0.3);
    expect(points?.[1]?.value).toBeCloseTo(0.6);
  });

  it('leaves an engine without answers in a week out of that week, not counted as 0', () => {
    const points = trendPoints(CODES, [
      engine('chatgpt_web', [week(W1, 0.5), week(W2, null)]),
      engine('gemini_web', [week(W1, null), week(W2, 0.25)]),
    ]);
    expect(points).toEqual<TrendPoint[]>([
      { weekStart: W1, value: 0.5 },
      { weekStart: W2, value: 0.25 },
    ]);
  });

  it('has a gap for a week no engine has a rate in, and a zero where the rate is zero', () => {
    const points = trendPoints(CODES, [
      engine('chatgpt_web', [week(W1, 0), week(W2, null), week(W3, 0.5)]),
      engine('gemini_web', [week(W1, 0), week(W2, null), week(W3, null)]),
    ]);
    expect(points).toEqual<TrendPoint[]>([
      { weekStart: W1, value: 0 },
      { weekStart: W2, value: null },
      { weekStart: W3, value: 0.5 },
    ]);
  });

  it('takes the weeks of every engine, a week one engine lacks being its gap', () => {
    const points = trendPoints(CODES, [
      engine('chatgpt_web', [week(W1, 0.5), week(W2, 0.5)]),
      engine('gemini_web', [week(W2, 0.1), week(W3, 0.3)]),
    ]);
    expect(points?.map((point) => point.weekStart)).toEqual([W1, W2, W3]);
    expect(points?.[0]?.value).toBeCloseTo(0.5);
    expect(points?.[1]?.value).toBeCloseTo(0.3);
    expect(points?.[2]?.value).toBeCloseTo(0.3);
  });

  it('reads only the engines asked for, and the engines that have a series', () => {
    const points = trendPoints(
      ['gemini_web'],
      [engine('chatgpt_web', [week(W1, 0.9)]), engine('gemini_web', [week(W1, 0.1)]), engine('other', null)],
    );
    expect(points).toEqual<TrendPoint[]>([{ weekStart: W1, value: 0.1 }]);
    expect(trendPoints(['google_ai_mode'], [engine('chatgpt_web', [week(W1, 0.9)])])).toBeNull();
    // One engine with a series is enough, whatever the others have
    expect(trendPoints(CODES, [engine('chatgpt_web', [week(W1, 0.9)]), engine('gemini_web', undefined)])).toEqual<
      TrendPoint[]
    >([{ weekStart: W1, value: 0.9 }]);
  });
});

const points = (...values: (number | null)[]): TrendPoint[] =>
  values.map((value, at) => ({ weekStart: `2026-10-${String(12 + at * 7).padStart(2, '0')}`, value }));

describe('the direction of a weekly mention rate', () => {
  it('compares the first week with a rate and the last one', () => {
    expect(trendDirection(points(0.2, 0.3, 0.5))).toBe('up');
    expect(trendDirection(points(0.6, 0.5, 0.4))).toBe('down');
  });

  it('skips the gaps at either end, and calls a move inside the band flat', () => {
    expect(trendDirection(points(null, 0.2, null, 0.6, null))).toBe('up');
    expect(trendDirection(points(0.5, 0.5 + TREND_FLAT_BAND / 2))).toBe('flat');
    expect(trendDirection(points(0.5, 0.5 - TREND_FLAT_BAND / 2))).toBe('flat');
    expect(trendDirection(points(0.5, 0.5 + TREND_FLAT_BAND * 2))).toBe('up');
  });

  it('is flat without two weeks with a rate to compare', () => {
    expect(trendDirection(points(0.4))).toBe('flat');
    expect(trendDirection(points(null, null))).toBe('flat');
    expect(trendDirection([])).toBe('flat');
  });
});
