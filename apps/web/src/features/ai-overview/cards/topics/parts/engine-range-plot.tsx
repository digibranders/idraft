'use client';

import type { Route } from 'next';
import Link from 'next/link';
import type { ReactElement } from 'react';

import { engineRole } from '../engine-role';
import type { LegendSymbol } from '@/components/app/chart/chart-legend';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { Tooltip } from '@/components/ui/tooltip';
import { seriesColorVar } from '@/lib/charts/category-chart';
import { EMPTY_VALUE, formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';

// shortcut: card local (the plan's L-E fallback); promote to components/app/chart when a second card needs a range plot.

/** One engine of a row. `position` is the rate as a percent on the shared axis; `null` draws no dot (R2, D5). */
export interface RangeDot {
  code: string;
  name: string;
  position: number | null;
  /** The engine's words with its counts, "3 answers" for too few, n/a for none: the table and the row's note use it. */
  text: string;
}

export interface RangePlotRow {
  id: string;
  label: string;
  href?: Route | undefined;
  dots: readonly RangeDot[];
  /** "39 points". */
  spreadText: string;
  /** The reading of the gap, from counts only: "detectable difference". */
  verdict: string;
  /** The row's one accessible text: the topic, the gap, the verdict and every engine's value with its counts. */
  accessibleText: string;
  /** The tooltip's second line. */
  detail: string;
}

export interface EngineRangePlotProps {
  rows: readonly RangePlotRow[];
  /** Names the list. */
  caption: string;
}

/** The marker follows the engine's place in the fixed order, so colour is never the only difference. */
const SHAPE_OF: Readonly<Record<string, LegendSymbol>> = {
  chatgpt_web: 'circle',
  gemini_web: 'rect',
  google_ai_mode: 'triangle',
};
const SHAPE_PATH: Readonly<Record<LegendSymbol, string>> = {
  circle: 'M5 0.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9z',
  rect: 'M0.5 0.5h9v9h-9z',
  triangle: 'M5 0.5L9.5 9.5H0.5z',
  diamond: 'M5 0.5L9.5 5L5 9.5L0.5 5z',
};

/** The marker of an engine, also for its legend entry. */
export const markerOf = (code: string): LegendSymbol => SHAPE_OF[code] ?? 'diamond';

const TICKS = [
  { at: 0, align: '' },
  { at: 50, align: '-translate-x-1/2' },
  { at: 100, align: '-translate-x-full' },
] as const;

const clamp = (position: number): number => Math.min(100, Math.max(0, position));
const percentText = (position: number): string => `${String(clamp(position))}%`;

/** The grid every row and the axis share: the label above the track when narrow, beside it from 448 px. */
const GRID = 'grid grid-cols-[minmax(0,1fr)] gap-x-4 gap-y-1 @md:grid-cols-[minmax(8rem,14rem)_minmax(0,1fr)]';

function Dot({ dot }: { dot: RangeDot & { position: number } }): ReactElement {
  const shape = markerOf(dot.code);
  return (
    <span
      data-slot="range-dot"
      data-engine={dot.code}
      data-shape={shape}
      className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
      style={{ left: percentText(dot.position) }}
    >
      <svg viewBox="0 0 10 10" width={10} height={10} className="block stroke-surface" strokeWidth={1}>
        <path d={SHAPE_PATH[shape]} fill={seriesColorVar(engineRole(dot.code))} />
      </svg>
    </span>
  );
}

function Track({ dots }: { dots: readonly RangeDot[] }): ReactElement {
  const placed = dots.flatMap((dot) => (dot.position === null ? [] : [{ ...dot, position: dot.position }]));
  const positions = placed.map((dot) => clamp(dot.position));
  const low = Math.min(...positions);
  const high = Math.max(...positions);
  return (
    <div className="px-1.5" aria-hidden="true">
      <div className="relative h-6">
        {placed.length > 1 ? (
          <span
            data-slot="range-line"
            className="absolute top-1/2 h-0.5 -translate-y-1/2 bg-border"
            style={{ left: percentText(low), width: percentText(high - low) }}
          />
        ) : null}
        {placed.map((dot) => (
          <Dot key={dot.code} dot={dot} />
        ))}
      </div>
    </div>
  );
}

function RangeRow({ row }: { row: RangePlotRow }): ReactElement {
  // An engine with no dot says why in text, so its answers are never left out
  const noted = row.dots.filter((dot) => dot.position === null);
  const content = (
    <>
      <span className="sr-only">{row.accessibleText}</span>
      <div aria-hidden="true" className={cn(GRID, 'items-center py-1')}>
        <div className="min-w-0">
          <span data-slot="range-label" className="block truncate type-body text-foreground">
            {row.label}
          </span>
          <span className="block truncate type-meta text-foreground-tertiary">{`${row.spreadText}, ${row.verdict}`}</span>
          {noted.map((dot) => (
            <span key={dot.code} className="block truncate type-meta text-foreground-tertiary">
              {`${dot.name}: ${dot.text}`}
            </span>
          ))}
        </div>
        <Track dots={row.dots} />
      </div>
    </>
  );
  // A linked row is at least 32 px tall, above the 24 px minimum target
  const box = 'flex min-h-row flex-col justify-center';
  const trigger =
    row.href === undefined ? (
      <div className={box}>{content}</div>
    ) : (
      <Link
        href={row.href}
        className={cn(box, 'rounded-sm outline-none hover:bg-surface-hover focus-visible:focus-ring')}
      >
        {content}
      </Link>
    );
  return (
    <li>
      {/* The accessible text already says what the tooltip says: it is for the eye */}
      <Tooltip content={row.label} detail={row.detail} purpose="label">
        {trigger}
      </Tooltip>
    </li>
  );
}

/**
 * A range plot as HTML: a list with one item per topic, every engine's rate as a dot on one shared 0 to 100 percent
 * axis, and a line from the lowest to the highest dot. Markers differ by shape as well as colour; an engine with too
 * few answers has no dot and its answers are written beside the topic. Each item is read once, from its sentence.
 */
export function EngineRangePlot({ rows, caption }: EngineRangePlotProps): ReactElement {
  return (
    <div className="@container flex flex-col gap-1">
      <div aria-hidden="true" className={GRID}>
        <span className="hidden @md:block" />
        <div className="px-1.5">
          <div className="relative h-4 type-meta text-foreground-tertiary">
            {TICKS.map((tick) => (
              <span
                key={tick.at}
                className={cn('absolute top-0 whitespace-nowrap', tick.align)}
                style={{ left: `${String(tick.at)}%` }}
              >
                {formatPercent(tick.at / 100, { decimals: 0 })}
              </span>
            ))}
          </div>
        </div>
      </div>
      <ul aria-label={caption} className="flex flex-col">
        {rows.map((row) => (
          <RangeRow key={row.id} row={row} />
        ))}
      </ul>
    </div>
  );
}

export interface EngineRangeTableProps {
  rows: readonly RangePlotRow[];
  caption: string;
  labels: { topic: string; spread: string; verdict: string };
}

/** The Table view: the topic, every engine's value with its counts, the spread and the reading. */
export function EngineRangeTable({ rows, caption, labels }: EngineRangeTableProps): ReactElement {
  const engines = rows[0]?.dots ?? [];
  const columns: PlainColumn<RangePlotRow>[] = [
    { id: 'topic', header: labels.topic, cell: (row) => row.label },
    ...engines.map((engine): PlainColumn<RangePlotRow> => ({
      id: engine.code,
      header: engine.name,
      wrap: true,
      cell: (row) => row.dots.find((dot) => dot.code === engine.code)?.text ?? EMPTY_VALUE,
    })),
    { id: 'spread', header: labels.spread, cell: (row) => row.spreadText },
    { id: 'verdict', header: labels.verdict, wrap: true, cell: (row) => row.verdict },
  ];
  return (
    <PlainTable<RangePlotRow>
      caption={caption}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      status="ready"
      errorState={null}
      emptyText={EMPTY_VALUE}
    />
  );
}
