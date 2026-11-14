'use client';

import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { useChangeFrame } from './change-frame';
import { useCardMeta } from './card-meta';
import { buildComparison, comparisonDomains, type ComparisonMetric, type ComparisonRow } from './comparison-model';
import { engineChartColor } from './engine-role';
import { percentNumber } from './percent';
import { useCardData } from './use-card-data';
import { useCardDensity } from './use-card-density';
import { useCardExport } from './use-card-seams';
import type { ExportBlock } from '../../export/export-model';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import {
  IntervalBar,
  IntervalBarTable,
  intervalBarCsv,
  type DumbbellRow,
  type IntervalBarProps,
  type PointsDeltaInput,
} from '@/components/app/chart/interval-bar';
import { EngineLogo } from '@/components/app/engine/engine-logo';
import type { CardProps } from '@/features/layouts';
import type { CsvCell } from '@/lib/csv/csv-write';
import { formatDateRange, formatList, formatMetricDelta, formatPercent, formatPointsDelta } from '@/lib/format';

type Translate = ReturnType<typeof useTranslations<'aiOverview.engines.comparison'>>;
type Compared = Extract<ComparisonRow, { state: 'compare' }>;

/** The name of the downloaded file, without its extension. */
const FILE_NAME = 'period-comparison';

const METRIC_KEY = {
  mention: 'metricMention',
  citation: 'metricCitation',
  share_of_voice: 'metricShareOfVoice',
} as const satisfies Record<ComparisonMetric, string>;

const EXPORT_HEADER = [
  'engine',
  'metric',
  'before_percent',
  'before_k',
  'before_n',
  'now_percent',
  'now_k',
  'now_n',
  'change_points',
  'interval_low_points',
  'interval_high_points',
  'detectable',
  'status',
] as const;

const metricOf = (value: string | undefined): ComparisonMetric =>
  value === 'citation' || value === 'share_of_voice' ? value : 'mention';

const changeOf = (row: Compared): PointsDeltaInput => ({
  value: row.points,
  unit: 'points',
  polarity: 'higher_is_better',
  isDetectable: row.detectable,
});

/** One window of a row as the Table view and the CSV say it: the rate and the answers it rests on. */
const sideText = (side: Compared['now'], t: Translate): string =>
  side.successes === null
    ? t('shareText', { value: formatPercent(side.value), n: side.answers })
    : t('rateText', { value: formatPercent(side.value), k: side.successes, n: side.answers });

/**
 * "This period vs the last" (CH-10): for each asked engine the rate of the metric in the window before and now as two
 * dots, and the change with its 95 percent interval on a second axis. Share of voice has no interval (it has no count
 * of successes), so its rows are words with the numbers. A change is coloured only when it is larger than normal
 * variation; an engine with fewer than 4 valid answers in a window says so and shows no rate.
 */
