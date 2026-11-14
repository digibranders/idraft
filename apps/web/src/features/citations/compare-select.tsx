'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { Select } from '@/components/ui/select';

type Choice = 'previous' | 'off';

export interface CompareSelectProps {
  /** The comparison with the period before is on (the page's default). */
  compare: boolean;
  onCompareChange: (compare: boolean) => void;
  noPrevious?: boolean | undefined;
}

/**
 * "Compare with" of the Citations page (WB-CIT-04): the period before, or no comparison. Off stops the read of
 * the previous period and every change of a share; the page writes it as `cmp=off`.
 */
export function CompareSelect({ compare, onCompareChange, noPrevious = false }: CompareSelectProps): ReactElement {
  const t = useTranslations('citations.compare');
  return (
    <div className="w-40 shrink-0">
      <Select<Choice>
        aria-label={t('label')}
        size="sm"
        value={compare ? 'previous' : 'off'}
        onValueChange={(next) => onCompareChange(next === 'previous')}
        placeholder={t('label')}
        options={[
          {
            value: 'previous',
            label: t('previous'),
            description: noPrevious ? t('noPrevious') : undefined,
          },
          { value: 'off', label: t('off') },
        ]}
      />
    </div>
  );
}
