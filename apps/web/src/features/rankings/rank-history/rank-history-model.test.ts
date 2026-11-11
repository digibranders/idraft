import { describe, expect, it } from 'vitest';

import { competitorPalette, eventMarksOf, rankHistoryChart, type CheckSlot } from './rank-history-model';
import type { HistoryEvent, HistoryPoint, RankHistory } from '@/lib/api/types';

const fixture = (overrides: Partial<RankHistory> = {}): RankHistory => ({
  tracked_keyword_id: 'kw-1',
  bands: [],
  columns: null,
  config_history: [],
  deep_check_weekday: 1,
  events: null,
  series: [
    {
      entity: {
        entity_id: 'own-1',
        canonical_name: 'Fynix',
        entity_type: 'organization',
        role: 'own',
        color_index: null,
      },
      points: [
        {
          date: '2026-10-01',
          rank: 4,
          depth_requested: 20,
          state: 'ranked',
          observed_at: '2026-10-01T02:00:00Z',
          serp_snapshot_id: null,
          url_id: null,
          absolute_rank: 4,
        },
        {
          date: '2026-10-02',
          rank: null,
          depth_requested: 20,
          state: 'beyond_depth',
          observed_at: '2026-10-02T02:00:00Z',
          serp_snapshot_id: null,
          url_id: null,
          absolute_rank: null,
        },
      ],
    },
    {
      entity: {
        entity_id: 'comp-1',
        canonical_name: 'Acme',
        entity_type: 'organization',
        role: 'competitor',
        color_index: 3,
      },
      points: [
        {
          date: '2026-10-02',
          rank: 8,
          depth_requested: 20,
          state: 'ranked',
          observed_at: '2026-10-02T02:00:00Z',
          serp_snapshot_id: null,
          url_id: null,
          absolute_rank: 8,
        },
        {
          date: '2026-10-03',
          rank: 7,
          depth_requested: 20,
          state: 'ranked',
          observed_at: '2026-10-03T02:00:00Z',
          serp_snapshot_id: null,
          url_id: null,
          absolute_rank: 7,
        },
      ],
    },
    {
      entity: {
        entity_id: 'comp-2',
        canonical_name: 'Beta',
        entity_type: 'organization',
        role: 'competitor',
        color_index: null,
      },
      points: [
        {
          date: '2026-10-01',
          rank: null,
          depth_requested: 20,
          state: 'failed',
          observed_at: '2026-10-01T02:00:00Z',
          serp_snapshot_id: null,
          url_id: null,
          absolute_rank: null,
        },
      ],
    },
  ],
  summary: {
    checks: 2,
    ranked_checks: 1,
    beyond_depth_checks: 1,
    failed_checks: 0,
    average_rank: null,
  },
  urls: {},
  version_boundaries: [],
  window: {
    from: '2026-10-01',
    to: '2026-10-03',
    timezone: 'Europe/Berlin',
  },
  ...overrides,
});

