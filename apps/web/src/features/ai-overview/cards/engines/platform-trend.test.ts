import { describe, expect, it } from 'vitest';

import { buildPlatformTrend, weekMetricOf } from './platform-trend';
import { weeklyShareNote } from './trend-model';
import { at, cell, engine, share, summaryOf, week } from '../competitors/model/summary-fixtures';
import type { EngineCode, MetricCell, PromptsSummary, WeekCells } from '@/lib/api/types';

const CURRENT = { from: '2026-10-19', to: '2026-11-15' };
const PREVIOUS = { from: '2026-09-21', to: '2026-10-18' };

/** A week of one platform: `k` of `n` valid answers mention the brand, and `v` of `n` mention or cite it. */
function point(weekStart: string, k: number, n: number, v?: number): WeekCells {
  const base = week(weekStart, { mentioned: cell(k, n), share: share(k, n) });
  return v === undefined ? base : ({ ...base, visibility: cell(v, n) } as WeekCells & { visibility: MetricCell });
}

const summaryOfSeries = (series: Record<string, WeekCells[]>): PromptsSummary =>
  summaryOf({ total: Object.entries(series).map(([code, weeks]) => engine(code, { series: weeks })) });

const input = (current: PromptsSummary, over: Partial<Parameters<typeof buildPlatformTrend>[0]> = {}) => ({
  current,
  previous: null,
  codes: ['chatgpt_web', 'gemini_web'] as EngineCode[],
  metric: 'mention' as const,
  range: CURRENT,
  previousRange: PREVIOUS,
  average: true,
  ...over,
});

describe('weekMetricOf', () => {
  it('spells share of voice as the API does and leaves the rest', () => {
    expect([
      weekMetricOf('visibility'),
      weekMetricOf('mention'),
      weekMetricOf('citation'),
      weekMetricOf('sov'),
    ]).toEqual(['visibility', 'mention', 'citation', 'share_of_voice']);
  });
});

