'use client';

import { useTranslations } from 'next-intl';

import type { CardPhase } from './card-phase';
import type { ChartEmpty, ChartError, ChartNotice } from '@/components/app/chart/chart-frame';

/** What `useFrameState` reads of a card's data (the same names `useCardData` returns). */
export interface FrameStateData {
  phase: CardPhase;
  stale: boolean;
  partialPrevious: boolean;
  errorId: string | null;
  retry: () => void;
}

/** The part of the props of `ChartFrame` that every card of the family has in common. */
export type FrameState =
  | { status: 'loading'; notice?: undefined; empty?: undefined; error?: undefined }
  | { status: 'ready' | 'refetching'; notice?: ChartNotice | undefined; empty?: undefined; error?: undefined }
  | { status: 'empty'; empty: ChartEmpty; notice?: undefined; error?: undefined }
  | { status: 'error'; error: ChartError; notice?: undefined; empty?: undefined };

export interface FrameStateOptions {
  /** The card's name, for "Could not load {name}". */
  name: string;
  /** The words of the card's empty state; required while the card is empty. */
  empty?: ChartEmpty | null;
  /** The retry is running. */
  retrying?: boolean;
}

/** A card reached its empty state without the words to say why: a bug of the card, not of the data. */
export class MissingEmptyStateError extends Error {
  constructor(name: string) {
    super(`The card "${name}" is empty and gave no empty state`);
    this.name = 'MissingEmptyStateError';
  }
}

/**
 * The status, empty state, error and notice of a card's `ChartFrame` (WP-34 plan section 3.4), so that all twelve
 * cards fail, go stale and run partial in the same words.
 */
export function useFrameState(
  { phase, stale, partialPrevious, errorId, retry }: FrameStateData,
  { name, empty = null, retrying = false }: FrameStateOptions,
): FrameState {
  const t = useTranslations('aiOverview.engines.common');
  const status = useTranslations('status.error');
  if (phase === 'loading') return { status: 'loading' };
  if (phase === 'empty') {
    if (empty === null) throw new MissingEmptyStateError(name);
    return { status: 'empty', empty };
  }
  if (phase === 'error') {
    return {
      status: 'error',
      error: {
        title: t('errorTitle', { name }),
        reason: t('errorReason'),
        errorId:
          errorId === null
            ? null
            : {
                id: errorId,
                label: status('errorId', { id: errorId }),
                copyLabel: status('copyErrorId'),
                copiedLabel: status('copied'),
              },
        onRetry: retry,
        retrying,
        retryLabel: t('retry'),
      },
    };
  }
  // Stale is said before partial: a card that shows old figures matters more than a missing comparison
  if (stale) return { status: phase, notice: { kind: 'stale', text: t('stale') } };
  if (partialPrevious) return { status: phase, notice: { kind: 'partial', text: t('partialPrevious') } };
  return { status: phase };
}
