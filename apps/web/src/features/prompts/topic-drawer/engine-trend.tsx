'use client';

import { useTimeZone, useTranslations } from 'next-intl';
import { useCallback, useMemo, type ReactElement } from 'react';

import { useDrawerMetric, useTopicDrawer } from './drawer-context';
import { useTopicTrend } from './topic-trend-query';
import { ChartFrame, type ChartEmpty, type ChartError, type ChartNotice } from '@/components/app/chart/chart-frame';
import { engineRole, rateCeilingOf } from '@/features/prompts/history-model';
import { CELL_OF_METRIC } from '@/features/prompts/prompt-model';
import { useRateWords } from '@/features/prompts/rate-view';
import { enginePoints, isStale, poolNote, type TopicPoint } from '@/features/prompts/topics-by-engine/series-model';
import { useErrorId } from '@/lib/api/use-error-id';
import { rateBandOption, type RateBandPoint } from '@/lib/charts/rate-band-chart';
import type { ChartTokens } from '@/lib/design/read-tokens';
import { formatChartDate, formatPercent, formatTableDate } from '@/lib/format';
import { MIN_OBSERVATIONS } from '@/lib/stats';

const formatRate = (value: number): string => formatPercent(value, { decimals: 0 });

/** One engine's points over the weeks of the chart, `null` where the engine has no point for a week. */
interface EngineLine {
  code: string;
  label: string;
  points: (TopicPoint | null)[];
}

interface TrendModel {
  /** The Mondays the points are of, oldest first. */
  weeks: string[];
  lines: EngineLine[];
}

type FrameState =
  | { status: 'loading' | 'ready' | 'refetching' }
  | { status: 'empty'; empty: ChartEmpty }
  | { status: 'error'; error: ChartError };

/**
 * The Trend by engine section of the topic drawer's Overview (WB-TPE-10, CF-31): the weekly rate of the topic on each
 * engine over the window, each with the 95 percent Wilson band of its pooled answers, from the weekly read of the topic
 * (`filter[term]`). A point that shows several weeks together (the API pools a topic point when fewer than 10 prompts
 * answered, C-18) says so in its tooltip and its table row, and the footnote says the rule whenever a point is pooled. A
 * point over too few answers is hollow with no band, a week with no valid answer a gap, and an engine without a series is
 * not drawn and reads "No valid answer" in the table. The chart is also a table of the same words. The metric is the page's.
 */
