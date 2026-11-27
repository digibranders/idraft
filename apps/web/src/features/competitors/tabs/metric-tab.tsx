'use client';

import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { useCompetitors } from '../competitors-context';
import {
  cellOver,
  changeOf,
  rankedCompetitors,
  roleOf,
  standingOf,
  weeklyValues,
  type EntityRow,
  type MetricKey,
} from '../model/competitor-model';
import { ChartCard } from './chart-card';
import { useChartInfo, type ChartInfoId } from './chart-info';
import { DonutCard } from './donut-card';
import { toSlices } from './donut-model';
import { EntityName } from './entity-name';
import { ChangeCell, RateCell } from './metric-cells';
import { COLUMN, countItem, fileOf, gapItem, gapOf, ID, rateItem, stripOf, valueItem } from './strip-items';
import { TrackedSetGate } from './tracked-set-gate';
import { useTabModel } from './use-tab-model';
import { Delta } from '@/components/app/metric/delta';
import { MetricStrip } from '@/components/app/metric/metric-strip';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { formatPercent } from '@/lib/format';
import type { CategorySeries } from '@/lib/charts/category-chart';

/** The tabs that take one metric of the tracked set: Mentions, Citations and Share of Voice. */
export type MetricTabKind = 'mentions' | 'citations' | 'sov';

const BY_BRAND: Record<MetricTabKind, ChartInfoId> = {
  mentions: 'mentionsByBrand',
  citations: 'citationsByBrand',
  sov: 'sovByBrand',
};
const BY_PLATFORM: Record<MetricTabKind, ChartInfoId> = {
  mentions: 'mentionsByPlatform',
  citations: 'citationsByPlatform',
  sov: 'sovByPlatform',
};

const METRIC_OF: Record<MetricTabKind, MetricKey> = {
  mentions: 'mention_rate',
  citations: 'citation_share',
  sov: 'share_of_voice',
};

/**
 * One metric across the tracked set: the strip (you, the leader, the gap), three charts (by competitor, by platform,
 * over time) and the table. Mentions, Citations and Share of Voice differ in the metric and the trend, nothing else.
 */
