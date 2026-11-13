'use client';

import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import type { EngineValue } from './engine-values';
import type { TopicMetric } from './model-types';
import { useRateTipWords } from '@/components/app/chart/use-rate-tip-words';
import type { ResolvedRange } from '@/components/app/date-range/range-model';
import { rateTipText, type RateTipWords } from '@/lib/charts/rate-tip';
import { EMPTY_VALUE, formatDateRange, formatPercent } from '@/lib/format';
import { wilsonInterval } from '@/lib/stats';

export interface TopicWords {
  /** A rate as a percent; an unknown rate is n/a, never 0%. */
  percent: (value: number | null) => string;
  /**
   * What a cell's tooltip says after the subject. `counted` is true for a rate that has a count of answers that
   * count (mention, citation) and false for share of voice, which has only the answers that name a brand.
   * Too few answers say their count and no percent; none say so.
   */
  cellTip: (value: EngineValue, counted: boolean) => string;
  rateTip: RateTipWords;
  metricLabel: (metric: TopicMetric) => string;
  answers: (count: number) => string;
  prompts: (count: number) => string;
  /** The window and its length, for a card's meta line: "Oct 16 to Nov 12, 28 days". */
  window: (range: ResolvedRange) => string;
}

/** The words every topics card shares: percents, cell tips, counts and metric names, from the message catalog. */
export function useTopicWords(): TopicWords {
  const t = useTranslations('aiOverview.topics.common');
  const rateTip = useRateTipWords();
  return useMemo((): TopicWords => {
    const percent = (value: number | null): string => (value === null ? EMPTY_VALUE : formatPercent(value));
    const answers = (count: number): string => t('answerCount', { count });
    const prompts = (count: number): string => t('promptCount', { count });
    return {
      percent,
      rateTip,
      answers,
      prompts,
      cellTip: (value, counted) => {
        if (value.state === 'none') return rateTip.noAnswers;
        if (value.state === 'insufficient') return rateTip.thin(value.answers);
        if (counted && value.successes !== null) {
          return rateTipText(
            {
              value: value.value,
              k: value.successes,
              n: value.answers,
              prompts: value.prompts ?? undefined,
              band: wilsonInterval(value.successes, value.answers),
              thin: false,
            },
            rateTip,
          );
        }
        // Share of voice has no count of answers that name a brand: it says the answers it is over
        return [
          t('tipShare', { value: percent(value.value), count: value.answers }),
          value.prompts === null ? null : rateTip.prompts(value.prompts),
        ]
          .filter((part): part is string => part !== null)
          .join(', ');
      },
      metricLabel: (metric) =>
        metric === 'mention'
          ? t('metric.mention')
          : metric === 'citation'
            ? t('metric.citation')
            : t('metric.shareOfVoice'),
      window: (range) => t('windowMeta', { window: formatDateRange(range.from, range.to), days: range.days }),
    };
  }, [t, rateTip]);
}
