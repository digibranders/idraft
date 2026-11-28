'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { ChartFrame } from '@/components/app/chart/chart-frame';
import { formatBusinessDate, formatInteger, formatMetricDelta, type ChangeTone } from '@/lib/format';
import type { PageAi } from '@/lib/internal-links/types';
import { changeOf, trendOf } from '@/lib/pages/ai-model';
import { cn } from '@/lib/utils';

export interface AiTrendCardProps {
  ai: PageAi;
}

const CHART_HEIGHT = 180;

const TONE_CLASS: Readonly<Record<ChangeTone, string>> = {
  positive: 'text-positive-text',
  negative: 'text-negative-text',
  neutral: 'text-foreground-secondary',
};

const formatValue = (value: number): string => formatInteger(value);

/** Daily citation counts are whole numbers, so ECharts keeps y-axis intervals at least 1. */
const withWholeAxis = (option: Record<string, unknown>): Record<string, unknown> => {
  const axis = typeof option.yAxis === 'object' && option.yAxis !== null ? option.yAxis : {};
  return { ...option, yAxis: { ...axis, minInterval: 1 } };
};

/** Daily bars of AI answers citing the open page, with compared period change and Chart/Table switch. */
export function AiTrendCard({ ai }: AiTrendCardProps): ReactElement {
  const t = useTranslations('pages.drawer.ai.trend');
  const change = changeOf(ai);
  const deltaDisplay =
    change === null
      ? null
      : formatMetricDelta({
          value: change.delta,
          unit: 'count',
          polarity: 'higher_is_better',
          isDetectable: null,
        });
  const trend = trendOf(ai, {
    seriesName: t('series'),
    cell: (cited, answers) => t('cellText', { cited, answers }),
    noAnswers: t('noAnswers'),
  });

  const summary = t('summary', {
    cited: ai.answers_citing,
    answers: ai.answers,
    start: formatBusinessDate(ai.window.from),
    end: formatBusinessDate(ai.window.to),
  });

  const showChange = change !== null && deltaDisplay !== null && (ai.answers_citing > 0 || change.previous > 0);
  const direction = change === null ? 'flat' : change.delta > 0 ? 'up' : change.delta < 0 ? 'down' : 'flat';

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface px-4 pt-3 pb-4">
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 type-body text-foreground">
        <span className="num">{ai.answers_citing === 0 ? t('notCited') : t('line', { count: ai.answers_citing })}</span>
        {showChange ? (
          <span className={cn('num type-meta', TONE_CLASS[deltaDisplay.tone])}>
            {t('change', {
              direction,
              delta: deltaDisplay.text,
              days: change.days,
              previous: formatInteger(change.previous),
            })}
          </span>
        ) : null}
      </p>
      <ChartFrame
        title={t('title')}
        variant="inspector"
        kind="bar"
        categories={trend.categories}
        categoryHeader={t('day')}
        series={trend.series}
        formatValue={formatValue}
        cellText={trend.cellText}
        extendOption={withWholeAxis}
        height={CHART_HEIGHT}
        summary={summary}
        status="ready"
      />
    </div>
  );
}
