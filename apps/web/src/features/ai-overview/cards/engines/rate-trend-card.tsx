'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useMemo, type ReactElement } from 'react';

import { engineLabel, engineRole } from './engine-role';
import { percentNumber } from './percent';
import { buildPlatformTrend, weekMetricOf, type AveragePoint, type PlatformTrend } from './platform-trend';
import { tipOf, weeklyShareNote, type TrendPoint, type TrendWords, type WeekMetric } from './trend-model';
import { useCardData } from './use-card-data';
import { useCardExport } from './use-card-seams';
import { useFrameState } from './use-frame-state';
import { WEEKLY_SHARE_READ } from '../../data/overview-queries';
import { useOverview } from '../../overview-context';
import { compareWord, SCOPE_METRICS, singlePlatform, type ScopeMetric } from '../../scope/scope-model';
import { useScopeUnavailable } from '../../states/scope-unavailable';
import { ChartFrame, type ChartEmpty } from '@/components/app/chart/chart-frame';
import { useRateTipWords } from '@/components/app/chart/use-rate-tip-words';
import { SegmentedControl } from '@/components/ui/segmented-control';
import type { CardProps } from '@/features/layouts';
import type { EngineCode } from '@/lib/api/types';
import type { CategorySeries, CategoryValue } from '@/lib/charts/category-chart';
import type { CsvCell } from '@/lib/csv/csv-write';
import { rateBandOption, type RateBandPoint } from '@/lib/charts/rate-band-chart';
import type { ChartTokens } from '@/lib/design/read-tokens';
import { formatBusinessDate, formatChartDate, formatDateRange, formatList, formatPercent } from '@/lib/format';
import { visibilityOfPrompts } from '@/lib/rates/visibility-model';

/** The message suffix of each metric of the page scope: `titleMention`, `tabShareOfVoice`. */
const KEY = {
  visibility: 'Visibility',
  mention: 'Mention',
  citation: 'Citation',
  sov: 'ShareOfVoice',
} as const satisfies Record<ScopeMetric, string>;

const AVERAGE_ID = 'average';
/** The dashed line of the same period last year, week for week under the current weeks. */
const LAST_YEAR_ID = 'last-year';
/** The axis fits the data in steps of 5 points, with 3 points of room (OV-TREND-04). */
const STEP = 0.05;
const ROOM = 0.03;

type Translate = ReturnType<typeof useTranslations<'aiOverview.engines.platformTrend'>>;

/**
 * The points of the one line of last year: for All platforms the Average of the platforms that had a rate, for one
 * platform its own points. `null` when last year is not drawn.
 */
function lastYearValues(trend: PlatformTrend): (number | null)[] | null {
  const last = trend.lastYear;
  if (last === null) return null;
  return last.average?.map((point) => point.value) ?? last.platforms[0]?.points.map((point) => point.value) ?? null;
}

/** The lines of the chart as `ChartFrame` series: one for each platform, the dashed Average and the dashed last year. */
function seriesOf(
  trend: PlatformTrend,
  label: (code: EngineCode) => string,
  average: string,
  lastYear: string,
): CategorySeries[] {
  const last = lastYearValues(trend);
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
    ...(last === null
      ? []
      : [{ id: LAST_YEAR_ID, name: lastYear, role: { kind: 'reference' } as const, values: last }]),
  ];
}

/**
 * The words of an Average point: how many platforms it is of and, for Share of voice, the x of y brand mentions of each
 * (R3), because an average of shares has no count of its own: "Average of 2 platforms. Brand mentions: ChatGPT 8 of 20
 * and Gemini 6 of 15".
 */
function averageTip(
  point: AveragePoint,
  metric: WeekMetric,
  t: Translate,
  label: (code: EngineCode) => string,
): string {
  if (metric !== 'share_of_voice' || point.counts.length === 0) return t('averageTip', { count: point.platforms });
  const counts = formatList(point.counts.map(({ code, k, n }) => t('platformCount', { platform: label(code), k, n })));
  return t('averageShareTip', { count: point.platforms, counts });
}

