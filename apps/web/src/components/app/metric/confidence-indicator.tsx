import type { ReactElement } from 'react';

import { EMPTY_VALUE, formatInterval } from '@/lib/format';

export interface ConfidenceIndicatorProps {
  /** A ratio from 0 to 1. */
  estimate: number | null;
  low: number | null;
  high: number | null;
  decimals?: 0 | 1 | undefined;
  form: 'text' | 'text-and-bar' | 'bar';
  /** The top of the scale the bar is drawn on, a ratio; shared by the rows that are compared. Default 1 (100 percent). */
  scaleMax?: number | undefined;
  /** The name for assistive technology: "95% interval 31% to 37%". */
  label: string;
}

/** A position on the bar in percent of its width, kept inside the axis. */
const place = (ratio: number, scaleMax: number): number => Math.min(100, Math.max(0, (ratio / scaleMax) * 100));

/**
 * The 95 percent interval of a rate (23-application-patterns.md section 8.2): its text ("29% to 39%") and a 48 x 12 px
 * bar with a 1 px axis, the interval as a 2 px segment and a 6 px point at the estimate. The bar has no filled track,
 * which would add a gray block to every row and compete with the interval. Insufficient data is not drawn here: the
 * caller says so in its place.
 */
export function ConfidenceIndicator({
  estimate,
  low,
  high,
  decimals = 0,
  form,
  scaleMax = 1,
  label,
}: ConfidenceIndicatorProps): ReactElement {
  if (estimate === null || low === null || high === null) {
    return <span className="type-meta text-foreground-tertiary">{EMPTY_VALUE}</span>;
  }
  return (
    <span role="img" aria-label={label} className="inline-flex items-center gap-2">
      {form === 'text' ? null : (
        <span data-slot="confidence-bar" aria-hidden="true" className="relative h-3 w-12 shrink-0">
          <span className="absolute inset-x-0 top-1/2 h-px bg-border-strong" />
          <span
            className="absolute top-1/2 h-0.5 -translate-y-1/2 bg-foreground-secondary"
            style={{
              left: `${String(place(low, scaleMax))}%`,
              width: `${String(place(high, scaleMax) - place(low, scaleMax))}%`,
            }}
          />
          <span
            className="absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground"
            style={{ left: `${String(place(estimate, scaleMax))}%` }}
          />
        </span>
      )}
      {form === 'bar' ? null : (
        <span className="num type-meta whitespace-nowrap">{formatInterval(low, high, decimals)}</span>
      )}
    </span>
  );
}
