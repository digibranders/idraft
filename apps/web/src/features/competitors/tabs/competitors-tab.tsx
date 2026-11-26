'use client';

import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { useCompetitors } from '../competitors-context';
import {
  biggestMover,
  cellOver,
  changeOf,
  rankedCompetitors,
  roleOf,
  standingOf,
  weeklyValues,
  type EntityRow,
} from '../model/competitor-model';
import { ChartCard } from './chart-card';
import { DonutCard } from './donut-card';
import { toSlices } from './donut-model';
import { EntityName } from './entity-name';
import { ChangeCell, RateCell } from './metric-cells';
import { COLUMN, FILE, gapItem, gapOf, ID, rateItem, stripOf, valueItem } from './strip-items';
import { TrackedSetGate } from './tracked-set-gate';
import { useTabModel } from './use-tab-model';
import { Delta } from '@/components/app/metric/delta';
import { MetricStrip } from '@/components/app/metric/metric-strip';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import type { CategorySeries } from '@/lib/charts/category-chart';
import { formatInteger, formatPercent, formatPointsDelta } from '@/lib/format';

/**
 * The first tab: who the competitors are and how they stand. A strip of five figures, three charts (share of voice and
 * mention rate by competitor, share of voice over time) and one table with every metric side by side.
 */