export function EngineTrend(): ReactElement {
  const { topicKey, summary, engines, extras } = useTopicDrawer();
  const t = useTranslations('prompts.topicDrawer.trend');
  const pooling = useTranslations('prompts.topicDrawer.pooling');
  const panel = useTranslations('prompts.topicDrawer.panel');
  const prompts = useTranslations('prompts');
  const common = useTranslations('common');
  const words = useRateWords();
  const timeZone = useTimeZone() ?? 'UTC';
  const { metric } = useDrawerMetric();
  const key = CELL_OF_METRIC[metric];
  const { scope, range, includeBranded, country } = extras;
  const read = useMemo(() => ({ scope, range, includeBranded, country }), [scope, range, includeBranded, country]);
  const trend = useTopicTrend(read, topicKey, true, summary);
  const errorId = useErrorId(trend.error);
  const metricLabel = prompts(`metric.${metric}`);

  const model = useMemo((): TrendModel | null => {
    const cells = trend.row?.engines;
    const found = engines.map(({ engine }) => ({
      code: engine.engine_code,
      label: engine.label,
      points: enginePoints(
        cells?.find((cell) => cell.engine_code === engine.engine_code),
        key,
      ),
    }));
    const weeks = [...new Set(found.flatMap((entry) => entry.points?.map((point) => point.weekStart) ?? []))].sort();
    if (weeks.length === 0) return null;
    return {
      weeks,
      lines: found.map((entry) => ({
        code: entry.code,
        label: entry.label,
        points: weeks.map((week) => entry.points?.find((point) => point.weekStart === week) ?? null),
      })),
    };
  }, [trend.row, engines, key]);

  /** The words of one week of one engine: the same in the tooltip and in the table. */
  const pointText = useCallback(
    (point: TopicPoint | null): string => {
      if (point === null || point.value === null) return t('cellNone');
      const basis =
        words.basis({
          state: point.thin ? 'insufficient' : 'ok',
          value: point.value,
          answers: point.n,
          successes: point.k,
          reason: null,
        }) ?? '';
      const text = point.thin
        ? t('cellThin', { basis, prompts: point.prompts })
        : t('cell', { value: formatRate(point.value), basis, prompts: point.prompts });
      // A pooled point says which weeks it holds: a canvas line cannot restyle one point, so the words do
      return point.showsPool
        ? t('cellPooled', {
            cell: text,
            span: pooling('pointTitle', { weeks: point.weeks, date: formatChartDate(point.weekStart) }),
          })
        : text;
    },
    [t, pooling, words],
  );
  const titles = useMemo(
    () =>
      (model?.weeks ?? []).map((week, at) => {
        const pooled = Math.max(
          1,
          ...(model?.lines ?? []).map((line) => {
            const point = line.points[at];
            return point?.showsPool === true ? point.weeks : 1;
          }),
        );
        return pooled > 1
          ? pooling('pointTitle', { weeks: pooled, date: formatChartDate(week) })
          : formatChartDate(week);
      }),
    [model, pooling],
  );
  const cellText = useCallback(
    (seriesId: string, index: number): string | null => {
      const line = model?.lines.find((entry) => entry.code === seriesId);
      return line === undefined ? null : pointText(line.points[index] ?? null);
    },
    [model, pointText],
  );
  const bands = useMemo((): Record<string, (RateBandPoint | null)[]> => {
    const bySeries: Record<string, (RateBandPoint | null)[]> = {};
    for (const line of model?.lines ?? []) {
      bySeries[line.code] = line.points.map((point) =>
        point === null ? null : { value: point.value, band: point.band, thin: point.thin, tip: pointText(point) },
      );
    }
    return bySeries;
  }, [model, pointText]);
  const ceiling = useMemo(() => rateCeilingOf((model?.lines ?? []).flatMap((line) => line.points)), [model]);
  const extendOption = useCallback(
    (option: Record<string, unknown>, tokens: ChartTokens): Record<string, unknown> =>
      rateBandOption(option, tokens, {
        points: bands,
        titles,
        ceiling,
        // The band is a little stronger on the dark ground (15 section 4); the theme is a class of the page
        dark: document.documentElement.classList.contains('dark'),
      }),
    [bands, titles, ceiling],
  );

  const categories = useMemo(() => (model?.weeks ?? []).map((week) => formatChartDate(week)), [model]);
  const series = useMemo(
    () =>
      (model?.lines ?? []).map((line) => ({
        id: line.code,
        name: line.label,
        role: engineRole(line.code),
        values: line.points.map((point) => point?.value ?? null),
      })),
    [model],
  );
  const lastValid = trend.row?.last_valid_at ?? null;
  const notice: ChartNotice | undefined =
    lastValid !== null && isStale(lastValid, new Date())
      ? { kind: 'stale', text: panel('stale', { date: formatTableDate(lastValid, timeZone) }) }
      : undefined;
  const pooledAny = (model?.lines ?? []).some(
    (line) => poolNote(line.points.filter((point): point is TopicPoint => point !== null)).pooled > 0,
  );
  const state: FrameState =
    model !== null
      ? { status: trend.fetching ? 'refetching' : 'ready' }
      : trend.status === 'failed'
        ? {
            status: 'error',
            error: {
              title: prompts('summaryLoadFailed'),
              reason: prompts('loadFailedReason'),
              errorId,
              onRetry: trend.retry,
              retrying: trend.fetching,
              retryLabel: common('retry'),
            },
          }
        : trend.status === 'loading'
          ? { status: 'loading' }
          : { status: 'empty', empty: { title: t('noSeriesTitle'), reason: t('noSeriesReason') } };

  return (
    <div className="rounded-lg border border-border bg-surface px-4 pt-3 pb-4">
      <ChartFrame
        kind="line"
        variant="inspector"
        title={t('title')}
        meta={t('meta', { metric: metricLabel })}
        notice={notice}
        footnote={
          <>
            <p>{t('footnote', { min: MIN_OBSERVATIONS })}</p>
            {pooledAny ? <p>{pooling('sentence')}</p> : null}
          </>
        }
        categories={categories}
        categoryHeader={t('weekColumn')}
        cellText={cellText}
        series={series}
        formatValue={formatRate}
        height={180}
        summary={t('summary', { metric: metricLabel })}
        extendOption={extendOption}
        {...state}
      />
    </div>
  );
}
