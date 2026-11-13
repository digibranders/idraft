'use client';

import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { Select } from '@/components/ui/select';
import type { SourceSort } from '@/lib/citations/source-queries';

export interface SortSelectProps {
  sort: SourceSort;
  onSortChange: (sort: SourceSort) => void;
}

/**
 * "Order by" of the Domains and Pages tabs. The server sorts: it takes three orders, and a table that lists
 * the rows as given (a tree) has no sort of its own.
 */
export function SortSelect({ sort, onSortChange }: SortSelectProps): ReactElement {
  const t = useTranslations('citations.sort');
  const options = useMemo(
    () => [
      { value: '-citation_units' as const, label: t('units') },
      { value: '-observations' as const, label: t('observations') },
      { value: '-prompts' as const, label: t('prompts') },
    ],
    [t],
  );
  return (
    <Select<SourceSort>
      aria-label={t('label')}
      size="sm"
      className="w-44"
      value={sort}
      onValueChange={onSortChange}
      placeholder={t('label')}
      options={options}
    />
  );
}
