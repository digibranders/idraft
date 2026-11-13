import { describe, expect, it } from 'vitest';

import { TREND_FLAT_BAND, trendDirection, trendPoints, type TrendPoint } from './trend-model';
import type { EngineSummary, MetricCell, WeekCells } from '@/lib/api/types';
import { MIN_OBSERVATIONS } from '@/lib/stats';

/** A cell over `denominator` valid answers; a topic's cell counts them in `pooled`, with `denominator` left small. */
const cell = (value: number | null, denominator = MIN_OBSERVATIONS, pooledTrials?: number): MetricCell => ({
  value,
  numerator: value === null ? 0 : value * denominator,
  denominator: value === null ? 0 : denominator,
  n_observations: denominator,
  ...(pooledTrials === undefined ? {} : { pooled: { successes: 1, trials: pooledTrials } }),
});
const week = (weekStart: string, value: number | null, denominator = MIN_OBSERVATIONS): WeekCells => ({
  week_start: weekStart,
  prompts: 1,
  is_pooled: false,
  mentioned: cell(value, denominator),
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
const point = (weekStart: string, value: number | null, enough = true): TrendPoint => ({ weekStart, value, enough });

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
    expect(points?.map((entry) => entry.weekStart)).toEqual([W1, W2]);
    expect(points?.[0]?.value).toBeCloseTo(0.3);
    expect(points?.[1]?.value).toBeCloseTo(0.6);
  });

  it('leaves an engine without answers in a week out of that week, not counted as 0', () => {
    const points = trendPoints(CODES, [
      engine('chatgpt_web', [week(W1, 0.5), week(W2, null)]),
      engine('gemini_web', [week(W1, null), week(W2, 0.25)]),
    ]);
    expect(points).toEqual([point(W1, 0.5), point(W2, 0.25)]);
  });

  it('has a gap for a week no engine has a rate in, and a zero where the rate is zero', () => {
    const points = trendPoints(CODES, [
      engine('chatgpt_web', [week(W1, 0), week(W2, null), week(W3, 0.5)]),
      engine('gemini_web', [week(W1, 0), week(W2, null), week(W3, null)]),
    ]);
    expect(points).toEqual([point(W1, 0), point(W2, null, false), point(W3, 0.5)]);
  });

  it('takes the weeks of every engine, a week one engine lacks being its gap', () => {
    const points = trendPoints(CODES, [
      engine('chatgpt_web', [week(W1, 0.5), week(W2, 0.5)]),
      engine('gemini_web', [week(W2, 0.1), week(W3, 0.3)]),
    ]);
    expect(points?.map((entry) => entry.weekStart)).toEqual([W1, W2, W3]);
    expect(points?.[0]?.value).toBeCloseTo(0.5);
    expect(points?.[1]?.value).toBeCloseTo(0.3);
    expect(points?.[2]?.value).toBeCloseTo(0.3);
  });

  it('reads only the engines asked for, and the engines that have a series', () => {
    const points = trendPoints(
      ['gemini_web'],
      [engine('chatgpt_web', [week(W1, 0.9)]), engine('gemini_web', [week(W1, 0.1)]), engine('other', null)],
    );
    expect(points).toEqual([point(W1, 0.1)]);
    expect(trendPoints(['google_ai_mode'], [engine('chatgpt_web', [week(W1, 0.9)])])).toBeNull();
    // One engine with a series is enough, whatever the others have
    expect(trendPoints(CODES, [engine('chatgpt_web', [week(W1, 0.9)]), engine('gemini_web', undefined)])).toEqual([
      point(W1, 0.9),
    ]);
  });

  it('says a week has enough answers when an engine has a rate over the minimum of valid answers', () => {
    const thin = trendPoints(CODES, [
      engine('chatgpt_web', [week(W1, 0.5, 1), week(W2, 0.5, MIN_OBSERVATIONS - 1)]),
      engine('gemini_web', [week(W1, 0.5, MIN_OBSERVATIONS), week(W2, 0.5, 1)]),
    ]);
    // The rate of a thin week is still drawn; only its weight in a direction is taken away
    expect(thin).toEqual([point(W1, 0.5, true), point(W2, 0.5, false)]);
  });

  it('counts a topic by the answers pooled behind its weekly rate, not by its denominator', () => {
    const topic = {
      ...week(W1, 0.5),
      mentioned: cell(0.5, 2, MIN_OBSERVATIONS + 2),
    };
    expect(trendPoints(CODES, [engine('chatgpt_web', [topic])])).toEqual([point(W1, 0.5, true)]);
    const thinTopic = { ...week(W1, 0.5), mentioned: cell(0.5, 9, 1) };
    expect(trendPoints(CODES, [engine('chatgpt_web', [thinTopic])])).toEqual([point(W1, 0.5, false)]);
  });
});

/** Weeks of a rate each, on enough answers, from the Monday of 12 October. */
const weeks = (...values: (number | null)[]): TrendPoint[] =>
  values.map((value, at) => point(`2026-10-${String(12 + at * 7).padStart(2, '0')}`, value));

describe('the direction of a weekly mention rate', () => {
  it('compares the first and the last week inside the window that have enough answers', () => {
    expect(trendDirection(weeks(0.9, 0.2, 0.3, 0.5, 0.1))).toBe('up');
    expect(trendDirection(weeks(0.1, 0.6, 0.5, 0.4, 0.9))).toBe('down');
  });

  it('leaves out the first and the last week of the series, which the window cuts', () => {
    // The edge weeks say up; the weeks between say nothing moved
    expect(trendDirection(weeks(0.1, 0.5, 0.5, 0.5, 0.9))).toBe('flat');
    // Two weeks have no week between them
    expect(trendDirection(weeks(0.1, 0.9))).toBe('none');
    expect(trendDirection(weeks(0.1, 0.5, 0.9))).toBe('none');
  });

  it('leaves out weeks without enough answers, and gaps', () => {
    const thin = [point('a', 0.1), point('b', 0.1, false), point('c', 0.9, false), point('d', 0.9), point('e', 0.9)];
    // One answer against one answer is no direction
    expect(trendDirection(thin)).toBe('none');
    expect(
      trendDirection([point('a', 0.2), point('b', 0.2), point('c', null, false), point('d', 0.7), point('e', 0.7)]),
    ).toBe('up');
  });

  it('calls a move inside the band flat', () => {
    expect(trendDirection(weeks(0, 0.5, 0.5, 0.5 + TREND_FLAT_BAND / 2, 0))).toBe('flat');
    expect(trendDirection(weeks(0, 0.5, 0.5, 0.5 - TREND_FLAT_BAND / 2, 0))).toBe('flat');
    expect(trendDirection(weeks(0, 0.5, 0.5, 0.5 + TREND_FLAT_BAND * 2, 0))).toBe('up');
  });

  it('says nothing without two weeks to compare', () => {
    expect(trendDirection(weeks(0, 0.4, null, null, 0))).toBe('none');
    expect(trendDirection(weeks(null, null, null))).toBe('none');
    expect(trendDirection([])).toBe('none');
  });
});