/** The tooltip words of every point: a gap has none, a thin point says its answers, an Average says how many platforms. */
function pointsOf(
  trend: PlatformTrend,
  words: TrendWords,
  metric: WeekMetric,
  t: Translate,
  label: (code: EngineCode) => string,
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
                : {
                    value: point.value,
                    band: null,
                    thin: false,
                    tip: averageTip(point, metric, t, label),
                  },
            ),
          ],
        ];
  const last = lastYearTips(trend, words, metric, t, label);
  const lastYear: [string, (RateBandPoint | null)[]][] = last === null ? [] : [[LAST_YEAR_ID, last]];
  return Object.fromEntries([...platforms, ...average, ...lastYear]);
}

/** The tooltip words of the last year line: each point says the week of last year it is of, then its own counts. */
function lastYearTips(
  trend: PlatformTrend,
  words: TrendWords,
  metric: WeekMetric,
  t: Translate,
  label: (code: EngineCode) => string,
): (RateBandPoint | null)[] | null {
  const last = trend.lastYear;
  if (last === null) return null;
  const said = (index: number, tip: string): string => {
    const weekStart = last.weekStarts[index];
    return weekStart == null ? tip : t('lastYearTip', { date: formatBusinessDate(weekStart), tip });
  };
  if (last.average !== null) {
    return last.average.map((point, index) =>
      point.value === null
        ? null
        : { value: point.value, band: null, thin: false, tip: said(index, averageTip(point, metric, t, label)) },
    );
  }
  return (
    last.platforms[0]?.points.map((point, index) =>
      point.n === 0
        ? null
        : { value: point.value, band: null, thin: point.thin, tip: said(index, tipOf(point, metric, words)) },
    ) ?? null
  );
}

