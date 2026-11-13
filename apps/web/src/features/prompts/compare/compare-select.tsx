'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { useCompare } from './use-compare';
import { Select } from '@/components/ui/select';
import { Tooltip } from '@/components/ui/tooltip';
import type { Schemas } from '@/lib/api/types';
import { formatDateRange } from '@/lib/format';

type Choice = 'previous' | 'off';

export interface CompareSelectProps {
  /** The window the response was compared with, when it has one: the tooltip names it. */
  window: Pick<Schemas['MetricWindow'], 'from' | 'to'> | null;
}

/**
 * "Compare with" of Topics & Prompts (WB-TPF-06): the period before, or no comparison. Off stops the read of the
 * previous period and every change; the address says it as `cmp=off`. Same period last year and Custom are not offered (no data for them yet).
 */
export function CompareSelect({ window }: CompareSelectProps): ReactElement {
  const t = useTranslations('prompts.compare');
  const { compare, setCompare } = useCompare();
  const tip = compare
    ? window === null
      ? null
      : t('windowTip', { range: formatDateRange(window.from, window.to) })
    : t('offTip');
  return (
    <Tooltip content={tip ?? t('label')} disabled={tip === null} side="bottom">
      <div className="w-48 shrink-0">
        <Select<Choice>
          aria-label={t('label')}
          size="sm"
          value={compare ? 'previous' : 'off'}
          onValueChange={(next) => setCompare(next === 'previous')}
          placeholder={t('label')}
          options={[
            { value: 'previous', label: t('previous') },
            { value: 'off', label: t('off') },
          ]}
        />
      </div>
    </Tooltip>
  );
}
