'use client';

import type { ReactElement, ReactNode } from 'react';

import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface TippedChangeProps {
  /** What the tooltip says; empty draws no tooltip and no tab stop. */
  tip: string;
  className?: string | undefined;
  children: ReactNode;
}

/**
 * The tab stop that holds the tooltip of a change where nothing else does: a card of the topic drawer and the meta line
 * of a prompt have no cell or strip item to carry it, and a tooltip on an element nothing focuses reaches no keyboard
 * user (20 section 6.2 rule 6, as `Delta` says). Wrap the value and its `ChangeInline`; the tip is read as the
 * description of the focused box.
 */
export function TippedChange({ tip, className, children }: TippedChangeProps): ReactElement {
  const tipped = tip !== '';
  return (
    <Tooltip content={tip} disabled={!tipped}>
      <span
        // A box with a tooltip is a tab stop that opens it; the lint rule cannot see why
        {...(tipped ? { tabIndex: 0 } : {})}
        className={cn('inline-flex', className, tipped && 'rounded-xs outline-none focus-visible:focus-ring')}
      >
        {children}
      </span>
    </Tooltip>
  );
}
