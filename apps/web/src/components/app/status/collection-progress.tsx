'use client';

import {
  CalendarClock,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  CircleX,
  LoaderCircle,
  Receipt,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';

import { Icon } from '@/components/ui/icon';
import { announce } from '@/lib/a11y/announcer';
import { cn } from '@/lib/utils';

/** Run statuses of 21-scheduler-workers.md, plus `partial`, a display state (17 section 4.1). */
export type CollectionStatus =
  'queued' | 'running' | 'completed' | 'completed_with_errors' | 'partial' | 'failed' | 'budget_blocked' | 'cancelled';

const LOOK: Readonly<Record<CollectionStatus, { icon: LucideIcon; tone: string }>> = {
  queued: { icon: CalendarClock, tone: cn('text-foreground-tertiary') },
  running: { icon: LoaderCircle, tone: cn('text-primary-text') },
  completed: { icon: CircleCheck, tone: cn('text-positive-text') },
  completed_with_errors: { icon: TriangleAlert, tone: cn('text-warning-text') },
  partial: { icon: CircleDashed, tone: cn('text-warning-text') },
  failed: { icon: CircleX, tone: cn('text-negative-text') },
  budget_blocked: { icon: Receipt, tone: cn('text-warning-text') },
  cancelled: { icon: CircleSlash, tone: cn('text-foreground-tertiary') },
};

export interface CollectionProgressProps {
  /** `compact`: one 20 px line for a meta line. `standard`: title, bar and counts, under a page header. */
  density: 'compact' | 'standard';
  status: CollectionStatus;
  /** Compact: the line, "Running: 412 of 1,000 checks · 3 failed". Standard: the title, "Import running". */
  text: string;
  /** Standard only: the counts the bar draws. */
  counts?: { done: number; failed: number; total: number } | undefined;
  /** Standard only: "409 done · 3 failed · 588 in flight". */
  countsText?: string | undefined;
  /** The bar's value for assistive technology: "412 of 1,000 rows, 3 failed". */
  progressText?: string | undefined;
  /** Standard only, right of the title: "Started 02:00 CEST". */
  meta?: string | undefined;
  /** "View run", or Cancel while the work can still stop. */
  action?: ReactNode;
}

const share = (part: number, total: number): string =>
  `${String(total <= 0 ? 0 : Math.min(100, (part / total) * 100))}%`;

/**
 * Background work in progress or finished (17-empty-loading-error-states.md section 4): a scheduled run, a
 * refresh, an import. The status picks the icon and its colour; the copy is the caller's, already
 * formatted. Starting and finishing are announced, not every count in between.
 */
export function CollectionProgress({
  density,
  status,
  text,
  counts,
  countsText,
  progressText,
  meta,
  action,
}: CollectionProgressProps): ReactElement {
  const { icon, tone } = LOOK[status];
  const spoken = useRef(status);
  useEffect(() => {
    if (spoken.current === status) return;
    spoken.current = status;
    announce(text);
  }, [status, text]);
  const glyph = (
    <Icon icon={icon} size="sm" className={cn('shrink-0', tone, status === 'running' && 'motion-safe:animate-spin')} />
  );

  if (density === 'compact') {
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5 type-meta">
        {glyph}
        <span className="truncate">{text}</span>
        {action === undefined || action === null ? null : <span className="shrink-0">{action}</span>}
      </span>
    );
  }
  const failed = counts === undefined ? 0 : Math.min(counts.failed, counts.done);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface px-4 py-3">
      <div className="flex items-center gap-2">
        {glyph}
        <p className="min-w-0 flex-1 truncate type-body-strong">{text}</p>
        {meta === undefined ? null : <p className="shrink-0 type-meta">{meta}</p>}
      </div>
      {counts === undefined ? null : (
        <div
          role="progressbar"
          aria-label={text}
          aria-valuemin={0}
          aria-valuemax={counts.total}
          aria-valuenow={counts.done}
          aria-valuetext={progressText}
          className="flex h-1 overflow-hidden rounded-sm bg-surface-subtle"
        >
          <span className="h-full bg-primary" style={{ width: share(counts.done - failed, counts.total) }} />
          <span className="h-full bg-negative-solid" style={{ width: share(failed, counts.total) }} />
        </div>
      )}
      {countsText === undefined && (action === undefined || action === null) ? null : (
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate num type-meta">{countsText}</p>
          {action}
        </div>
      )}
    </div>
  );
}
