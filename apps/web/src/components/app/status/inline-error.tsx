'use client';

import { CircleX } from 'lucide-react';
import type { ReactElement } from 'react';

import { ErrorId } from './error-id';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';

export interface InlineErrorProps {
  /** "Could not load rank history". */
  title: string;
  /** Why, and that nothing else changed: "The server returned an error. Your filters are unchanged." */
  reason: string;
  /** The error id with its words and copy button, or `null` when there is none (a lost connection). */
  errorId: { id: string; label: string; copyLabel: string; copiedLabel: string } | null;
  onRetry: () => void;
  /** While the retry runs; the previous data and the refetch bar stay. */
  retrying: boolean;
  /** "Try again". */
  retryLabel: string;
  /** Announce the failure: when the person is working in the region, not when the page loads with it. */
  live?: boolean | undefined;
}

/**
 * Replaces a section, chart or inspector section that failed to load, keeping its title and height
 * (17-empty-loading-error-states.md section 5.2, 25 section 11.7): 16 px padding, left-aligned, a 16 px
 * `CircleX`, the title and reason, then Retry and the error id.
 */
export function InlineError({
  title,
  reason,
  errorId,
  onRetry,
  retrying,
  retryLabel,
  live = false,
}: InlineErrorProps): ReactElement {
  return (
    <div data-slot="inline-error" role={live ? 'alert' : undefined} className="flex items-start gap-2 p-4">
      <Icon icon={CircleX} className="mt-0.5 shrink-0 text-negative-text" />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="type-body-strong text-foreground">{title}</p>
        <p className="type-body text-foreground-secondary">{reason}</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Button variant="secondary" size="sm" loading={retrying} onClick={onRetry}>
            {retryLabel}
          </Button>
          {errorId === null ? null : <ErrorId {...errorId} />}
        </div>
      </div>
    </div>
  );
}
