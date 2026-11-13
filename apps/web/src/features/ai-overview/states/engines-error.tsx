'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { useOverview } from '../overview-context';
import { InlineError } from '@/components/app/status/inline-error';

/**
 * The body when the engines of the project could not be read: without them the page cannot tell an engine that is
 * off from one it has not heard of, so it says so and offers a retry instead of guessing.
 */
export function EnginesError(): ReactElement {
  const t = useTranslations('aiOverview');
  const common = useTranslations('common');
  const status = useTranslations('status.error');
  const { engines } = useOverview();
  const id = engines.errorId;
  return (
    <InlineError
      title={t('enginesFailedTitle')}
      reason={t('enginesFailedReason')}
      errorId={
        id === null
          ? null
          : { id, label: status('errorId', { id }), copyLabel: status('copyErrorId'), copiedLabel: status('copied') }
      }
      onRetry={engines.refetch}
      retrying={false}
      retryLabel={common('retry')}
    />
  );
}
