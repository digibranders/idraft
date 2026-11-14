'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';

import { EmptyState } from '@/components/app/status/empty-state';
import { Button } from '@/components/ui/button';

export interface DetectableEmptyProps {
  /** The comparison is on. Off, no row can have a change, and the state says so. */
  compare: boolean;
  /** How many rows had a change to read at all. */
  compared: number;
  /** The valid answers of the previous period (`previous_answers`); `null` when the response does not say. */
  previousAnswers: number | null;
  /** The filters that narrowed the rows, as read-only chips. */
  details?: ReactNode;
  /** Turns the comparison on. */
  onTurnOn: () => void;
  onClear: () => void;
}

/**
 * What "Detectable changes only" leaves when it leaves no row (WB-TPF-07): the reason, and the action that changes it.
 * Never blank and never a failure: with comparison off the change cannot be told, and with it on the rows may all be
 * within normal variation, have too few answers in a period, or the previous period may have no answers at all.
 */
export function DetectableEmpty({
  compare,
  compared,
  previousAnswers,
  details,
  onTurnOn,
  onClear,
}: DetectableEmptyProps): ReactElement {
  const t = useTranslations('prompts.compare.empty');
  const root = useTranslations('prompts');
  const reason = !compare
    ? t('offReason')
    : compared > 0
      ? t('noneReason', { count: compared })
      : previousAnswers === 0
        ? t('noPreviousReason')
        : t('tooFewReason');
  return (
    <EmptyState
      title={compare ? t('noneTitle') : t('offTitle')}
      reason={reason}
      headingLevel={2}
      details={details}
      primaryAction={
        compare ? (
          <Button variant="secondary" onClick={onClear}>
            {root('clearFilters')}
          </Button>
        ) : (
          <Button variant="secondary" onClick={onTurnOn}>
            {t('turnOn')}
          </Button>
        )
      }
      secondaryAction={
        compare ? undefined : (
          <Button variant="link" onClick={onClear}>
            {root('clearFilters')}
          </Button>
        )
      }
    />
  );
}
