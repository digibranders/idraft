import { renderHook } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { useRankHistoryChart, type RankHistoryChartOptions } from './use-rank-history-chart';
import messages from '../../../../messages/en.json';
import type { HistoryPoint, RankHistory } from '@/lib/api/types';
import type { ChartTokens } from '@/lib/design/read-tokens';

const tokens: ChartTokens = {
  palette: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'],
  axis: 'axis',
  label: 'label',
  fontFamily: 'sans',
  other: 'other',
  reference: 'reference',
  grid: 'grid',
  band: 'band',
  rankBandNone: 'none',
  surfaceElevated: 'elevated',
  border: 'border',
  borderStrong: 'borderStrong',
  foreground: 'foreground',
  foregroundSecondary: 'foregroundSecondary',
};

function Wrapper({ children }: { children: ReactNode }): ReactNode {
  return (
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      {children}
    </NextIntlClientProvider>
  );
}

function point(date: string, state: HistoryPoint['state'], rank: number | null, depth = 20): HistoryPoint {
  return {
    date,
    observed_at: `${date}T02:00:00Z`,
    state,
    rank,
    depth_requested: depth,
    url_id: null,
    serp_snapshot_id: null,
    absolute_rank: rank,
  };
}

function history(points: HistoryPoint[], overrides: Partial<RankHistory> = {}): RankHistory {
  const count = (state: HistoryPoint['state']): number => points.filter((p) => p.state === state).length;
  return {
    tracked_keyword_id: 'kw',
    bands: [],
    columns: null,
    config_history: [],
    deep_check_weekday: 1,
    events: null,
    series: [
      {
        entity: {
          entity_id: 'own',
          canonical_name: 'Fynix',
          entity_type: 'organization',
          role: 'own',
          color_index: null,
        },
        points,
      },
    ],
    summary: {
      checks: count('ranked') + count('beyond_depth'),
      ranked_checks: count('ranked'),
      beyond_depth_checks: count('beyond_depth'),
      failed_checks: count('failed'),
      average_rank: null,
    },
    urls: {},
    version_boundaries: [],
    window: { from: '2026-10-01', to: '2026-10-05', timezone: 'UTC' },
    ...overrides,
  };
}

const render = (value: RankHistory | undefined, options: Partial<RankHistoryChartOptions> = {}) =>
  renderHook(() => useRankHistoryChart(value, { height: 240, ...options }), { wrapper: Wrapper }).result.current;

const EXTENDED = z.object({
  yAxis: z.object({
    inverse: z.boolean(),
    min: z.number(),
    max: z.number(),
    axisLabel: z.object({ customValues: z.array(z.number()) }),
  }),
  series: z.array(z.object({ markLine: z.object({ data: z.array(z.object({ yAxis: z.number() })) }) })),
});

const TOOLTIPPED = z.object({
  yAxis: z.object({ name: z.string() }),
  tooltip: z.object({
    formatter: z.function({ input: [z.array(z.object({ dataIndex: z.number() }))], output: z.string() }),
  }),
});

const READY = [
  point('2026-10-01', 'ranked', 9),
  point('2026-10-02', 'ranked', 4),
  point('2026-10-03', 'beyond_depth', null),
  point('2026-10-04', 'ranked', 6),
];

