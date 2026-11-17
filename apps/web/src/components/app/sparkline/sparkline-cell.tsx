'use client';

import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';

import {
  RATE_SPAN,
  SPARK_HEIGHT,
  SPARK_HEIGHT_COMPACT,
  SPARK_WIDTH,
  sparklineGeometry,
  type SparkValue,
} from '@/lib/charts/sparkline';
import { readColorToken } from '@/lib/design/read-tokens';
import type { Density } from '@/lib/tables/table-state';
import { cn } from '@/lib/utils';

/**
 * The line's colour: the neutral reference, the own brand (`own`, in a table that mixes the own brand with
 * others), or the direction of a movement (never the only sign of it).
 */
export type SparklineTone = 'reference' | 'own' | 'positive' | 'negative';

const TONE_TOKEN: Readonly<Record<SparklineTone, string>> = {
  reference: '--chart-reference',
  own: '--chart-1',
  positive: '--positive-solid',
  negative: '--negative-solid',
};

/**
 * What the values are, which fixes the scale (15-data-visualization.md section 9): `count` fills the box with the
 * row's own range (search volume); `rate` stands for at least `minSpan` 0.2; `rank` is inverted (1 at the top)
 * on a fixed scale of 1 to `rankDepth`, so the rows of a table compare.
 */
export type SparklineKind = 'count' | 'rate' | 'rank';

const dprOf = (): number => (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);

/** The bottom of the rank scale unless a table says otherwise. */
const RANK_DEPTH = 20;

const ENTITY_TOKENS = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6'] as const;
const entityToken = (entity: { own: boolean; colorIndex: number | null }): string =>
  entity.own ? '--chart-1' : (ENTITY_TOKENS[(entity.colorIndex ?? 0) - 1] ?? '--chart-other');

export interface SparklineCellProps {
  /** The values, oldest first; `null` for a point without one. */
  values: readonly SparkValue[];
  label: string;
  /** Default `count`, the built behaviour. */
  kind?: SparklineKind | undefined;
  tone?: SparklineTone | undefined;
  /** Overrides the least range of the kind (rate 0.2, count 0): in the values' unit, so a point or two stays flat. */
  minSpan?: number | undefined;
  /** Rank only: the bottom of the fixed scale, 20 by default; a rank beyond it breaks the line. */
  rankDepth?: number | undefined;
  /** `compact` is 64 x 16 px, `default` 64 x 20 px; left out, 20 px as it has been. */
  density?: Density | undefined;
  /**
   * Pixels; 64 unless a board column asks for more (the Citations Trend column: 96, C 536). `fill` (WP-77): the width
   * of its parent, measured, for a sparkline that spans a card (the page drawer's trend, I 166).
   */
  width?: number | 'fill' | undefined;
  /** Pixels; overrides `density` (the page drawer's 56 px trend, I 166). */
  height?: number | undefined;
  /**
   * Draws in the entity's colour, as `EntitySwatch` does: `chart-1` for the own brand, `chart-N` for its color index,
   * `chart-other` past six or without one. Overrides `tone`.
   */
  entity?: { own: boolean; colorIndex: number | null } | undefined;
  /** The dot on the last point; the preview's sparklines have none. Default true. */
  endDot?: boolean | undefined;
  className?: string | undefined;
}

/**
 * A trend sparkline in a table cell (15-data-visualization.md section 9).
 * Draws on a 64 x 16 or 64 x 20 canvas with role="img" and accessible label.
 * An empty sparkline renders a 1 px dashed line across the width.
 */
export function SparklineCell({
  values,
  label,
  kind = 'count',
  tone = 'reference',
  minSpan,
  rankDepth = RANK_DEPTH,
  density,
  width,
  height: heightProp,
  entity,
  endDot = true,
  className,
}: SparklineCellProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const box = useRef<HTMLSpanElement | null>(null);
  const [measured, setMeasured] = useState<number | null>(null);
  useEffect(() => {
    if (width !== 'fill') return undefined;
    const element = box.current;
    if (element === null || typeof ResizeObserver === 'undefined') return undefined;
    // As MetricStrip measures its panel: the canvas is drawn again at each new width
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setMeasured(Math.floor(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [width]);
  const boxWidth = width === 'fill' ? (measured ?? 0) : (width ?? SPARK_WIDTH);
  const height = heightProp ?? (density === 'compact' ? SPARK_HEIGHT_COMPACT : SPARK_HEIGHT);
  const token = entity === undefined ? TONE_TOKEN[tone] : entityToken(entity);

  const geo = useMemo(
    () =>
      kind === 'rank'
        ? sparklineGeometry(values, boxWidth, height, 0, { low: 1, high: rankDepth, invert: true })
        : sparklineGeometry(values, boxWidth, height, minSpan ?? (kind === 'rate' ? RATE_SPAN : 0)),
    [values, kind, minSpan, rankDepth, boxWidth, height],
  );
  const hasSegments = geo.segments.length > 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || !hasSegments) return undefined;

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return undefined;

    const draw = (): void => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const color = readColorToken(token);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      for (const segment of geo.segments) {
        if (segment.length === 0) continue;
        const first = segment[0];
        if (first === undefined) continue;
        if (segment.length === 1) {
          ctx.beginPath();
          ctx.arc(first.x, first.y, 1.5, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.moveTo(first.x, first.y);
          for (let i = 1; i < segment.length; i += 1) {
            const pt = segment[i];
            if (pt !== undefined) ctx.lineTo(pt.x, pt.y);
          }
          ctx.stroke();
        }
      }

      if (endDot && geo.last !== null) {
        ctx.beginPath();
        ctx.arc(geo.last.x, geo.last.y, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    draw();

    const theme = new MutationObserver(() => draw());
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });

    return () => {
      theme.disconnect();
    };
  }, [hasSegments, geo, token, endDot]);

  if (width === 'fill') {
    // The box has its height before the first measure; the line appears once the width is known
    return (
      <span ref={box} role="img" aria-label={label} className={cn('block w-full', className)} style={{ height }}>
        {boxWidth === 0 ? null : hasSegments ? (
          <canvas
            ref={canvasRef}
            aria-hidden="true"
            width={boxWidth * dprOf()}
            height={height * dprOf()}
            style={{ width: boxWidth, height }}
            className="block"
          />
        ) : (
          <span className="flex h-full items-center">
            <span className="w-full border-b border-dashed border-border" />
          </span>
        )}
      </span>
    );
  }

  if (!hasSegments) {
    return (
      <span
        role="img"
        aria-label={label}
        className={cn('inline-flex items-center justify-center', className)}
        style={{ width: boxWidth, height }}
      >
        <span className="w-full border-b border-dashed border-border" />
      </span>
    );
  }

  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  return (
    <canvas
      ref={canvasRef}
      // eslint-disable-next-line jsx-a11y/no-interactive-element-to-noninteractive-role -- A chart canvas presents a graphic
      role="img"
      aria-label={label}
      width={boxWidth * dpr}
      height={height * dpr}
      style={{ width: boxWidth, height }}
      className={cn('block shrink-0', className)}
    />
  );
}
