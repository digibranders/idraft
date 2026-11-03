'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useMemo } from 'react';

import { eventMarksOf, rankHistoryChart, type DeepChecks, type RankHistoryModel } from './rank-history-model';
import type { ChartHeight } from '@/components/app/chart/chart-frame';
import type { RankHistory } from '@/lib/api/types';
import { rankAxis, type EventMark } from '@/lib/charts/rank-chart';
import type { CategorySeries } from '@/lib/charts/category-chart';
import type { ChartTokens } from '@/lib/design/read-tokens';
import { formatChartDate, formatInteger } from '@/lib/format';

export interface RankHistoryChartOptions {
  /** The chart's height; the rank axis lays its labels out by it. */
  height: ChartHeight;
  /** The window the history covers, for the sentences and the meta line. Default 90. */
  days?: number;
  deep?: DeepChecks;
  absolute?: boolean;
  /** The competitors to draw, in order; null or absent draws all. Keep it stable (`useMemo`). */
  competitorIds?: readonly string[] | null;
  /** Added to the meta line after a middle dot: "deep check Monday". */
  metaSuffix?: string;
  /** Marks the own events of the chart families on the bottom edge of the plot (the page's Events layer). */
  events?: boolean;
  /** The project's time zone, for the day of an event that does not carry the instant of a check. Default UTC. */
  timeZone?: string;
}

/** What `ChartFrame` needs to draw the history. */
export interface RankHistoryFrame {
  categories: string[];
  categoryHeader: string;
  series: CategorySeries[];
  formatValue: (value: number) => string;
  extendOption: (option: Record<string, unknown>, tokens: ChartTokens) => Record<string, unknown>;
  summary: string;
  meta: string;
  model: RankHistoryModel;
  /** The events drawn on the chart (empty while the layer is off), for the key under it. */
  eventMarks: EventMark[];
}

export type RankHistoryChartState = 'loading' | 'empty' | 'allFailed' | 'ready';

const DEFAULT_DAYS = 90;
const formatValue = (value: number): string => formatInteger(value);

/**
 * The rank history chart of the inspector card and of the page: one model, one set of sentences. `allFailed`
 * still has a frame (the chart shows a glyph per failed check); `loading` and `empty` have none.
 */
export function useRankHistoryChart(
  history: RankHistory | undefined,
  options: RankHistoryChartOptions,
): { state: RankHistoryChartState; frame: RankHistoryFrame | null } {
  const t = useTranslations('rankings.rankHistory');
  const { height, days = DEFAULT_DAYS, deep, absolute, competitorIds, metaSuffix, events = false, timeZone } = options;

  const model = useMemo(
    () =>
      history === undefined
        ? null
        : rankHistoryChart(history, {
            ownName: (name) => t('you', { name }),
            absoluteName: (name) => t('absolute', { name }),
            ...(deep === undefined ? {} : { deep }),
            ...(absolute === undefined ? {} : { absolute }),
            ...(competitorIds === undefined ? {} : { competitorIds }),
          }),
    [history, t, deep, absolute, competitorIds],
  );
  const categories = useMemo(() => (model ? model.categories.map((date) => formatChartDate(date)) : []), [model]);
  const failedIndices = useMemo(
    () => (model?.series[0]?.values ?? []).flatMap((value, index) => (value === 'failed' ? [index] : [])),
    [model],
  );
  const eventMarks = useMemo((): EventMark[] => {
    const own = history?.series?.find((entry) => entry.entity.role === 'own') ?? history?.series?.[0];
    if (!events || model === null || own === undefined) return [];
    const labelOf = (type: string): string => {
      switch (type) {
        case 'url_changed':
          return t('eventMark.url_changed');
        case 'entered_top_10':
          return t('eventMark.entered_top_10');
        case 'lost_top_10':
          return t('eventMark.lost_top_10');
        case 'aio_appeared':
          return t('eventMark.aio_appeared');
        case 'aio_disappeared':
          return t('eventMark.aio_disappeared');
        default:
          return type;
      }
    };
    return eventMarksOf(history?.events ?? [], model.slots, own.entity.entity_id, labelOf, timeZone);
  }, [events, history, model, t, timeZone]);
  const extendOption = useCallback(
    (base: Record<string, unknown>, tokens: ChartTokens): Record<string, unknown> =>
      model === null
        ? base
        : rankAxis(base, tokens, {
            eventMarks,
            depthMax: model.depthMax,
            plotHeight: height,
            bands: model.bands,
            failedIndices,
            failedLabel: t('checkFailed'),
            guide: (rank) => t('guide', { rank }),
            bandLabel: (depth) => t('band', { depth }),
            axisName: t('axisName'),
            deepIndices: model.deepIndices,
            deepLabel: t('deepCheck'),
          }),
    [model, failedIndices, height, t, eventMarks],
  );

  if (model === null) return { state: 'loading', frame: null };
  if (model.empty) return { state: 'empty', frame: null };

  const ownName = model.series[0]?.name ?? '';
  const ranked = (model.series[0]?.values ?? []).filter((value): value is number => typeof value === 'number');
  const first = ranked[0];
  const last = ranked.at(-1);
  const allFailed = model.summary.checks === 0 && model.summary.failed > 0;

  const bands = model.bands
    .map((band) => {
      const from = categories[band.from] ?? '';
      const to = categories[band.to] ?? '';
      return from === to
        ? t('bandSingle', { depth: band.depth, date: from })
        : t('bandRange', { depth: band.depth, from, to });
    })
    .join(' ');

  let sentence: string;
  if (allFailed) {
    sentence = t('summaryAllFailed', { name: ownName, days });
  } else if (first === undefined || last === undefined) {
    sentence = t('summaryUnranked', { name: ownName, days });
  } else {
    sentence = t('summary', {
      name: ownName,
      days,
      first,
      last,
      best: Math.min(...ranked),
      competitors: model.series.filter((entry) => entry.role.kind === 'palette').length,
      failed: model.summary.failed,
    });
  }
  const summary = [
    sentence.trim(),
    bands,
    model.deepHidden > 0 ? t('deepNote', { count: model.deepHidden }) : '',
    events ? t('eventsMarked', { count: eventMarks.length }) : '',
  ]
    .filter((part) => part !== '')
    .join(' ');

  const counts = { days, checks: model.summary.checks, ranked: model.summary.ranked, failed: model.summary.failed };
  const base = allFailed
    ? t('metaAllFailed', counts)
    : model.summary.failed > 0
      ? t('metaWithFailed', counts)
      : t('meta', counts);
  const meta = metaSuffix === undefined ? base : `${base} · ${metaSuffix}`;

  return {
    state: allFailed ? 'allFailed' : 'ready',
    frame: {
      categories,
      categoryHeader: t('category'),
      series: model.series,
      formatValue,
      extendOption,
      summary,
      meta,
      model,
      eventMarks,
    },
  };
}
