'use client';

import type { ReactElement } from 'react';

import { useCompare } from './use-compare';
import { Delta } from '@/components/app/metric/delta';
import { deltaInput, type RateChange } from '@/lib/compare/change-model';

export interface ChangeInlineProps {
  /** How the rate moved; `null` where it is not known. */
  change: RateChange | null;
  /** `md` in a strip chip, `sm` in a table cell. */
  size?: 'sm' | 'md';
}

/**
 * The change in points beside a rate (WB-TPS-05, WB-TOP-15), as a `Delta` of the interim test. It colours only when the
 * change's own test says detectable (`Delta` picks the tone, never the sign), and draws nothing while comparison is off
 * or the change is not known: an unknown change is not a zero. The tooltip is the cell's or the chip's, which is the
 * tab stop that holds it, so this one has none.
 *
 * The spoken text of a `Delta` is visually hidden by absolute placement. The box here is its positioned ancestor, so it
 * stays beside the figure and cannot reach out of a scroller that is not positioned itself (a strip chip row) and widen
 * the page.
 */
export function ChangeInline({ change, size = 'md' }: ChangeInlineProps): ReactElement | null {
  const { compare } = useCompare();
  if (!compare || change === null) return null;
  return (
    <span className="relative inline-flex">
      <Delta input={deltaInput(change)} size={size} test="interim" tip={false} />
    </span>
  );
}