describe('buildPlatformTrend', () => {
  it('draws a line for each platform that has a rate, and none for a platform with no answer', () => {
    const current = summaryOfSeries({
      chatgpt_web: [point('2026-10-19', 4, 10), point('2026-10-26', 5, 10)],
      gemini_web: [point('2026-10-19', 0, 0), point('2026-10-26', 0, 0)],
    });
    const trend = buildPlatformTrend(input(current));
    expect(trend.platforms.map((line) => line.code)).toEqual(['chatgpt_web']);
  });

  it('adds the Average of the platforms week by week, each platform counting once and never pooled', () => {
    const current = summaryOfSeries({
      chatgpt_web: [point('2026-10-19', 4, 10), point('2026-10-26', 5, 10)],
      gemini_web: [point('2026-10-19', 1, 100), point('2026-10-26', 2, 100)],
    });
    const trend = buildPlatformTrend(input(current));
    // (40% + 1%) / 2, where a pooled ratio would be 5 of 110
    expect(at(trend.average ?? [], 0).value).toBeCloseTo(0.205);
    expect(at(trend.average ?? [], 0).platforms).toBe(2);
  });

  it('keeps the x of y of each platform behind an Average point, and none for a platform left out of the week', () => {
    const current = summaryOfSeries({
      chatgpt_web: [point('2026-10-19', 4, 10), point('2026-10-26', 5, 10)],
      gemini_web: [point('2026-10-19', 1, 100), point('2026-10-26', 1, 3)],
    });
    const average = buildPlatformTrend(input(current, { metric: 'share_of_voice' })).average ?? [];
    expect(at(average, 0).counts).toEqual([
      { code: 'chatgpt_web', k: 4, n: 10 },
      { code: 'gemini_web', k: 1, n: 100 },
    ]);
    expect(at(average, 1).counts).toEqual([{ code: 'chatgpt_web', k: 5, n: 10 }]);
  });

  it('leaves a thin point (fewer than 4 answers) out of the Average, and has no average of nothing', () => {
    const current = summaryOfSeries({
      chatgpt_web: [point('2026-10-19', 4, 10), point('2026-10-26', 1, 2)],
      gemini_web: [point('2026-10-19', 2, 10), point('2026-10-26', 1, 3)],
    });
    const trend = buildPlatformTrend(input(current));
    expect(at(trend.average ?? [], 0).value).toBeCloseTo(0.3);
    expect(at(trend.average ?? [], 1).value).toBeNull();
  });

  it('has no Average for one platform', () => {
    const current = summaryOfSeries({ chatgpt_web: [point('2026-10-19', 4, 10), point('2026-10-26', 5, 10)] });
    const trend = buildPlatformTrend(input(current, { codes: ['chatgpt_web'], average: false }));
    expect(trend.average).toBeNull();
  });

  it('puts the previous period before the current one and marks where the current one starts', () => {
    const current = summaryOfSeries({ chatgpt_web: [point('2026-10-19', 4, 10), point('2026-10-26', 5, 10)] });
    const previous = summaryOfSeries({ chatgpt_web: [point('2026-09-21', 2, 10), point('2026-09-28', 3, 10)] });
    const trend = buildPlatformTrend(input(current, { previous, codes: ['chatgpt_web'], average: false }));
    expect(trend.weeks.map((entry) => entry.weekStart)).toEqual([
      '2026-09-21',
      '2026-09-28',
      '2026-10-19',
      '2026-10-26',
    ]);
    expect(trend.boundary).toBe(2);
    expect(at(at(trend.platforms, 0).points, 0).value).toBeCloseTo(0.2);
  });

  it('lays last year under the current weeks by their order, never before them, and has no boundary', () => {
    const current = summaryOfSeries({
      chatgpt_web: [point('2026-10-19', 4, 10), point('2026-10-26', 5, 10)],
      gemini_web: [point('2026-10-19', 2, 10), point('2026-10-26', 3, 10)],
    });
    const lastYear = summaryOfSeries({
      chatgpt_web: [point('2025-10-20', 1, 10), point('2025-10-27', 2, 10)],
      gemini_web: [point('2025-10-20', 3, 10), point('2025-10-27', 4, 10)],
    });
    const trend = buildPlatformTrend(input(current, { previous: lastYear, lastYear: true }));
    expect(trend.weeks.map((entry) => entry.weekStart)).toEqual(['2026-10-19', '2026-10-26']);
    expect(trend.boundary).toBeNull();
    expect(trend.lastYear?.weekStarts).toEqual(['2025-10-20', '2025-10-27']);
    // The Average of the platforms of last year, week by week: (10% + 30%) / 2 and (20% + 40%) / 2
    expect(trend.lastYear?.average?.map((entry) => entry.value)).toEqual([expect.closeTo(0.2), expect.closeTo(0.3)]);
  });

  it('leaves a current week with no week of last year under it as a gap, and draws nothing when last year has no rate', () => {
    const current = summaryOfSeries({
      chatgpt_web: [point('2026-10-19', 4, 10), point('2026-10-26', 5, 10)],
    });
    const short = summaryOfSeries({ chatgpt_web: [point('2025-10-20', 1, 10)] });
    const trend = buildPlatformTrend(
      input(current, { previous: short, lastYear: true, codes: ['chatgpt_web'], average: false }),
    );
    expect(trend.lastYear?.weekStarts).toEqual(['2025-10-20', null]);
    expect(trend.lastYear?.platforms[0]?.points.map((entry) => entry.value)).toEqual([expect.closeTo(0.1), null]);
    const silent = summaryOfSeries({ chatgpt_web: [point('2025-10-20', 0, 0), point('2025-10-27', 0, 0)] });
    expect(buildPlatformTrend(input(current, { previous: silent, lastYear: true })).lastYear).toBeNull();
  });

  it('keeps the current point when a window starts mid-week and both reads hold that Monday', () => {
    const current = summaryOfSeries({ chatgpt_web: [point('2026-10-19', 4, 10)] });
    const previous = summaryOfSeries({ chatgpt_web: [point('2026-10-12', 2, 10), point('2026-10-19', 1, 5)] });
    const trend = buildPlatformTrend(input(current, { previous, codes: ['chatgpt_web'], average: false }));
    expect(trend.weeks.map((entry) => entry.weekStart)).toEqual(['2026-10-12', '2026-10-19']);
    expect(trend.boundary).toBe(1);
    expect(at(at(trend.platforms, 0).points, 1).k).toBe(4);
  });

  it('has no boundary without a previous period', () => {
    const current = summaryOfSeries({ chatgpt_web: [point('2026-10-19', 4, 10)] });
    expect(buildPlatformTrend(input(current, { codes: ['chatgpt_web'] })).boundary).toBeNull();
  });

  it('gives one platform its Wilson band from the pooled answers of each point', () => {
    const current = summaryOfSeries({ chatgpt_web: [point('2026-10-19', 4, 10)] });
    const [line] = buildPlatformTrend(input(current, { codes: ['chatgpt_web'], average: false })).platforms;
    expect(at(line?.points ?? [], 0).band).not.toBeNull();
  });

  describe('AI visibility', () => {
    it('is not collected weekly when no week carries the visibility cell, and mention is not put in its place', () => {
      const current = summaryOfSeries({ chatgpt_web: [point('2026-10-19', 4, 10), point('2026-10-26', 5, 10)] });
      const trend = buildPlatformTrend(input(current, { metric: 'visibility' }));
      expect(trend.collected).toBe(false);
      expect(trend.platforms).toEqual([]);
    });

    it('is drawn from the weekly visibility cell when the API has it', () => {
      const current = summaryOfSeries({
        chatgpt_web: [point('2026-10-19', 4, 10, 6), point('2026-10-26', 5, 10, 7)],
      });
      const trend = buildPlatformTrend(
        input(current, { metric: 'visibility', codes: ['chatgpt_web'], average: false }),
      );
      expect(trend.collected).toBe(true);
      expect(at(at(trend.platforms, 0).points, 1).value).toBeCloseTo(0.7);
    });
  });
});

describe('weeklyShareNote', () => {
  const marked = (note: 'capped' | 'notCollected'): MetricCell => ({ ...share(0, 0), share_note: note }) as MetricCell;
  const withPoints = (...notes: ('capped' | 'notCollected' | null)[]): PromptsSummary =>
    summaryOfSeries({
      chatgpt_web: notes.map((note, index) =>
        week(`2026-10-${String(19 + index * 7)}`, { share: note === null ? share(3, 10) : marked(note) }),
      ),
    });

  it('says why no week has its counts: cut at 20 brands, or not collected', () => {
    expect(weeklyShareNote(withPoints('capped', 'capped'))).toBe('capped');
    expect(weeklyShareNote(withPoints('notCollected', 'notCollected'))).toBe('notCollected');
  });

  it('says nothing when a week has its counts, and when there is no week', () => {
    expect(weeklyShareNote(withPoints('notCollected', null))).toBeUndefined();
    expect(weeklyShareNote(withPoints())).toBeUndefined();
  });
});