describe('rankHistoryChart', () => {
  it('gives categories as the sorted union of series dates, with own series first and competitors colored', () => {
    const model = rankHistoryChart(fixture(), { ownName: (name) => `${name} (you)` });
    expect(model.categories).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);

    expect(model.series).toHaveLength(3);
    const [own, comp1, comp2] = model.series;
    expect(own).toEqual({
      id: 'own-1',
      name: 'Fynix (you)',
      role: { kind: 'brand' },
      values: [4, null, null],
    });
    // comp1 has color_index 3
    expect(comp1).toEqual({
      id: 'comp-1',
      name: 'Acme',
      role: { kind: 'palette', index: 3 },
      values: [null, 8, 7],
    });
    // comp2 has no color_index and takes the first slot comp1's index 3 leaves free (2), with 'failed' for failed checks
    expect(comp2?.role).toEqual({ kind: 'palette', index: 2 });
    expect(comp2?.values).toEqual(['failed', null, null]);
  });

  it('keeps multiple checks on the same day as separate categories without collapsing', () => {
    const sameDay = fixture({
      series: [
        {
          entity: {
            entity_id: 'own-1',
            canonical_name: 'Fynix',
            entity_type: 'organization',
            role: 'own',
            color_index: null,
          },
          points: [
            {
              date: '2026-10-01',
              rank: 5,
              depth_requested: 20,
              state: 'ranked',
              observed_at: '2026-10-01T02:00:00Z',
              serp_snapshot_id: null,
              url_id: null,
              absolute_rank: 5,
            },
            {
              date: '2026-10-01',
              rank: 4,
              depth_requested: 20,
              state: 'ranked',
              observed_at: '2026-10-01T14:00:00Z',
              serp_snapshot_id: null,
              url_id: null,
              absolute_rank: 4,
            },
          ],
        },
      ],
      summary: {
        checks: 2,
        ranked_checks: 2,
        beyond_depth_checks: 0,
        failed_checks: 0,
        average_rank: null,
      },
    });

    const model = rankHistoryChart(sameDay, { ownName: (name) => `${name} (you)` });
    expect(model.categories).toEqual(['2026-10-01', '2026-10-01']);
    expect(model.series[0]?.values).toEqual([5, 4]);
    expect(model.categories.length).toBe(model.summary.checks);
  });

  it('does not clip a deeper competitor rank with depthMax', () => {
    const withDeepCompetitor = fixture({
      series: [
        {
          entity: {
            entity_id: 'own-1',
            canonical_name: 'Fynix',
            entity_type: 'organization',
            role: 'own',
            color_index: null,
          },
          points: [
            {
              date: '2026-10-01',
              rank: 5,
              depth_requested: 20,
              state: 'ranked',
              observed_at: '2026-10-01T02:00:00Z',
              serp_snapshot_id: null,
              url_id: null,
              absolute_rank: 5,
            },
          ],
        },
        {
          entity: {
            entity_id: 'comp-1',
            canonical_name: 'Acme',
            entity_type: 'organization',
            role: 'competitor',
            color_index: 3,
          },
          points: [
            {
              date: '2026-10-01',
              rank: 45,
              depth_requested: 20,
              state: 'ranked',
              observed_at: '2026-10-01T02:00:00Z',
              serp_snapshot_id: null,
              url_id: null,
              absolute_rank: 45,
            },
          ],
        },
      ],
    });

    const model = rankHistoryChart(withDeepCompetitor, { ownName: (name) => `${name} (you)` });
    expect(model.depthMax).toBe(50);
  });

  it('sets depthMax to 20 when all depths are at most 20, or the largest depth up to 100', () => {
    const standard = rankHistoryChart(fixture(), { ownName: (name) => `${name} (you)` });
    expect(standard.depthMax).toBe(20);

    const withDeep = fixture({
      series: [
        {
          entity: {
            entity_id: 'own-1',
            canonical_name: 'Fynix',
            entity_type: 'organization',
            role: 'own',
            color_index: null,
          },
          points: [
            {
              date: '2026-10-01',
              rank: 35,
              depth_requested: 50,
              state: 'ranked',
              observed_at: '2026-10-01T02:00:00Z',
              serp_snapshot_id: null,
              url_id: null,
              absolute_rank: 35,
            },
          ],
        },
      ],
    });
    const deepModel = rankHistoryChart(withDeep, { ownName: (name) => `${name} (you)` });
    expect(deepModel.depthMax).toBe(50);
  });

  it('keeps own entity bands as category indices', () => {
    const withBands = fixture({
      bands: [
        {
          entity_id: 'own-1',
          from: '2026-10-01',
          to: '2026-10-02',
          depth_requested: 20,
          kind: 'beyond_depth',
          label: 'Not in top 20',
        },
        {
          entity_id: 'other-entity',
          from: '2026-10-01',
          to: '2026-10-02',
          depth_requested: 20,
          kind: 'beyond_depth',
          label: 'Not in top 20',
        },
      ],
    });
    const model = rankHistoryChart(withBands, { ownName: (name) => `${name} (you)` });
    expect(model.bands).toEqual([{ from: 0, to: 1, depth: 20 }]);
  });

  it('passes summary counts through and sets empty when checks is 0', () => {
    const model = rankHistoryChart(fixture(), { ownName: (name) => `${name} (you)` });
    expect(model.summary).toEqual({ checks: 2, ranked: 1, beyond: 1, failed: 0 });
    expect(model.empty).toBe(false);

    const empty = rankHistoryChart(
      fixture({
        series: [],
        summary: { checks: 0, ranked_checks: 0, beyond_depth_checks: 0, failed_checks: 0, average_rank: null },
      }),
      { ownName: (name) => `${name} (you)` },
    );
    expect(empty.empty).toBe(true);
    expect(empty.summary.checks).toBe(0);
  });

  it('sets empty true only when checks + failed_checks === 0; an all-failed history is not empty', () => {
    const allFailed = rankHistoryChart(
      fixture({
        series: [
          {
            entity: {
              entity_id: 'own',
              canonical_name: 'Fynix',
              entity_type: 'organization',
              role: 'own',
              color_index: null,
            },
            points: [
              {
                date: '2026-10-01',
                rank: null,
                depth_requested: null,
                state: 'failed',
                observed_at: null,
                serp_snapshot_id: null,
                url_id: null,
                absolute_rank: null,
              },
            ],
          },
        ],
        summary: { checks: 0, ranked_checks: 0, beyond_depth_checks: 0, failed_checks: 1, average_rank: null },
      }),
      { ownName: (name) => `${name} (you)` },
    );
    expect(allFailed.empty).toBe(false);
    expect(allFailed.summary.checks).toBe(0);
    expect(allFailed.summary.failed).toBe(1);
  });

  it('I2: exercises the null-observed_at key path (date#n) in rankHistoryChart', () => {
    const model = rankHistoryChart(
      fixture({
        series: [
          {
            entity: {
              entity_id: 'own',
              canonical_name: 'Fynix',
              entity_type: 'organization',
              role: 'own',
              color_index: null,
            },
            points: [
              {
                date: '2026-10-01',
                rank: null,
                depth_requested: null,
                state: 'failed',
                observed_at: null,
                serp_snapshot_id: null,
                url_id: null,
                absolute_rank: null,
              },
              {
                date: '2026-10-01',
                rank: null,
                depth_requested: null,
                state: 'failed',
                observed_at: null,
                serp_snapshot_id: null,
                url_id: null,
                absolute_rank: null,
              },
            ],
          },
        ],
        summary: { checks: 0, ranked_checks: 0, beyond_depth_checks: 0, failed_checks: 2, average_rank: null },
      }),
      { ownName: (name) => `${name} (you)` },
    );

    // 2 failed points on same date with null observed_at become 2 slots: 2026-10-01#0 and 2026-10-01#1
    expect(model.categories).toHaveLength(2);
    expect(model.series[0]?.values).toEqual(['failed', 'failed']);
  });
});

