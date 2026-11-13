'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { SHAPE_OPTIONS, useTrackedSet } from './data/use-competitor-reads';
import { coMentionMatrix } from './model/co-mentions';
import type { CoMentionCell, CoMentionMatrix, TrackedEntity, TrackedSet } from './model/types';
import { useCardEngine } from './parts/card-engine';
import { useFrameState, type DataSituation } from './parts/frame-state';
import { percentOf } from './parts/percent';
import { TrackedFootnote } from './parts/tracked-footnote';
import { useCardDensity } from '../engines/use-card-density';
import { useCardDrill, useCardExport, type CardDrill } from '../engines/use-card-seams';
import { useOverview, useOverviewSummary } from '../../overview-context';
import type { Say } from '../../numbers/number-model';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import { heatmapCsv } from '@/components/app/chart/heat-bins';
import { HeatmapGrid, type HeatCell, type HeatRow } from '@/components/app/chart/heatmap-grid';
import { EngineLogo } from '@/components/app/engine/engine-logo';
import { EntitySwatch } from '@/components/app/entity/entity-swatch';
import { MetricInfo } from '@/components/app/metric/metric-info';
import type { CardProps } from '@/features/layouts';
import { METHODOLOGY_HREF } from '@/lib/citations/methodology';
import { EMPTY_VALUE, formatDateRange, formatInteger, formatList } from '@/lib/format';
import { MIN_OBSERVATIONS } from '@/lib/stats';

/** The first of these that holds, so nothing is drawn from too little. Fewer than 4 answers still draws, as insufficient cells. */
function situationOf(matrix: CoMentionMatrix | null, set: TrackedSet | null, unread: boolean): DataSituation {
  if (unread || matrix?.answers === 0) return { kind: 'no_answers' };
  if (set !== null && !set.entities.some((entity) => entity.role === 'competitor')) return { kind: 'no_competitor' };
  return { kind: 'ready' };
}

/** The cell as the grid takes it; its tip carries the counts, and is the cell's accessible name and its Table view text. */
function heatCellOf(
  cell: CoMentionCell,
  entities: readonly TrackedEntity[],
  t: Say,
  percent: (value: number) => string,
): HeatCell {
  const row = entities.find((entity) => entity.entityId === cell.rowId);
  const column = entities.find((entity) => entity.entityId === cell.columnId);
  const rowName = row?.name ?? '';
  const read = cell.state === 'ok' && cell.value !== null;
  const value = read && cell.value !== null ? percent(cell.value) : '';
  const base = { value: cell.value, answers: cell.n, state: cell.state, text: value };
  if (cell.rowId === cell.columnId) {
    const tip = read
      ? t('diagonalTip', { value, name: rowName, k: formatInteger(cell.k), n: cell.n })
      : cell.state === 'insufficient'
        ? t('diagonalThin', { name: rowName, count: cell.n, min: MIN_OBSERVATIONS })
        : t('diagonalNone', { name: rowName });
    return { ...base, tip };
  }
  // You are named last: "HubSpot and you"
  const [first, second] = row?.role === 'own' ? [column, row] : [row, column];
  const nameOf = (entity: TrackedEntity | undefined): string =>
    entity?.role === 'own' ? t('you') : (entity?.name ?? '');
  const tip = read
    ? t('pairTip', { value, first: nameOf(first), second: nameOf(second), k: formatInteger(cell.k), n: cell.n })
    : t('pairThin', { first: nameOf(first), second: nameOf(second), count: cell.n, min: MIN_OBSERVATIONS });
  return { ...base, tip };
}

function rowsOf(
  matrix: CoMentionMatrix,
  engineCode: string,
  drill: CardDrill,
  t: Say,
  percent: (value: number) => string,
): HeatRow[] {
  return matrix.entities.map((entity, index) => {
    const isOwn = entity.role === 'own';
    const href =
      (isOwn
        ? drill('prompts', { engine: engineCode, metric: 'mention' })
        : drill('competitors', { engine: engineCode })) ?? undefined;
    return {
      id: entity.entityId,
      name: isOwn ? t('ownName', { name: entity.name }) : entity.name,
      label: (
        <span className="flex min-w-0 items-center gap-2">
          <EntitySwatch colorIndex={entity.colorIndex} own={isOwn} />
          <span className="truncate">{entity.name}</span>
        </span>
      ),
      cells: (matrix.cells[index] ?? []).map((cell) => heatCellOf(cell, matrix.entities, t, percent)),
      href,
    };
  });
}

