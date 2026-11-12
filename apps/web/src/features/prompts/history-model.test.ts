import { describe, expect, it } from 'vitest';

import { historyEvents, rateCeiling, weeklyHistory } from './history-model';
import type { EngineSummary, MetricCell, ObservationSummary, WeekCells } from '@/lib/api/types';
import { MIN_OBSERVATIONS, wilsonInterval } from '@/lib/stats';

const cell = (k: number, n: number): MetricCell => ({
  numerator: k,
  denominator: n,
  n_observations: n,
  value: n === 0 ? null : k / n,
});
const week = (weekStart: string, k: number, n: number): WeekCells => ({
  week_start: weekStart,
  mentioned: cell(k, n),
  cited: cell(0, n),
  share_of_voice: cell(0, 0),
});
const engine = (code: string, series: readonly WeekCells[] | null | undefined): EngineSummary =>
  ({
    engine_code: code,
    mentioned: cell(0, 0),
    cited: cell(0, 0),
    share_of_voice: cell(0, 0),
    ...(series === undefined ? {} : { series: series === null ? null : [...series] }),
  }) as unknown as EngineSummary;

const W1 = '2026-10-12';
const W2 = '2026-10-19';
const W3 = '2026-10-26';
const CHATGPT = 'chatgpt_web';
const GEMINI = 'gemini_web';

describe('the weekly history of a prompt', () => {
  it('is not there while the summary has no series: not loaded, an older API or a read without it', () => {
    expect(weeklyHistory([CHATGPT], undefined)).toBeNull();
    expect(weeklyHistory([CHATGPT], [])).toBeNull();
    expect(weeklyHistory([CHATGPT, GEMINI], [engine(CHATGPT, undefined), engine(GEMINI, null)])).toBeNull();
  });

  it('has a point for each week of each engine on the weeks of all of them, oldest first', () => {
    const history = weeklyHistory(
      [CHATGPT, GEMINI],
      [engine(CHATGPT, [week(W2, 3, 5), week(W1, 2, 4)]), engine(GEMINI, [week(W3, 4, 4)])],
    );
    expect(history?.weeks).toEqual([W1, W2, W3]);
    expect(history?.engines.map((entry) => entry.engineCode)).toEqual([CHATGPT, GEMINI]);
    expect(history?.engines[0]?.points.map((point) => point?.value ?? null)).toEqual([0.5, 0.6, null]);
    // A week an engine's series does not list is a gap, not a week with no answers
    expect(history?.engines[1]?.points.map((point) => point === null)).toEqual([true, true, false]);
  });

  it('leaves out the engines that were not asked for, and keeps the order that was', () => {
    const history = weeklyHistory([GEMINI], [engine(CHATGPT, [week(W1, 1, 4)]), engine(GEMINI, [week(W1, 2, 4)])]);
    expect(history?.engines.map((entry) => entry.engineCode)).toEqual([GEMINI]);
  });

  it('gives a week with no valid answer no value and no band, never a zero', () => {
    const point = weeklyHistory([CHATGPT], [engine(CHATGPT, [week(W1, 0, 0)])])?.engines[0]?.points[0];
    expect(point).toEqual({ weekStart: W1, k: 0, n: 0, value: null, band: null, thin: false });
  });

  it('gives a rate of 0 over enough answers a value of 0 with its band', () => {
    const point = weeklyHistory([CHATGPT], [engine(CHATGPT, [week(W1, 0, 8)])])?.engines[0]?.points[0];
    expect(point?.value).toBe(0);
    expect(point?.band).toEqual(wilsonInterval(0, 8));
    expect(point?.thin).toBe(false);
  });

  it('draws a week over fewer than the minimum valid answers as thin, with its value and no band', () => {
    const point = weeklyHistory([CHATGPT], [engine(CHATGPT, [week(W1, 1, MIN_OBSERVATIONS - 1)])])?.engines[0]
      ?.points[0];
    expect(point?.thin).toBe(true);
    expect(point?.band).toBeNull();
    expect(point?.value).toBeCloseTo(1 / (MIN_OBSERVATIONS - 1));
  });

  it('gives a week of the minimum itself a 95 percent Wilson band from its own counts', () => {
    const point = weeklyHistory([CHATGPT], [engine(CHATGPT, [week(W1, 2, MIN_OBSERVATIONS)])])?.engines[0]?.points[0];
    expect(point?.thin).toBe(false);
    expect(point?.band).toEqual(wilsonInterval(2, MIN_OBSERVATIONS));
  });

  it('leaves a week with counts that cannot be real without a band', () => {
    const point = weeklyHistory([CHATGPT], [engine(CHATGPT, [week(W1, 9, 5)])])?.engines[0]?.points[0];
    expect(point?.band).toBeNull();
  });
});

describe('the ceiling of the rate axis', () => {
  const history = (k: number, n: number) => weeklyHistory([CHATGPT], [engine(CHATGPT, [week(W1, k, n)])]);

  it('is the next tenth above the highest rate or band, at least 10 percent and at most 100 percent', () => {
    expect(rateCeiling(null)).toBe(0.1);
    expect(rateCeiling(history(0, 0))).toBe(0.1);
    const high = wilsonInterval(2, 8)?.high ?? 0;
    expect(rateCeiling(history(2, 8))).toBe(Math.ceil(high * 10) / 10);
    expect(rateCeiling(history(8, 8))).toBe(1);
  });
});

const model = (id: string, engine: string, observedAt: string, model: string | null): ObservationSummary =>
  ({ observation_id: id, engine_code: engine, observed_at: observedAt, model_reported: model }) as ObservationSummary;

describe('the events of a prompt', () => {
  const ADDED = '2026-09-01T09:00:00Z';

  it('lists when the prompt was added, and nothing else for answers from one model', () => {
    expect(
      historyEvents(ADDED, [
        model('1', CHATGPT, '2026-10-01T02:00:00Z', 'gpt-5'),
        model('2', CHATGPT, '2026-10-05T02:00:00Z', 'gpt-5'),
      ]),
    ).toEqual([{ id: 'added', kind: 'added', at: ADDED }]);
  });

  it('adds a change of the model an engine reports, dated by the first answer of the new one, newest first', () => {
    const events = historyEvents(ADDED, [
      model('4', CHATGPT, '2026-10-12T02:00:00Z', 'gpt-5.1'),
      model('1', CHATGPT, '2026-10-01T02:00:00Z', 'gpt-5'),
      model('3', GEMINI, '2026-10-08T02:00:00Z', 'gemini-3'),
      model('2', GEMINI, '2026-10-02T02:00:00Z', 'gemini-2.5'),
    ]);
    expect(events.map((event) => [event.kind, event.at, event.engineCode, event.from, event.to])).toEqual([
      ['model', '2026-10-12T02:00:00Z', CHATGPT, 'gpt-5', 'gpt-5.1'],
      ['model', '2026-10-08T02:00:00Z', GEMINI, 'gemini-2.5', 'gemini-3'],
      ['added', ADDED, undefined, undefined, undefined],
    ]);
  });

  it('compares the models of one engine only, and skips an answer that reports none', () => {
    const events = historyEvents(ADDED, [
      model('1', CHATGPT, '2026-10-01T02:00:00Z', 'gpt-5'),
      model('2', GEMINI, '2026-10-02T02:00:00Z', 'gemini-3'),
      model('3', CHATGPT, '2026-10-05T02:00:00Z', null),
      model('4', CHATGPT, '2026-10-09T02:00:00Z', 'gpt-5'),
    ]);
    expect(events.map((event) => event.kind)).toEqual(['added']);
  });
});
