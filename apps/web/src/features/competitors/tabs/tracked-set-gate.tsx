'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';

import { useCompetitors } from '../competitors-context';
import { NoCompetitor, ReadFailed } from '../competitors-states';

/**
 * Holds the tabs of the AI answers back until the tracked set has a competitor: a failed read says so with Retry,
 * a set with the own brand alone gets the empty state with Add competitor. Loading and ready draw the children.
 */
export function TrackedSetGate({ children }: { children: ReactNode }): ReactElement {
  const t = useTranslations('competitors.states');
  const { reads, addCompetitor } = useCompetitors();
  const { competitors } = reads;
  if (competitors.status === 'error') {
    return (
      <ReadFailed
        title={t('readFailedTitle')}
        reason={t('readFailedReason')}
        errorId={competitors.errorId}
        onRetry={competitors.refetch}
      />
    );
  }
  const data = competitors.data;
  if (data !== undefined && !data.data.some((row) => row.entity.role === 'competitor')) {
    return <NoCompetitor onAdd={addCompetitor} />;
  }
  return <>{children}</>;
}
