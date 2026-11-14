import type { ReactElement } from 'react';

import type { BudgetStatus } from '@/lib/api/types';
import { formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface MeterProps {
  /** The measure so far; it may exceed `max`, and the fill then stops at the track end. */
  value: number;
  /** The extent of the track. It must be positive. */
  max: number;
  /** In the value's unit: the fill turns warning from here. Null or absent: muted until the value passes `max`. */
  warnFrom?: number | null | undefined;
  /** The hard limit was reached: the whole fill is warning. */
  allWarning?: boolean | undefined;
  /** The soft limit marker, in the value's unit. */
  tick?: number | null | undefined;
  /** The accessible name: "Active prompts". */
  label: string;
  /** The real share in words, for the cases the clamped value cannot say: "168 of 150 active prompts". */
  valueText: string;
  /** 160 px wide in a summary, 64 px in a table cell. */
  width: 'summary' | 'cell';
}

/** A percentage kept between 0 and 100 for a width or a position; a value that is not a number counts as 0. */
const within = (percent: number): number => Math.min(100, Math.max(0, Number.isFinite(percent) ? percent : 0));

/**
 * The meter of 23-application-patterns.md section 11.2: a 6 px bar with a 1 px outline for a track (so 100%
 * has a place), a fill that stays muted up to `warnFrom` and turns warning from there, the whole fill warning
 * with `allWarning`, and a tick for the soft limit. The caller shows the number as text next to it; the meter
 * never carries it alone. Cost and quota are never coloured negative, so there is no red here.
 */
export function Meter({ value, max, warnFrom, allWarning, tick, label, valueText, width }: MeterProps): ReactElement {
  if (!(Number.isFinite(max) && max > 0)) throw new Error(`Meter: max must be a positive number, got ${String(max)}`);
  const toPercent = (amount: number): number => within((amount * 100) / max);
  const used = toPercent(value);
  const warnAt = warnFrom == null ? 100 : toPercent(warnFrom);
  // A warning start at the track end has no room inside the track: passing it turns the whole fill
  const wholly = allWarning === true || (value > max && warnAt >= 100);
  const mutedEnd = wholly ? 0 : Math.min(used, warnAt);
  const warningStart = wholly ? 0 : warnAt;
  const warningEnd = wholly ? used : Math.max(used, warningStart);
  return (
    <div
      role="meter"
      aria-valuenow={used}
      aria-valuetext={valueText}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn('relative h-1.5 shrink-0', width === 'summary' ? 'w-40' : 'w-16')}
    >
      <div className="absolute inset-0 overflow-hidden rounded-sm border border-border-strong">
        <span className="absolute inset-y-0 left-0 bg-foreground-muted" style={{ width: `${String(mutedEnd)}%` }} />
        <span
          className="absolute inset-y-0 bg-warning-solid"
          style={{ left: `${String(warningStart)}%`, width: `${String(warningEnd - warningStart)}%` }}
        />
      </div>
      {tick == null ? null : (
        <span
          aria-hidden="true"
          className="absolute -top-0.5 h-2.5 w-0.5 bg-foreground-secondary"
          style={{ left: `${String(toPercent(tick))}%` }}
        />
      )}
    </div>
  );
}

export interface BudgetMeterProps {
  /** Share of the limit already used, as the API counts it; it may pass 100. */
  pct: number;
  /** Where the soft limit sits, in percent of the limit. */
  softLimitPct: number;
  state: BudgetStatus['state'];
  /** 160 px wide in the summary, 64 px in a table cell. */
  size: 'summary' | 'cell';
  /** The accessible name, with the real share: "64% of $2,000.00". */
  label: string;
}

/** The budget meter of section 11.2: `Meter` on a 0 to 100 scale, warning from the soft limit, wholly at the hard one. */
export function BudgetMeter({ pct, softLimitPct, state, size, label }: BudgetMeterProps): ReactElement {
  return (
    <Meter
      value={pct}
      max={100}
      warnFrom={softLimitPct}
      allWarning={state === 'hard_exceeded'}
      tick={softLimitPct}
      label={label}
      // The value stops at the track's end, so the real share is said in words
      valueText={formatPercent(Number.isFinite(pct) ? pct / 100 : 0, { decimals: 1 })}
      width={size}
    />
  );
}