export function MetricTab({ kind }: { kind: MetricTabKind }): ReactElement {
  const t = useTranslations('competitors');
  const info = useChartInfo();
  const metric = METRIC_OF[kind];
  const { reads, labelOf, scope } = useCompetitors();
  const { rows, engines, averaged } = useTabModel();
  // The API builds a weekly series per entity for share of voice and mention rate only, so Citations has no trend
  const trendKind = kind === 'citations' ? null : kind;
  const trend = kind === 'sov' ? reads.sovSeries : reads.mentionSeries;

  const own = rows.find((row) => row.role === 'own');
  const leaders = useMemo(() => rankedCompetitors(rows, metric, engines), [rows, metric, engines]);
  const leader = leaders[0];
  const ownCell = own === undefined ? null : cellOver(own, metric, engines);
  const leaderCell = leader === undefined ? null : cellOver(leader, metric, engines);
  const gap = gapOf(ownCell?.value, leaderCell?.value);
  const standing = standingOf(rows, metric, engines);

  const ordered = useMemo(
    () => [...rows.filter((row) => row.role === 'own'), ...leaders, ...rows.filter((row) => row.role === 'watch')],
    [rows, leaders],
  );

  // Rates that divide a whole are shown as a donut too: share of voice and citation share, not the mention rate
  const donutKind = kind === 'mentions' ? null : kind;
  const slices = toSlices(
    ordered.map((row, position) => ({
      id: row.id,
      name: row.name,
      value: cellOver(row, metric, engines).value,
      role: roleOf(row, position),
    })),
    t('charts.donut.other'),
  );

  const byCompetitor: CategorySeries[] = [
    {
      id: COLUMN.value,
      name: averaged ? t('charts.platformAverage') : labelOf(engines[0] ?? 'chatgpt_web'),
      role: { kind: 'brand' },
      values: ordered.map((row) => cellOver(row, metric, engines).value),
    },
  ];
  const byPlatform: CategorySeries[] = ordered.slice(0, 6).map((row, position) => ({
    id: row.id,
    name: row.name,
    role: roleOf(row, position),
    values: engines.map((engine) => cellOver(row, metric, [engine]).value),
  }));
  const weekly = useMemo(
    () => (trend.data === undefined ? null : weeklyValues(trend.data.data, engines)),
    [trend.data, engines],
  );
  const trendSeries: CategorySeries[] = ordered.slice(0, 6).map((row, position) => ({
    id: row.id,
    name: row.name,
    role: roleOf(row, position),
    values: weekly?.byEntity.get(row.id) ?? [],
  }));

  const columns: PlainColumn<EntityRow>[] = [
    { id: COLUMN.name, header: t('columns.competitor'), cell: (row) => <EntityName row={row} /> },
    {
      id: COLUMN.value,
      header: averaged ? t('columns.platformAverage') : t(`metric.${kind}`),
      cell: (row) => <RateCell cell={cellOver(row, metric, engines)} />,
    },
    {
      id: COLUMN.change,
      header: t('columns.change'),
      cell: (row) => <ChangeCell cell={cellOver(row, metric, engines)} />,
    },
    ...engines.map((engine): PlainColumn<EntityRow> => ({
      id: engine,
      header: labelOf(engine),
      cell: (row) => <RateCell cell={cellOver(row, metric, [engine])} />,
    })),
  ];

  const empty = rows.length === 0;
  const noCompare = !scope.compare;
  const delta = (cell: ReturnType<typeof cellOver> | null): ReactElement | undefined =>
    cell === null || noCompare ? undefined : (
      <Delta
        size="md"
        tip={false}
        input={{ value: changeOf(cell), unit: 'points', polarity: 'higher_is_better', isDetectable: null }}
      />
    );

  return (
    <TrackedSetGate>
      <MetricStrip
        size="md"
        label={t(`strip.${kind}`)}
        status={
          reads.competitors.status === 'refetching'
            ? 'refetching'
            : reads.competitors.data === undefined
              ? 'loading'
              : 'ready'
        }
        groups={stripOf([
          rateItem(ID.own, t(`strip.your.${kind}`), ownCell?.value ?? null, delta(ownCell), t(`strip.context.${kind}`)),
          valueItem(
            ID.rank,
            t('strip.rank'),
            standing.rank === null ? null : t('strip.rankValue', { rank: standing.rank }),
            standing.rank === null ? null : t('strip.rankOf', { total: standing.of }),
          ),
          {
            ...rateItem(ID.leader, t('strip.topCompetitor'), leaderCell?.value ?? null, delta(leaderCell)),
            context: leader?.name ?? null,
          },
          gapItem(ID.gap, t('strip.gap'), gap, gap === null ? null : gap >= 0 ? t('strip.lead') : t('strip.trail')),
          countItem(
            ID.ahead,
            t('strip.aheadOfYou'),
            ownCell?.value == null ? null : standing.ahead,
            t('strip.ofCompetitors', { count: leaders.length }),
          ),
        ])}
      />
      <div
        className={
          donutKind === null ? 'grid grid-cols-1 gap-3 @4xl:grid-cols-2' : 'grid grid-cols-1 gap-3 @4xl:grid-cols-3'
        }
      >
        {donutKind === null ? null : (
          <DonutCard
            title={t(`charts.donut.${donutKind}.title`)}
            summary={t(`charts.donut.${donutKind}.summary`)}
            info={info(donutKind === 'sov' ? 'sovSplit' : 'citationsSplit')}
            slices={slices}
            centerValue={formatPercent(ownCell?.value ?? null)}
            centerLabel={t('charts.donut.you')}
            formatValue={(value) => formatPercent(value)}
            reads={[reads.competitors]}
            isEmpty={empty || slices.length === 0}
          />
        )}
        <ChartCard
          title={t(`charts.${kind}.byCompetitor`)}
          summary={t(`charts.${kind}.byCompetitorSummary`)}
          kind="bar"
          categories={ordered.map((row) => row.name)}
          categoryHeader={t('columns.competitor')}
          series={byCompetitor}
          formatValue={(value) => formatPercent(value)}
          reads={[reads.competitors]}
          isEmpty={empty}
          fileName={fileOf(kind, 'by-competitor')}
          info={info(BY_BRAND[kind])}
        />
        <ChartCard
          title={t(`charts.${kind}.byPlatform`)}
          summary={t(`charts.${kind}.byPlatformSummary`)}
          kind="bar"
          categories={engines.map((engine) => labelOf(engine))}
          categoryHeader={t('filters.engine')}
          series={byPlatform}
          formatValue={(value) => formatPercent(value)}
          reads={[reads.competitors]}
          isEmpty={empty}
          fileName={fileOf(kind, 'by-platform')}
          info={info(BY_PLATFORM[kind])}
        />
      </div>
      {trendKind !== null ? (
        <ChartCard
          title={t(`charts.${trendKind}.trend`)}
          summary={t(`charts.${trendKind}.trendSummary`)}
          kind="line"
          categories={weekly?.weeks ?? []}
          categoryHeader={t('charts.week')}
          series={trendSeries}
          formatValue={(value) => formatPercent(value)}
          height={280}
          reads={[reads.competitors, trend]}
          isEmpty={empty || (weekly?.weeks.length ?? 0) === 0}
          fileName={fileOf(kind, 'trend')}
          info={info(trendKind === 'sov' ? 'sovTrend' : 'mentionsTrend')}
        />
      ) : null}
      <PlainTable
        caption={t(`charts.${kind}.table`)}
        columns={columns}
        rows={ordered}
        rowKey={(row) => row.id}
        status={
          reads.competitors.status === 'error' ? 'error' : reads.competitors.data === undefined ? 'loading' : 'ready'
        }
        errorState={null}
        emptyText={t('states.noDataReason')}
        scrollHint={t('columns.scrollHint')}
      />
    </TrackedSetGate>
  );
}
