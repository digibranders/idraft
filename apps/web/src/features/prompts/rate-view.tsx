'use client';

import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { EMPTY_VALUE, formatPercent } from '@/lib/format';
import type { RateReading } from '@/lib/rates/strip-model';

export interface RateWords {
  /** The percent; the answers there are when they are too few; "n/a" when there is no rate. */
  text: (rate: RateReading) => string;
  /** The same for a line of text that names the rate before it: "too few answers (3)" is not a count of what it names. */
  inline: (rate: RateReading) => string;
  /** The counts behind it: "4 of 8 answers", or "31 answers" for share of voice; `null` without any answer. */
  basis: (rate: RateReading) => string | null;
  /** Why there is no rate: "No answers", "None valid"; `null` when there is one. */
  reason: (rate: RateReading) => string | null;
}

/** A rate figure put into words, the same in the strip and the tables. */
export function useRateWords(): RateWords {
  const t = useTranslations('prompts.rate');
  return useMemo(
    () => ({
      text: (rate) => {
        if (rate.state === 'none') return EMPTY_VALUE;
        if (rate.state === 'insufficient') return t('insufficient', { count: rate.answers });
        return formatPercent(rate.value, { decimals: 0 });
      },
      inline: (rate) =>
        rate.state === 'insufficient'
          ? t('insufficientInline', { count: rate.answers })
          : rate.state === 'none'
            ? EMPTY_VALUE
            : formatPercent(rate.value, { decimals: 0 }),
      basis: (rate) => {
        if (rate.state === 'none') return null;
        return rate.successes === null
          ? t('basisAnswers', { answers: rate.answers })
          : t('basis', { successes: rate.successes, answers: rate.answers });
      },
      reason: (rate) => (rate.reason === null ? null : t('reason', { reason: rate.reason })),
    }),
    [t],
  );
}
