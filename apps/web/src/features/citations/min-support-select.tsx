'use client';

import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { DEFAULT_MIN_SUPPORT } from './citation-scope';
import { Select } from '@/components/ui/select';
import { Tooltip } from '@/components/ui/tooltip';

/** The minimums the list offers (Q10); a link may name another, which the list then holds too. */
const OFFERED: readonly number[] = [1, 2, 3, 5, 10];

export interface MinSupportSelectProps {
  minSupport: number;
  /** The minimum chosen; `null` for the default, which the address does not hold. */
  onMinSupportChange: (minSupport: number | null) => void;
}

/**
 * "Fewest citation units" of the Domains and Pages tabs (WB-CIT-07): rows below it are left out of the table,
 * and the shares and totals do not change. The note is the select's description, for the eye and for readers.
 */
export function MinSupportSelect({ minSupport, onMinSupportChange }: MinSupportSelectProps): ReactElement {
  const t = useTranslations('citations.minSupport');
  const options = useMemo(
    () =>
      [...new Set([...OFFERED, minSupport])]
        .sort((a, b) => a - b)
        .map((count) => ({ value: String(count), label: t('option', { count }) })),
    [minSupport, t],
  );
  return (
    <Tooltip content={t('note')}>
      <Select<string>
        aria-label={t('label')}
        size="sm"
        className="w-32 sm:w-44"
        value={String(minSupport)}
        onValueChange={(next) => {
          const count = Number(next);
          onMinSupportChange(count === DEFAULT_MIN_SUPPORT ? null : count);
        }}
        placeholder={t('label')}
        options={options}
      />
    </Tooltip>
  );
}
