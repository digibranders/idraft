'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement, type ReactNode } from 'react';

import { useCompetitorReads, useTrackedSet } from './data/use-competitor-reads';
import { entityTotals, previousEntityTotals } from './model/entity-totals';
import type { EngineEntityTotals, EntityFigures, TrackedEntity, TrackedSet } from './model/types';
import { useFrameState, type DataSituation, type FrameState } from './parts/frame-state';
import { percentOf } from './parts/percent';
import { TrackedFootnote } from './parts/tracked-footnote';
import { useCardDrill, useCardExport } from '../engines/use-card-seams';
import { askedEngines } from '../../data/overview-queries';
import { useOverview } from '../../overview-context';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import { EntitySwatch } from '@/components/app/entity/entity-swatch';
import { DeltaCell } from '@/components/app/metric/delta-cell';
import { MetricInfo } from '@/components/app/metric/metric-info';
import { SampleCount } from '@/components/app/metric/sample-count';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { TextLink } from '@/components/ui/text-link';
import type { CardProps } from '@/features/layouts';
import { METHODOLOGY_HREF } from '@/lib/citations/methodology';
import { deltaInput, rateChange, type RateChange } from '@/lib/compare/change-model';
import { EMPTY_VALUE, formatDateRange, formatList, formatPointsDelta } from '@/lib/format';
import { engineLabel } from '@/lib/layouts';
import type { CsvCell } from '@/lib/csv/csv-write';
import type { RateReading } from '@/lib/rates/strip-model';
import { MIN_OBSERVATIONS, type RateState } from '@/lib/stats';

/** The `metric` option (catalog: mention rate by default, or share of voice). */
type Metric = 'mention' | 'share_of_voice';
const metricOf = (option: string | undefined): Metric => (option === 'share_of_voice' ? option : 'mention');

/** The `rows` option: the brands drawn, you included (catalog 5 or 10, default 5). */
const ROW_OPTIONS = [5, 10] as const;
const DEFAULT_ROWS = 5;
const rowsOf = (option: string | undefined): number =>
  ROW_OPTIONS.find((candidate) => candidate === Number(option)) ?? DEFAULT_ROWS;

/**
 * What one engine says of one brand:
 * - `no_answers`: the engine has no valid answer in the window, so nothing is said of any brand.
 * - `none`: the engine was read and has no figure for the brand.
 * - `thin`: fewer than 4 answers behind the figure (`n` of them): no rate.
 * - `average`: the plain mean of every engine that has answers, each counted once.
 */
type Cell =
  | { kind: 'no_answers' }
  | { kind: 'none' }
  | { kind: 'thin'; n: number }
  | { kind: 'value'; value: number; k: number | null; n: number; change: RateChange | null }
  | { kind: 'average'; value: number; engines: number };

/** One engine of the scope: its totals now and before, `null` when it has no valid answer in that window. */
interface EngineColumn {
  code: string;
  label: string;
  totals: EngineEntityTotals | null;
  before: EngineEntityTotals | null;
}

/** One brand with what each engine column and the average say of it. */
interface BrandRow {
  brand: TrackedEntity;
  cells: Cell[];
  average: Cell;
  /** The figure the order of the rows follows, as printed: the Average where it is shown, else the one engine's value; `null` when it has none. */
  lead: number | null;
}

interface Reading {
  state: RateState;
  value: number | null;
  /** The answers that count; `null` for share of voice, which has no count of successes. */
  k: number | null;
  /** The valid answers, or for share of voice the answers that name a tracked brand. */
  n: number;
}

function readingOf(figures: EntityFigures, metric: Metric): Reading {
  if (metric === 'mention') {
    const { state, value, k, n } = figures.mention;
    return { state, value, k, n };
  }
  const { state, value, answers } = figures.share;
  return { state, value, k: null, n: answers };
}

const rateOf = (reading: Reading): RateReading => ({
  state: reading.state,
  value: reading.value,
  answers: reading.n,
  successes: reading.k,
  reason: null,
});

