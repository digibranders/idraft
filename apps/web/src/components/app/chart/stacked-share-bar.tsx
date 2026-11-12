'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useId, type ReactElement, type ReactNode } from 'react';

import { SmallSampleMarker } from './small-sample-marker';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { safeText, type CsvCell, type CsvTable } from '@/lib/csv/csv-write';
import { formatList } from '@/lib/format';
import type { Density } from '@/lib/tables/table-state';
import { cn } from '@/lib/utils';

/**
 * Palette order; `chart-1` only for an own-brand segment (Own in CH-16), never for a category (DS 15 5.2): the
 * type cannot tell, so a consumer and its reviewer do.
 */
export type ShareColor =
  `chart-${1 | 2 | 3 | 4 | 5 | 6}` | 'chart-other' | `rank-band-${1 | 2 | 3 | 4 | 5}` | 'rank-band-none';

/** The segments, in their fixed order (CH-03: Named and cited, Named only, Cited only, Neither). */
export interface ShareSegment {
  id: string;
  name: string;
  color: ShareColor;
}

/** One segment's part of one row: a known share (0 is a real zero of a known total). */
export interface ShareCell {
  segmentId: string;
  share: number;
  shareText: string;
  countText: string;
}

export type ShareRowValue =
  | { kind: 'shares'; cells: readonly ShareCell[] }
  | { kind: 'thin'; answers: number }
  | { kind: 'none'; text?: string | undefined };

export interface ShareRow {
  id: string;
  /** Engine or category: "Gemini". */
  label: string;
  /** Decorative (an `EngineLogo` later): the label carries the name. */
  icon?: ReactNode;
  /** "of 1,296 answers", "of 2,842 citation units" (R1, R12). */
  denominatorText: string;
  value: ShareRowValue;
  /** The prompt list filtered by outcome or engine (CH-03 rows are focusable, segments are not). */
  href?: Route | undefined;
}

export interface StackedShareBarProps {
  /** "Named and cited, by engine": names the list and the legend table. */
  caption: string;
  segments: readonly ShareSegment[];
  rows: readonly ShareRow[];
  /** First column header of the legend table: "Outcome". */
  segmentHeader: string;
  /** The frame's Patterns state (`body={({ patterns }) => ...}`); false in the Table view and the CSV. */
  patterns: boolean;
  /** Default `default`: 32 px bars; `compact`: 24 px. */
  density?: Density | undefined;
}

/** A segment narrower than this share of the bar is too narrow for its label; the legend table says it. */
const MIN_LABEL_SHARE = 0.06;

const FILL: Record<ShareColor, string> = {
  'chart-1': 'bg-chart-1',
  'chart-2': 'bg-chart-2',
  'chart-3': 'bg-chart-3',
  'chart-4': 'bg-chart-4',
  'chart-5': 'bg-chart-5',
  'chart-6': 'bg-chart-6',
  'chart-other': 'bg-chart-other',
  'rank-band-1': 'bg-rank-band-1',
  'rank-band-2': 'bg-rank-band-2',
  'rank-band-3': 'bg-rank-band-3',
  'rank-band-4': 'bg-rank-band-4',
  'rank-band-5': 'bg-rank-band-5',
  'rank-band-none': 'bg-rank-band-none',
};

/*
 * The text colour of the label inside a segment, from the contrast of the two text tokens on each fill (4.5 to 1,
 * WCAG AA, checked in both themes by the test that reads tokens.css). `foreground-inverse` is light text in the
 * light theme and dark text in the dark theme, so the pairs differ by theme. `null`: no text token reaches 4.5 to 1
 * in both themes (rank-band-3 in the dark theme), so the segment has no label and the legend table carries the
 * value.
 */
export const LABEL_ON: Record<ShareColor, string | null> = {
  'chart-1': 'text-foreground-inverse',
  'chart-2': 'text-foreground dark:text-foreground-inverse',
  'chart-3': 'text-foreground dark:text-foreground-inverse',
  'chart-4': 'text-foreground-inverse',
  'chart-5': 'text-foreground-inverse',
  'chart-6': 'text-foreground-inverse',
  'chart-other': 'text-foreground-inverse',
  'rank-band-1': 'text-foreground-inverse',
  'rank-band-2': 'text-foreground-inverse',
  'rank-band-3': null,
  'rank-band-4': 'text-foreground',
  'rank-band-5': 'text-foreground',
  'rank-band-none': 'text-foreground',
};

