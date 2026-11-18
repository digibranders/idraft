'use client';

import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import type { ReactElement } from 'react';

import { Icon } from '@/components/ui/icon';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const TAB_STOP = { tabIndex: 0 } as const;

/**
 * Your value against theirs as the trend icon of the Prompts page: green and up when you are ahead, red and down when
 * you are behind, and only when the difference is detectable (`isDetectableDifference`, the test of every change
 * icon). Anything else, a small sample or a difference within normal variation, is a grey dash: the icon never takes
 * a side it cannot back. `sentence` is the hover text and the words a screen reader hears, and says which it is. The
 * icon is a tab stop that opens the sentence.
 */
export function GapIcon({
  difference,
  detectable,
  sentence,
}: {
  difference: number;
  detectable: boolean | null;
  sentence: string;
}): ReactElement {
  const direction = detectable === true && difference !== 0 ? (difference > 0 ? 'up' : 'down') : 'flat';
  return (
    <Tooltip content={sentence}>
      <span
        data-slot="gap-icon"
        data-direction={direction}
        // An icon with a tooltip is a tab stop that opens it (20 section 6.2 rule 6); the lint rule cannot see why
        {...TAB_STOP}
        className={cn(
          'inline-flex shrink-0 self-center rounded-xs outline-none focus-visible:focus-ring',
          direction === 'up'
            ? 'text-positive-text'
            : direction === 'down'
              ? 'text-negative-text'
              : 'text-foreground-secondary',
        )}
      >
        <Icon icon={direction === 'flat' ? Minus : direction === 'up' ? TrendingUp : TrendingDown} size="sm" />
        <span className="sr-only">{sentence}</span>
      </span>
    </Tooltip>
  );
}
