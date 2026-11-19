'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { Select } from '@/components/ui/select';

type Choice = 'previous' | 'off';

export interface CompareSelectProps {
  /** The comparison with the period before is on (the page's default). */
  compare: boolean;
  onCompareChange: (compare: boolean) => void;
}

/**
 * "Compare with": the period before, or no comparison. Off stops the read of the previous period and every change
 * the page shows; the page writes it as `cmp=off`.
 */
export function CompareSelect({ compare, onCompareChange }: CompareSelectProps): ReactElement {
  const t = useTranslations('competitors.compare');
  return (
    <div className="w-48 shrink-0">
      <Select<Choice>
        aria-label={t('label')}
        size="sm"
        value={compare ? 'previous' : 'off'}
        onValueChange={(next) => onCompareChange(next === 'previous')}
        placeholder={t('label')}
        options={[
          { value: 'previous', label: t('previous') },
          { value: 'off', label: t('off') },
        ]}
      />
    </div>
  );
}
