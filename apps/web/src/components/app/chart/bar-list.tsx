'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';

import { SmallSampleMarker } from './small-sample-marker';
import { Delta, type DeltaTest } from '@/components/app/metric/delta';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { LinkButton } from '@/components/ui/link-button';
import { Tooltip } from '@/components/ui/tooltip';
import { safeText, type CsvCell, type CsvTable } from '@/lib/csv/csv-write';
import type { MetricDeltaInput } from '@/lib/format';
import type { Density } from '@/lib/tables/table-state';
import { cn } from '@/lib/utils';

/** What a row shows: a value with its words, too few answers for a rate (R2), or nothing known (R6). */
export type BarValue =
  | { kind: 'value'; value: number; valueText: string; contextText: string | null }
  | { kind: 'thin'; answers: number }
  | { kind: 'none'; text?: string | undefined };

/** Distribution mode colours: each has a bg-* utility (`seq-*` is the sequential heat scale, CH-18). */
export type BarScaleColor =
  | `rank-band-${1 | 2 | 3 | 4 | 5}`
  | 'rank-band-none'
  | `seq-${1 | 2 | 3 | 4 | 5 | 6 | 7}`
  | 'chart-other'
  | 'insufficient';

interface BarListRowBase {
  id: string;
  /** Domain, entity, query or category: the visible label and the first words of `accessibleText`. */
  label: string;
  value: BarValue;
  /** "HubSpot: 33% share of voice, 466 of 1,412 answers". Starts with `label`. The row's only accessible content. */
  accessibleText: string;
  /** The hover and focus tooltip's second line (from `rateTipText`); left out: the tooltip shows the label only. */
  tip?: string | undefined;
  /** An engine logo or other mark before the label; decorative, so it is hidden from assistive technology. */
  icon?: ReactNode;
  /** A Badge (role Own, Competitor, Third party). Text, so meaning is never colour only; also in `accessibleText`. */
  badge?: ReactNode;
  /**
   * Change since the previous window, drawn by `Delta` (coloured only when detectable). `text` is for the table and CSV.
   * Without a `changeHeader` on the list the row still draws its `Delta`, but the table and CSV have no change column.
   */
  delta?: { input: MetricDeltaInput; test: DeltaTest; text: string } | undefined;
  /** Opens the entity, domain or filtered list. */
  href?: Route | undefined;
  /** The link replaces the history entry instead of adding one: a link that moves a drawer that is already open. */
  replace?: boolean | undefined;
}

export interface ComparisonRow extends BarListRowBase {
  /** Own brand or owned domain: `chart-1` bar and `type-body-strong` label; every other row `chart-bar-neutral`. */
  own: boolean;
}

export interface DistributionRow extends BarListRowBase {
  scale: BarScaleColor;
}

interface BarListCommon {
  /** Names the list and the table: "Share of voice on ChatGPT". */
  caption: string;
  /** Table and CSV headers, from the feature's messages. */
  labelHeader: string;
  valueHeader: string;
  contextHeader: string;
  /** Header of the change column of the table and CSV; the column exists when this is given and a row has a `delta`. */
  changeHeader?: string | undefined;
  /** The value at full width; default the largest `value` of the rows (a shared scale from 0). */
  max?: number | undefined;
  /** At most this many rows inline (default and ceiling 15); more needs `showAllHref`. */
  limit?: number | undefined;
  /** "Show all 23" link under the list when rows are cut. */
  showAllHref?: Route | undefined;
  density?: Density | undefined;
}

export type BarListProps =
  | (BarListCommon & { mode: 'comparison'; rows: readonly ComparisonRow[] })
  | (BarListCommon & { mode: 'distribution'; rows: readonly DistributionRow[] });

const MAX_ROWS = 15;

const FILL_OWN = cn('bg-chart-1');
const FILL_NEUTRAL = cn('bg-chart-bar-neutral');
const SCALE_FILL: Record<BarScaleColor, string> = {
  'rank-band-1': cn('bg-rank-band-1'),
  'rank-band-2': cn('bg-rank-band-2'),
  'rank-band-3': cn('bg-rank-band-3'),
  'rank-band-4': cn('bg-rank-band-4'),
  'rank-band-5': cn('bg-rank-band-5'),
  'rank-band-none': cn('bg-rank-band-none'),
  'seq-1': cn('bg-seq-1'),
  'seq-2': cn('bg-seq-2'),
  'seq-3': cn('bg-seq-3'),
  'seq-4': cn('bg-seq-4'),
  'seq-5': cn('bg-seq-5'),
  'seq-6': cn('bg-seq-6'),
  'seq-7': cn('bg-seq-7'),
  'chart-other': cn('bg-chart-other'),
  insufficient: cn('bg-insufficient'),
};

interface BarItem {
  row: BarListRowBase;
  fill: string;
  /** The own row: its label is strong. */
  strong: boolean;
}

