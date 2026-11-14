'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { DEFAULT_MIN_SUPPORT, type ChangeKind } from '../citation-scope';
import { Banner } from '@/components/app/status/banner';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { Button } from '@/components/ui/button';
import type { ErrorIdWords } from '@/lib/api/use-error-id';

/** What the New and lost list says when it has no rows, cannot be read, or cannot count the other kind. */

/** The list of a kind could not be read, and there is nothing to show: Retry asks again, the error id is there to quote. */
export function ChangeFailed({
  kind,
  errorId,
  onRetry,
  retrying,
}: {
  kind: ChangeKind;
  /** `null` when there is none, such as a lost connection. */
  errorId: ErrorIdWords | null;
  onRetry: () => void;
  retrying: boolean;
}): ReactElement {
  const t = useTranslations('citations');
  const common = useTranslations('common');
  return (
    <InlineError
      title={t('newLost.failed', { kind })}
      reason={t('empty.failedReason')}
      errorId={errorId}
      onRetry={onRetry}
      retrying={retrying}
      retryLabel={common('retry')}
      live
    />
  );
}

/** The kind that is not shown could not be counted: its segment says n/a, and this says why, with Retry. */
export function CountFailed({
  kind,
  onRetry,
  retrying,
}: {
  kind: ChangeKind;
  onRetry: () => void;
  retrying: boolean;
}): ReactElement {
  const t = useTranslations('citations.newLost');
  const common = useTranslations('common');
  return (
    <Banner
      tone="warning"
      placement="region"
      live
      message={t('countFailed', { kind })}
      actions={
        <Button variant="secondary" size="sm" loading={retrying} onClick={onRetry}>
          {common('retry')}
        </Button>
      }
    />
  );
}

export interface ChangeEmptyProps {
  kind: ChangeKind;
  /** The fewest units a source needs to be listed. */
  minSupport: number;
  /** The days a source must have been absent (New) or the days of answers a lost read needs (Lost). */
  days: number;
  /** The previous period has no answers, which is the whole reason nothing is listed. */
  noPrevious: boolean;
  /** Puts the default minimum back; offered only while the minimum is above it. */
  onResetMinimum: () => void;
}

/**
 * No source is new, or none is lost: the reason names the minimum and the days it stands on, or the missing period.
 * A raised minimum can be what left no row, so it comes with the one button that puts it back.
 */
export function ChangeEmpty({ kind, minSupport, days, noPrevious, onResetMinimum }: ChangeEmptyProps): ReactElement {
  const t = useTranslations('citations.newLost');
  const title = kind === 'new' ? t('emptyNewTitle') : t('emptyLostTitle');
  if (noPrevious) {
    return (
      <EmptyState title={title} reason={kind === 'new' ? t('noPrevious') : t('noPreviousLost')} headingLevel={2} />
    );
  }
  return (
    <EmptyState
      title={title}
      reason={kind === 'new' ? t('emptyNewReason', { min: minSupport, days }) : t('emptyLostReason', { days })}
      primaryAction={
        minSupport > DEFAULT_MIN_SUPPORT ? (
          <Button variant="secondary" onClick={onResetMinimum}>
            {t('resetMinimum', { min: DEFAULT_MIN_SUPPORT })}
          </Button>
        ) : undefined
      }
      headingLevel={2}
    />
  );
}
