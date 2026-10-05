'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { InlineError } from '@/components/app/status/inline-error';

/** What a region of Costs shows when its own request failed: the rest of the page stays as it is. */
export function CostsError({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }): ReactElement {
  const t = useTranslations('costs');
  const common = useTranslations('common');
  return (
    <InlineError
      title={t('loadFailed')}
      reason={t('loadFailedReason')}
      errorId={null}
      onRetry={onRetry}
      retrying={retrying}
      retryLabel={common('retry')}
    />
  );
}
