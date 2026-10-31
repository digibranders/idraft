'use client';

import { useEffect, useRef, type ReactElement } from 'react';

import type { SparklinePoint } from '@/lib/api/types';
import { SPARK_HEIGHT, SPARK_WIDTH, sparklineGeometry } from '@/lib/charts/sparkline';
import { readColorToken } from '@/lib/design/read-tokens';
import { cn } from '@/lib/utils';

export interface SparklineCellProps {
  points: readonly SparklinePoint[];
  label: string;
  className?: string | undefined;
}

/**
 * A rank trend sparkline in a table cell (15-data-visualization.md section 9).
 * Draws on a 64 x 20 canvas with role="img" and accessible label.
 * An empty sparkline renders a 1 px dashed line across the width.
 */
export function SparklineCell({ points, label, className }: SparklineCellProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const geo = sparklineGeometry(points, SPARK_WIDTH, SPARK_HEIGHT);
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

      const color = readColorToken('--chart-reference');
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
  }, [hasSegments, geo]);

  if (!hasSegments) {
    return (
      <span
        role="img"
        aria-label={label}
        className={cn('inline-flex items-center justify-center', className)}
        style={{ width: SPARK_WIDTH, height: SPARK_HEIGHT }}
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
      height={SPARK_HEIGHT * dpr}
      style={{ width: SPARK_WIDTH, height: SPARK_HEIGHT }}
      className={cn('block shrink-0', className)}
    />
  );
}
