'use client';

import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import type { RateReading } from './strip-model';
import { Tooltip } from '@/components/ui/tooltip';
import { EMPTY_VALUE, formatPercent } from '@/lib/format';
import { MIN_OBSERVATIONS } from '@/lib/stats';

/**
 * A rate over fewer than `MIN_OBSERVATIONS` valid answers, in place of a percent (parity spec decision D-1): the
 * answers there are, on the hatched muted ground of InsufficientData (docs/design-system/12 section 7.3), with
 * what is missing in a tooltip. The tables' cells show an insufficient rate this way. The strip does not use it:
 * `MetricStrip` draws the same hatched ground for an item that is `insufficient`. A table cell carries the
 * tooltip itself, where the keyboard reaches it: it passes `tip={false}` and gives the same text as the cell's.
 */
export function InsufficientPill({ answers, tip = true }: { answers: number; tip?: boolean }): ReactElement {
  const t = useTranslations('prompts.rate');
  const pill = (
    <span className="inline-flex h-6 items-center rounded-xs bg-insufficient px-1.5 type-label whitespace-nowrap text-foreground-tertiary">
      {t('insufficient', { count: answers })}
    </span>
  );
  return tip ? (
    <Tooltip content={t('insufficientTip', { count: answers, min: MIN_OBSERVATIONS })}>{pill}</Tooltip>
  ) : (
    pill
  );
}

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
