import type { EnumFilterField, FilterValues } from '@/components/app/filters/types';
import { enumValuesOf } from '@/lib/filters/filter-values';

/** The URL key of the chip (13 section 5): `detectable=only`. The filter system has no boolean kind, so it is an enum with one value. */
export const DETECTABLE_ID = 'detectable';
const ONLY = 'only';

/** "Show: Detectable changes only", an enum field of one option, like Branded prompts. */
export const detectableField = (labels: { field: string; option: string }): EnumFilterField => ({
  id: DETECTABLE_ID,
  kind: 'enum',
  label: labels.field,
  multi: false,
  options: [{ value: ONLY, label: labels.option }],
});

/** Whether the chip is on. */
export const isDetectableOnly = (values: FilterValues): boolean => enumValuesOf(values[DETECTABLE_ID]).includes(ONLY);
