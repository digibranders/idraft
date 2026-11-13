import { describe, expect, it } from 'vitest';

import {
  engineRole,
  historyEvents,
  rateCeiling,
  STALE_AFTER_DAYS,
  staleEvents,
  staleWindow,
  weeklyHistory,
} from './history-model';
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
    // The window of the third week still holds the first two, so the engine's rate goes on over a week it has no point for
    expect(history?.engines[0]?.points.map((point) => point?.value ?? null)).toEqual([0.5, 5 / 9, 5 / 9]);
    // An engine whose series lists no week of the window has a gap there, not a week with no answers
    expect(history?.engines[1]?.points.map((point) => point === null)).toEqual([true, true, false]);
  });

  it('leaves out the engines that were not asked for, and keeps the order that was', () => {
    const history = weeklyHistory([GEMINI], [engine(CHATGPT, [week(W1, 1, 4)]), engine(GEMINI, [week(W1, 2, 4)])]);
    expect(history?.engines.map((entry) => entry.engineCode)).toEqual([GEMINI]);
  });

  describe('as the trailing four weeks pooled', () => {
    /** Five Mondays, 4 weeks apart from the first to the fourth and one more after. */
    const MONDAYS = ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02'] as const;
    // Two answers a week, as a prompt is asked: (mentioned, valid) of each week
    const COUNTS = [
      [1, 2],
      [0, 2],
      [2, 2],
      [1, 2],
      [2, 2],
    ] as const;
    const points = () =>
      weeklyHistory(
        [CHATGPT],
        [
          engine(
            CHATGPT,
            COUNTS.map(([k, n], at) => week(MONDAYS[at] ?? '', k, n)),
          ),
        ],
      )?.engines[0]?.points;

    it('adds the numerators and the denominators of the week and the three before it', () => {
      const [, , , , last] = points() ?? [];
      // Weeks 2 to 5: 0 + 2 + 1 + 2 mentioned of 8 valid answers
      expect(last).toMatchObject({ weekStart: MONDAYS[4], k: 5, n: 8, value: 5 / 8, thin: false, span: 4 });
      expect(last?.band).toEqual(wilsonInterval(5, 8));
    });

    it('pools fewer weeks for the first three, which are thin until the valid answers reach the minimum', () => {
      const pooled = points() ?? [];
      expect(pooled.map((point) => [point?.k, point?.n, point?.span, point?.thin])).toEqual([
        [1, 2, 1, true],
        [1, 4, 2, false],
        [3, 6, 3, false],
        [4, 8, 4, false],
        [5, 8, 4, false],
      ]);
      expect(pooled[0]?.band).toBeNull();
      // A hand built case where a band appears: the second point is the first to hold four valid answers
      expect(pooled[1]?.band).toEqual(wilsonInterval(1, 4));
      expect(pooled[1]?.band?.low).toBeLessThan(0.25);
    });

    it('leaves a window with no valid answer a gap, and a window with no week of the engine too', () => {
      const empty = weeklyHistory([CHATGPT], [engine(CHATGPT, [week(MONDAYS[0], 0, 0)])])?.engines[0]?.points[0];
      expect(empty).toMatchObject({ k: 0, n: 0, value: null, band: null, thin: false });
    });

    it('draws a window of fewer than the minimum valid answers as thin, with its value and no band', () => {
      const point = weeklyHistory([CHATGPT], [engine(CHATGPT, [week(W1, 1, MIN_OBSERVATIONS - 1)])])?.engines[0]
        ?.points[0];
      expect(point?.thin).toBe(true);
      expect(point?.band).toBeNull();
      expect(point?.value).toBeCloseTo(1 / (MIN_OBSERVATIONS - 1));
    });

    it('gives a rate of 0 over enough answers a value of 0 with its band', () => {
      const point = weeklyHistory([CHATGPT], [engine(CHATGPT, [week(W1, 0, 8)])])?.engines[0]?.points[0];
      expect(point?.value).toBe(0);
      expect(point?.band).toEqual(wilsonInterval(0, 8));
    });

    it('lets a week with counts that cannot be real add nothing', () => {
      const point = weeklyHistory([CHATGPT], [engine(CHATGPT, [week(W1, 9, 5), week(W2, 2, 4)])])?.engines[0]
        ?.points[1];
      expect(point).toMatchObject({ k: 2, n: 4 });
    });
  });
});

