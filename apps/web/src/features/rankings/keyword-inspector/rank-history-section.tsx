'use client';

import { useQuery } from '@tanstack/react-query';
import { LineChart } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, type ReactElement } from 'react';

import { rankHistoryQuery, type KeywordScope } from './inspector-queries';
import { rankHistoryChart } from './rank-history-model';
import { SectionError } from './section-error';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import { InspectorSection } from '@/components/app/inspector/inspector-section';
import { EmptyState } from '@/components/app/status/empty-state';
import { rankAxis } from '@/lib/charts/rank-chart';
import type { ChartTokens } from '@/lib/design/read-tokens';
import { formatChartDate, formatInteger } from '@/lib/format';

export interface RankHistorySectionProps {
  scope: KeywordScope;
  timeZone: string;
}

/**
 * The keyword's organic rank history over the last 90 days, with effective competitors.
 */
export function RankHistorySection({ scope }: RankHistorySectionProps): ReactElement {
  const t = useTranslations('rankings.inspector.rankHistory');
  const history = useQuery(rankHistoryQuery(scope));

  const model = useMemo(
    () =>
      history.data
        ? rankHistoryChart(history.data.data, {
            ownName: (name) => t('you', { name }),
          })
        : null,
    [history.data, t],
  );

  const categories = useMemo(() => (model ? model.categories.map((d) => formatChartDate(d)) : []), [model]);
  const formatValue = useCallback((value: number) => formatInteger(value), []);

  const extendOption = useCallback(
    (baseOption: Record<string, unknown>, tokens: ChartTokens) => {
      if (!model) return baseOption;
      return rankAxis(baseOption, tokens, {
        depthMax: model.depthMax,
        plotHeight: 180,
        bands: model.bands,
        guide: (rank) => t('guide', { rank }),
        bandLabel: (depth) => t('band', { depth }),
      });
    },
    [model, t],
  );

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

  if (model === null || model.empty) {
    return (
      <InspectorSection
        title={t('title')}
        icon={LineChart}
        status="empty"
        empty={<EmptyState variant="inline" title={t('empty')} reason={t('emptyReason')} headingLevel={3} />}
      />
    );
  }

  const ownName = model.series[0]?.name ?? '';
  const ownValues = model.series[0]?.values ?? [];
  const rankedValues = ownValues.filter((v): v is number => v !== null);
  const firstRank = rankedValues[0];
  const lastRank = rankedValues.at(-1);
  const summary =
    rankedValues.length === 0 || firstRank === undefined || lastRank === undefined
      ? t('summaryUnranked', { name: ownName })
      : t('summary', {
          name: ownName,
          first: firstRank,
          last: lastRank,
          best: Math.min(...rankedValues),
          competitors: Math.max(0, model.series.length - 1),
        });

  const meta = t('meta', { checks: model.summary.checks, ranked: model.summary.ranked });

  return (
    <div className="rounded-lg border border-border bg-surface px-4 pt-3 pb-4">
      <ChartFrame
        title={t('title')}
        variant="inspector"
        meta={meta}
        kind="line"
        categories={categories}
        categoryHeader={t('category')}
        series={model.series}
        formatValue={formatValue}
        height={180}
        summary={summary}
        status="ready"
        extendOption={extendOption}
      />
    </div>
  );
}
