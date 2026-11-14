'use client';

/**
 * Where a failed card says so in customize mode. The card's body is inert there (a card is arranged, not used), so
 * a message inside it could be neither read by assistive technology nor retried. The boundary of the card reports
 * its failure to this small store, which the grid owns, and the frame's `notice` (outside the inert region) shows
 * it: the same message and the same Retry as in view mode.
 */
import { useTranslations } from 'next-intl';
import { createContext, use, useCallback, useEffect, useSyncExternalStore, type ReactElement } from 'react';

import { InlineError } from '@/components/app/status/inline-error';
import { cardName, type CardItem } from '@/lib/layouts';

export interface CardFailures {
  subscribe(listener: () => void): () => void;
  /** The Retry of the failed card with this id; undefined while it has not failed. */
  retryOf(id: string): (() => void) | undefined;
  report(id: string, retry: () => void): void;
  clear(id: string): void;
}

export function createCardFailures(): CardFailures {
  const retries = new Map<string, () => void>();
  const listeners = new Set<() => void>();
  const emit = (): void => {
    listeners.forEach((listener) => {
      listener();
    });
  };
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    retryOf: (id) => retries.get(id),
    report: (id, retry) => {
      retries.set(id, retry);
      emit();
    },
    clear: (id) => {
      if (retries.delete(id)) emit();
    },
  };
}

/** Provided by `LayoutGrid`; null outside one, where a failed card shows its error in its own body. */
export const CardFailuresContext = createContext<CardFailures | null>(null);

export function useCardFailures(): CardFailures | null {
  return use(CardFailuresContext);
}

/** Renders nothing: tells the grid that this card has failed, for as long as it stays failed. */
export function ReportCardFailure({
  failures,
  id,
  retry,
}: {
  failures: CardFailures;
  id: string;
  retry: () => void;
}): null {
  useEffect(() => {
    failures.report(id, retry);
    return () => {
      failures.clear(id);
    };
  }, [failures, id, retry]);
  return null;
}

/** The frame's notice of a card: its failure and Retry in customize mode, nothing otherwise. */
export function CardFailureNotice({ item }: { item: CardItem }): ReactElement | null {
  const t = useTranslations('layouts.customize.card');
  const failures = useCardFailures();
  const subscribe = useCallback(
    (listener: () => void): (() => void) => failures?.subscribe(listener) ?? (() => undefined),
    [failures],
  );
  const retry = useSyncExternalStore(
    subscribe,
    () => failures?.retryOf(item.id),
    () => undefined,
  );
  if (retry === undefined) return null;
  return (
    <div role="group" aria-label={cardName(item)} className="flex min-h-30 rounded-lg border border-border bg-surface">
      <InlineError
        title={t('failed')}
        reason={t('failedReason')}
        errorId={null}
        retrying={false}
        retryLabel={t('retry')}
        onRetry={retry}
      />
    </div>
  );
}
