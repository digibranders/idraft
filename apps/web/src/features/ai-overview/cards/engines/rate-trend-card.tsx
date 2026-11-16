'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useMemo, type ReactElement } from 'react';

import { engineLabel, engineRole } from './engine-role';
import { percentNumber } from './percent';
import { buildPlatformTrend, weekMetricOf, type PlatformTrend } from './platform-trend';
import { tipOf, type TrendPoint, type TrendWords, type WeekMetric } from './trend-model';
import { useCardData } from './use-card-data';
import { useCardExport } from './use-card-seams';
import { useFrameState } from './use-frame-state';
import { useOverview } from '../../overview-context';
import { SCOPE_METRICS, singlePlatform, type ScopeMetric } from '../../scope/scope-model';
import { useScopeUnavailable } from '../../states/scope-unavailable';
import { ChartFrame, type ChartEmpty } from '@/components/app/chart/chart-frame';
import { useRateTipWords } from '@/components/app/chart/use-rate-tip-words';
import { SegmentedControl } from '@/components/ui/segmented-control';
import type { CardProps } from '@/features/layouts';
import type { EngineCode } from '@/lib/api/types';
import type { CategorySeries, CategoryValue } from '@/lib/charts/category-chart';
import { rateBandOption, type RateBandPoint } from '@/lib/charts/rate-band-chart';
import type { ChartTokens } from '@/lib/design/read-tokens';
import { formatBusinessDate, formatChartDate, formatList, formatPercent } from '@/lib/format';
import { visibilityOfPrompts } from '@/lib/rates/visibility-model';

/** The message suffix of each metric of the page scope: `titleMention`, `tabShareOfVoice`. */
const KEY = {
  visibility: 'Visibility',
  mention: 'Mention',
  citation: 'Citation',
  sov: 'ShareOfVoice',
} as const satisfies Record<ScopeMetric, string>;

const AVERAGE_ID = 'average';
/** The axis fits the data in steps of 5 points, with 3 points of room (OV-TREND-04). */
const STEP = 0.05;
const ROOM = 0.03;

type Translate = ReturnType<typeof useTranslations<'aiOverview.engines.platformTrend'>>;

/** The lines of the chart as `ChartFrame` series: one for each platform and the dashed Average. */
function seriesOf(trend: PlatformTrend, label: (code: EngineCode) => string, average: string): CategorySeries[] {
  return [
    ...trend.platforms.map((entry): CategorySeries => ({
      id: entry.code,
      name: label(entry.code),
      role: engineRole(entry.code),
      values: entry.points.map((point) => point.value),
    })),
    ...(trend.average === null
      ? []
      : [
          {
            id: AVERAGE_ID,
            name: average,
            role: { kind: 'other' } as const,
            values: trend.average.map((point) => point.value),
          },
        ]),
  ];
}

/** The tooltip words of every point: a gap has none, a thin point says its answers, an Average says how many platforms. */
function pointsOf(
  trend: PlatformTrend,
  words: TrendWords,
  metric: WeekMetric,
  t: Translate,
  banded: boolean,
): Record<string, (RateBandPoint | null)[]> {
  const platforms = trend.platforms.map((entry): [string, (RateBandPoint | null)[]] => [
    entry.code,
    entry.points.map((point: TrendPoint) =>
      point.n === 0
        ? null
        : { value: point.value, band: banded ? point.band : null, thin: point.thin, tip: tipOf(point, metric, words) },
    ),
  ]);
  const average: [string, (RateBandPoint | null)[]][] =
    trend.average === null
      ? []
      : [
          [
            AVERAGE_ID,
            trend.average.map((point) =>
              point.value === null
                ? null
                : { value: point.value, band: null, thin: false, tip: t('averageTip', { count: point.platforms }) },
            ),
          ],
        ];
  return Object.fromEntries([...platforms, ...average]);
}

/** The axis from the lowest to the highest value (and band) on 5 point steps, never outside 0 to 100%. */
function axisOf(trend: PlatformTrend, banded: boolean): { min: number; max: number } {
  const values = [
    ...trend.platforms.flatMap((entry) =>
      entry.points.flatMap((point) => [
        point.value,
        banded ? point.band?.low : undefined,
        banded ? point.band?.high : undefined,
      ]),
    ),
    ...(trend.average ?? []).map((point) => point.value),
  ].filter((value): value is number => typeof value === 'number');
  if (values.length === 0) return { min: 0, max: 1 };
  return {
    min: Math.max(0, Math.floor((Math.min(...values) - ROOM) / STEP + 1e-9) * STEP),
    max: Math.min(1, Math.ceil((Math.max(...values) + ROOM) / STEP - 1e-9) * STEP),
  };
}

