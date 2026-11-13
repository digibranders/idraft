'use client';

import { useTranslations } from 'next-intl';

import type { Read } from '../../../data/read-state';
import type { ChartEmpty, ChartError, ChartNotice } from '@/components/app/chart/chart-frame';

/** The status of a card's `ChartFrame` and what goes with it: the shape the frame takes for its state. */
export type FrameState = (
  | { status: 'loading' | 'ready' | 'refetching'; empty?: undefined; error?: undefined }
  | { status: 'empty'; empty: ChartEmpty; error?: undefined }
  | { status: 'error'; error: ChartError; empty?: undefined }
) & { notice?: ChartNotice | undefined };

/**
 * The two words every card of the activity family shares for what a read did: its error (with the request id and
 * the retry) and the notice that the figures are the last that were read. No card words these itself, so they read
 * alike. An empty state is each card's own: only the card knows why it has nothing to show.
 */

/** What the frame needs of a read: its error id, whether the data is the last one read, and a retry. */
export type ReadFacts = Pick<Read<unknown>, 'errorId' | 'stale' | 'refetch'>;

/** The error of the frame for a failed read, "Could not load collection status", with its id and its retry. */
export function useErrorState(read: ReadFacts, subject: string): ChartError {
  const t = useTranslations('aiOverview.activity.common');
  const status = useTranslations('status.error');
  const common = useTranslations('common');
  const id = read.errorId;
  return {
    title: t('errorTitle', { subject }),
    reason: t('errorReason'),
    errorId:
      id === null
        ? null
        : { id, label: status('errorId', { id }), copyLabel: status('copyErrorId'), copiedLabel: status('copied') },
    onRetry: read.refetch,
    retrying: false,
    retryLabel: common('retry'),
  };
}

/** The notice of ready data whose last read failed; `undefined` when the figures are current. */
export function useStaleNotice(stale: boolean): ChartNotice | undefined {
  const t = useTranslations('aiOverview.activity.common');
  return stale ? { kind: 'stale', text: t('stale') } : undefined;
}
