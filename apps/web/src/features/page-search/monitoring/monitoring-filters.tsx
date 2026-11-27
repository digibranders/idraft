'use client';

import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement, type ReactNode } from 'react';

import { healthCounts, UNTIERED_VALUE } from './monitoring-rows';
import { HEALTH_KEYS } from '../panel/verdict';
import type { TrackedPageRow, Verdict } from '../types';
import { FilterBar } from '@/components/app/filters/filter-bar';
import type { FilterField, FilterValues } from '@/components/app/filters/types';
import type { PageTier } from '@/lib/internal-links/types';

/**
 * The two fields of the filter bar: Tier (a tier or Untiered) and Health (each verdict that occurs). The options carry
 * no counts yet, so the values can be read from the address before the filters are known (`withHealthCounts`).
 */
export function useMonitoringFields(
  tiers: readonly PageTier[] | null,
  rows: readonly TrackedPageRow[],
  loading: boolean,
): FilterField[] {
  const t = useTranslations('monitoring');
  const p = useTranslations('pageSearch');
  return useMemo((): FilterField[] => {
    // Every verdict that occurs is an option, so choosing a tier never takes the chosen verdict away
    const occurring = healthCounts(rows, { tier: '', search: '' }).map((one) => one.verdict);
    return [
      {
        id: 'tier',
        kind: 'enum',
        multi: false,
        label: t('tier'),
        options: [
          ...(tiers ?? []).map((one) => ({ value: one.tier_id, label: one.label })),
          { value: UNTIERED_VALUE, label: t('untiered') },
        ],
        optionsLoading: tiers === null,
      },
      {
        id: 'health',
        kind: 'enum',
        multi: false,
        label: t('health'),
        options: occurring.map((verdict) => ({ value: verdict, label: p(`health.${HEALTH_KEYS[verdict]}`) })),
        optionsLoading: loading,
      },
    ];
  }, [t, p, tiers, rows, loading]);
}

/**
 * The fields as the bar shows them: each verdict labelled with the number of rows the tier and the search leave it. A
 * single choice list has no count column, so the count is part of the option's name.
 */
export function useCountedFields(
  fields: readonly FilterField[],
  rows: readonly TrackedPageRow[],
  narrowing: { tier: string; search: string },
): FilterField[] {
  const t = useTranslations('monitoring');
  const { tier, search } = narrowing;
  return useMemo(() => {
    const counts = new Map(healthCounts(rows, { tier, search }).map((one) => [one.verdict, one.count]));
    return fields.map((field) =>
      field.id === 'health' && field.kind === 'enum'
        ? {
            ...field,
            options: field.options.map((option) => ({
              ...option,
              label: t('healthOption', { name: option.label, count: counts.get(option.value as Verdict) ?? 0 }),
            })),
          }
        : field,
    );
  }, [t, fields, rows, tier, search]);
}

export interface MonitoringFiltersProps {
  /** Period and Compare with, when the last final day is known. */
  periodControls: ReactNode;
  fields: readonly FilterField[];
  values: FilterValues;
  onChange: (values: FilterValues) => void;
}

/** Row 2 of the page (spec 10.1): the period scope, then the shared filter bar. */
export function MonitoringFilters({ periodControls, fields, values, onChange }: MonitoringFiltersProps): ReactElement {
  const t = useTranslations('monitoring');
  return (
    <div role="group" aria-label={t('filtersLabel')} className="flex flex-wrap items-center gap-2">
      {periodControls}
      <FilterBar fields={fields} values={values} onChange={onChange} hideAddWhenFull />
    </div>
  );
}
