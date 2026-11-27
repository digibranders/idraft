'use client';

import { SearchX } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { useCompetitors } from '../competitors-context';
import { ReadFailed } from '../competitors-states';
import { bucketCounts, keywordTable, type KeywordRow } from '../model/seo-model';
import { ChartCard } from './chart-card';
import { useChartInfo } from './chart-info';
import { DonutCard } from './donut-card';
import { toSlices } from './donut-model';
import { countItem, FILE, ID, stripOf, textItem, valueItem } from './strip-items';
import { MetricStrip } from '@/components/app/metric/metric-strip';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { EmptyState } from '@/components/app/status/empty-state';
import { LinkButton } from '@/components/ui/link-button';
import { formatDecimal, formatInteger, formatPercent } from '@/lib/format';
import { rankingsPath } from '@/lib/routes/paths';

const BUCKET_ORDER = ['top3', 'top10', 'top20', 'beyond', 'none'] as const;
const BUCKET_ROLE = [
  { kind: 'brand' },
  { kind: 'palette', index: 2 },
  { kind: 'palette', index: 3 },
  { kind: 'palette', index: 4 },
  { kind: 'other' },
] as const;

const rankText = (rank: number | null): string => (rank === null ? '-' : formatInteger(rank));

/**
 * SEO ranking: where the own brand and each competitor stand in search for the tracked keywords, from the latest
 * check. Search rankings are not AI answers, so the platform, branded and topic filters do not apply here.
 */
export function SeoTab(): ReactElement {
  const t = useTranslations('competitors');
  const info = useChartInfo();
  const { reads, workspaceSlug, project } = useCompetitors();
  const { keywords } = reads;
  const model = useMemo(() => (keywords.data === undefined ? null : keywordTable(keywords.data)), [keywords.data]);

  if (keywords.status === 'error') {
    return (
      <ReadFailed
        title={t('states.readFailedTitle')}
        reason={t('states.readFailedReason')}
        errorId={keywords.errorId}
        onRetry={keywords.refetch}
      />
    );
  }
  if (model !== null && model.competitors.length === 0) {
    return (
      <EmptyState
        icon={SearchX}
        title={t('seo.emptyTitle')}
        reason={t('seo.emptyReason')}
        headingLevel={2}
        primaryAction={
          <LinkButton render={<Link href={rankingsPath(workspaceSlug, project.slug)} />} variant="secondary">
            {t('seo.open')}
          </LinkButton>
        }
      />
    );
  }

  const entities = model === null ? [] : [model.own, ...model.competitors];
  const counts = entities.map((entity) => bucketCounts(model?.rows ?? [], entity.id));
  const topTen = counts.map((count) => count.top3 + count.top10);
  const ownTopTen = topTen[0] ?? null;
  const loaded = model !== null;
  const ownCounts = counts[0];
  const rankSlices = toSlices(
    BUCKET_ORDER.map((bucket, index) => ({
      id: bucket,
      name: t(`seo.buckets.${bucket}`),
      value: ownCounts?.[bucket] ?? null,
      role: BUCKET_ROLE[index] ?? { kind: 'other' },
    })),
    t('charts.donut.other'),
    { sorted: false },
  );
  const ownTopTenShare =
    model === null || model.rows.length === 0 || ownTopTen === null ? null : ownTopTen / model.rows.length;

  const columns: PlainColumn<KeywordRow>[] = [
    {
      id: 'keyword',
      header: t('seo.keyword'),
      wrap: true,
      cell: (row) => <span className="type-body-strong">{row.text}</span>,
    },
    ...entities.map((entity): PlainColumn<KeywordRow> => ({
      id: entity.id,
      header: entity.name,
      cell: (row) => <span className="type-body tabular-nums">{rankText(row.ranks.get(entity.id) ?? null)}</span>,
    })),
    {
      id: 'ahead',
      header: t('seo.ahead'),
      cell: (row) => <span className="type-body tabular-nums">{formatInteger(row.competitorsAhead)}</span>,
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <MetricStrip
        size="md"
        label={t('strip.seo')}
        status={loaded ? 'ready' : 'loading'}
        groups={stripOf([
          countItem(
            ID.keywords,
            t('seo.keywordsTracked'),
            model?.rows.length ?? null,
            model === null || !model.truncated
              ? null
              : t('seo.firstOnly', { shown: model.rows.length, total: model.total }),
          ),
          countItem(
            ID.top10,
            t('seo.yourTop10'),
            ownTopTen,
            ownTopTen === null || model === null || model.rows.length === 0
              ? null
              : t('seo.shareOfTracked', { percent: formatPercent(ownTopTen / model.rows.length, { decimals: 0 }) }),
          ),
          valueItem(
            ID.average,
            t('seo.averagePosition'),
            model?.ownAverage == null ? null : formatDecimal(model.ownAverage, 1),
            model?.ownAverage == null ? null : t('seo.averageNote'),
          ),
          countItem(
            ID.behind,
            t('seo.behindAny'),
            model?.rows.filter((row) => row.competitorsAhead > 0).length ?? null,
            model === null ? null : t('seo.ofKeywords', { count: model.rows.length }),
          ),
          textItem(
            ID.leader,
            t('seo.topCompetitor'),
            model?.leader?.name ?? null,
            model?.leader === undefined ? null : t('seo.inTop10', { count: model.leader.topTen }),
          ),
        ])}
      />
      <div className="grid grid-cols-1 gap-3 @4xl:grid-cols-3">
        <DonutCard
          title={t('seo.donutTitle')}
          summary={t('seo.donutSummary')}
          info={info('seoRankSplit')}
          slices={rankSlices}
          centerValue={formatPercent(ownTopTenShare, { decimals: 0 })}
          centerLabel={t('seo.donutCenter')}
          formatValue={(value) => formatInteger(value)}
          reads={[keywords]}
          isEmpty={rankSlices.length === 0}
          showShare
        />
        <ChartCard
          title={t('seo.chartTop10')}
          summary={t('seo.chartTop10Summary')}
          kind="bar"
          categories={entities.map((entity) => entity.name)}
          categoryHeader={t('columns.competitor')}
          series={[{ id: ID.top10, name: t('seo.inTop10Label'), role: { kind: 'brand' }, values: topTen }]}
          formatValue={(value) => formatInteger(value)}
          reads={[keywords]}
          isEmpty={entities.length === 0}
          fileName={FILE.keywordsTop10}
          info={info('seoTop10')}
        />
        <ChartCard
          title={t('seo.chartBuckets')}
          summary={t('seo.chartBucketsSummary')}
          kind="bar"
          stacked
          categories={entities.map((entity) => entity.name)}
          categoryHeader={t('columns.competitor')}
          series={BUCKET_ORDER.map((bucket, index) => ({
            id: bucket,
            name: t(`seo.buckets.${bucket}`),
            role: BUCKET_ROLE[index] ?? { kind: 'other' },
            values: counts.map((count) => count[bucket]),
          }))}
          formatValue={(value) => formatInteger(value)}
          reads={[keywords]}
          isEmpty={entities.length === 0}
          fileName={FILE.rankDistribution}
          info={info('seoBuckets')}
        />
      </div>
      <PlainTable
        caption={t('seo.tableCaption')}
        columns={columns}
        rows={model?.rows ?? []}
        rowKey={(row) => row.id}
        status={loaded ? 'ready' : 'loading'}
        errorState={null}
        emptyText={t('seo.emptyReason')}
        scrollHint={t('columns.scrollHint')}
      />
    </div>
  );
}