export default function PeriodComparisonCard({ item, options, live }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.engines.comparison');
  const chart = useTranslations('chart');
  const metaOf = useCardMeta();
  const density = useCardDensity();
  const data = useCardData({ previous: 'required', subscribed: live });
  const { scope, aggregates } = data;
  const metric = metricOf(options.metric);

  const comparison = useMemo(
    () => (aggregates === null ? [] : buildComparison({ aggregates, metric })),
    [aggregates, metric],
  );
  const title = t('title');
  const frame = useChangeFrame(data, title, (key, values) => t(key, values), null);
  const { rate, change: changeAxis } = comparisonDomains(comparison);

  const rowOf = (row: ComparisonRow): DumbbellRow => {
    const base = {
      id: row.engineCode,
      label: row.label,
      icon: <EngineLogo engine={row.engineCode} name="" />,
      color: engineChartColor(row.engineCode),
    };
    if (row.state === 'thin') {
      return {
        ...base,
        previous: null,
        current: null,
        previousText: '',
        currentText: '',
        accessibleText: t('rowThin', { engine: row.label, nBefore: row.before, nNow: row.now }),
        value: { kind: 'thin' },
      };
    }
    if (row.state === 'none') {
      const words = t('noAnswersWords');
      return {
        ...base,
        previous: null,
        current: null,
        previousText: '',
        currentText: '',
        accessibleText: t('rowNone', { engine: row.label, words }),
        value: { kind: 'none', text: words },
      };
    }
    const change = changeOf(row);
    const changeText = formatMetricDelta(change).text;
    const common = {
      ...base,
      previous: row.before.value,
      current: row.now.value,
      previousText: sideText(row.before, t),
      currentText: sideText(row.now, t),
    };
    if (row.interval === null) {
      const words = t('shareWords', {
        before: formatPercent(row.before.value),
        now: formatPercent(row.now.value),
        change: changeText,
        nBefore: row.before.answers,
        nNow: row.now.answers,
      });
      return {
        ...common,
        accessibleText: t('rowShare', { engine: row.label, words }),
        value: { kind: 'none', text: words },
      };
    }
    const intervalText = t('intervalText', {
      low: formatPointsDelta(row.interval.low),
      high: formatPointsDelta(row.interval.high),
    });
    return {
      ...common,
      accessibleText: t('rowText', {
        engine: row.label,
        change: changeText,
        interval: intervalText,
        test: row.detectable === true ? 'detectable' : row.detectable === false ? 'within' : 'other',
        before: common.previousText,
        now: common.currentText,
      }),
      tip: t('tip', {
        before: formatPercent(row.before.value),
        now: formatPercent(row.now.value),
        change: changeText,
        kBefore: row.before.successes ?? 0,
        nBefore: row.before.answers,
        kNow: row.now.successes ?? 0,
        nNow: row.now.answers,
      }),
      value: {
        kind: 'compare',
        interval: { estimate: row.points, low: row.interval.low, high: row.interval.high },
        change,
        test: 'interim',
        changeText,
        intervalText,
      },
    };
  };
  const bar: IntervalBarProps = {
    form: 'dumbbell',
    caption: title,
    labelHeader: t('labelHeader'),
    rows: comparison.map(rowOf),
    rateDomain: rate,
    changeDomain: changeAxis,
    density,
  };

  useCardExport(item.id, (): ExportBlock | null => {
    if (aggregates === null || data.phase === 'loading' || data.phase === 'error') return null;
    return {
      id: item.id,
      header: EXPORT_HEADER,
      rows: comparison.map((row): CsvCell[] => {
        const head: CsvCell[] = [row.engineCode, metric];
        if (row.state === 'none') return [...head, null, null, null, null, null, null, null, null, null, null, 'none'];
        if (row.state === 'thin') {
          return [...head, null, null, row.before, null, null, row.now, null, null, null, null, 'insufficient'];
        }
        return [
          ...head,
          percentNumber(row.before.value),
          row.before.successes,
          row.before.answers,
          percentNumber(row.now.value),
          row.now.successes,
          row.now.answers,
          percentNumber(row.points),
          row.interval === null ? null : percentNumber(row.interval.low),
          row.interval === null ? null : percentNumber(row.interval.high),
          row.detectable === null ? null : row.detectable ? 'true' : 'false',
          'ok',
        ];
      }),
    };
  });

  const parts = comparison.map((row) =>
    row.state === 'compare'
      ? t('summaryCompare', {
          engine: row.label,
          before: formatPercent(row.before.value),
          now: formatPercent(row.now.value),
          change: formatMetricDelta(changeOf(row)).text,
        })
      : row.state === 'thin'
        ? t('summaryThin', { engine: row.label })
        : t('summaryNone', { engine: row.label }),
  );
  const summary =
    comparison.length === 0
      ? t('summaryEmpty')
      : t('summaryIntro', {
          metric: t(METRIC_KEY[metric]),
          engines: formatList(comparison.map((row) => row.label)),
          parts: formatList(parts),
        });

  return (
    <ChartFrame
      kind="html"
      variant="panel"
      title={title}
      meta={metaOf({
        range: scope.range,
        prompts: aggregates?.promptCount ?? null,
        answers: null,
        branded: scope.branded,
        promptWeighted: true,
      })}
      footnote={t('footnote', { period: formatDateRange(scope.previous.from, scope.previous.to) })}
      height={180}
      summary={summary}
      body={<IntervalBar {...bar} />}
      table={<IntervalBarTable {...bar} />}
      menu={{
        fileName: FILE_NAME,
        csv: intervalBarCsv(bar, {
          change: chart('intervalBar.change'),
          interval: chart('intervalBar.interval'),
          previous: chart('intervalBar.previous'),
          current: chart('intervalBar.current'),
          thin: chart('intervalBar.thin'),
          noValue: chart('noValue'),
        }),
      }}
      {...frame}
    />
  );
}
