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
 * The Branded filter of the page: a chip that shows only while the choice is not the default (owner, 2026-11-27: the
 * "Branded: Excluded" chip was always on and broke the header row). It is its own piece, so the toolbar can place it
 * beside the actions; on a phone it sits in the Filters sheet with the selects.
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
  // The default (branded prompts left out) needs no chip: an always-on chip took a row of the header for nothing. The
  // filter stays mounted and is only not displayed, so nothing else moves; it shows when a link brought another choice,
  // so the scope is never changed out of sight, and removing the chip goes back to the default.
  return (
    <div className={scope.branded === 'excluded' ? 'hidden' : 'min-w-0'}>
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
