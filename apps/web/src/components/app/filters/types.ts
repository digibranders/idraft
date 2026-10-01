import type { FilterValue, TextOperator } from '@/lib/filters/filter-values';

/** One choice of an enum filter, with its count when the API supplies it cheaply (13 section 3). */
export interface FilterOption {
  value: string;
  label: string;
  count?: number | null | undefined;
}

interface FieldBase {
  /** The URL key, as 13-filters-search.md section 5 lists it. */
  id: string;
  /** The field's name on the chip and in the field picker: "Intent". */
  label: string;
}

/** "Intent: Commercial, Transactional": radios for a single choice, checkboxes for several. */
export interface EnumFilterField extends FieldBase {
  kind: 'enum';
  multi: boolean;
  options: readonly FilterOption[];
  /**
   * The options come from the API and have not all arrived: a value from a link is kept as it is until
   * they have, rather than dropped as unknown.
   */
  optionsLoading?: boolean | undefined;
}

/** "Volume: 1,000 to 10,000": whole numbers, either end open. */
export interface RangeFilterField extends FieldBase {
  kind: 'range';
  /** The lowest and highest values the field takes, for the inputs. */
  bounds?: { min: number; max: number } | undefined;
  /** How a value reads on the chip; grouped integers by default. */
  format?: ((value: number) => string) | undefined;
  /**
   * The ends the field takes: both by default, or one when the API filters by a single bound ("Volume: at
   * least 1,000" is `search_volume_gte`). The editor then shows that end only.
   */
  ends?: 'both' | 'min' | 'max' | undefined;
}

/** "Keyword contains: crm" */
export interface TextFilterField extends FieldBase {
  kind: 'text';
  operators: readonly TextOperator[];
}

export type FilterField = EnumFilterField | RangeFilterField | TextFilterField;

/** An operator's message key under `filters.operators`: the URL spells operators in snake case. */
export const OPERATOR_MESSAGE: Readonly<Record<TextOperator, 'contains' | 'startsWith' | 'equals' | 'notContains'>> = {
  contains: 'contains',
  starts_with: 'startsWith',
  equals: 'equals',
  not_contains: 'notContains',
};

export type FilterValues = Readonly<Record<string, FilterValue>>;