function cellOf(column: EngineColumn, brand: TrackedEntity, metric: Metric): Cell {
  if (column.totals === null) return { kind: 'no_answers' };
  const figures = column.totals.entities.find((candidate) => candidate.entity.entityId === brand.entityId);
  if (figures === undefined) return { kind: 'none' };
  const now = readingOf(figures, metric);
  if (now.state === 'insufficient') return { kind: 'thin', n: now.n };
  if (now.state !== 'ok' || now.value === null) return { kind: 'none' };
  const earlier = column.before?.entities.find((candidate) => candidate.entity.entityId === brand.entityId);
  const change =
    earlier === undefined
      ? null
      : rateChange(
          rateOf(now),
          rateOf(readingOf(earlier, metric)),
          metric === 'mention' ? 'mentioned' : 'share_of_voice',
        );
  return { kind: 'value', value: now.value, k: now.k, n: now.n, change };
}

/** The mean of the engines that have answers, each once, or nothing: an engine that has none for the brand breaks the mean. */
function averageOf(cells: readonly Cell[]): Cell {
  const values = cells.flatMap((cell) => (cell.kind === 'value' ? [cell.value] : []));
  if (cells.length < 2 || values.length !== cells.length) return { kind: 'none' };
  return {
    kind: 'average',
    value: values.reduce((total, value) => total + value, 0) / values.length,
    engines: cells.length,
  };
}

function brandRowOf(
  brand: TrackedEntity,
  columns: readonly EngineColumn[],
  metric: Metric,
  showAverage: boolean,
): BrandRow {
  const cells = columns.map((column) => cellOf(column, brand, metric));
  const average = averageOf(cells.filter((_, index) => columns[index]?.totals !== null));
  // The order follows what is printed: the Average column, or with one engine answering, that engine's value
  const headline = showAverage ? average : cells.find((cell) => cell.kind === 'value');
  return {
    brand,
    cells,
    average,
    lead: headline?.kind === 'average' || headline?.kind === 'value' ? headline.value : null,
  };
}

/** You first, then the competitors by the figure shown, highest first; a brand with none is last, equal figures keep the tracked order. */
function ranked(brands: readonly BrandRow[]): BrandRow[] {
  const own = brands.filter((row) => row.brand.role === 'own');
  const others = brands.filter((row) => row.brand.role !== 'own').sort((a, b) => (b.lead ?? -1) - (a.lead ?? -1));
  return [...own, ...others];
}

function situationOf(columns: readonly EngineColumn[], set: TrackedSet | null, ready: boolean): DataSituation {
  if (!ready || set === null) return { kind: 'ready' };
  if (columns.every((column) => column.totals === null)) return { kind: 'no_answers' };
  if (!set.entities.some((entity) => entity.role === 'competitor')) return { kind: 'no_competitor' };
  return { kind: 'ready' };
}

/** A row of the Table view and of the export: one brand on one engine, or on the average. */
interface LongRow {
  key: string;
  brand: TrackedEntity;
  engine: string;
  cell: Cell;
}

