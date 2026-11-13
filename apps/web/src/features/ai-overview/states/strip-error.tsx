'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { InlineError } from '@/components/app/status/inline-error';

export interface StripErrorProps {
  /** The request id of the failed read, for support; `null` when it has none. */
  errorId: string | null;
  onRetry: () => void;
}

/**
 * The strip when the summary could not be read: without it no number can be told from an empty one, so the panel
 * of the strip says so and offers one Retry, and the cards keep their own states. It holds the strip's height at
 * least, so the page below it does not jump when the numbers come back.
 */
export function StripError({ errorId, onRetry }: StripErrorProps): ReactElement {
  const t = useTranslations('aiOverview.numbers');
  const common = useTranslations('common');
  const status = useTranslations('status.error');
  return (
    <div className="min-h-metric-strip rounded-lg border border-border bg-surface">
      <InlineError
        title={t('failedTitle')}
        reason={t('failedReason')}
        errorId={
          errorId === null
            ? null
            : {
                id: errorId,
                label: status('errorId', { id: errorId }),
                copyLabel: status('copyErrorId'),
                copiedLabel: status('copied'),
              }
        }
        onRetry={onRetry}
        retrying={false}
        retryLabel={common('retry')}
      />
    </div>
  );
}
