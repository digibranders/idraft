import type { ReactElement } from 'react';

import { formatInteger } from '@/lib/format';
import { cn } from '@/lib/utils';

const TONE = {
  negative: 'bg-negative-subtle text-negative-text',
  neutral: 'bg-surface-subtle text-foreground-secondary',
} as const;

/**
 * The count on a tab. The visible number is for sighted people (`aria-hidden`); the same words follow as hidden
 * text, so the tab is named "Changes, 3 alerts" (mock `tabs`).
 */
export function TabBadge({
  count,
  text,
  tone,
}: {
  count: number;
  /** The count in words, such as "3 alerts" or "12 open". */
  text: string;
  tone: keyof typeof TONE;
}): ReactElement {
  return (
    <>
      <span
        aria-hidden="true"
        className={cn(
          'inline-flex h-badge min-w-5 items-center justify-center rounded-sm px-1 num type-label',
          TONE[tone],
        )}
      >
        {formatInteger(count)}
      </span>
      <span className="sr-only">{`, ${text}`}</span>
    </>
  );
}
