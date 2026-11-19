'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';

import { useCompetitors } from '../competitors-context';
import { NoCompetitor, ReadFailed } from '../competitors-states';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * What the Comparison and AI tabs show until the tracked set (R1) says there is something to compare: a skeleton while
 * it loads, the failure with Retry (the header and the tabs stay), or the real zero when no competitor is tracked.
 * Every other state, a tab's own, is its children's.
 */
export function TrackedSetGate({ children }: { children: ReactNode }): ReactElement {
  const t = useTranslations('competitors.states');
  const { reads, addCompetitor } = useCompetitors();
  const set = reads.competitors;
  if (set.status === 'error') {
    return (
      <ReadFailed
        title={t('readFailedTitle')}
        reason={t('readFailedReason')}
        errorId={set.errorId}
        onRetry={set.refetch}
      />
    );
  }
  if (set.data === undefined) {
    return (
      <div aria-busy="true" data-testid="tracked-set-skeleton" className="flex flex-col gap-3">
        <Skeleton shape="block" height="chart-140" />
        <Skeleton shape="block" height="chart-180" />
      </div>
    );
  }
  if (!set.data.data.some((row) => row.entity.role === 'competitor')) return <NoCompetitor onAdd={addCompetitor} />;
  return <>{children}</>;
}
