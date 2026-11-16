'use client';

import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { useOverview } from '../overview-context';
import { brandedField, brandedFromValues, brandedValues } from './branded-field';
import { FilterBar } from '@/components/app/filters/filter-bar';
import type { FilterField, FilterValues } from '@/components/app/filters/types';

/** 768 px, the width from which the scope controls are on the page and the window and location are in the top bar. */
export const PAGE_CONTROLS = '(width >= 48rem)';

/**
 * The Branded filter of the page: the chip "Branded: Excluded" from the default, and "+ Filter" to bring it back. It
 * is its own piece, so the toolbar can place it beside the actions and keep the scope row to the selects (the row is
 * then two lines at 1280 px, not three); on a phone it sits in the Filters sheet with the selects.
 */
export function BrandedFilter(): ReactElement {
  const t = useTranslations('aiOverview.scope');
  const { scope, setScope } = useOverview();
  const branded = useMemo(
    () =>
      brandedField({
        label: t('branded'),
        excluded: t('brandedExcluded'),
        only: t('brandedOnly'),
        included: t('brandedIncluded'),
      }),
    [t],
  );
  const fields = useMemo((): FilterField[] => [branded], [branded]);
  const values = useMemo((): FilterValues => brandedValues(scope.branded), [scope.branded]);
  return (
    <div className="min-w-0">
      <FilterBar
        fields={fields}
        values={values}
        hideClear
        hideAddWhenFull
        onChange={(next) => setScope({ branded: brandedFromValues(next) })}
      />
    </div>
  );
}
