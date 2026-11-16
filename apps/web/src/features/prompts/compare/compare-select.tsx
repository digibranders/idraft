'use client';

import { useTranslations } from 'next-intl';
import { useId, type ReactElement } from 'react';

import { useCompare, type CompareMode } from './use-compare';
import { Select } from '@/components/ui/select';
import { Tooltip } from '@/components/ui/tooltip';
import type { Schemas } from '@/lib/api/types';
import { formatDateRange } from '@/lib/format';

type Choice = CompareMode | 'off';

export interface CompareSelectProps {
  /** The window the response was compared with, when it has one: the tooltip names it. */
  window: Pick<Schemas['MetricWindow'], 'from' | 'to'> | null;
}

/**
 * "Compare with" of the Prompts page (WB-TPF-06): no comparison, which is where the page opens, the period before, or
 * the same dates a year earlier. Off stops the read of the compared period and every change; the address says on as
 * `cmp=previous` or `cmp=year`. Custom is not offered (no data for it yet).
 */
export function CompareSelect({ window }: CompareSelectProps): ReactElement {
  const t = useTranslations('prompts.compare');
  const { compare, mode, setCompare, setMode } = useCompare();
  const describedBy = useId();
  const tip = compare
    ? window === null
      ? null
      : t('windowTip', { kind: mode, range: formatDateRange(window.from, window.to) })
    : t('offTip');
  return (
    // The tooltip is for the eye; the combobox itself is described by the hidden text, so a screen reader hears it
    <Tooltip content={tip ?? t('label')} purpose="label" disabled={tip === null} side="bottom">
      <div className="min-w-0 md:w-48 md:shrink-0">
        <Select<Choice>
          aria-label={t('label')}
          {...(tip === null ? {} : { 'aria-describedby': describedBy })}
          size="sm"
          value={compare ? mode : 'off'}
          onValueChange={(next) => (next === 'off' ? setCompare(false) : setMode(next))}
          placeholder={t('label')}
          options={[
            { value: 'previous', label: t('previous') },
            { value: 'year', label: t('year') },
            { value: 'off', label: t('off') },
          ]}
        />
        {tip === null ? null : (
          <span id={describedBy} hidden>
            {tip}
          </span>
        )}
      </div>
    </Tooltip>
  );
}