interface CheckSpec {
  state: HistoryPoint['state'];
  rank: number | null;
  depth: number;
  absolute: number | null;
}

const rank = (value: number, depth: number, extra: { absolute?: number } = {}): CheckSpec => ({
  state: 'ranked',
  rank: value,
  depth,
  absolute: extra.absolute ?? value,
});
const beyond = (depth: number): CheckSpec => ({ state: 'beyond_depth', rank: null, depth, absolute: null });

const dayOf = (index: number): string => `2026-10-${String(index + 1).padStart(2, '0')}`;

function pointsOf(checks: readonly CheckSpec[]): HistoryPoint[] {
  return checks.map((check, index) => ({
    date: dayOf(index),
    observed_at: `${dayOf(index)}T02:00:00Z`,
    state: check.state,
    rank: check.rank,
    depth_requested: check.depth,
    url_id: null,
    serp_snapshot_id: null,
    absolute_rank: check.absolute,
  }));
}

/** The own site is `own`; a competitor is named by its key. Bands follow the runs of beyond-depth checks. */
function historyOf(input: {
  own: readonly CheckSpec[];
  competitors?: Record<string, readonly CheckSpec[]>;
}): RankHistory {
  const bands: RankHistory['bands'] = [];
  input.own.forEach((check, index) => {
    if (check.state !== 'beyond_depth') return;
    const last = bands.at(-1);
    if (last !== undefined && last.depth_requested === check.depth && last.to === dayOf(index - 1)) {
      last.to = dayOf(index);
    } else {
      bands.push({
        entity_id: 'own',
        from: dayOf(index),
        to: dayOf(index),
        depth_requested: check.depth,
        kind: 'beyond_depth',
        label: `Not in top ${String(check.depth)}`,
      });
    }
  });
  const count = (state: HistoryPoint['state']): number => input.own.filter((check) => check.state === state).length;
  return fixture({
    bands,
    series: [
      {
        entity: {
          entity_id: 'own',
          canonical_name: 'own',
          entity_type: 'organization',
          role: 'own',
          color_index: null,
        },
        points: pointsOf(input.own),
      },
      ...Object.entries(input.competitors ?? {}).map(([key, checks]) => ({
        entity: {
          entity_id: key,
          canonical_name: key,
          entity_type: 'organization' as const,
          role: 'competitor' as const,
          color_index: null,
        },
        points: pointsOf(checks),
      })),
    ],
    summary: {
      checks: count('ranked') + count('beyond_depth'),
      ranked_checks: count('ranked'),
      beyond_depth_checks: count('beyond_depth'),
      failed_checks: count('failed'),
      average_rank: null,
    },
  });
}

