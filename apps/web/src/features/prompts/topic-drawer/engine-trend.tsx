'use client';

import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { useDrawerMetric, useTopicDrawer } from './drawer-context';
import { RateLinesFrame, type RateFrameState, type RateLine } from './rate-lines-frame';
import { useTopicTrend } from './topic-trend-query';
import { engineRole } from '@/features/prompts/history-model';
import { CELL_OF_METRIC } from '@/features/prompts/prompt-model';
import { enginePoints } from '@/features/prompts/topics-by-engine/series-model';
import { useErrorId } from '@/lib/api/use-error-id';

interface TrendModel {
  /** The Mondays the points are of, oldest first. */
  weeks: string[];
  lines: RateLine[];
}

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
  const prompts = useTranslations('prompts');
  const common = useTranslations('common');
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
        id: entry.code,
        name: entry.label,
        role: engineRole(entry.code),
        points: weeks.map((week) => entry.points?.find((point) => point.weekStart === week) ?? null),
      })),
    };
  }, [trend.row, engines, key]);

  const state: RateFrameState =
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
    <RateLinesFrame
      title={t('title')}
      meta={t('meta', { metric: metricLabel })}
      summary={t('summary', { metric: metricLabel })}
      weeks={model?.weeks ?? []}
      lines={model?.lines ?? []}
      lastValidAt={trend.row?.last_valid_at ?? null}
      state={state}
    />
  );
}