describe('the colour of an engine in a chart', () => {
  it('follows the fixed order of the engines, never the order of the data', () => {
    expect(engineRole('chatgpt_web')).toEqual({ kind: 'brand' });
    expect(engineRole('gemini_web')).toEqual({ kind: 'palette', index: 2 });
    expect(engineRole('google_ai_mode')).toEqual({ kind: 'palette', index: 3 });
  });

  it('gives an engine that is not in the order the colour of everything else', () => {
    expect(engineRole('perplexity_api')).toEqual({ kind: 'other' });
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

describe('the stale engines of a prompt', () => {
  const FROM = '2026-10-01T00:00:00Z';
  const END = '2026-11-02T00:00:00Z';
  const answer = (id: string, engine: string, observedAt: string, valid: boolean | null = true): ObservationSummary =>
    ({
      observation_id: id,
      engine_code: engine,
      observed_at: observedAt,
      facts: valid === null ? null : { is_valid: valid },
    }) as ObservationSummary;
  /** ChatGPT answers every 3 days, so it is never stale. */
  const chatgptEvery3Days = Array.from({ length: 11 }, (_, at) =>
    answer(`c${String(at)}`, CHATGPT, new Date(Date.parse(FROM) + at * 3 * 86_400_000).toISOString()),
  );
  const stale = (observations: readonly ObservationSummary[], end = END, engines = [CHATGPT, GEMINI]) =>
    staleEvents(engines, observations, { from: FROM, end });

  it('adds a stale event for each enabled engine with no valid answer for 7 days or more', () => {
    const events = stale([
      ...chatgptEvery3Days,
      answer('g1', GEMINI, '2026-10-20T02:00:00Z'),
      answer('g2', GEMINI, '2026-10-30T02:00:00Z'),
    ]);
    expect(events).toEqual([
      {
        id: 'stale:gemini_web:2026-10-20T02:00:00Z',
        kind: 'stale',
        at: '2026-10-20T02:00:00Z',
        engineCode: GEMINI,
        days: 10,
      },
    ]);
  });

  it('counts a gap of exactly 7 days and not one of 6', () => {
    expect(STALE_AFTER_DAYS).toBe(7);
    const gap = (days: number) =>
      stale(
        [
          answer('g1', GEMINI, '2026-10-10T00:00:00Z'),
          answer('g2', GEMINI, new Date(Date.parse('2026-10-10T00:00:00Z') + days * 86_400_000).toISOString()),
        ],
        '2026-10-20T00:00:00Z',
        [GEMINI],
      );
    expect(gap(7).map((event) => event.days)).toEqual([7]);
    expect(gap(6)).toEqual([]);
  });

  it('gives an engine with no valid answer in the list one event from the start of the window', () => {
    const events = stale(chatgptEvery3Days);
    expect(events).toEqual([{ id: `stale:gemini_web:${FROM}`, kind: 'stale', at: FROM, engineCode: GEMINI, days: 32 }]);
  });

  it('says nothing of an engine with no valid answer in a list that holds only the newest answers', () => {
    const events = staleEvents([CHATGPT, GEMINI], chatgptEvery3Days, { from: FROM, end: END }, false);
    expect(events).toEqual([]);
  });

  it('does not let an invalid answer, or one with no facts, end a gap', () => {
    const events = stale(
      [
        ...chatgptEvery3Days,
        answer('g1', GEMINI, '2026-10-20T02:00:00Z'),
        answer('g2', GEMINI, '2026-10-25T02:00:00Z', false),
        answer('g3', GEMINI, '2026-10-28T02:00:00Z', null),
      ],
      END,
    );
    expect(events.map((event) => [event.engineCode, event.at, event.days])).toEqual([
      [GEMINI, '2026-10-20T02:00:00Z', 12],
    ]);
  });

  it('measures the gap between two valid answers whatever the order of the list', () => {
    const events = stale(
      [
        answer('g2', GEMINI, '2026-10-30T02:00:00Z'),
        ...chatgptEvery3Days,
        answer('g1', GEMINI, '2026-10-20T02:00:00Z'),
      ],
      END,
    );
    expect(events.map((event) => event.days)).toEqual([10]);
  });

  it('says nothing of an engine that is not in the list of enabled engines', () => {
    expect(stale([], END, [])).toEqual([]);
    expect(
      stale([answer('g1', GEMINI, '2026-10-01T00:00:00Z')], END, [CHATGPT]).map((event) => event.engineCode),
    ).toEqual([CHATGPT]);
  });

  it('measures the last gap to the end of the window, never past now', () => {
    const observations = [...chatgptEvery3Days, answer('g1', GEMINI, '2026-10-30T02:00:00Z')];
    // Window ends Nov 30 but now is Nov 5: 6 days since Oct 30, not stale; at Nov 6 it is 7
    const window = { from: '2026-10-01', to: '2026-11-30' };
    const at = (now: string) => staleWindow(window, FROM, 'UTC', new Date(now));
    expect(stale(observations, at('2026-11-05T02:00:00Z').end)).toEqual([]);
    expect(stale(observations, at('2026-11-06T02:00:00Z').end).map((event) => event.days)).toEqual([7]);
    // A window that ended before now ends at the close of its last day
    expect(at('2026-12-20T00:00:00Z').end).toBe('2026-12-01T00:00:00.000Z');
  });
});

describe('the window a stale gap is measured in', () => {
  it('starts at the start of the first project day, or when the prompt was added if that is later', () => {
    const range = { from: '2026-10-01', to: '2026-10-31' };
    const now = new Date('2026-11-20T00:00:00Z');
    expect(staleWindow(range, '2026-09-01T09:00:00Z', 'UTC', now).from).toBe('2026-10-01T00:00:00.000Z');
    expect(staleWindow(range, '2026-10-25T09:00:00Z', 'UTC', now).from).toBe('2026-10-25T09:00:00.000Z');
  });

  it('reads the days in the project zone', () => {
    const range = { from: '2026-10-01', to: '2026-10-31' };
    const now = new Date('2026-11-20T00:00:00Z');
    const window = staleWindow(range, '2026-01-01T00:00:00Z', 'Asia/Kolkata', now);
    expect(window.from).toBe('2026-09-30T18:30:00.000Z');
    expect(window.end).toBe('2026-10-31T18:30:00.000Z');
  });
});
