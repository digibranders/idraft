'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { ChartFrame } from '@/components/app/chart/chart-frame';
import { formatBusinessDate, formatInteger, formatSignedInteger } from '@/lib/format';
import type { PageAi } from '@/lib/internal-links/types';
import { changeOf, trendOf } from '@/lib/pages/ai-model';
import { cn } from '@/lib/utils';

export interface AiTrendCardProps {
  ai: PageAi;
}

const CHART_HEIGHT = 180;

const deltaToneClass = (delta: number): string =>
  delta > 0 ? 'text-positive-text' : delta < 0 ? 'text-negative-text' : 'text-foreground-secondary';

const formatValue = (value: number): string => formatInteger(value);

/** Daily bars of AI answers citing the open page, with compared period change and Chart/Table switch. */
export function AiTrendCard({ ai }: AiTrendCardProps): ReactElement {
  const t = useTranslations('pages.drawer.ai.trend');
  const change = changeOf(ai);
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

  const showChange = change !== null && (ai.answers_citing > 0 || change.previous > 0);
  const direction = change === null ? 'flat' : change.delta > 0 ? 'up' : change.delta < 0 ? 'down' : 'flat';

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface px-4 pt-3 pb-4">
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 type-body text-foreground">
        <span className="num">{ai.answers_citing === 0 ? t('notCited') : t('line', { count: ai.answers_citing })}</span>
        {showChange ? (
          <span className={cn('num type-meta', deltaToneClass(change.delta))}>
            {t('change', {
              direction,
              delta: formatSignedInteger(change.delta),
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
        height={CHART_HEIGHT}
        summary={summary}
        status="ready"
      />
    </div>
  );
}