export function CompetitorsTab(): ReactElement {
  const t = useTranslations('competitors');
  const { reads, scope } = useCompetitors();
  const { rows, engines } = useTabModel();

  const own = rows.find((row) => row.role === 'own');
  const leaders = useMemo(() => rankedCompetitors(rows, 'share_of_voice', engines), [rows, engines]);
  const ordered = useMemo(
    () => [...rows.filter((row) => row.role === 'own'), ...leaders, ...rows.filter((row) => row.role === 'watch')],
    [rows, leaders],
  );
  const leader = leaders[0];
  const ownSov = own === undefined ? null : cellOver(own, 'share_of_voice', engines);
  const leaderSov = leader === undefined ? null : cellOver(leader, 'share_of_voice', engines);
  const gap = gapOf(ownSov?.value, leaderSov?.value);
  const standing = standingOf(rows, 'share_of_voice', engines);
  const mover = biggestMover(rows, 'share_of_voice', engines);
  const delta = (cell: ReturnType<typeof cellOver> | null): ReactElement | undefined =>
    cell === null || !scope.compare ? undefined : (
      <Delta
        size="md"
        tip={false}
        input={{ value: changeOf(cell), unit: 'points', polarity: 'higher_is_better', isDetectable: null }}
      />
    );

  const sovSlices = toSlices(
    ordered.map((row, position) => ({
      id: row.id,
      name: row.name,
      value: cellOver(row, 'share_of_voice', engines).value,
      role: roleOf(row, position),
    })),
    t('charts.donut.other'),
  );
  const changeSeries: CategorySeries[] = [
    {
      id: 'change',
      name: t('charts.sov.changeTitle'),
      role: { kind: 'palette', index: 2 },
      values: ordered.map((row) => changeOf(cellOver(row, 'share_of_voice', engines))),
    },
  ];
  const mentionSeries: CategorySeries[] = [
    {
      id: 'mention',
      name: t('metric.mentions'),
      role: { kind: 'brand' },
      values: ordered.map((row) => cellOver(row, 'mention_rate', engines).value),
    },
  ];
  const weekly = useMemo(
    () => (reads.sovSeries.data === undefined ? null : weeklyValues(reads.sovSeries.data.data, engines)),
    [reads.sovSeries.data, engines],
  );
  const trendSeries: CategorySeries[] = ordered.slice(0, 6).map((row, position) => ({
    id: row.id,
    name: row.name,
    role: roleOf(row, position),
    values: weekly?.byEntity.get(row.id) ?? [],
  }));

  const columns: PlainColumn<EntityRow>[] = [
    { id: COLUMN.name, header: t('columns.competitor'), cell: (row) => <EntityName row={row} /> },
    { id: 'sov', header: t('metric.sov'), cell: (row) => <RateCell cell={cellOver(row, 'share_of_voice', engines)} /> },
    {
      id: 'sovChange',
      header: t('columns.sovChange'),
      cell: (row) => <ChangeCell cell={cellOver(row, 'share_of_voice', engines)} />,
    },
    {
      id: 'mentions',
      header: t('metric.mentions'),
      cell: (row) => <RateCell cell={cellOver(row, 'mention_rate', engines)} />,
    },
    {
      id: 'citations',
      header: t('metric.citations'),
      cell: (row) => <RateCell cell={cellOver(row, 'citation_share', engines)} />,
    },
    {
      id: 'platforms',
      header: t('columns.platforms'),
      cell: (row) => (
        <span className="type-body tabular-nums">
          {formatInteger(engines.filter((engine) => cellOver(row, 'share_of_voice', [engine]).value !== null).length)}
          {' / '}
          {formatInteger(engines.length)}
        </span>
      ),
    },
  ];

  const empty = rows.length === 0;

  const trendCard = (
    <ChartCard
      title={t('charts.sov.trend')}
      summary={t('charts.sov.trendSummary')}
      kind="line"
      height={240}
      categories={weekly?.weeks ?? []}
      categoryHeader={t('charts.week')}
      series={trendSeries}
      formatValue={(value) => formatPercent(value)}
      reads={[reads.competitors, reads.sovSeries]}
      isEmpty={empty || (weekly?.weeks.length ?? 0) === 0}
      fileName={FILE.sovTrend}
    />
  );

  return (
    <TrackedSetGate>
      <MetricStrip
        size="md"
        label={t('strip.competitors')}
        status={
          reads.competitors.status === 'refetching'
            ? 'refetching'
            : reads.competitors.data === undefined
              ? 'loading'
              : 'ready'
        }
        groups={stripOf([
          rateItem(ID.sov, t('strip.your.sov'), ownSov?.value ?? null, delta(ownSov), t('strip.context.sov')),
          valueItem(
            ID.rank,
            t('strip.rank'),
            standing.rank === null ? null : t('strip.rankValue', { rank: standing.rank }),
            standing.rank === null ? null : t('strip.rankOf', { total: standing.of }),
          ),
          {
            ...rateItem(ID.leader, t('strip.topCompetitor'), leaderSov?.value ?? null, delta(leaderSov)),
            context: leader?.name ?? null,
          },
          gapItem(ID.gap, t('strip.gap'), gap, gap === null ? null : gap >= 0 ? t('strip.lead') : t('strip.trail')),
          gapItem(ID.mover, t('strip.biggestMover'), mover?.change ?? null, mover?.name ?? null),
        ])}
      />
      <div className="grid grid-cols-1 gap-3 @4xl:grid-cols-3">
        <DonutCard
          title={t('charts.donut.sov.title')}
          summary={t('charts.donut.sov.summary')}
          slices={sovSlices}
          centerValue={formatPercent(ownSov?.value ?? null)}
          centerLabel={t('charts.donut.you')}
          formatValue={(value) => formatPercent(value)}
          reads={[reads.competitors]}
          isEmpty={empty || sovSlices.length === 0}
        />
        <ChartCard
          title={t('charts.mentions.byCompetitor')}
          summary={t('charts.mentions.byCompetitorSummary')}
          kind="bar"
          height={240}
          categories={ordered.map((row) => row.name)}
          categoryHeader={t('columns.competitor')}
          series={mentionSeries}
          formatValue={(value) => formatPercent(value)}
          reads={[reads.competitors]}
          isEmpty={empty}
          fileName={FILE.mentionsByCompetitor}
        />
        {scope.compare ? (
          <ChartCard
            title={t('charts.sov.changeTitle')}
            summary={t('charts.sov.changeSummary')}
            kind="bar"
            height={240}
            categories={ordered.map((row) => row.name)}
            categoryHeader={t('columns.competitor')}
            series={changeSeries}
            formatValue={(value) => formatPointsDelta(value)}
            reads={[reads.competitors]}
            isEmpty={empty || changeSeries.every((entry) => entry.values.every((value) => value === null))}
            fileName={FILE.sovChange}
          />
        ) : (
          trendCard
        )}
      </div>
      {scope.compare ? trendCard : null}
      <PlainTable
        caption={t('columns.overviewCaption')}
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
