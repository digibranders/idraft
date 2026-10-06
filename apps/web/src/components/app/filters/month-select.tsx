'use client';

import { useLocale } from 'next-intl';
import type { ReactElement } from 'react';

import { Select } from '@/components/ui/select';
import { monthLabel, type MonthKey } from '@/lib/format/month';

export interface MonthSelectProps {
  /** The months offered, newest first. */
  months: readonly MonthKey[];
  value: MonthKey;
  /** The select's name and placeholder: "Month". */
  label: string;
  onValueChange: (month: MonthKey) => void;
}

/** The month a cost or run page is scoped to: a small select of the recent months, named in the person's language. */
export function MonthSelect({ months, value, label, onValueChange }: MonthSelectProps): ReactElement {
  const locale = useLocale();
  return (
    <Select<MonthKey>
      size="sm"
      aria-label={label}
      placeholder={label}
      value={value}
      onValueChange={onValueChange}
      options={months.map((month) => ({ value: month, label: monthLabel(month, locale) }))}
    />
  );
}