const OWN = { ownName: (name: string) => name } as const;

describe('rankHistoryChart: deep checks, absolute rank and chosen competitors', () => {
  it('hides ranks deeper than 20 while deep checks are off, counts them, and keeps the axis at 20', () => {
    const model = rankHistoryChart(historyOf({ own: [rank(5, 20), rank(35, 100), beyond(20)] }), {
      ...OWN,
      deep: 'hide',
    });
    expect(model.depthMax).toBe(20);
    expect(model.series[0]?.values).toEqual([5, null, null]);
    expect(model.deepHidden).toBe(1);
  });

  it('shows them and extends the axis to the deepest check when on', () => {
    const model = rankHistoryChart(historyOf({ own: [rank(5, 20), rank(35, 100), beyond(20)] }), {
      ...OWN,
      deep: 'show',
    });
    expect(model.depthMax).toBe(100);
    expect(model.series[0]?.values).toEqual([5, 35, null]);
    expect(model.deepHidden).toBe(0);
  });

  it('keeps the inspector rule when no choice is made: the axis follows the deepest check', () => {
    const model = rankHistoryChart(historyOf({ own: [rank(5, 20), rank(35, 100), beyond(20)] }), OWN);
    expect(model.depthMax).toBe(100);
    expect(model.series[0]?.values).toEqual([5, 35, null]);
    expect(model.deepHidden).toBe(0);
  });

  it('draws a deep check that ranked within 20, and counts one that found nothing within its depth', () => {
    const model = rankHistoryChart(historyOf({ own: [rank(4, 100), beyond(100), beyond(20)] }), {
      ...OWN,
      deep: 'hide',
    });
    expect(model.series[0]?.values).toEqual([4, null, null]);
    expect(model.deepHidden).toBe(1);
  });

  it('hides a deep competitor rank too, but counts only the own site checks', () => {
    const history = historyOf({ own: [rank(5, 20), rank(8, 20)], competitors: { a: [rank(45, 100), rank(9, 20)] } });
    const model = rankHistoryChart(history, { ...OWN, deep: 'hide' });
    expect(model.series.map((s) => s.values)).toEqual([
      [5, 8],
      [null, 9],
    ]);
    expect(model.deepHidden).toBe(0);
  });

  it('adds the absolute rank of the own site as a dashed reference series named by absoluteName', () => {
    const model = rankHistoryChart(historyOf({ own: [rank(3, 20, { absolute: 5 })] }), {
      ...OWN,
      absoluteName: (name) => `${name} (absolute)`,
      absolute: true,
    });
    expect(model.series.map((s) => [s.name, s.role.kind, s.values])).toEqual([
      ['own', 'brand', [3]],
      ['own (absolute)', 'reference', [5]],
    ]);
  });

  it('adds no absolute series unless asked', () => {
    const model = rankHistoryChart(historyOf({ own: [rank(3, 20, { absolute: 5 })] }), {
      ...OWN,
      absoluteName: (name) => `${name} (absolute)`,
    });
    expect(model.series.map((s) => s.name)).toEqual(['own']);
  });

  it('lets an absolute rank beyond 20 move the axis, unless deep checks are hidden', () => {
    const history = historyOf({ own: [rank(3, 20, { absolute: 31 })] });
    const options = { ...OWN, absoluteName: (name: string) => name, absolute: true } as const;
    expect(rankHistoryChart(history, options).depthMax).toBe(50);
    const hidden = rankHistoryChart(history, { ...options, deep: 'hide' });
    expect(hidden.depthMax).toBe(20);
    expect(hidden.series[1]?.values).toEqual([null]);
  });

  it('draws only the chosen competitors, in the order chosen', () => {
    const history = historyOf({
      own: [rank(5, 20)],
      competitors: { a: [rank(2, 20)], b: [rank(9, 20)], c: [rank(12, 20)] },
    });
    const model = rankHistoryChart(history, { ...OWN, competitorIds: ['b', 'a'] });
    expect(model.series.map((s) => s.id)).toEqual(['own', 'b', 'a']);
  });

  it('draws no competitor for an empty choice, and every competitor when no choice is made', () => {
    const history = historyOf({ own: [rank(5, 20)], competitors: { a: [rank(2, 20)], b: [rank(9, 20)] } });
    expect(rankHistoryChart(history, { ...OWN, competitorIds: [] }).series.map((s) => s.id)).toEqual(['own']);
    expect(rankHistoryChart(history, { ...OWN, competitorIds: null }).series.map((s) => s.id)).toEqual([
      'own',
      'a',
      'b',
    ]);
    expect(rankHistoryChart(history, OWN).series.map((s) => s.id)).toEqual(['own', 'a', 'b']);
  });

  it('skips a chosen competitor the history does not hold, and sizes the axis by what is drawn', () => {
    const history = historyOf({ own: [rank(5, 20)], competitors: { a: [rank(2, 20)], deep: [rank(70, 100)] } });
    const model = rankHistoryChart(history, { ...OWN, competitorIds: ['a', 'gone'] });
    expect(model.series.map((s) => s.id)).toEqual(['own', 'a']);
    expect(model.depthMax).toBe(20);
  });

  it('drops bands deeper than 20 while deep checks are off', () => {
    const history = historyOf({ own: [rank(5, 20), beyond(20), beyond(100)] });
    expect(rankHistoryChart(history, { ...OWN, deep: 'hide' }).bands.map((b) => b.depth)).toEqual([20]);
    expect(rankHistoryChart(history, { ...OWN, deep: 'show' }).bands.map((b) => b.depth)).toEqual([20, 100]);
  });

  it('does not count a failed check as a hidden deep check', () => {
    const failedDeep: CheckSpec = { state: 'failed', rank: null, depth: 100, absolute: null };
    const model = rankHistoryChart(historyOf({ own: [rank(5, 20), failedDeep, rank(35, 100)] }), {
      ...OWN,
      deep: 'hide',
    });
    expect(model.deepHidden).toBe(1);
    expect(model.series[0]?.values).toEqual([5, 'failed', null]);
  });

  it('lists the categories of own deep checks, and none for a failed check or an ordinary one', () => {
    const failedDeep: CheckSpec = { state: 'failed', rank: null, depth: 100, absolute: null };
    const model = rankHistoryChart(
      historyOf({ own: [rank(5, 20), rank(35, 100), failedDeep, beyond(100), beyond(20)] }),
      OWN,
    );
    expect(model.deepIndices).toEqual([1, 3]);
  });

  it('gives uncoloured competitors the slots the coloured ones leave free, so five competitors get five colours', () => {
    const palette = competitorPalette([
      { id: 'a', colorIndex: 3 },
      { id: 'b', colorIndex: null },
      { id: 'c', colorIndex: 5 },
      { id: 'd', colorIndex: null },
      { id: 'e', colorIndex: 2 },
    ]);
    expect(['a', 'b', 'c', 'd', 'e'].map((id) => palette.get(id))).toEqual([3, 4, 5, 6, 2]);
    expect(new Set(palette.values()).size).toBe(5);
  });

  it('keeps a given colour, ignores one outside the palette, and reuses slots only when all five are taken', () => {
    const palette = competitorPalette([
      { id: 'a', colorIndex: 1 },
      { id: 'b', colorIndex: 9 },
      ...['c', 'd', 'e', 'f', 'g'].map((id) => ({ id, colorIndex: null })),
    ]);
    expect(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => palette.get(id))).toEqual([2, 3, 4, 5, 6, 2, 3]);
  });

  it('draws the series with those colours, whichever competitors are chosen', () => {
    const history = historyOf({
      own: [rank(5, 20)],
      competitors: { a: [rank(2, 20)], b: [rank(9, 20)], c: [rank(12, 20)] },
    });
    const all = rankHistoryChart(history, OWN)
      .series.slice(1)
      .map((entry) => entry.role);
    const some = rankHistoryChart(history, { ...OWN, competitorIds: ['c'] })
      .series.slice(1)
      .map((entry) => entry.role);
    expect(all).toEqual([
      { kind: 'palette', index: 2 },
      { kind: 'palette', index: 3 },
      { kind: 'palette', index: 4 },
    ]);
    expect(some).toEqual([{ kind: 'palette', index: 4 }]);
  });

  it('lists the check slots in the order of the categories, with the instant of each check', () => {
    const model = rankHistoryChart(historyOf({ own: [rank(5, 20), beyond(20)] }), OWN);
    expect(model.slots.map((slot) => [slot.date, slot.observedAt])).toEqual([
      ['2026-10-01', '2026-10-01T02:00:00Z'],
      ['2026-10-02', '2026-10-02T02:00:00Z'],
    ]);
    expect(model.slots.map((slot) => slot.date)).toEqual(model.categories);
  });
});

