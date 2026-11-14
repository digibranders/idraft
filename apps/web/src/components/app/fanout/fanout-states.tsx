'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { Button } from '@/components/ui/button';
import type { ErrorIdWords } from '@/lib/api/use-error-id';
import { formatList } from '@/lib/format';

/**
 * What the fan-out surfaces say instead of a list: the engines show no queries, a scope has none, a read failed. Each
 * is one state, and carries its words and its callbacks: nothing here fetches.
 */

export interface NotExposedStateProps {
  /** The labels of the engines chosen that do not show their queries. */
  engines: readonly string[];
  /** Puts every engine back; left out when there is no narrower choice to undo. */
  onShowAll?: (() => void) | undefined;
}

/**
 * No engine in scope shows the queries it issues, so there is nothing to read. It is not an empty list and not a
 * zero: an engine that does not expose its queries is not an engine that issued none.
 */
export function NotExposedState({ engines, onShowAll }: NotExposedStateProps): ReactElement {
  const t = useTranslations('fanout');
  return (
    <EmptyState
      variant="region"
      title={t('notExposedTitle', { engines: formatList(engines) })}
      reason={t('notExposedReason', { count: engines.length })}
      primaryAction={
        onShowAll === undefined ? undefined : (
          <Button variant="secondary" onClick={onShowAll}>
            {t('notExposedAction')}
          </Button>
        )
      }
      headingLevel={2}
    />
  );
}

export type FanoutEmptyProps =
  /** No answer of the engine was read in the window. */
  | { kind: 'noAnswers'; engine: string }
  /** Answers were read and none issued a query. */
  | { kind: 'none'; engine: string; answers: number }
  /** Queries exist, and the minimum left none of them: the one action lists every query. */
  | { kind: 'underMin'; minSupport: number; onShowEvery: () => void };

/** A list with no row, with the reason that is true: no answer, no query, or the minimum. */
export function FanoutEmpty(props: FanoutEmptyProps): ReactElement {
  const t = useTranslations('fanout');
  switch (props.kind) {
    case 'noAnswers':
      return (
        <EmptyState
          title={t('emptyNoAnswersTitle', { engine: props.engine })}
          reason={t('emptyNoAnswersReason')}
          headingLevel={2}
        />
      );
    case 'none':
      return (
        <EmptyState
          title={t('emptyNoneTitle')}
          reason={t('emptyNoneReason', { answers: props.answers, engine: props.engine })}
          headingLevel={2}
        />
      );
    case 'underMin':
      return (
        <EmptyState
          title={t('emptyUnderMinTitle', { min: props.minSupport })}
          reason={t('emptyUnderMinReason')}
          primaryAction={
            <Button variant="secondary" onClick={props.onShowEvery}>
              {t('showEvery')}
            </Button>
          }
          headingLevel={2}
        />
      );
  }
}

/** The queries could not be read, and there is nothing to show: Retry asks again, the error id is there to quote. */
export function FanoutFailed({
  errorId,
  onRetry,
  retrying,
}: {
  /** `null` when there is none, such as a lost connection. */
  errorId: ErrorIdWords | null;
  onRetry: () => void;
  retrying: boolean;
}): ReactElement {
  const t = useTranslations('fanout');
  const common = useTranslations('common');
  return (
    <InlineError
      title={t('failedTitle')}
      reason={t('failedReason')}
      errorId={errorId}
      onRetry={onRetry}
      retrying={retrying}
      retryLabel={common('retry')}
      live
    />
  );
}