/**
 * CH-38: how often two tracked brands are named in the same answer of one engine, as a full symmetric matrix of
 * the top 8 brands, you first. Every cell is of the same valid answers (one denominator, printed), a pair that was
 * never seen is a real 0, and a cell the answers cannot support says so instead of showing a rate.
 */
export default function CoMentionsCard({ item, options }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.competitors.coMentions');
  const belowTenth = useTranslations('aiOverview.competitors.common')('belowTenth');
  const percent = (value: number): string => percentOf(value, belowTenth);
  const { scope } = useOverview();
  const engine = useCardEngine(options);
  const density = useCardDensity();
  const drill = useCardDrill();
  // One read: this card draws no comparison, so the previous window is not asked
  const read = useOverviewSummary(SHAPE_OPTIONS.pairs);
  const current = read.data;
  const set = useTrackedSet(current);
  const result = current !== undefined && set !== null ? coMentionMatrix(current, engine.code, set) : null;
  const matrix = result?.status === 'read' ? result : null;
  const frame = useFrameState({
    subject: t('subject'),
    read,
    previous: null,
    previousEmpty: false,
    engine,
    situation: situationOf(matrix, set, result?.status === 'unread'),
  });

  const rows = matrix === null ? [] : rowsOf(matrix, engine.code, drill, t as Say, percent);
  const columns = (matrix?.entities ?? []).map((entity) => ({
    id: entity.entityId,
    label: <span className="block truncate">{entity.name}</span>,
  }));
  const grid = (form: 'grid' | 'table'): ReactElement => (
    <HeatmapGrid
      caption={t('caption', { engine: engine.label })}
      rowHeader={t('rowHeader')}
      columns={columns}
      rows={rows}
      scale="sequential"
      density={density}
      form={form}
    />
  );
  const csv =
    matrix === null
      ? undefined
      : heatmapCsv({
          rowHeader: t('rowHeader'),
          noneText: EMPTY_VALUE,
          columns: matrix.entities.map((entity) => entity.name),
          rows: rows.map((row, index) => ({
            label: matrix.entities[index]?.name ?? '',
            cells: row.cells.map(({ state, tip }) => ({ state, tip })),
          })),
        });
  useCardExport(item.id, () =>
    csv === undefined || frame.status === 'loading' || frame.status === 'error'
      ? null
      : { id: item.id, header: csv.header, rows: csv.rows },
  );

  // The brands named with you most often, for people who cannot see the grid
  const partners = (matrix?.cells[0] ?? [])
    .flatMap((cell, index) => {
      const entity = matrix?.entities[index];
      return entity === undefined || cell.rowId === cell.columnId || cell.state !== 'ok' || cell.value === null
        ? []
        : [{ name: entity.name, value: cell.value }];
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, 3);
  const range = current === undefined ? null : formatDateRange(current.window.from, current.window.to);
  return (
    <ChartFrame
      kind="html"
      variant="panel"
      height={280}
      title={t('title', { engine: engine.label })}
      meta={
        range === null || matrix === null
          ? null
          : t('meta', { window: range, count: matrix.answers, branded: scope.branded })
      }
      summary={
        partners.length === 0
          ? t('summaryNone', { engine: engine.label })
          : t('summary', {
              engine: engine.label,
              count: matrix?.answers ?? 0,
              list: formatList(
                partners.map((partner) => t('summaryItem', { name: partner.name, value: percent(partner.value) })),
              ),
            })
      }
      footnote={
        <>
          {set === null ? null : <TrackedFootnote set={set} />}
          {matrix === null ? null : <p>{t('denominator', { count: matrix.answers, engine: engine.label })}</p>}
          {matrix !== null && matrix.omitted > 0 ? <p>{t('omitted', { count: matrix.omitted })}</p> : null}
        </>
      }
      body={
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 type-meta">
            <EngineLogo engine={engine.code} name={engine.label} />
            <span>{t('shownAs')}</span>
            <MetricInfo
              name={t('infoName')}
              definition={t('infoDefinition')}
              formula={t('infoFormula')}
              denominatorText={t('infoSample', { count: matrix?.answers ?? 0 })}
              methodologyHref={METHODOLOGY_HREF}
            />
          </div>
          {grid('grid')}
        </div>
      }
      table={grid('table')}
      menu={{ fileName: t('fileName', { engine: engine.code }), ...(csv === undefined ? {} : { csv }) }}
      {...frame}
    />
  );
}
