'use client';

import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { EMPTY_VALUE, formatPercent } from '@/lib/format';
import type { RateReading } from '@/lib/rates/strip-model';

export interface RateWords {
  /** The percent; the answers there are when they are too few; "n/a" when there is no rate. */
  text: (rate: RateReading, share?: boolean) => string;
  /** The same for a line of text that names the rate before it: "too few answers (3)" is not a count of what it names. */
  inline: (rate: RateReading, share?: boolean) => string;
  /** The counts behind it: "4 of 8 answers", or "4 of 31 brand mentions" for share of voice (`share`); `null` without any. */
  basis: (rate: RateReading, share?: boolean) => string | null;
  /** Why there is no rate: "No answers", "None valid"; `null` when there is one. */
  reason: (rate: RateReading) => string | null;
}

/** A rate figure put into words, the same in the strip and the tables. */
export function useRateWords(): RateWords {
  const t = useTranslations('prompts.rate');
  return useMemo(
    () => ({
      text: (rate, share = false) => {
        if (rate.state === 'none') return EMPTY_VALUE;
        if (rate.state === 'insufficient') return t(share ? 'insufficientShare' : 'insufficient', { count: rate.answers });
        return formatPercent(rate.value, { decimals: 0 });
      },
      inline: (rate, share = false) =>
        rate.state === 'insufficient'
          ? t(share ? 'insufficientInlineShare' : 'insufficientInline', { count: rate.answers })
          : rate.state === 'none'
            ? EMPTY_VALUE
            : formatPercent(rate.value, { decimals: 0 }),
      basis: (rate, share = false) => {
        if (rate.state === 'none') return null;
        if (rate.successes === null) return t('basisAnswers', { answers: rate.answers });
        return share
          ? t('shareBasis', { k: rate.successes, n: rate.answers })
          : t('basis', { successes: rate.successes, answers: rate.answers });
      },
      reason: (rate) => (rate.reason === null ? null : t('reason', { reason: rate.reason })),
    }),
    [t],
  );
}