function barItems(props: BarListProps): readonly BarItem[] {
  return props.mode === 'comparison'
    ? props.rows.map((row) => ({ row, fill: row.own ? FILL_OWN : FILL_NEUTRAL, strong: row.own }))
    : props.rows.map((row) => ({ row, fill: SCALE_FILL[row.scale], strong: false }));
}

const baseRows = (props: BarListProps): readonly BarListRowBase[] => props.rows;

/** The change column exists when the caller named it and at least one row has a change to show. */
const changeHeaderOf = (props: BarListProps): string | undefined =>
  baseRows(props).some((row) => row.delta !== undefined) ? props.changeHeader : undefined;

function scaleMax(props: BarListProps): number {
  if (props.max !== undefined) return props.max;
  return Math.max(0, ...baseRows(props).flatMap((row) => (row.value.kind === 'value' ? [row.value.value] : [])));
}

/** The bar's length as a share of the scale, clamped to the track; a row without a value has none. */
function barPercent(bar: BarValue, max: number): number {
  if (bar.kind !== 'value' || !Number.isFinite(bar.value) || !(max > 0)) return 0;
  return Math.min(100, Math.max(0, (bar.value / max) * 100));
}

function ValueText({ bar }: { bar: BarValue }): ReactElement {
  const t = useTranslations('chart');
  if (bar.kind === 'thin') return <SmallSampleMarker answers={bar.answers} form="text" />;
  if (bar.kind === 'none') {
    return <span className="type-meta whitespace-nowrap text-foreground-tertiary">{bar.text ?? t('noValue')}</span>;
  }
  return <span className="num type-meta whitespace-nowrap text-foreground-tertiary">{bar.valueText}</span>;
}

interface BarRowProps {
  item: BarItem;
  max: number;
  density: Density;
  /** Some shown row has a context, badge or change: every row then renders the trailing slot, empty or not. */
  trailing: boolean;
}

const hasTrailingContent = (row: BarListRowBase): boolean =>
  (row.value.kind === 'value' && row.value.contextText !== null) || row.badge !== undefined || row.delta !== undefined;

/**
 * One row. The visual part is hidden from assistive technology and the row is read once, from `accessibleText`.
 * Below 448 px the value shares the label's line and the bar runs under it, and the trailing items (context, badge,
 * change) sit on their own line. From 448 px the bar fills the track and the value sits in a fixed 112 px column after
 * it, so a full-width bar never meets its value (the value is drawn for both layouts, and the container query shows
 * one). Between 448 and 672 px the trailing items wrap onto a line of their own under the row. From 672 px they sit
 * inline in a fixed 224 px slot, so the track is as wide on every row of the list and one percent is one length: the
 * list decides whether the slot exists (`trailing`), and then every row renders it, empty when it has nothing to say.
 * The slot wraps to a second line instead of overlapping, and the context truncates with a `title`. A row without a
 * bar (thin, none) writes its words in flow in place of the bar, on its own line when narrow, and truncates them
 * instead of overflowing; it takes the same space as a bar, so it never changes the track of another row.
 */
function BarRow({ item, max, density, trailing }: BarRowProps): ReactElement {
  const { row, fill, strong } = item;
  const compact = density === 'compact';
  const hasBar = row.value.kind === 'value';
  const pct = barPercent(row.value, max);
  const contextText = row.value.kind === 'value' ? row.value.contextText : null;
  const content = (
    <>
      <span className="sr-only">{row.accessibleText}</span>
      <div
        aria-hidden="true"
        className="flex flex-col gap-1 py-1 @md:flex-row @md:flex-wrap @md:items-center @md:gap-x-3 @md:gap-y-1 @2xl:flex-nowrap"
      >
        <div className="flex min-w-0 items-center gap-2 @md:w-40 @md:shrink-0">
          {row.icon}
          <span
            data-slot="bar-list-label"
            className={cn('min-w-0 flex-1 truncate text-foreground', strong ? 'type-body-strong' : 'type-body')}
          >
            {row.label}
          </span>
          {hasBar ? (
            <span className="shrink-0 @md:hidden">
              <ValueText bar={row.value} />
            </span>
          ) : null}
        </div>
        {hasBar ? (
          <div className="flex min-w-0 items-center gap-2 @md:flex-1">
            <div className="min-w-0 flex-1">
              <div
                data-slot="bar-list-bar"
                className={cn('rounded-2xs', compact ? 'h-4' : 'h-6', fill)}
                style={{ width: `${String(pct)}%` }}
              />
            </div>
            <div data-slot="bar-list-value" className="hidden w-28 shrink-0 @md:block">
              <ValueText bar={row.value} />
            </div>
          </div>
        ) : (
          <div title={row.value.kind === 'none' ? row.value.text : undefined} className="min-w-0 truncate @md:flex-1">
            <ValueText bar={row.value} />
          </div>
        )}
        {trailing ? (
          <div
            data-slot="bar-list-trailing"
            className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 empty:hidden @md:w-full @2xl:w-56 @2xl:shrink-0 @2xl:empty:flex"
          >
            {contextText === null ? null : (
              <span
                data-slot="bar-list-context"
                title={contextText}
                className="max-w-full min-w-0 truncate type-meta text-foreground-tertiary"
              >
                {contextText}
              </span>
            )}
            {row.badge}
            {row.delta === undefined ? null : (
              <Delta input={row.delta.input} test={row.delta.test} size="sm" tip={false} />
            )}
          </div>
        ) : null}
      </div>
    </>
  );
  // A linked row is at least 32 px tall, above the 24 px minimum target
  const box = cn('flex flex-col justify-center', compact ? 'min-h-row-compact' : 'min-h-row');
  const trigger =
    row.href === undefined ? (
      <div className={box}>{content}</div>
    ) : (
      <Link
        href={row.href}
        {...(row.replace === true ? { replace: true } : {})}
        className={cn(box, 'rounded-sm outline-none hover:bg-surface-hover focus-visible:focus-ring')}
      >
        {content}
      </Link>
    );
  return (
    <li>
      {/* The accessible text already says what the tooltip says: it is for the eye */}
      <Tooltip content={row.label} detail={row.tip} purpose="label">
        {trigger}
      </Tooltip>
    </li>
  );
}