const slot = (observedAt: string, date: string): CheckSlot => ({ key: observedAt, date, observedAt });
const hev = (type: string, at: string, entity: string): HistoryEvent => ({
  rank_event_id: `${type}-${at}-${entity}`,
  occurred_at: at,
  event_type: type,
  entity_id: entity,
  from_rank: null,
  to_rank: null,
});

describe('eventMarksOf', () => {
  const slots = [
    slot('2026-10-01T02:00:00.000Z', '2026-10-01'),
    slot('2026-10-02T02:00:00.000Z', '2026-10-02'),
    slot('2026-10-02T14:00:00.000Z', '2026-10-02'),
  ];

  it('maps the chart families, drops a competitor event, and puts an event on the check it names', () => {
    const events = [
      hev('url_changed', '2026-10-02T14:00:00.000Z', 'own'),
      hev('aio_appeared', '2026-10-01T02:00:00.000Z', 'own'),
      hev('entered_top_10', '2026-10-02T02:00:00.000Z', 'rival'),
      hev('rank_gain', '2026-10-02T02:00:00.000Z', 'own'),
    ];
    expect(eventMarksOf(events, slots, 'own', (type) => type)).toEqual([
      { index: 0, family: 'aio', label: 'aio_appeared' },
      { index: 2, family: 'url', label: 'url_changed' },
    ]);
  });

  it('gives each chart type its family and the words of the caller', () => {
    const events = [
      hev('entered_top_10', '2026-10-01T02:00:00.000Z', 'own'),
      hev('lost_top_10', '2026-10-02T02:00:00.000Z', 'own'),
      hev('aio_disappeared', '2026-10-02T14:00:00.000Z', 'own'),
    ];
    expect(eventMarksOf(events, slots, 'own', (type) => `words of ${type}`)).toEqual([
      { index: 0, family: 'rank', label: 'words of entered_top_10' },
      { index: 1, family: 'rank', label: 'words of lost_top_10' },
      { index: 2, family: 'aio', label: 'words of aio_disappeared' },
    ]);
  });

  it('puts an event between two checks on the last check of its local day', () => {
    const marks = eventMarksOf([hev('url_changed', '2026-10-02T10:00:00.000Z', 'own')], slots, 'own', (t) => t);
    expect(marks.map((mark) => mark.index)).toEqual([2]);
  });

  it('counts the day in the time zone of the project, not in UTC', () => {
    // 23:30 UTC on Oct 1 is already Oct 2 in Berlin
    const event = hev('url_changed', '2026-10-01T23:30:00.000Z', 'own');
    expect(eventMarksOf([event], slots, 'own', (t) => t, 'Europe/Berlin').map((mark) => mark.index)).toEqual([2]);
    expect(eventMarksOf([event], slots, 'own', (t) => t, 'UTC').map((mark) => mark.index)).toEqual([0]);
  });

  it('matches the instant of a check whatever way the API writes it', () => {
    const marks = eventMarksOf([hev('url_changed', '2026-10-02T14:00:00Z', 'own')], slots, 'own', (t) => t);
    expect(marks.map((mark) => mark.index)).toEqual([2]);
  });

  it('drops an event that no check of the window covers', () => {
    const events = [
      hev('url_changed', '2026-09-20T02:00:00.000Z', 'own'),
      hev('url_changed', '2026-10-09T02:00:00.000Z', 'own'),
    ];
    expect(eventMarksOf(events, slots, 'own', (t) => t)).toEqual([]);
  });

  it('returns the marks sorted by check, whatever order the events came in', () => {
    const events = [
      hev('url_changed', '2026-10-02T14:00:00.000Z', 'own'),
      hev('entered_top_10', '2026-10-02T02:00:00.000Z', 'own'),
      hev('aio_appeared', '2026-10-01T02:00:00.000Z', 'own'),
    ];
    expect(eventMarksOf(events, slots, 'own', (t) => t).map((mark) => mark.index)).toEqual([0, 1, 2]);
  });

  it('has no marks without events', () => {
    expect(eventMarksOf([], slots, 'own', (t) => t)).toEqual([]);
  });
});