/** The axis from the lowest to the highest value (and band) on 5 point steps, never outside 0 to 100%. */
const latest = (values: readonly CategoryValue[]): number | null =>
  values.findLast((value): value is number => typeof value === 'number') ?? null;

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
    ...(lastYearValues(trend) ?? []),
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
  // Share of voice is drawn from the weekly cells of every tracked brand (the one read of its kind); the other metrics
  // from the weekly points of the prompt rows, as before. The two reads have distinct keys, so the cache never mixes them.
  const data = useCardData({
    previous: 'optional',
    ...(scope.metric === 'sov' ? WEEKLY_SHARE_READ : { include: ['series'] as const }),
    subscribed: live,
  });
  const metricKey = KEY[scope.metric];
  const weekMetric = weekMetricOf(scope.metric);
  const title = t(`title${metricKey}`);
  const unavailable = useScopeUnavailable(title);
  const single = singlePlatform(scope) !== null;

  const label = useCallback((code: EngineCode): string => engineLabel(code) ?? common('unknownEngine'), [common]);
  const words = useMemo<TrendWords>(
    () => ({
      rate: tipWords,
      share: (value, k, n) => t('shareTip', { value: formatPercent(value), k, n }),
      pooledRange: (weeks, from, to) => t('pooledRange', { weeks, range: formatDateRange(from, to) }),
      partial: trendWords('partialWeek'),
    }),
    [tipWords, t, trendWords],
  );

  const currentData = data.current.data;
  // The weeks of last year are not put before this year's (one line would join two seasons a year apart as if adjacent):
  // they are drawn under the current weeks, week for week, as one dashed line
  const previousData = data.previous?.data ?? null;
  const lastYear = scope.compareKind === 'previous_year';
  const trend = useMemo(
    () =>
      currentData === undefined || data.asked.length === 0
        ? null
        : buildPlatformTrend({
            current: currentData,
            previous: previousData,
            lastYear,
            codes: data.asked,
            metric: weekMetric,
            range: scope.range,
            previousRange: scope.previous,
            average: !single,
          }),
    [currentData, previousData, lastYear, data.asked, weekMetric, scope.range, scope.previous, single],
  );
  const series = useMemo(
    () => (trend === null ? [] : seriesOf(trend, label, t('average'), t('lastYear'))),
    [trend, label, t],
  );
  const points = useMemo(
    () => (trend === null ? {} : pointsOf(trend, words, weekMetric, t, label, single)),
    [trend, words, weekMetric, t, label, single],
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
      // More than 20 tracked brands is its own reason: the weekly cells stop at 20 and y would be too small (request 24)
      const capped =
        weekMetric === 'share_of_voice' && currentData !== undefined && weeklyShareNote(currentData) === 'capped';
      const reason = t(
        capped
          ? 'cappedShareReason'
          : weekMetric === 'share_of_voice'
            ? 'notCollectedShareReason'
            : 'notCollectedReason',
      );
      return {
        title: capped ? t('cappedTitle') : t('notCollectedTitle'),
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
        trend ?? {
          metric: weekMetric,
          weeks: [],
          boundary: null,
          platforms: [],
          average: null,
          lastYear: null,
          collected: true,
        },
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
        // The markers of `categoryChartOption` stay: their shapes tell the lines apart without colour (20-accessibility.md
        // section 12.2), and a small-sample point is the same shape, hollow
        series: [...(banded.series as Record<string, unknown>[]), ...boundary],
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
    const rowOf = (weekStart: string, period: string, code: EngineCode, point: TrendPoint | undefined): CsvCell[] => {
      const shown = point !== undefined && point.n > 0 && !point.thin && point.value !== null;
      return [
        weekStart,
        period,
        label(code),
        shown ? percentNumber(point.value ?? 0) : null,
        point?.k ?? null,
        point?.n ?? 0,
        point?.prompts ?? null,
        point?.band == null ? null : percentNumber(point.band.low),
        point?.band == null ? null : percentNumber(point.band.high),
        // The days a pooled point holds, as the API's `pool` says them (Share of voice: the total's own points)
        point?.pooledRange == null ? null : `${point.pooledRange.from} to ${point.pooledRange.to}`,
        point === undefined || point.n === 0 ? 'no_answers' : point.thin ? 'insufficient' : 'ok',
      ];
    };
    const last = trend.lastYear;
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
        'weeks_held',
        'status',
      ],
      rows: [
        ...trend.weeks.flatMap((entry, index) =>
          trend.platforms.map((line) =>
            rowOf(
              entry.weekStart,
              t(entry.period === 'previous' ? 'exportPrevious' : 'exportCurrent'),
              line.code,
              line.points[index],
            ),
          ),
        ),
        // The weeks of the same period last year, each platform's own points (the Average is not a platform)
        ...(last === null
          ? []
          : last.platforms.flatMap((line) =>
              last.weekStarts.flatMap((weekStart, index) =>
                weekStart === null ? [] : [rowOf(weekStart, t('exportLastYear'), line.code, line.points[index])],
              ),
            )),
      ],
    };
  });

  const summary = series
    .flatMap((entry) => {
      const value = latest(entry.values);
      return value === null
        ? []
        : [t('summaryPlatform', { platform: entry.name, value: formatPercent(value, { decimals: 0 }) })];
    })
    .join(', ');
  // The legend under the chart names each line with its latest rate, as the Table view and the summary do
  const legendValues = useMemo(
    (): Record<string, string> =>
      Object.fromEntries(
        series.map((entry) => {
          const value = latest(entry.values);
          return [entry.id, value === null ? t('legend.none') : formatPercent(value, { decimals: 0 })];
        }),
      ),
    [series, t],
  );
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
        {trend.lastYear === null ? null : <p>{t('footnoteLastYear')}</p>}
      </>
    );

  return (
    <ChartFrame
      kind="line"
      keepHeaderWhenEmpty
      variant="panel"
      title={title}
      meta={meta}
      info={{ what: t('info.what'), how: t('info.how', { days: scope.range.days, kind: compareWord(scope) }) }}
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
      legendValues={legendValues}
      legendMarkers
      menu={{ fileName: t('fileName'), png: true, csv: true }}
      {...frame}
    />
  );
}