/** Horizontal bars as HTML (DS 15 section 5.1): a list, one item per row, links reachable by keyboard. */
export function BarList(props: BarListProps): ReactElement {
  const t = useTranslations('chart');
  const { caption, showAllHref, density = 'default' } = props;
  const items = barItems(props);
  const max = scaleMax(props);
  const shown = items.slice(0, Math.max(0, Math.min(props.limit ?? MAX_ROWS, MAX_ROWS)));
  const trailing = shown.some((item) => hasTrailingContent(item.row));
  return (
    <div className="@container flex flex-col gap-2">
      <ul aria-label={caption} className="flex flex-col">
        {shown.map((item) => (
          <BarRow key={item.row.id} item={item} max={max} density={density} trailing={trailing} />
        ))}
      </ul>
      {shown.length < items.length && showAllHref !== undefined ? (
        <LinkButton size="sm" variant="ghost" className="self-start" render={<Link href={showAllHref} />}>
          {t('barList.showAll', { count: items.length })}
        </LinkButton>
      ) : null}
    </div>
  );
}

/** The Table view: one row per bar row (every row, also those past `limit`): label, value, context, change. */
export function BarListTable(props: BarListProps): ReactElement {
  const t = useTranslations('chart');
  const insufficient = useTranslations('common.insufficient');
  const changeHeader = changeHeaderOf(props);
  const valueCell = (bar: BarValue): string => {
    if (bar.kind === 'thin') return insufficient('answers', { count: bar.answers });
    return bar.kind === 'none' ? (bar.text ?? t('noValue')) : bar.valueText;
  };
  const columns: PlainColumn<BarListRowBase>[] = [
    { id: 'label', header: props.labelHeader, cell: (row) => row.label },
    { id: 'value', header: props.valueHeader, cell: (row) => valueCell(row.value) },
    {
      id: 'context',
      header: props.contextHeader,
      cell: (row) => (row.value.kind === 'value' ? (row.value.contextText ?? '') : ''),
    },
    ...(changeHeader === undefined
      ? []
      : [{ id: 'change', header: changeHeader, cell: (row: BarListRowBase) => row.delta?.text ?? '' }]),
  ];
  return (
    <PlainTable<BarListRowBase>
      caption={props.caption}
      columns={columns}
      rows={baseRows(props)}
      rowKey={(row) => row.id}
      status="ready"
      errorState={null}
      emptyText={t('noValue')}
    />
  );
}

/**
 * Every row, every text cell and the header through `safeText`. A thin row writes its words, an unknown row an empty
 * cell (never 0). Built at once, so a click in the menu cannot throw. `thin` writes "3 answers" from
 * `useTranslations('common.insufficient')`.
 */
export function barListCsv(props: BarListProps, thin: (answers: number) => string): CsvTable {
  const changeHeader = changeHeaderOf(props);
  const valueCell = (bar: BarValue): CsvCell => {
    if (bar.kind === 'thin') return safeText(thin(bar.answers));
    return bar.kind === 'none' ? null : safeText(bar.valueText);
  };
  return {
    header: [
      props.labelHeader,
      props.valueHeader,
      props.contextHeader,
      ...(changeHeader === undefined ? [] : [changeHeader]),
    ].map(safeText),
    rows: baseRows(props).map((row) => {
      const context =
        row.value.kind === 'value' && row.value.contextText !== null ? safeText(row.value.contextText) : null;
      const cells: CsvCell[] = [safeText(row.label), valueCell(row.value), context];
      if (changeHeader !== undefined) cells.push(row.delta === undefined ? null : safeText(row.delta.text));
      return cells;
    }),
  };
}
