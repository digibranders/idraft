'use client';

import { useTimeZone, useTranslations } from 'next-intl';
import { useCallback, useMemo, type ReactElement, type ReactNode } from 'react';

import { ChartFrame, type ChartEmpty, type ChartError, type ChartNotice } from '@/components/app/chart/chart-frame';
import { rateCeilingOf } from '@/features/prompts/history-model';
import { useRateWords } from '@/features/prompts/rate-view';
import { isStale, poolNote, type TopicPoint } from '@/features/prompts/topics-by-engine/series-model';
import { rateBandOption, type RateBandPoint } from '@/lib/charts/rate-band-chart';
import type { SeriesRole } from '@/lib/charts/category-chart';
import type { ChartTokens } from '@/lib/design/read-tokens';
import { formatChartDate, formatPercent, formatTableDate } from '@/lib/format';
import { MIN_OBSERVATIONS } from '@/lib/stats';

const formatRate = (value: number): string => formatPercent(value, { decimals: 0 });

/** One line of the chart: its points over `weeks`, `null` where it has none for a week. */
export interface RateLine {
  id: string;
  name: string;
  role: SeriesRole;
  points: readonly (TopicPoint | null)[];
}

export type RateFrameState =
  | { status: 'loading' | 'ready' | 'refetching' }
  | { status: 'empty'; empty: ChartEmpty }
  | { status: 'error'; error: ChartError };

export interface RateLinesFrameProps {
  title: string;
  meta: string;
  summary: string;
  /** The Mondays the points are of, oldest first. */
  weeks: readonly string[];
  lines: readonly RateLine[];
  /** The topic's last valid answer: a long silence says so in the meta line. */
  lastValidAt: string | null;
  /** The sentences of the footnote that are the chart's own, before the shared ones. */
  footnote?: ReactNode;
  /** What the viewer can change about the lines (an engine). */
  controls?: ReactNode;
  /** The lines carry the interval of their pooled answers. An average of engines does not, and the footnote says so. */
  banded?: boolean;
  state: RateFrameState;
}

/**
 * The weekly rate of a topic as lines with the 95 percent Wilson band of the pooled answers, the frame the topic drawer's
 * trends share (CF-31, WB-TI-12): one point of one line says its rate and the answers and prompts behind it the same in
 * the tooltip and the table form, names the weeks a pooled point holds (C-18) and says the rule in the footnote whenever
 * a point is pooled. A point over too few answers is hollow with no band, a week with no valid answer a gap.
 */
export function RateLinesFrame({
  title,
  meta,
  summary,
  weeks,
  lines,
  lastValidAt,
  footnote,
  controls,
  banded = true,
  state,
}: RateLinesFrameProps): ReactElement {
  const t = useTranslations('prompts.topicDrawer.trend');
  const pooling = useTranslations('prompts.topicDrawer.pooling');
  const panel = useTranslations('prompts.topicDrawer.panel');
  const words = useRateWords();
  const timeZone = useTimeZone() ?? 'UTC';

  /** The words of one week of one line: the same in the tooltip and in the table. */
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
      weeks.map((week, at) => {
        const pooled = Math.max(
          1,
          ...lines.map((line) => {
            const point = line.points[at];
            return point?.showsPool === true ? point.weeks : 1;
          }),
        );
        return pooled > 1
          ? pooling('pointTitle', { weeks: pooled, date: formatChartDate(week) })
          : formatChartDate(week);
      }),
    [weeks, lines, pooling],
  );
  const cellText = useCallback(
    (seriesId: string, index: number): string | null => {
      const line = lines.find((entry) => entry.id === seriesId);
      return line === undefined ? null : pointText(line.points[index] ?? null);
    },
    [lines, pointText],
  );
  const bands = useMemo((): Record<string, (RateBandPoint | null)[]> => {
    const bySeries: Record<string, (RateBandPoint | null)[]> = {};
    for (const line of lines) {
      bySeries[line.id] = line.points.map((point) =>
        point === null ? null : { value: point.value, band: point.band, thin: point.thin, tip: pointText(point) },
      );
    }
    return bySeries;
  }, [lines, pointText]);
  const ceiling = useMemo(() => rateCeilingOf(lines.flatMap((line) => line.points)), [lines]);
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
  const categories = useMemo(() => weeks.map((week) => formatChartDate(week)), [weeks]);
  const series = useMemo(
    () =>
      lines.map((line) => ({
        id: line.id,
        name: line.name,
        role: line.role,
        values: line.points.map((point) => point?.value ?? null),
      })),
    [lines],
  );
  const notice: ChartNotice | undefined =
    lastValidAt !== null && isStale(lastValidAt, new Date())
      ? { kind: 'stale', text: panel('stale', { date: formatTableDate(lastValidAt, timeZone) }) }
      : undefined;
  const pooledAny = lines.some(
    (line) => poolNote(line.points.filter((point): point is TopicPoint => point !== null)).pooled > 0,
  );

  return (
    <div className="rounded-lg border border-border bg-surface px-4 pt-3 pb-4">
      <ChartFrame
        kind="line"
        variant="inspector"
        title={title}
        meta={meta}
        notice={notice}
        footnote={
          <>
            {footnote}
            <p>{t(banded ? 'footnote' : 'footnoteAverage', { min: MIN_OBSERVATIONS })}</p>
            {pooledAny ? <p>{pooling('sentence')}</p> : null}
          </>
        }
        controls={controls}
        categories={categories}
        categoryHeader={t('weekColumn')}
        cellText={cellText}
        series={series}
        formatValue={formatRate}
        height={180}
        summary={summary}
        extendOption={extendOption}
        {...state}
      />
    </div>
  );
}
