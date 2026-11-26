'use client';

import type { ReactElement } from 'react';

import { Tooltip } from '@/components/ui/tooltip';
import type { ChangeTone } from '@/lib/format';
import { cn } from '@/lib/utils';

const TONE = {
  positive: cn('text-positive-text'),
  negative: cn('text-negative-text'),
  neutral: cn('text-foreground-secondary'),
} as const satisfies Record<ChangeTone, string>;

/** The tooltip of a part of a cell is a tab stop that opens it (20 section 6.2 rule 6). */
const TAB_STOP = { tabIndex: 0 } as const;
const TIPPED = 'rounded-xs outline-none focus-visible:focus-ring-inset';

export interface MetricChange {
  /** Already formatted ("+135", "-25.5%", "slipped 2.5"). */
  text: string;
  /** From the delta formatters, never chosen by hand. */
  tone: ChangeTone;
  /** What the change is against ("1,105 queries in the period before"). */
  tip?: string | undefined;
}

export interface MetricValueCellProps {
  /** The value as the app formats it. */
  value: string;
  /** A tooltip on the value itself (a capped count says Google's limit was reached). */
  valueTip?: string | undefined;
  change: MetricChange | null;
}

/**
 * The value and its change side by side, one composition for Clicks, Impressions, CTR, Average position and Queries.
 * The change is set in the smaller `type-meta` step so the two are easy to tell apart (owner, 2026-11-26).
 */
export function MetricValueCell({ value, valueTip, change }: MetricValueCellProps): ReactElement {
  return (
    <span className="flex min-w-0 items-baseline gap-1.5">
      {valueTip === undefined ? (
        <span className="num">{value}</span>
      ) : (
        <Tooltip content={valueTip}>
          <span {...TAB_STOP} className={cn('num', TIPPED)}>
            {value}
          </span>
        </Tooltip>
      )}
      {change === null ? null : (
        <Tooltip content={change.tip ?? ''} disabled={change.tip === undefined}>
          <span
            {...(change.tip === undefined ? {} : TAB_STOP)}
            className={cn('num type-meta', TONE[change.tone], change.tip !== undefined && TIPPED)}
          >
            {change.text}
          </span>
        </Tooltip>
      )}
    </span>
  );
}
