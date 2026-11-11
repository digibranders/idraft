'use client';

import { useQuery } from '@tanstack/react-query';
import { LineChart } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { rankHistoryQuery, type KeywordScope } from './inspector-queries';
import { SectionError } from './section-error';
import { useRankHistoryChart } from '../rank-history/use-rank-history-chart';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import { InspectorSection } from '@/components/app/inspector/inspector-section';
import { EmptyState } from '@/components/app/status/empty-state';

export interface RankHistorySectionProps {
  scope: KeywordScope;
}

/**
 * The keyword's organic rank history over the last 90 days, with effective competitors. The page of the
 * keyword draws the same chart (`useRankHistoryChart`) with more controls.
 */
export function RankHistorySection({ scope }: RankHistorySectionProps): ReactElement {
  const t = useTranslations('rankings.rankHistory');
  const history = useQuery(rankHistoryQuery(scope));
  const { state, frame } = useRankHistoryChart(history.data?.data, { height: 180 });

  if (history.isPending) {
    return <InspectorSection title={t('title')} icon={LineChart} status="loading" />;
  }

  if (history.isError) {
    return (
      <InspectorSection
        title={t('title')}
        icon={LineChart}
        status="error"
        error={
          <SectionError
            title={t('failed')}
            error={history.error}
            onRetry={() => void history.refetch()}
            retrying={history.isFetching}
          />
        }
      />
    );
  }

  if (frame === null || state === 'empty') {
    return (
      <InspectorSection
        title={t('title')}
        icon={LineChart}
        status="empty"
        empty={<EmptyState variant="inline" title={t('empty')} reason={t('emptyReason')} headingLevel={3} />}
      />
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface px-4 pt-3 pb-4">
      <ChartFrame
        title={t('title')}
        variant="inspector"
        meta={frame.meta}
        kind="line"
        categories={frame.categories}
        categoryHeader={frame.categoryHeader}
        series={frame.series}
        formatValue={frame.formatValue}
        height={180}
        summary={frame.summary}
        status="ready"
        extendOption={frame.extendOption}
      />
    </div>
  );
}
