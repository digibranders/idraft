'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import type { CompareParam } from '../types';
import { DateRangePicker } from '@/components/app/date-range/date-range-picker';
import type { DateRangeValue } from '@/components/app/date-range/range-model';
import { Select, type SelectOption } from '@/components/ui/select';

/** Search Console keeps 16 months and the API reads at most 92 days at once. */
export const MAX_PERIOD_DAYS = 92;

const COMPARES: readonly CompareParam[] = ['previous_period', 'previous_year', 'none'];
const COMPARE_KEYS = { previous_period: 'previousPeriod', previous_year: 'previousYear', none: 'none' } as const;

export interface PeriodControlsProps {
  value: DateRangeValue;
  onValueChange: (value: DateRangeValue) => void;
  compare: CompareParam;
  onCompareChange: (compare: CompareParam) => void;
  /** The last final day: the picker's "today". */
  finalThrough: string;
  timeZone: string;
}

/** Period and Compare with, the two controls of the panel and of Monitoring. */
export function PeriodControls({
  value,
  onValueChange,
  compare,
  onCompareChange,
  finalThrough,
  timeZone,
}: PeriodControlsProps): ReactElement {
  const t = useTranslations('pageSearch');
  const options: SelectOption<CompareParam>[] = COMPARES.map((one) => ({
    value: one,
    label: t(`compare.${COMPARE_KEYS[one]}`),
  }));
  const chosen = t(`compare.${COMPARE_KEYS[compare]}`);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <DateRangePicker
        size="sm"
        word={t('period')}
        value={value}
        onValueChange={onValueChange}
        timeZone={timeZone}
        today={finalThrough}
        maxDays={MAX_PERIOD_DAYS}
      />
      <Select
        size="sm"
        value={compare}
        onValueChange={onCompareChange}
        options={options}
        placeholder={t('compareWith')}
        triggerPrefix={<>{t('compareWith')}:</>}
        aria-label={`${t('compareWith')}: ${chosen}`}
        listLabel={t('compareWith')}
      />
    </div>
  );
}
