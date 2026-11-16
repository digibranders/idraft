'use client';

import type { ReactElement, ReactNode } from 'react';

import { SEGMENTS, type Segment, type Split } from './headline-model';
import { CardInfoButton, type CardInfo } from '@/components/app/chart/card-info';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * The tokens of the four outcomes: `seq-6`, `seq-4`, `seq-3` and the neutral bar, as the preview draws them and as the
 * Answer outcomes card does for the same four (`OutcomeBars`), so a segment has one colour on the whole page
 * (OV-HEAD-06, OV-HEAD-20). Set as a custom property, the token being the only place the colour is named.
 */
const FILL: Readonly<Record<Segment, { backgroundColor: string }>> = {
  mentioned_and_cited: { backgroundColor: 'var(--seq-6)' },
  mentioned_only: { backgroundColor: 'var(--seq-4)' },
  cited_only: { backgroundColor: 'var(--seq-3)' },
  neither: { backgroundColor: 'var(--chart-bar-neutral)' },
};

const SPARK_WIDTH = 100;
const round2 = (value: number): number => Math.round(value * 100) / 100;

/** A plain SVG line that follows the theme through `chart-1`; a gap in the series breaks no line, it is skipped. */
export function Sparkline({
  points,
  height,
  label,
  className,
}: {
  points: readonly (number | null)[];
  height: number;
  label?: string;
  className?: string;
}): ReactElement | null {
  const values = points.filter((value): value is number => value !== null);
  if (values.length < 2) return null;
  const low = Math.min(...values);
  const span = Math.max(...values) - low || 1;
  const pad = 3;
  const line = points
    .flatMap((value, index) =>
      value === null
        ? []
        : [
            `${String(round2((index / (points.length - 1)) * SPARK_WIDTH))},${String(round2(height - pad - ((value - low) / span) * (height - 2 * pad)))}`,
          ],
    )
    .join(' ');
  return (
    <svg
      viewBox={`0 0 ${String(SPARK_WIDTH)} ${String(height)}`}
      preserveAspectRatio="none"
      className={cn('block w-full overflow-visible', className)}
      style={{ height }}
      {...(label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
    >
      <polyline
        points={line}
        fill="none"
        strokeWidth={1.75}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        className="stroke-chart-1"
      />
    </svg>
  );
}

export interface SplitBarProps {
  split: Split;
  /** The name of each segment. */
  nameOf: (segment: Segment) => string;
  /** A share as text, 0 decimals. */
  percent: (share: number) => string;
  /** The words of a segment's tooltip: its share, and its counts for one platform. */
  tipOf: (segment: Segment) => string;
  label: string;
}

/**
 * The four outcomes of an answer as one bar, each share beside its name (OV-HEAD-06). A segment with no share is not
 * drawn. Colour is not the only carrier: every share is printed in the legend under the bar.
 */
export function SplitBar({ split, nameOf, percent, tipOf, label }: SplitBarProps): ReactElement {
  return (
    <div className="flex flex-col gap-2">
      <div role="img" aria-label={label} className="flex h-2.5 gap-0.5 overflow-hidden rounded-xs">
        {SEGMENTS.filter((segment) => split.shares[segment] > 0).map((segment) => (
          <Tooltip key={segment} content={tipOf(segment)}>
            <div
              className="h-full min-w-0"
              style={{ ...FILL[segment], width: `${String(split.shares[segment] * 100)}%` }}
            />
          </Tooltip>
        ))}
      </div>
      <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-1">
        {SEGMENTS.map((segment) => (
          <div key={segment} className="flex min-w-0 items-center gap-1.5 type-table">
            <span aria-hidden="true" className="size-2 shrink-0 rounded-xs" style={FILL[segment]} />
            <dt className="truncate text-foreground-secondary">{nameOf(segment)}</dt>
            <dd className="ml-auto num text-foreground">{percent(split.shares[segment])}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export interface TileProps {
  label: string;
  info: CardInfo;
  value: string;
  /** The figure is there: a missing one is quiet. */
  known: boolean;
  /** The counts or the reason, in the tooltip. */
  tip: string | null;
  /** The one short line under the value; kept (empty) so a tile has the same height in every scope. */
  note: string;
  spark: ReactNode;
  /** The figure is still being read: a placeholder holds its place. */
  loading?: boolean;
}

/** One of the eight numbers: its label with its own info button, the value with its trend, and a line of note. */
export function Tile({ label, info, value, known, tip, note, spark, loading = false }: TileProps): ReactElement {
  const figure = loading ? (
    <Skeleton shape="text-14" widthPct={48} className="h-8" />
  ) : (
    <span
      className={cn('num type-metric', known ? 'text-foreground' : 'text-foreground-tertiary')}
      {...(tip === null ? {} : { tabIndex: 0 })}
    >
      {value}
      {/* The counts or the reason are read with the value, as the preview does (OV-HEAD-12), not only on hover */}
      {tip === null ? null : <span className="sr-only">, {tip}</span>}
    </span>
  );
  return (
    <div className="flex min-w-0 flex-col justify-between gap-1 bg-surface px-4 py-3">
      <div className="flex min-w-0 items-center justify-between gap-1">
        <span className="line-clamp-2 min-w-0 type-label text-foreground-secondary">{label}</span>
        <span className="-my-1.5 -mr-1.5 shrink-0">
          <CardInfoButton title={label} info={info} />
        </span>
      </div>
      <div className="flex min-w-0 items-center justify-between gap-3">
        {tip === null || loading ? (
          figure
        ) : (
          <Tooltip content={tip} purpose="label">
            {figure}
          </Tooltip>
        )}
        {spark === null ? null : <div className="w-14 shrink-0">{spark}</div>}
      </div>
      <span className="block min-h-4 truncate type-micro text-foreground-tertiary">{note}</span>
    </div>
  );
}
