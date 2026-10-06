'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { InlineError } from '@/components/app/status/inline-error';
import { useErrorId } from '@/lib/api/use-error-id';

/**
 * What a region of Costs shows when its own request failed: the rest of the page stays as it is. The failure
 * is announced, since it often follows a change of month or filter made in the page.
 */
export function CostsError({
  error,
  onRetry,
  retrying,
}: {
  error: unknown;
  onRetry: () => void;
  retrying: boolean;
}): ReactElement {
  const t = useTranslations('costs');
  const common = useTranslations('common');
  const errorId = useErrorId(error);
  return (
    <InlineError
      title={t('loadFailed')}
      reason={t('loadFailedReason')}
      errorId={errorId}
      onRetry={onRetry}
      retrying={retrying}
      retryLabel={common('retry')}
      live
    />
  );
}
