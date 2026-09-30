'use client';

import { CircleX } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';

import { ErrorId } from './error-id';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';

export interface ErrorPageProps {
  title: string;
  reason: string;
  /** "Try again": the error boundary's `reset`. */
  retry: { label: string; onRetry: () => void };
  /** A text link out of the page, such as the project's Settings. */
  way?: ReactNode | undefined;
  errorId: { id: string; label: string; copyLabel: string; copiedLabel: string } | null;
}

/**
 * The content of a route's `error.tsx` inside the shell (17-empty-loading-error-states.md section 5.8, 25
 * section 11.9): the `EmptyState` layout with a 20 px `CircleX`, "Try again", a way out, and the error id.
 * 404 is `not-found.tsx`; 401 never renders a page error, it goes to sign in.
 */
export function ErrorPage({ title, reason, retry, way, errorId }: ErrorPageProps): ReactElement {
  return (
    <div data-slot="error-page" className="mx-auto flex max-w-dialog-sm flex-col items-center p-8 text-center">
      <Icon icon={CircleX} size="lg" className="mb-3 text-negative-text" />
      <h1 tabIndex={-1} className="type-subsection-title text-foreground outline-none">
        {title}
      </h1>
      <p className="mt-1 type-body text-foreground-secondary">{reason}</p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
        <Button variant="primary" onClick={retry.onRetry}>
          {retry.label}
        </Button>
        {way}
      </div>
      {errorId === null ? null : (
        <div className="mt-4">
          <ErrorId {...errorId} />
        </div>
      )}
    </div>
  );
}
