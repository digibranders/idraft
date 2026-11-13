'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';

import { EmptyState } from '@/components/app/status/empty-state';
import { Button } from '@/components/ui/button';

export interface DetectableEmptyProps {
  /** The comparison is on. Off, no row can have a change, and the state says so. */
  compare: boolean;
  /** How many rows had a change to read at all; 0 means the previous period had nothing to compare with. */
  compared: number;
  /** The filters that narrowed the rows, as read-only chips. */
  details?: ReactNode;
  /** Turns the comparison on. */
  onTurnOn: () => void;
  onClear: () => void;
}

/**
 * What "Detectable changes only" leaves when it leaves no row (WB-TPF-07): the reason, and the action that changes it.
 * Never blank and never a failure: with comparison off the change cannot be told, and with it on the rows may all be
 * within normal variation.
 */
export function DetectableEmpty({ compare, compared, details, onTurnOn, onClear }: DetectableEmptyProps): ReactElement {
  const t = useTranslations('prompts.compare.empty');
  const root = useTranslations('prompts');
  const clear = (
    <Button variant="link" onClick={onClear}>
      {root('clearFilters')}
    </Button>
  );
  return (
    <EmptyState
      title={compare ? t('noneTitle') : t('offTitle')}
      reason={!compare ? t('offReason') : compared === 0 ? t('noPreviousReason') : t('noneReason', { count: compared })}
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
      secondaryAction={compare ? undefined : clear}
    />
  );
}