/** The six patterns, in a fixed order: a segment keeps its kind whichever outcomes a row has. */
const PATTERN_KINDS = ['diagonal-45', 'diagonal-135', 'vertical', 'horizontal', 'dots', 'cross'] as const;
type PatternKind = (typeof PATTERN_KINDS)[number];

const patternKind = (index: number): PatternKind => PATTERN_KINDS[index % PATTERN_KINDS.length] ?? PATTERN_KINDS[0];

const PATTERN_SIZE = 6;
const STROKE = { stroke: 'currentColor', strokeWidth: 1.5 } as const;

function PatternShapes({ kind }: { kind: PatternKind }): ReactElement {
  const middle = PATTERN_SIZE / 2;
  switch (kind) {
    case 'dots':
      return <circle cx={middle} cy={middle} r={1} fill="currentColor" />;
    case 'cross':
      return (
        <>
          <line x1={middle} y1={0} x2={middle} y2={PATTERN_SIZE} {...STROKE} />
          <line x1={0} y1={middle} x2={PATTERN_SIZE} y2={middle} {...STROKE} />
        </>
      );
    case 'horizontal':
      return <line x1={0} y1={middle} x2={PATTERN_SIZE} y2={middle} {...STROKE} />;
    case 'vertical':
    case 'diagonal-45':
    case 'diagonal-135':
      return <line x1={middle} y1={0} x2={middle} y2={PATTERN_SIZE} {...STROKE} />;
  }
}

const PATTERN_TRANSFORM: Partial<Record<PatternKind, string>> = {
  'diagonal-45': 'rotate(45)',
  'diagonal-135': 'rotate(135)',
};

