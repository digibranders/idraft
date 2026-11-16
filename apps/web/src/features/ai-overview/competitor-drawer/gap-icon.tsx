'use client';

import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import type { ReactElement } from 'react';

import { Icon } from '@/components/ui/icon';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/** Two rates on the 0 to 1 scale that differ by less than this are level. */
const LEVEL = 0.0005;
const TAB_STOP = { tabIndex: 0 } as const;

export const isLevel = (difference: number): boolean => Math.abs(difference) < LEVEL;

/**
 * Your value against theirs as the trend icon of the Prompts page (the served preview's `gapIcon`): green and up when you
 * are ahead, red and down when you are behind, a grey dash when level. It is a difference between two things, not a
 * change over time, and is never tested for detectability, so `sentence` says that; it is the hover text and the words a
 * screen reader hears. The icon is a tab stop that opens the sentence.
 */
export function GapIcon({ difference, sentence }: { difference: number; sentence: string }): ReactElement {
  const level = isLevel(difference);
  return (
    <Tooltip content={sentence}>
      <span
        data-slot="gap-icon"
        data-direction={level ? 'flat' : difference > 0 ? 'up' : 'down'}
        // An icon with a tooltip is a tab stop that opens it (20 section 6.2 rule 6); the lint rule cannot see why
        {...TAB_STOP}
        className={cn(
          'inline-flex shrink-0 self-center rounded-xs outline-none focus-visible:focus-ring',
          level ? 'text-foreground-secondary' : difference > 0 ? 'text-positive-text' : 'text-negative-text',
        )}
      >
        <Icon icon={level ? Minus : difference > 0 ? TrendingUp : TrendingDown} size="sm" />
        <span className="sr-only">{sentence}</span>
      </span>
    </Tooltip>
  );
}
