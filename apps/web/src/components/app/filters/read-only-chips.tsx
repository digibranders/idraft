'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { useChipText } from './filter-chip';
import type { FilterField, FilterValues } from './types';
import { Tag } from '@/components/ui/tag';

/**
 * The applied filters as chips that cannot be edited or removed: what a filtered-to-zero state shows below
 * its reason, so the person sees what excludes the data (17-empty-loading-error-states.md section 2).
 */
export function ReadOnlyFilterChips({
  fields,
  values,
}: {
  fields: readonly FilterField[];
  values: FilterValues;
}): ReactElement | null {
  const t = useTranslations('filters');
  const chipText = useChipText();
  const applied = fields.flatMap((field) => {
    const value = values[field.id];
    return value === undefined ? [] : [{ field, value }];
  });
  if (applied.length === 0) return null;
  return (
    <ul aria-label={t('applied')} className="flex flex-wrap justify-center gap-2">
      {applied.map(({ field, value }) => {
        const text = chipText(field, value);
        return (
          <li key={field.id}>
            <Tag label={t('chip', { name: text.name, value: text.value })} />
          </li>
        );
      })}
    </ul>
  );
}
