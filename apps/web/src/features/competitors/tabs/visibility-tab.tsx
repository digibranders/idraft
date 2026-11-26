'use client';

import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { useCompetitors } from '../competitors-context';
import {
  cellOver,
  paletteRole,
  rankedCompetitors,
  roleOf,
  strongestEngine,
  type EntityRow,
} from '../model/competitor-model';
import { ChartCard } from './chart-card';
import { DonutCard } from './donut-card';
import { toSlices } from './donut-model';
import { EntityName } from './entity-name';
import { RateCell } from './metric-cells';
import { COLUMN, countItem, FILE, ID, rateItem, stripOf, textItem } from './strip-items';
import { TrackedSetGate } from './tracked-set-gate';
import { useTabModel } from './use-tab-model';
import { MetricStrip } from '@/components/app/metric/metric-strip';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { formatInteger, formatPercent } from '@/lib/format';

/**
 * AI visibility: how often each entity is present across the platforms (a matrix of mention rates), and on one
 * platform the prompts a competitor is named in and we are not. The platform is the first in scope; narrowing the
 * Platform filter to another changes it.
 */
export function VisibilityTab(): ReactElement {
  const t = useTranslations('competitors');
  const { reads, scope, labelOf } = useCompetitors();
  const { rows, engines } = useTabModel();
  const eng = scope.eng;

  const leaders = useMemo(() => rankedCompetitors(rows, 'mention_rate', engines), [rows, engines]);
  const ordered = useMemo(() => [...rows.filter((row) => row.role === 'own'), ...leaders], [rows, leaders]);
  const own = rows.find((row) => row.role === 'own');
  const ownAverage = own === undefined ? null : cellOver(own, 'mention_rate', engines).value;
  const strongest = own === undefined ? null : strongestEngine(own, 'mention_rate', engines);

  const lostRows = useMemo(
    () =>
      (reads.lost.data?.data ?? [])
        .filter((row) => row.entity.role === 'competitor')
        .map((row) => ({ row, engine: row.by_engine.find((entry) => entry.engine_code === eng) }))
        .flatMap(({ row, engine }) => (engine === undefined ? [] : [{ name: row.entity.canonical_name, engine }])),
    [reads.lost.data, eng],
  );
  const lostSorted = useMemo(
    () => [...lostRows].sort((a, b) => (b.engine.lost_prompts_total ?? 0) - (a.engine.lost_prompts_total ?? 0)),
    [lostRows],
  );
  const topLost = lostSorted[0]?.engine.lost_prompts ?? [];
  const topLostItem = lostSorted[0];
  const totalLost =
    reads.lost.data === undefined
      ? null
      : lostSorted.reduce((sum, item) => sum + (item.engine.lost_prompts_total ?? 0), 0);

  const lostSlices = toSlices(
    lostSorted.map((item) => ({
      id: item.name,
      name: item.name,
      value: item.engine.lost_prompts_total ?? null,
      role: paletteRole(
        Math.max(
          0,
          ordered.findIndex((row) => row.name === item.name),
        ),
      ),
    })),
    t('charts.donut.other'),
  );
  const byPlatform = ordered.slice(0, 6).map((row, position) => ({
    id: row.id,
    name: row.name,
    role: roleOf(row, position),
    values: engines.map((engine) => cellOver(row, 'mention_rate', [engine]).value),
  }));

  const matrix: PlainColumn<EntityRow>[] = [
    { id: COLUMN.name, header: t('columns.competitor'), cell: (row) => <EntityName row={row} /> },
    ...engines.map((engine): PlainColumn<EntityRow> => ({
      id: engine,
      header: labelOf(engine),
      cell: (row) => <RateCell cell={cellOver(row, 'mention_rate', [engine])} />,
    })),
  ];
  const lostColumns: PlainColumn<(typeof lostSorted)[number]>[] = [
    {
      id: COLUMN.name,
      header: t('columns.competitor'),
      cell: (item) => <span className="type-body-strong">{item.name}</span>,
    },
    {
      id: COLUMN.lost,
      header: t('columns.promptsLost'),
      cell: (item) => (
        <span className="type-body tabular-nums">{formatInteger(item.engine.lost_prompts_total ?? null)}</span>
      ),
    },
    {
      id: COLUMN.of,
      header: t('columns.ofPrompts'),
      cell: (item) => (
        <span className="type-body tabular-nums">
          {formatInteger(item.engine.lost_prompts_with_min_answers ?? null)}
        </span>
      ),
    },
  ];

  const status =
    reads.competitors.status === 'error' ? 'error' : reads.competitors.data === undefined ? 'loading' : 'ready';
  const lostStatus = reads.lost.status === 'error' ? 'error' : reads.lost.data === undefined ? 'loading' : 'ready';

  return (
    <TrackedSetGate>
      <MetricStrip
        size="md"
        label={t('strip.visibility')}
        status={reads.competitors.data === undefined ? 'loading' : 'ready'}
        groups={stripOf([
          rateItem(ID.own, t('strip.your.visibility'), ownAverage, undefined, t('strip.context.visibility')),
          textItem(
            ID.strongest,
            t('strip.strongestPlatform'),
            strongest === null ? null : labelOf(strongest.engine),
            strongest === null ? null : t('strip.mentionRateOf', { rate: formatPercent(strongest.value) }),
          ),
          countItem(ID.lost, t('strip.promptsLost'), totalLost, eng === null ? null : labelOf(eng)),
          textItem(
            ID.mostLost,
            t('strip.mostLostTo'),
            topLostItem === undefined || (topLostItem.engine.lost_prompts_total ?? 0) === 0 ? null : topLostItem.name,
            topLostItem === undefined
              ? null
              : t('strip.promptsCount', { count: topLostItem.engine.lost_prompts_total ?? 0 }),
          ),
        ])}
      />
      <ChartCard
        title={t('charts.visibility.byPlatform')}
        summary={t('charts.visibility.byPlatformSummary')}
        kind="bar"
        categories={engines.map((engine) => labelOf(engine))}
        categoryHeader={t('filters.engine')}
        series={byPlatform}
        formatValue={(value) => formatPercent(value)}
        reads={[reads.competitors]}
        isEmpty={ordered.length === 0}
        fileName={FILE.mentionsByPlatform}
      />
      <PlainTable
        caption={t('charts.visibility.matrix')}
        columns={matrix}
        rows={ordered}
        rowKey={(row) => row.id}
        status={status}
        errorState={null}
        emptyText={t('states.noDataReason')}
        scrollHint={t('columns.scrollHint')}
      />
      <div className="grid grid-cols-1 gap-3 @4xl:grid-cols-2">
        <DonutCard
          title={t('charts.donut.lost.title')}
          summary={t('charts.donut.lost.summary')}
          slices={lostSlices}
          centerValue={formatInteger(totalLost)}
          centerLabel={t('charts.donut.promptsLost')}
          formatValue={(value) => formatInteger(value)}
          reads={[reads.lost]}
          isEmpty={lostSlices.length === 0}
          showShare
        />
        <PlainTable
          caption={t('charts.visibility.lostTable')}
          columns={lostColumns}
          rows={lostSorted}
          rowKey={(item) => item.name}
          status={lostStatus}
          errorState={null}
          emptyText={t('states.noDataReason')}
        />
      </div>
      {topLost.length === 0 ? null : (
        <section
          aria-label={t('charts.visibility.topLost', { name: lostSorted[0]?.name ?? '' })}
          className="flex flex-col gap-2"
        >
          <h2 className="type-section-title">{t('charts.visibility.topLost', { name: lostSorted[0]?.name ?? '' })}</h2>
          <PlainTable
            caption={t('charts.visibility.topLost', { name: lostSorted[0]?.name ?? '' })}
            columns={[
              {
                id: COLUMN.prompt,
                header: t('columns.prompt'),
                wrap: true,
                cell: (item) => <span className="type-body">{item.text}</span>,
              },
            ]}
            rows={topLost}
            rowKey={(item) => item.prompt_id}
            status="ready"
            errorState={null}
            emptyText={t('states.noDataReason')}
          />
        </section>
      )}
    </TrackedSetGate>
  );
}
