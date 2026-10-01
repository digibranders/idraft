'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { InlineError } from '@/components/app/status/inline-error';
import { isApiProblem } from '@/lib/api/problem';

export interface SectionErrorProps {
  /** What did not load: "The monthly volumes did not load". */
  title: string;
  error: unknown;
  onRetry: () => void;
  retrying: boolean;
}

/** A section of the inspector that failed: its own error and Retry, so the other sections stay (16 section 2.4). */
export function SectionError({ title, error, onRetry, retrying }: SectionErrorProps): ReactElement {
  const errors = useTranslations('status.error');
  const common = useTranslations('common');
  const t = useTranslations('rankings.inspector');
  const errorId = isApiProblem(error) ? error.requestId : null;
  return (
    <InlineError
      title={title}
      reason={t('sectionErrorReason')}
      errorId={
        errorId === null
          ? null
          : {
              id: errorId,
              label: errors('errorId', { id: errorId }),
              copyLabel: errors('copyErrorId'),
              copiedLabel: errors('copied'),
            }
      }
      onRetry={onRetry}
      retrying={retrying}
      retryLabel={common('retry')}
    />
  );
}
