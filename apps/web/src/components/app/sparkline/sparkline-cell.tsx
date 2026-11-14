'use client';

import { useEffect, useMemo, useRef, type ReactElement } from 'react';

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

/** The bottom of the rank scale unless a table says otherwise. */
const RANK_DEPTH = 20;

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
  className,
}: SparklineCellProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const height = density === 'compact' ? SPARK_HEIGHT_COMPACT : SPARK_HEIGHT;

  const geo = useMemo(
    () =>
      kind === 'rank'
        ? sparklineGeometry(values, SPARK_WIDTH, height, 0, { low: 1, high: rankDepth, invert: true })
        : sparklineGeometry(values, SPARK_WIDTH, height, minSpan ?? (kind === 'rate' ? RATE_SPAN : 0)),
    [values, kind, minSpan, rankDepth, height],
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

      const color = readColorToken(TONE_TOKEN[tone]);
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

      if (geo.last !== null) {
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
  }, [hasSegments, geo, tone]);

  if (!hasSegments) {
    return (
      <span
        role="img"
        aria-label={label}
        className={cn('inline-flex items-center justify-center', className)}
        style={{ width: SPARK_WIDTH, height }}
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
      width={SPARK_WIDTH * dpr}
      height={height * dpr}
      style={{ width: SPARK_WIDTH, height }}
      className={cn('block shrink-0', className)}
    />
  );
}