/** The surface colour drawn over a fill with `stroke="currentColor"`, so the pattern needs no colour of its own. */
function PatternOverlay({ kind, id }: { kind: PatternKind; id: string }): ReactElement {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      data-pattern={kind}
      className="absolute inset-0 size-full text-surface opacity-50"
    >
      <defs>
        <pattern
          id={id}
          width={PATTERN_SIZE}
          height={PATTERN_SIZE}
          patternUnits="userSpaceOnUse"
          {...(PATTERN_TRANSFORM[kind] === undefined ? {} : { patternTransform: PATTERN_TRANSFORM[kind] })}
        >
          <PatternShapes kind={kind} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

/** `useId()` writes characters that a `url(#...)` reference may not take in every browser. */
const patternId = (base: string, suffix: string): string => `${base.replaceAll(/[^A-Za-z0-9_-]/g, '')}-${suffix}`;

interface ShareBarFigureProps {
  label: string;
  segments: readonly ShareSegment[];
  cells: readonly ShareCell[];
  denominatorText: string;
  /** Height, width and radius of the bar. */
  className: string;
  /** Shares written inside the segments wide enough for them. */
  inside: boolean;
  /** The prefix of this bar's pattern ids, or `null` for no patterns. */
  patternBase: string | null;
}

/** The bar: one image named with every segment and the denominator; its segments are for the eye only. */
function ShareBarFigure({
  label,
  segments,
  cells,
  denominatorText,
  className,
  inside,
  patternBase,
}: ShareBarFigureProps): ReactElement {
  const t = useTranslations('chart');
  const known = segments.flatMap((segment, index) => {
    const cell = cells.find((entry) => entry.segmentId === segment.id);
    return cell === undefined ? [] : [{ segment, index, cell }];
  });
  // An unknown outcome is named as unknown, so a screen reader hears what the eye sees as a shorter bar (R6)
  const name = t('shareBar.image', {
    label,
    segments: formatList(
      segments.map((segment) => {
        const cell = cells.find((entry) => entry.segmentId === segment.id);
        return cell === undefined
          ? `${segment.name}: ${t('noValue')}`
          : `${segment.name} ${cell.shareText}, ${cell.countText}`;
      }),
    ),
    denominator: denominatorText,
  });
  return (
    <div role="img" aria-label={name} className={cn('flex gap-px overflow-hidden', className)}>
      {/* An unknown outcome (no cell) and a known zero are both left out; the legend table tells them apart (R6) */}
      {known
        .filter(({ cell }) => cell.share > 0)
        .map(({ segment, index, cell }) => {
          const labelClass = LABEL_ON[segment.color];
          return (
            <div
              key={segment.id}
              data-slot="share-segment"
              data-segment={segment.id}
              aria-hidden="true"
              style={{ flexGrow: cell.share }}
              className={cn('relative min-w-0 basis-0 overflow-hidden', FILL[segment.color])}
            >
              {patternBase === null ? null : (
                <PatternOverlay kind={patternKind(index)} id={patternId(patternBase, `s${String(index)}`)} />
              )}
              {inside && labelClass !== null && cell.share >= MIN_LABEL_SHARE ? (
                <span className="absolute inset-0 flex items-center justify-center">
                  {/* A chip of the segment's own fill: with Patterns on, no stroke passes behind the glyphs, so the 4.5 to 1 of LABEL_ON holds */}
                  <span
                    className={cn('rounded-2xs px-1 num type-micro whitespace-nowrap', FILL[segment.color], labelClass)}
                  >
                    {cell.shareText}
                  </span>
                </span>
              ) : null}
            </div>
          );
        })}
    </div>
  );
}

interface RowProps {
  row: ShareRow;
  index: number;
  segments: readonly ShareSegment[];
  patternBase: string | null;
  barClass: string;
}

function ShareRowItem({ row, index, segments, patternBase, barClass }: RowProps): ReactElement {
  const t = useTranslations('chart');
  const { value } = row;
  const hasBar = value.kind === 'shares' && value.cells.length > 0;
  const rowPatternBase = patternBase === null ? null : patternId(patternBase, `r${String(index)}`);
  const icon = row.icon === undefined || row.icon === null ? null : <span aria-hidden="true">{row.icon}</span>;
  const labelContent = (
    <>
      {icon}
      {row.label}
    </>
  );
  return (
    <li className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center justify-between gap-x-4">
        {row.href === undefined ? (
          <span className="inline-flex items-center gap-2 type-body">{labelContent}</span>
        ) : (
          <Link
            href={row.href}
            className="-mx-1 inline-flex min-h-row-compact items-center gap-2 rounded-sm px-1 type-body text-foreground hover:bg-surface-hover focus-visible:focus-ring"
          >
            {labelContent}
          </Link>
        )}
        {hasBar ? <span className="num type-meta">{row.denominatorText}</span> : null}
      </div>
      {value.kind === 'shares' && hasBar ? (
        <ShareBarFigure
          label={row.label}
          segments={segments}
          cells={value.cells}
          denominatorText={row.denominatorText}
          className={barClass}
          inside
          patternBase={rowPatternBase}
        />
      ) : value.kind === 'thin' ? (
        <SmallSampleMarker answers={value.answers} form="text" />
      ) : (
        <span className="type-meta text-foreground-tertiary">
          {(value.kind === 'none' ? value.text : undefined) ?? t('noValue')}
        </span>
      )}
    </li>
  );
}

/** A square of the segment's colour, with its pattern when Patterns is on (the swatch grows to hold it). */
function Swatch({
  segment,
  index,
  patterns,
  base,
}: {
  segment: ShareSegment;
  index: number;
  patterns: boolean;
  base: string;
}): ReactElement {
  return (
    <span
      data-slot="share-swatch"
      data-segment={segment.id}
      aria-hidden="true"
      className={cn(
        'relative inline-block shrink-0 overflow-hidden rounded-2xs',
        patterns ? 'size-4' : 'size-2',
        FILL[segment.color],
      )}
    >
      {patterns ? <PatternOverlay kind={patternKind(index)} id={patternId(base, `w${String(index)}`)} /> : null}
    </span>
  );
}

function TableCell({ row, segment }: { row: ShareRow; segment: ShareSegment }): ReactElement {
  const t = useTranslations('chart');
  const { value } = row;
  if (value.kind === 'thin') return <SmallSampleMarker answers={value.answers} form="text" />;
  const cell = value.kind === 'shares' ? value.cells.find((entry) => entry.segmentId === segment.id) : undefined;
  if (cell !== undefined) return <>{`${cell.shareText}, ${cell.countText}`}</>;
  // No cell is an unknown outcome (R6), never a 0%
  return (
    <span className="text-foreground-tertiary">{(value.kind === 'none' ? value.text : undefined) ?? t('noValue')}</span>
  );
}

/**
 * The legend and the Table view in one: a row for each outcome, a column for each bar row, each cell the share
 * beside its count. A thin column says its answers and an unknown outcome says "No data".
 */
export function StackedShareTable({
  caption,
  segments,
  rows,
  segmentHeader,
  patterns,
}: StackedShareBarProps): ReactElement {
  const t = useTranslations('chart');
  const base = useId();
  const columns: PlainColumn<ShareSegment>[] = [
    {
      id: 'segment',
      header: segmentHeader,
      cell: (segment) => (
        <span className="inline-flex items-center gap-2">
          <Swatch
            segment={segment}
            index={segments.findIndex((entry) => entry.id === segment.id)}
            patterns={patterns}
            base={base}
          />
          {segment.name}
        </span>
      ),
    },
    ...rows.map((row): PlainColumn<ShareSegment> => ({
      id: row.id,
      header: row.label,
      cell: (segment) => <TableCell row={row} segment={segment} />,
    })),
  ];
  return (
    <PlainTable<ShareSegment>
      caption={caption}
      columns={columns}
      rows={segments}
      rowKey={(segment) => segment.id}
      status="ready"
      errorState={null}
      emptyText={t('noValue')}
    />
  );
}

/**
 * 100% stacked bars, a row for each engine or category (the inventory's OutcomeMixBar made generic): the shares
 * of one known total, so a bar fills only as far as its known outcomes do. The legend table below is the
 * alternative and always drawn; the frame's Table view is the same table.
 *
 * The DS 15 5.2 segment tooltip is not drawn here: the legend table under the bars carries every name, share and
 * count. The segments are for the eye only.
 */
export function StackedShareBar(props: StackedShareBarProps): ReactElement {
  const { caption, segments, rows, patterns, density = 'default' } = props;
  const base = useId();
  const barClass = density === 'compact' ? 'h-6 rounded-md' : 'h-8 rounded-md';
  return (
    <div className="flex flex-col gap-4">
      <ul aria-label={caption} className="flex flex-col gap-3">
        {rows.map((row, index) => (
          <ShareRowItem
            key={row.id}
            row={row}
            index={index}
            segments={segments}
            patternBase={patterns ? base : null}
            barClass={barClass}
          />
        ))}
      </ul>
      <StackedShareTable {...props} />
    </div>
  );
}

/** One segment of the 96 by 12 px bar in a rate table cell (WB-PD-05, DS 25 10.6 `cell`): no labels, nothing to focus. */
export interface ShareBarCellProps {
  label: string;
  segments: readonly ShareSegment[];
  /** The known outcomes of this row; a thin or unknown row draws its words in the cell instead. */
  cells: readonly ShareCell[];
  denominatorText: string;
}

export function ShareBarCell({ label, segments, cells, denominatorText }: ShareBarCellProps): ReactElement {
  const t = useTranslations('chart');
  if (cells.length === 0) return <span className="type-meta text-foreground-tertiary">{t('noValue')}</span>;
  return (
    <ShareBarFigure
      label={label}
      segments={segments}
      cells={cells}
      denominatorText={denominatorText}
      className="h-3 w-24 shrink-0 rounded-xs"
      inside={false}
      patternBase={null}
    />
  );
}

function csvCell(row: ShareRow, segment: ShareSegment, thin: (answers: number) => string): CsvCell {
  const { value } = row;
  if (value.kind === 'thin') return safeText(thin(value.answers));
  if (value.kind === 'none') return null;
  const cell = value.cells.find((entry) => entry.segmentId === segment.id);
  // An unknown outcome is an empty cell, never 0 (R6)
  return cell === undefined ? null : safeText(`${cell.shareText}, ${cell.countText}`);
}

/**
 * The Table view as a file: a row for each outcome, a column for each bar row. Built eagerly, with every text
 * through `safeText` (the frame does not pass an html table through it).
 */
export function stackedShareCsv(
  { segments, rows, segmentHeader }: StackedShareBarProps,
  thin: (answers: number) => string,
): CsvTable {
  return {
    header: [segmentHeader, ...rows.map((row) => row.label)].map(safeText),
    rows: segments.map((segment) => [safeText(segment.name), ...rows.map((row) => csvCell(row, segment, thin))]),
  };
}