/**
 * OV-TREND: the chosen rate over the weekly runs, a line for each platform of the page scope with the dashed Average,
 * or one platform with the 95% interval of each point. The Metric (page scope, `metric` in the address) is shared with the
 * other cards. The weeks of the previous window come first, with a dotted line where the current one starts, when
 * Compare is on. AI visibility is drawn only when the API has it week by week; until then the card says so.
 */
export default function RateTrendCard({ item, live }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.engines.platformTrend');
  const trendWords = useTranslations('aiOverview.engines.trend');
  const common = useTranslations('aiOverview.engines.common');
  const tipWords = useRateTipWords();
  const { scope, setScope } = useOverview();
  const data = useCardData({ previous: 'optional', include: ['series'], subscribed: live });
  const metricKey = KEY[scope.metric];
  const weekMetric = weekMetricOf(scope.metric);
  const title = t(`title${metricKey}`);
  const unavailable = useScopeUnavailable(title);
  const single = singlePlatform(scope) !== null;

  const label = useCallback((code: EngineCode): string => engineLabel(code) ?? common('unknownEngine'), [common]);
  const words = useMemo<TrendWords>(
    () => ({
      rate: tipWords,
      share: (value, n) => t('shareTip', { value: formatPercent(value), count: n }),
      partial: trendWords('partialWeek'),
    }),
    [tipWords, t, trendWords],
  );

  const currentData = data.current.data;
  const previousData = data.previous?.data ?? null;
  const trend = useMemo(
    () =>
      currentData === undefined || data.asked.length === 0
        ? null
        : buildPlatformTrend({
            current: currentData,
            previous: previousData,
            codes: data.asked,
            metric: weekMetric,
            range: scope.range,
            previousRange: scope.previous,
            average: !single,
          }),
    [currentData, previousData, data.asked, weekMetric, scope.range, scope.previous, single],
  );
  const series = useMemo(() => (trend === null ? [] : seriesOf(trend, label, t('average'))), [trend, label, t]);
  const points = useMemo(
    () => (trend === null ? {} : pointsOf(trend, words, weekMetric, t, single)),
    [trend, words, weekMetric, t, single],
  );
  const categories = useMemo(
    () =>
      (trend?.weeks ?? []).map((entry, index, weeks) =>
        formatChartDate(
          entry.weekStart,
          index === 0 || entry.weekStart.slice(0, 4) !== weeks[index - 1]?.weekStart.slice(0, 4),
        ),
      ),
    [trend],
  );
  const titles = useMemo(
    () =>
      (trend?.weeks ?? []).map((entry) =>
        t(entry.period === 'previous' ? 'weekOfPrevious' : 'weekOf', { date: formatBusinessDate(entry.weekStart) }),
      ),
    [trend, t],
  );

  const weeksWithAnswers =
    trend === null
      ? 0
      : trend.weeks.filter((_, index) => trend.platforms.some((entry) => (entry.points[index]?.n ?? 0) > 0)).length;
  const prompts = currentData?.prompts;
  const windowValues = useMemo(
    () =>
      data.asked.flatMap((code) => {
        const figure = visibilityOfPrompts(prompts ?? [], code);
        return figure.state === 'ok' && figure.value !== null
          ? [`${label(code)} ${formatPercent(figure.value, { decimals: 0 })}`]
          : [];
      }),
    [data.asked, prompts, label],
  );

  const ready = data.phase === 'ready' || data.phase === 'refetching';
  const empty = ((): ChartEmpty | null => {
    if (data.asked.length === 0) return unavailable;
    if (data.phase === 'empty') return { title: t('emptyNoPromptsTitle'), reason: t('emptyNoPromptsReason') };
    if (!ready || trend === null) return null;
    if (!trend.collected) {
      const reason = t('notCollectedReason');
      return {
        title: t('notCollectedTitle'),
        reason:
          windowValues.length === 0
            ? reason
            : `${reason} ${t('notCollectedWindow', { list: formatList(windowValues) })}`,
      };
    }
    if (trend.platforms.length === 0) return { title: t('emptyTitle'), reason: t('emptyReason') };
    if (weeksWithAnswers < 2) return { title: t('weeksTitle'), reason: t('weeksReason') };
    return null;
  })();
  const frame = useFrameState(
    { ...data, phase: empty !== null && data.phase !== 'loading' && data.phase !== 'error' ? 'empty' : data.phase },
    { name: title, empty },
  );

  const extendOption = useCallback(
    (base: Record<string, unknown>, tokens: ChartTokens): Record<string, unknown> => {
      const axis = axisOf(
        trend ?? { metric: weekMetric, weeks: [], boundary: null, platforms: [], average: null, collected: true },
        single,
      );
      // The theme is a class of the page, read each time the chart is built so a switch of theme redraws the band
      const dark = document.documentElement.classList.contains('dark');
      const banded = rateBandOption(base, tokens, { points, ceiling: axis.max, dark, titles });
      const boundary =
        trend?.boundary == null
          ? []
          : [
              {
                id: 'period-boundary',
                type: 'line',
                data: [],
                silent: true,
                tooltip: { show: false },
                markLine: {
                  silent: true,
                  symbol: 'none',
                  animation: false,
                  label: { show: false },
                  lineStyle: { type: [3, 3], color: tokens.reference, width: 1 },
                  data: [{ xAxis: categories[trend.boundary] }],
                },
              },
            ];
      return {
        ...banded,
        yAxis: { ...(banded.yAxis as Record<string, unknown>), min: axis.min, max: axis.max },
        series: [...(banded.series as unknown[]), ...boundary],
      };
    },
    [trend, weekMetric, points, titles, categories, single],
  );
  const cellText = useCallback(
    (seriesId: string, index: number): string | null => points[seriesId]?.[index]?.tip ?? null,
    [points],
  );

  useCardExport(item.id, () => {
    if (trend === null || !ready || !trend.collected) return null;
    return {
      id: item.id,
      header: [
        'week',
        t('exportPeriod'),
        'platform',
        'value_percent',
        'k',
        'n',
        'prompts',
        'interval_low_percent',
        'interval_high_percent',
        'status',
      ],
      rows: trend.weeks.flatMap((entry, index) =>
        trend.platforms.map((line) => {
          const point = line.points[index];
          const shown = point !== undefined && point.n > 0 && !point.thin && point.value !== null;
          return [
            entry.weekStart,
            t(entry.period === 'previous' ? 'exportPrevious' : 'exportCurrent'),
            label(line.code),
            shown ? percentNumber(point.value ?? 0) : null,
            point?.k ?? null,
            point?.n ?? 0,
            point?.prompts ?? null,
            point?.band == null ? null : percentNumber(point.band.low),
            point?.band == null ? null : percentNumber(point.band.high),
            point === undefined || point.n === 0 ? 'no_answers' : point.thin ? 'insufficient' : 'ok',
          ];
        }),
      ),
    };
  });

  const latest = (values: readonly CategoryValue[]): number | null =>
    values.findLast((value): value is number => typeof value === 'number') ?? null;
  const summary = series
    .flatMap((entry) => {
      const value = latest(entry.values);
      return value === null
        ? []
        : [t('summaryPlatform', { platform: entry.name, value: formatPercent(value, { decimals: 0 }) })];
    })
    .join(', ');
  const hasBand = scope.metric !== 'sov';
  const platformName = data.asked[0] === undefined ? '' : label(data.asked[0]);
  const meta = single ? t(hasBand ? 'metaOne' : 'metaOneNoBand', { platform: platformName }) : t('metaAll');

  const controls = (
    <SegmentedControl<ScopeMetric>
      semantics="view"
      size="sm"
      label={t('metric')}
      value={scope.metric}
      onValueChange={(metric) => setScope({ metric })}
      items={SCOPE_METRICS.map((metric) => ({ value: metric, label: t(`tab${KEY[metric]}`) }))}
    />
  );
  const footnote =
    trend === null ? undefined : (
      <>
        <p>{trendWords(scope.metric === 'sov' ? 'footnoteShare' : 'footnotePooled')}</p>
        <p>{trendWords(scope.metric === 'sov' ? 'footnoteNoBand' : 'footnoteBand')}</p>
        <p>{trendWords('footnoteThin')}</p>
        {trend.boundary === null ? null : <p>{t('footnoteBoundary')}</p>}
      </>
    );

  return (
    <ChartFrame
      kind="line"
      keepHeaderWhenEmpty
      variant="panel"
      title={title}
      meta={meta}
      info={{ what: t('info.what'), how: t('info.how', { days: scope.range.days }) }}
      footnote={footnote}
      controls={controls}
      height={280}
      summary={
        ready && empty === null
          ? t('summary', { metric: title, list: summary === '' ? t('summaryNone') : summary })
          : ''
      }
      categories={categories}
      categoryHeader={t('week')}
      series={series}
      formatValue={(value) => formatPercent(value, { decimals: 0 })}
      cellText={cellText}
      extendOption={extendOption}
      menu={{ fileName: t('fileName'), png: true, csv: true }}
      {...frame}
    />
  );
}