describe('useRankHistoryChart', () => {
  it('is loading while there is no history, with no frame', () => {
    expect(render(undefined)).toEqual({ state: 'loading', frame: null });
  });

  it('is empty for a history with no checks at all, with no frame', () => {
    expect(render(history([]))).toEqual({ state: 'empty', frame: null });
  });

  it('is allFailed when every check failed, and still draws the failed glyphs', () => {
    const { state, frame } = render(
      history([point('2026-10-01', 'failed', null), point('2026-10-02', 'failed', null)]),
    );
    expect(state).toBe('allFailed');
    expect(frame?.summary).toBe('Organic rank of Fynix (you) over the last 90 days: every check failed.');
    expect(frame?.series[0]?.values).toEqual(['failed', 'failed']);
  });

  it('says the real first, last and best ranks and the check count', () => {
    const { state, frame } = render(history(READY));
    expect(state).toBe('ready');
    expect(frame?.summary).toBe('Organic rank of Fynix (you) over the last 90 days, 1 is best: from 9 to 6, best 4.');
    expect(frame?.meta).toBe('Last 90 days · 4 checks, 3 ranked');
    expect(frame?.categories).toEqual(['Oct 1', 'Oct 2', 'Oct 3', 'Oct 4']);
  });

  it('names the window in the summary and the meta line', () => {
    const { frame } = render(history(READY), { days: 30 });
    expect(frame?.summary).toContain('over the last 30 days');
    expect(frame?.meta).toBe('Last 30 days · 4 checks, 3 ranked');
  });

  it('counts failed checks in the meta line and the summary', () => {
    const { frame } = render(history([...READY, point('2026-10-05', 'failed', null)]));
    expect(frame?.meta).toBe('Last 90 days · 4 checks, 3 ranked, 1 failed');
    expect(frame?.summary).toContain('1 failed.');
  });

  it('adds a suffix to the meta line when the page has one', () => {
    const { frame } = render(history(READY), { metaSuffix: 'deep check Monday' });
    expect(frame?.meta).toBe('Last 90 days · 4 checks, 3 ranked · deep check Monday');
  });

  it('says a keyword that never ranked is not ranked', () => {
    const { frame } = render(history([point('2026-10-01', 'beyond_depth', null)]));
    expect(frame?.summary).toContain('not ranked within the depth checked.');
  });

  it('describes each beyond-depth band, on one day and across several', () => {
    const bands: RankHistory['bands'] = [
      { entity_id: 'own', from: '2026-10-03', to: '2026-10-03', depth_requested: 20, kind: 'beyond_depth', label: 'x' },
      { entity_id: 'own', from: '2026-10-01', to: '2026-10-02', depth_requested: 50, kind: 'beyond_depth', label: 'x' },
    ];
    const { frame } = render(history(READY, { bands }));
    expect(frame?.summary).toContain('Not in top 20 on Oct 3.');
    expect(frame?.summary).toContain('Not in top 50 from Oct 1 to Oct 2.');
  });

  it('names the competitors drawn and the deep checks that are not', () => {
    const base = history([point('2026-10-01', 'ranked', 5), point('2026-10-02', 'ranked', 35, 100)]);
    const other = {
      entity: {
        entity_id: 'rival',
        canonical_name: 'Rival',
        entity_type: 'organization' as const,
        role: 'competitor' as const,
        color_index: null,
      },
      points: [point('2026-10-01', 'ranked', 2)],
    };
    const { frame } = render({ ...base, series: [...(base.series ?? []), other] }, { deep: 'hide' });
    expect(frame?.summary).toContain('1 competitor is shown too.');
    expect(frame?.summary).toContain('1 deep check is not drawn.');
    const three = render(
      history([
        point('2026-10-01', 'ranked', 5),
        ...[2, 3, 4].map((n) => point(`2026-10-0${String(n)}`, 'ranked', 40, 100)),
      ]),
      { deep: 'hide' },
    );
    expect(three.frame?.summary).toContain('3 deep checks are not drawn.');
  });

  it('names the absolute rank series of the own site', () => {
    const { frame } = render(history(READY), { absolute: true });
    expect(frame?.series.map((s) => s.name)).toEqual(['Fynix (you)', 'Fynix (you) (absolute)']);
  });

  it('extends the chart option with an inverted rank axis and guides at 3, 10 and 20', () => {
    const { frame } = render(history(READY));
    expect(frame).not.toBeNull();
    const option = frame?.extendOption(
      { yAxis: {}, grid: {}, series: [{ id: 'own', type: 'line', data: [] }] },
      tokens,
    );
    const parsed = EXTENDED.parse(option);
    expect(parsed.yAxis).toMatchObject({ inverse: true, min: 1, max: 20 });
    expect(parsed.series[0]?.markLine.data.map((guide) => guide.yAxis)).toEqual([3, 10, 20]);
  });

  it('lays the axis labels out by the height of the chart: no label at 3 below 200 px', () => {
    const labels = (height: 180 | 240): number[] => {
      const { frame } = render(history(READY), { height });
      expect(frame).not.toBeNull();
      return EXTENDED.parse(frame?.extendOption({ yAxis: {}, grid: {}, series: [{ id: 'own' }] }, tokens)).yAxis
        .axisLabel.customValues;
    };
    expect(labels(240)).toEqual([1, 3, 10, 20]);
    expect(labels(180)).toEqual([1, 10, 20]);
  });

  describe('the events layer', () => {
    const event = (type: string, date: string, entity = 'own', time = '02:00:00Z') => ({
      rank_event_id: `${type}-${date}-${entity}`,
      occurred_at: `${date}T${time}`,
      event_type: type,
      entity_id: entity,
      from_rank: null,
      to_rank: null,
    });
    const withEvents = (events: RankHistory['events']): RankHistory => history(READY, { events });
    const MARKED = z.object({
      series: z.array(
        z.object({
          markPoint: z
            .object({
              data: z.array(
                z.object({ coord: z.tuple([z.number(), z.number()]), symbol: z.string(), name: z.string() }),
              ),
            })
            .optional(),
        }),
      ),
    });
    const marksOf = (frame: ReturnType<typeof render>['frame']): { index: number; symbol: string; name: string }[] => {
      expect(frame).not.toBeNull();
      const option = MARKED.parse(frame?.extendOption({ yAxis: {}, grid: {}, series: [{ id: 'own' }] }, tokens));
      return (option.series[0]?.markPoint?.data ?? []).map((mark) => ({
        index: mark.coord[0],
        symbol: mark.symbol,
        name: mark.name,
      }));
    };
    const HISTORY_EVENTS = [
      event('url_changed', '2026-10-02'),
      event('entered_top_10', '2026-10-04'),
      event('url_changed', '2026-10-03', 'rival'),
      event('rank_gain', '2026-10-04'),
    ];

    it('draws nothing and says nothing while the layer is off, even when the history holds events', () => {
      const { frame } = render(withEvents(HISTORY_EVENTS));
      expect(marksOf(frame)).toEqual([]);
      expect(frame?.eventMarks).toEqual([]);
      expect(frame?.summary).not.toContain('marked on the chart');
    });

    it('marks the own events of the chart families on their checks, with words and a shape each', () => {
      const { frame } = render(withEvents(HISTORY_EVENTS), { events: true });
      expect(marksOf(frame)).toEqual([
        { index: 1, symbol: 'diamond', name: 'Ranking URL changed' },
        { index: 3, symbol: 'pin', name: 'Entered the top 10' },
      ]);
      expect(frame?.eventMarks.map((mark) => mark.family)).toEqual(['url', 'rank']);
    });

    it('says in the summary how many events are marked and where they are listed', () => {
      const { frame } = render(withEvents(HISTORY_EVENTS), { events: true });
      expect(frame?.summary).toContain('2 events are marked on the chart and listed under Events.');
      const one = render(withEvents([event('aio_appeared', '2026-10-01')]), { events: true });
      expect(one.frame?.summary).toContain('1 event is marked on the chart and listed under Events.');
    });

    it('says no event is marked when the layer is on and the window has none of the chart families', () => {
      const { frame } = render(withEvents([event('rank_gain', '2026-10-02')]), { events: true });
      expect(marksOf(frame)).toEqual([]);
      expect(frame?.summary).toContain('No events are marked on the chart.');
    });

    it('treats a history without events as having none', () => {
      const { frame } = render(withEvents(null), { events: true });
      expect(frame?.eventMarks).toEqual([]);
      expect(frame?.summary).toContain('No events are marked on the chart.');
    });

    it('counts the day of an event in the time zone given', () => {
      // 23:30 UTC on Oct 1 is Oct 2 in Berlin, where there is a check
      const late = withEvents([event('url_changed', '2026-10-01', 'own', '23:30:00Z')]);
      expect(marksOf(render(late, { events: true, timeZone: 'Europe/Berlin' }).frame).map((m) => m.index)).toEqual([1]);
      expect(marksOf(render(late, { events: true, timeZone: 'UTC' }).frame).map((m) => m.index)).toEqual([0]);
    });
  });

  it('names the rank axis and marks a deep check in its tooltip', () => {
    const { frame } = render(history([point('2026-10-01', 'ranked', 5), point('2026-10-02', 'ranked', 35, 100)]), {
      deep: 'show',
    });
    expect(frame).not.toBeNull();
    const option = TOOLTIPPED.parse(
      frame?.extendOption(
        { yAxis: {}, grid: {}, tooltip: { formatter: () => 'row' }, series: [{ id: 'own' }] },
        tokens,
      ),
    );
    expect(option.yAxis.name).toBe('Rank (1 = best)');
    expect(option.tooltip.formatter([{ dataIndex: 0 }])).toBe('row');
    expect(option.tooltip.formatter([{ dataIndex: 1 }])).toContain('Deep check');
  });

  it('says "all failed" with the real number of checks when every check failed', () => {
    const { frame } = render(history([point('2026-10-01', 'failed', null), point('2026-10-02', 'failed', null)]));
    expect(frame?.meta).toBe('Last 90 days · 2 checks, all failed');
    expect(render(history([point('2026-10-01', 'failed', null)])).frame?.meta).toBe(
      'Last 90 days · 1 check, all failed',
    );
  });

  it('counts the competitors drawn, not the absolute rank series, when the absolute layer is on', () => {
    const base = history([point('2026-10-01', 'ranked', 5)]);
    const rival = {
      entity: {
        entity_id: 'rival',
        canonical_name: 'Rival',
        entity_type: 'organization' as const,
        role: 'competitor' as const,
        color_index: null,
      },
      points: [point('2026-10-01', 'ranked', 2)],
    };
    const { frame } = render({ ...base, series: [...(base.series ?? []), rival] }, { absolute: true });
    expect(frame?.series).toHaveLength(3);
    expect(frame?.summary).toContain('1 competitor is shown too.');
  });
});
