import type { EnumFilterField, FilterValues } from '@/components/app/filters/types';
import { parseBranded, type Branded } from './scope-model';

/**
 * The Branded filter of the Overview (WP-33 plan section 3.2). Its default, Excluded, is a chip drawn from the
 * default and never written to the URL; Included is no chip at all, as in the approved preview: removing the chip
 * means Included, and "+ Filter" brings Branded back.
 */

export interface BrandedWords {
  label: string;
  excluded: string;
  only: string;
  included: string;
}

export function brandedField(words: BrandedWords): EnumFilterField {
  return {
    id: 'branded',
    kind: 'enum',
    label: words.label,
    multi: false,
    options: [
      { value: 'excluded', label: words.excluded },
      { value: 'only', label: words.only },
      { value: 'included', label: words.included },
    ],
  };
}

/** The filter bar's value for a choice: a chip for Excluded and Only, none for Included. */
export function brandedValues(branded: Branded): FilterValues {
  return branded === 'included' ? {} : { branded: { kind: 'enum', values: [branded] } };
}

/** The choice a filter bar's values say: no chip is Included, a chip is its value (an unknown one the default). */
export function brandedFromValues(values: FilterValues): Branded {
  const value = values.branded;
  if (value === undefined) return 'included';
  return value.kind === 'enum' ? parseBranded(value.values[0] ?? null) : 'excluded';
}
