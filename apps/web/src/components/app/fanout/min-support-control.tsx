'use client';

import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { Select } from '@/components/ui/select';
import { Tooltip } from '@/components/ui/tooltip';
import { DEFAULT_MIN_SUPPORT } from '@/lib/fanout';

/** The minimums the list offers; a link may name another, which the list then holds too. */
const OFFERED: readonly number[] = [1, 2, 3, 5, 10];

export interface MinSupportControlProps {
  minSupport: number;
  /** The minimum chosen; `null` for the default, which the address does not hold. */
  onMinSupportChange: (minSupport: number | null) => void;
}

/**
 * "Fewest answers" (WB-PIF-04): queries issued by fewer answers are left out of the list. What the strip counts
 * does not change. It counts answers, where the Citations minimum counts citation units, so it has its own words.
 */
export function MinSupportControl({ minSupport, onMinSupportChange }: MinSupportControlProps): ReactElement {
  const t = useTranslations('fanout');
  const options = useMemo(
    () =>
      [...new Set([...OFFERED, minSupport])]
        .sort((a, b) => a - b)
        .map((count) => ({ value: String(count), label: t('minOption', { count }) })),
    [minSupport, t],
  );
  return (
    <Tooltip content={t('minNote')}>
      <Select<string>
        aria-label={t('minLabel')}
        size="sm"
        className="w-36 sm:w-44"
        value={String(minSupport)}
        onValueChange={(next) => {
          const count = Number(next);
          onMinSupportChange(count === DEFAULT_MIN_SUPPORT ? null : count);
        }}
        placeholder={t('minLabel')}
        options={options}
      />
    </Tooltip>
  );
}
