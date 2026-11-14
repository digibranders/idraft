'use client';

import type { Route } from 'next';
import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';

import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface StatChipProps {
  id?: string;
  /** Short label for the metric: "Keywords", "Top 3", "Mentions". */
  label: string;
  /** Formatted metric value: "55", "82%", "n/a". */
  value: string | number;
  /** Optional secondary context: "avg", "of 134". */
  secondaryText?: string;
  /** Delta indicator: "+3.1 pts", "↑2". */
  delta?: ReactNode;
  /** Counts or sample size behind the value for tooltip and accessibility description. */
  tooltip?: string;
  /** Where the chip links to, if applicable. */
  href?: Route | string;
  /** Muted styling for missing or insufficient data; never zero. */
  unknown?: boolean | 'insufficient' | 'not-applicable' | 'pending';
  className?: string;
}

/**
 * Compact stat chip for page toolbars (04-spacing-density.md, 23-application-patterns.md section 2.8).
 * Displays a small label and bold value inline with optional delta and tooltip for counts.
 */
export function StatChip({
  label,
  value,
  secondaryText,
  delta,
  tooltip,
  href,
  unknown = false,
  className,
}: StatChipProps): ReactElement {
  const isUnknown = Boolean(unknown);
  const tipped = Boolean(tooltip);

  const valueContent = (
    <span
      className={cn(
        'num type-body-strong',
        isUnknown ? 'text-foreground-tertiary' : 'text-foreground',
        unknown === 'insufficient' && 'bg-insufficient',
      )}
    >
      {value}
    </span>
  );

  const ddContent = (
    <dd
      {...(tipped ? { tabIndex: 0, 'aria-label': `${label}: ${String(value)}` } : {})}
      className={cn(
        'flex items-baseline gap-1.5',
        tipped && '-mx-1 rounded-sm px-1 outline-none focus-visible:focus-ring-inset',
      )}
    >
      {valueContent}
      {delta !== undefined && delta !== null ? <span className="num type-body-strong">{delta}</span> : null}
      {secondaryText !== undefined && secondaryText !== null ? (
        <span className="type-meta text-foreground-tertiary">{secondaryText}</span>
      ) : null}
    </dd>
  );

  const wrappedDd = tipped ? <Tooltip content={tooltip ?? ''}>{ddContent}</Tooltip> : ddContent;

  const body = (
    <dl className={cn('flex min-w-0 shrink-0 items-baseline gap-1.5', className)}>
      <dt className="type-meta text-foreground-tertiary">{label}</dt>
      {wrappedDd}
    </dl>
  );

  if (href !== undefined) {
    return (
      <Link href={href as Route} className="rounded-sm outline-none hover:opacity-80 focus-visible:focus-ring">
        {body}
      </Link>
    );
  }

  return body;
}