export default function CompetitorTableCard({ item, options }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.competitors.table');
  const belowTenth = useTranslations('aiOverview.competitors.common')('belowTenth');
  const percent = (value: number): string => percentOf(value, belowTenth);
  const { scope, enabledEngines } = useOverview();
  const drill = useCardDrill();
  const metric = metricOf(options.metric);
  const reads = useCompetitorReads('totals');
  const current = reads.current.data;
  const set = useTrackedSet(current);
  const asked = useMemo(() => askedEngines({ scope, enabledEngines }), [scope, enabledEngines]);
  const previousSummary = reads.paired ? (reads.previous?.data ?? null) : null;

  const columns: EngineColumn[] = asked.map((code) => {
    const now = current !== undefined && set !== null ? entityTotals(current, code, set) : null;
    return {
      code,
      label: engineLabel(code),
      totals: now?.status === 'read' && now.validAnswers > 0 ? now : null,
      before: set === null ? null : previousEntityTotals(previousSummary, code, set),
    };
  });
  const answered = columns.filter((column) => column.totals !== null);
  const showAverage = answered.length >= 2;
  // Every engine that has answers has no earlier figure: the previous window holds nothing to compare with
  const previousEmpty =
    reads.previous?.status === 'ready' && answered.length > 0 && answered.every((c) => c.before === null);
  const base = useFrameState({
    subject: t('subject'),
    read: reads.current,
    previous: reads.previous,
    previousEmpty,
    engine: null,
    situation: situationOf(columns, set, current !== undefined),
  });
  // No engine is asked: the read does not run, which is a fact of the scope and not a wait
  const frame: FrameState =
    asked.length === 0
      ? { status: 'empty', empty: { title: t('noEnginesTitle'), reason: t('noEnginesReason') } }
      : base;

  const all = ranked((set?.entities ?? []).map((brand) => brandRowOf(brand, columns, metric, showAverage)));
  const shown = all.slice(0, rowsOf(options.rows));
  const hidden = all.length - shown.length;
  const averageLabel = t('averageHeader', { count: answered.length });

  const figure = (cell: Cell): ReactNode => {
    switch (cell.kind) {
      case 'no_answers':
        return <span className="type-table text-foreground-tertiary">{t('noAnswers')}</span>;
      case 'none':
        return <span className="num type-table text-foreground-tertiary">{EMPTY_VALUE}</span>;
      case 'thin':
        return (
          <div className="flex flex-col gap-0.5">
            <span className="type-table text-foreground-secondary">{t('tooFew')}</span>
            <span className="num type-meta text-foreground-tertiary">
              {t('tooFewLine', { count: cell.n, min: MIN_OBSERVATIONS })}
            </span>
          </div>
        );
      case 'average':
        return (
          <div className="flex flex-col gap-0.5">
            <span className="num type-table-strong text-foreground">{percent(cell.value)}</span>
            <span className="num type-meta text-foreground-tertiary">{t('averageLine', { count: cell.engines })}</span>
          </div>
        );
      case 'value':
        return (
          <div className="flex flex-col gap-0.5">
            <div className="flex items-baseline gap-2">
              <span className="num type-table-strong text-foreground">{percent(cell.value)}</span>
              {cell.change === null ? null : <DeltaCell input={deltaInput(cell.change)} test="interim" />}
            </div>
            <span className="type-meta text-foreground-tertiary">
              {metric === 'mention'
                ? t.rich('namedIn', { count: () => <SampleCount k={cell.k} n={cell.n} noun="answers" /> })
                : t.rich('ofNaming', { count: () => <SampleCount k={null} n={cell.n} noun="answers" form="n-only" /> })}
            </span>
          </div>
        );
    }
  };

  const brandCell = (brand: TrackedEntity): ReactNode => {
    const isOwn = brand.role === 'own';
    // Only a competitor has a page; you are plain text
    const href = isOwn ? null : drill('competitors');
    return (
      <span className="flex min-w-0 items-center gap-2">
        <EntitySwatch colorIndex={brand.colorIndex} own={isOwn} />
        {href === null ? (
          <span>{isOwn ? t('ownName', { name: brand.name }) : brand.name}</span>
        ) : (
          <TextLink render={<Link href={href} />}>{brand.name}</TextLink>
        )}
      </span>
    );
  };

  const tableColumns: PlainColumn<BrandRow>[] = [
    { id: 'brand', header: t('brandHeader'), cell: (row) => brandCell(row.brand) },
    ...columns.map((column, index): PlainColumn<BrandRow> => ({
      id: column.code,
      header: column.label,
      wrap: true,
      cell: (row) => figure(row.cells[index] ?? { kind: 'none' }),
    })),
    ...(showAverage
      ? [{ id: 'average', header: averageLabel, wrap: true, cell: (row: BrandRow) => figure(row.average) }]
      : []),
  ];

  // The Table view and the export: every brand on every engine, one row each, with the words and the counts
  const longRows: LongRow[] = all.flatMap((row) => [
    ...columns.map((column, index): LongRow => ({
      key: `${row.brand.entityId}:${column.code}`,
      brand: row.brand,
      engine: column.label,
      cell: row.cells[index] ?? { kind: 'none' },
    })),
    ...(showAverage
      ? [{ key: `${row.brand.entityId}:average`, brand: row.brand, engine: averageLabel, cell: row.average }]
      : []),
  ]);
  const words = (
    cell: Cell,
  ): { shown: string; value: string | null; count: string | null; change: string | null; status: string } => {
    switch (cell.kind) {
      case 'value':
        return {
          shown: percent(cell.value),
          value: percent(cell.value),
          count: metric === 'mention' ? t('named', { k: cell.k ?? 0, n: cell.n }) : t('ofNamingPlain', { n: cell.n }),
          change: cell.change === null ? null : formatPointsDelta(cell.change.points),
          status: t('statusRead'),
        };
      case 'average':
        return {
          shown: percent(cell.value),
          value: percent(cell.value),
          count: t('averageLine', { count: cell.engines }),
          change: null,
          status: t('statusRead'),
        };
      case 'thin':
        return {
          shown: t('tooFew'),
          value: null,
          count: t('tooFewLine', { count: cell.n, min: MIN_OBSERVATIONS }),
          change: null,
          status: t('statusTooFew'),
        };
      case 'no_answers':
        return { shown: t('noAnswers'), value: null, count: null, change: null, status: t('statusNoAnswers') };
      case 'none':
        return { shown: EMPTY_VALUE, value: null, count: null, change: null, status: t('statusNone') };
    }
  };
  const header = [
    t('brandHeader'),
    t('engineHeader'),
    t('valueHeader', { metric }),
    t('countHeader'),
    t('changeHeader'),
    t('statusHeader'),
  ];
  const csvRows: CsvCell[][] = longRows.map((row) => {
    const text = words(row.cell);
    return [row.brand.name, row.engine, text.value, text.count, text.change, text.status];
  });
  const csv = { header, rows: csvRows };
  useCardExport(item.id, () =>
    columns.length === 0 || frame.status === 'loading' || frame.status === 'error'
      ? null
      : { id: item.id, header, rows: csvRows },
  );

  const longColumns: PlainColumn<LongRow>[] = [
    { id: 'brand', header: header[0] ?? '', cell: (row) => row.brand.name },
    { id: 'engine', header: header[1] ?? '', cell: (row) => row.engine },
    { id: 'value', header: header[2] ?? '', cell: (row) => words(row.cell).shown },
    { id: 'count', header: header[3] ?? '', cell: (row) => words(row.cell).count ?? EMPTY_VALUE },
    { id: 'change', header: header[4] ?? '', cell: (row) => words(row.cell).change ?? EMPTY_VALUE },
  ];

  const leaders = shown.flatMap((row) =>
    row.lead === null ? [] : [t('summaryItem', { name: row.brand.name, value: percent(row.lead) })],
  );
  const engineNames = formatList(columns.map((column) => column.label));
  const range = current === undefined ? null : formatDateRange(current.window.from, current.window.to);
  return (
    <ChartFrame
      kind="html"
      variant="panel"
      height={280}
      title={t('title', { metric })}
      meta={
        range === null || set === null
          ? null
          : t('meta', { window: range, engines: asked.length, branded: scope.branded })
      }
      summary={
        leaders.length === 0
          ? t('summaryNone', { metric, engines: engineNames })
          : t('summary', {
              metric,
              count: all.length,
              engines: engineNames,
              many: showAverage ? 'yes' : 'no',
              list: formatList(leaders.slice(0, 3)),
            })
      }
      footnote={
        <>
          {set === null ? null : <TrackedFootnote set={set} />}
          <p>{metric === 'mention' ? t('noteMention') : t('noteShare')}</p>
          {showAverage ? <p>{t('noteAverage')}</p> : null}
          {columns.length === 0 ? null : <p>{showAverage ? t('noteOrderAverage') : t('noteOrderOne')}</p>}
          {hidden > 0 ? <p>{t('moreRows', { count: hidden })}</p> : null}
        </>
      }
      body={
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 type-meta">
            <MetricInfo
              name={t('infoName', { metric })}
              definition={t('infoDefinition', { metric })}
              formula={t('infoFormula', { metric })}
              methodologyHref={METHODOLOGY_HREF}
            />
          </div>
          <PlainTable
            caption={t('caption', { metric })}
            columns={tableColumns}
            rows={shown}
            rowKey={(row) => row.brand.entityId}
            status="ready"
            errorState={null}
            emptyText={t('noAnswers')}
          />
        </div>
      }
      table={
        <PlainTable
          caption={t('tableCaption', { metric })}
          columns={longColumns}
          rows={longRows}
          rowKey={(row) => row.key}
          status="ready"
          errorState={null}
          emptyText={t('noAnswers')}
        />
      }
      menu={{ fileName: t('fileName', { metric }), csv }}
      {...frame}
    />
  );
}
