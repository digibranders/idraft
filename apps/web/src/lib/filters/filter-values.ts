/**
 * Filter values as the filter bar holds them, and their forms in the URL (13-filters-search.md sections 3
 * and 5): a multi value as comma-separated ids (`intent=commercial,transactional`), a range as `min..max`
 * with either end open (`vol=1000..`), text as `operator:text` (`kw=contains:crm`). Unknown or invalid
 * values are dropped; nothing here throws.
 */

export type TextOperator = 'contains' | 'starts_with' | 'equals' | 'not_contains';

export const TEXT_OPERATORS: readonly TextOperator[] = ['contains', 'starts_with', 'equals', 'not_contains'];

export type FilterValue =
  | { kind: 'enum'; values: readonly string[] }
  | { kind: 'range'; min: number | null; max: number | null }
  | { kind: 'text'; operator: TextOperator; text: string };

/** The ids an enum filter holds, or none for a filter of another kind or no filter. */
export const enumValuesOf = (value: FilterValue | undefined): string[] =>
  value?.kind === 'enum' ? [...value.values] : [];

/** `a,b` as the ids `allowed` knows, each once, in the order given; `null` when none is left. */
export function parseEnumList(value: string | null | undefined, allowed: ReadonlySet<string>): string[] | null {
  if (value === null || value === undefined) return null;
  const ids = value
    .split(',')
    .map((id) => id.trim())
    .filter((id, index, all) => allowed.has(id) && all.indexOf(id) === index);
  return ids.length === 0 ? null : ids;
}

export const formatEnumList = (ids: readonly string[]): string => ids.join(',');

const wholeNumber = (text: string): number | null => {
  if (!/^-?\d+$/.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) ? number : null;
};

/** `1000..10000`, `1000..` or `..50` as a range; `null` for anything else, an empty range or min above max. */
export function parseRange(value: string | null | undefined): { min: number | null; max: number | null } | null {
  if (value === null || value === undefined) return null;
  const match = /^(-?\d*)\.\.(-?\d*)$/.exec(value.trim());
  if (match === null) return null;
  const [, low = '', high = ''] = match;
  const min = low === '' ? null : wholeNumber(low);
  const max = high === '' ? null : wholeNumber(high);
  if ((low !== '' && min === null) || (high !== '' && max === null)) return null;
  if (min === null && max === null) return null;
  if (min !== null && max !== null && min > max) return null;
  return { min, max };
}

export const formatRange = ({ min, max }: { min: number | null; max: number | null }): string =>
  `${min === null ? '' : String(min)}..${max === null ? '' : String(max)}`;

/** `contains:crm` as text with its operator; `null` for an unknown operator or empty text. */
export function parseText(value: string | null | undefined): { operator: TextOperator; text: string } | null {
  if (value === null || value === undefined) return null;
  const at = value.indexOf(':');
  if (at === -1) return null;
  const operator = TEXT_OPERATORS.find((candidate) => candidate === value.slice(0, at));
  const text = value.slice(at + 1).trim();
  return operator === undefined || text === '' ? null : { operator, text };
}

export const formatText = ({ operator, text }: { operator: TextOperator; text: string }): string =>
  `${operator}:${text}`;

/** Whether two values are the same filter, so "Apply" can stay disabled until something changed. */
export function sameFilterValue(a: FilterValue | null, b: FilterValue | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === 'enum' && b.kind === 'enum') {
    return a.values.length === b.values.length && a.values.every((value) => b.values.includes(value));
  }
  if (a.kind === 'range' && b.kind === 'range') return a.min === b.min && a.max === b.max;
  if (a.kind === 'text' && b.kind === 'text') return a.operator === b.operator && a.text === b.text;
  return false;
}

/** Whether a value filters anything: an empty list, an open range or blank text is no filter. */
export function isActiveFilter(value: FilterValue | null): value is FilterValue {
  if (value === null) return false;
  if (value.kind === 'enum') return value.values.length > 0;
  if (value.kind === 'range') return value.min !== null || value.max !== null;
  return value.text.trim() !== '';
}
