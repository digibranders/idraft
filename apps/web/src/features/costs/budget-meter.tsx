import type { ReactElement } from 'react';

import type { BudgetStatus } from '@/lib/api/types';
import { formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';

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

/** A percentage kept between 0 and 100 for a width or a position. */
const within = (value: number): number => Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));

/**
 * The budget meter of 23-application-patterns.md section 11.2: a 6 px bar with a 1 px outline for a track
 * (so 100% has a place), a fill that stays neutral up to the soft limit and turns warning from there, the
 * whole fill warning once the hard limit is reached, and a tick at the soft limit. The text next to it
 * carries the number; the fill stops at the track end whatever the share.
 */
export function BudgetMeter({ pct, softLimitPct, state, size, label }: BudgetMeterProps): ReactElement {
  const used = within(pct);
  const soft = within(softLimitPct);
  const hard = state === 'hard_exceeded';
  const neutralEnd = hard ? 0 : Math.min(used, soft);
  const warningStart = hard ? 0 : soft;
  const warningEnd = hard ? used : used > soft ? used : warningStart;
  return (
    <div
      role="meter"
      aria-valuenow={used}
      // The value stops at the track's end, so the real share is said in words
      aria-valuetext={formatPercent(Number.isFinite(pct) ? pct / 100 : 0, { decimals: 1 })}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn('relative h-1.5 shrink-0', size === 'summary' ? 'w-40' : 'w-16')}
    >
      <div className="absolute inset-0 overflow-hidden rounded-sm border border-border-strong">
        <span className="absolute inset-y-0 left-0 bg-foreground-muted" style={{ width: `${String(neutralEnd)}%` }} />
        <span
          className="absolute inset-y-0 bg-warning-solid"
          style={{ left: `${String(warningStart)}%`, width: `${String(warningEnd - warningStart)}%` }}
        />
      </div>
      <span
        aria-hidden="true"
        className="absolute -top-0.5 h-2.5 w-0.5 bg-foreground-secondary"
        style={{ left: `${String(soft)}%` }}
      />
    </div>
  );
}
