'use client';

import { useId, type ReactElement, type ReactNode } from 'react';

import { SEGMENTS, type Segment, type Split } from './headline-model';
import { CardInfoButton, type CardInfo } from '@/components/app/chart/card-info';
import { RingsChart } from '@/components/app/chart/rings-chart';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip } from '@/components/ui/tooltip';
import { smoothPath, type PathPoint } from '@/lib/charts/smooth-path';
import { cn } from '@/lib/utils';

/**
 * The tokens of the four outcomes: `seq-6`, `seq-4`, `seq-3` and the neutral bar, as the preview draws them and as the
 * Outcome split card does for the same four (`OutcomeRings`), so a segment has one colour on the whole page
 * (OV-HEAD-06, OV-HEAD-20). Set as a custom property, the token being the only place the colour is named.
 */
const FILL: Readonly<Record<Segment, { backgroundColor: string }>> = {
  mentioned_and_cited: { backgroundColor: 'var(--seq-6)' },
  mentioned_only: { backgroundColor: 'var(--seq-4)' },
  cited_only: { backgroundColor: 'var(--seq-3)' },
  neither: { backgroundColor: 'var(--chart-bar-neutral)' },
};

/** The same four tokens by name, for the ring (`FILL` holds them as custom properties for the legend swatches). */
const TOKEN: Readonly<Record<Segment, 'seq-6' | 'seq-4' | 'seq-3' | 'chart-bar-neutral'>> = {
  mentioned_and_cited: 'seq-6',
  mentioned_only: 'seq-4',
  cited_only: 'seq-3',
  neither: 'chart-bar-neutral',
};

const SPARK_WIDTH = 100;

/**
 * A smooth line with a fade under it, no glow and a dot on the latest point (15-data-visualization.md section 1a),
 * in `chart-1`. The dot is an HTML element, because a dot inside a stretched SVG would turn into an ellipse. A gap in
 * the series breaks no line, it is skipped.
 */
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
  const fade = useId().replaceAll(':', '');
  const values = points.filter((value): value is number => value !== null);
  if (values.length < 2) return null;
  const low = Math.min(...values);
  const span = Math.max(...values) - low || 1;
  const pad = 4;
  const spots: PathPoint[] = points.flatMap((value, index) =>
    value === null
      ? []
      : [
          {
            x: (index / (points.length - 1)) * SPARK_WIDTH,
            y: height - pad - ((value - low) / span) * (height - 2 * pad),
          },
        ],
  );
  const first = spots[0];
  const last = spots[spots.length - 1];
  if (first === undefined || last === undefined) return null;
  const line = smoothPath(spots);
  return (
    <div className={cn('relative w-full', className)} style={{ height }}>
      <svg
        viewBox={`0 0 ${String(SPARK_WIDTH)} ${String(height)}`}
        preserveAspectRatio="none"
        className="block w-full overflow-visible"
        style={{ height }}
        {...(label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
      >
        <defs>
          <linearGradient id={fade} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--chart-1)', stopOpacity: 0.32 }} />
            <stop offset="1" style={{ stopColor: 'var(--chart-1)', stopOpacity: 0 }} />
          </linearGradient>
        </defs>
        <path
          d={`${line} L${String(last.x)},${String(height)} L${String(first.x)},${String(height)} Z`}
          fill={`url(#${fade})`}
        />
        <path
          d={line}
          fill="none"
          strokeWidth={2.25}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          className="stroke-chart-1"
        />
      </svg>
      <span
        aria-hidden="true"
        className="absolute size-2 rounded-full border-2 border-surface bg-chart-1"
        style={{ left: `${String(last.x)}%`, top: last.y, transform: 'translate(-50%, -50%)' }}
      />
    </div>
  );
}

export interface HeroRingProps {
  split: Split;
  /** The visibility rate as text, for the middle of the ring: "44%". */
  center: string;
  /** What stands behind the rate (its counts or the platforms it averages), read with it and not drawn. */
  centerNote: string;
  /** The name of each segment. */
  nameOf: (segment: Segment) => string;
  /** A share as text, 0 decimals. */
  percent: (share: number) => string;
  /** The words of a segment's tooltip: its share, and its counts for one platform. */
  tipOf: (segment: Segment) => string;
  /** The four shares in words, for people who cannot see the ring. */
  label: string;
}

/** The ring is 132 px square and the legend takes the rest of the card. */
const HERO_RING = 132;
/** The key of the one row of the ring (not text: it is never shown). */
const HERO_ROW_ID = String(HERO_RING);

/**
 * The four outcomes of an answer as one plain ring with the visibility rate in the middle, each share beside its name
 * (OV-HEAD-06, 15-data-visualization.md section 1a). A segment with no share is not drawn. Colour is not the only carrier:
 * every share is printed in the legend beside the ring.
 */
export function HeroRing({ split, center, centerNote, nameOf, percent, tipOf, label }: HeroRingProps): ReactElement {
  return (
    <div className="flex items-center gap-4">
      <div className="w-32 shrink-0">
        <RingsChart
          names={false}
          emphasis
          height={HERO_RING}
          label={label}
          segments={SEGMENTS.map((segment) => ({ id: segment, name: nameOf(segment), token: TOKEN[segment] }))}
          rows={[
            {
              id: HERO_ROW_ID,
              label: '',
              center,
              centerNote,
              shares: SEGMENTS.map((segment) => split.shares[segment]),
              tips: SEGMENTS.map((segment) => tipOf(segment)),
            },
          ]}
        />
      </div>
      <dl className="m-0 flex min-w-0 flex-1 flex-col gap-1">
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
