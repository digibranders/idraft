'use client';

import { parseAsString, useQueryStates } from 'nuqs';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import type { FilterField, FilterValues, RangeFilterField } from './types';
import {
  formatEnumList,
  formatRange,
  formatText,
  isActiveFilter,
  parseEnumList,
  parseRange,
  parseText,
  type FilterValue,
} from '@/lib/filters/filter-values';

export interface UrlFiltersOptions {
  /**
   * Called with the fields whose value in the URL could not be read once their options are known; the URL
   * no longer holds them. The screen says so (13-filters-search.md section 5, "Validation").
   */
  onDropped?: ((fields: readonly FilterField[]) => void) | undefined;
}

/**
 * The filter bar's values kept in the URL (13-filters-search.md section 5): one key per field, its value in
 * the field's URL form, changes made with `replace` so a filter is not a history entry. A value the field
 * cannot read is dropped from the URL and reported; an enum value is kept as it is while the field's
 * options are loading, so a shared link does not lose a group before the groups arrive.
 */
export function useUrlFilters(
  fields: readonly FilterField[],
  { onDropped }: UrlFiltersOptions = {},
): [FilterValues, (values: FilterValues) => void] {
  const keys = useMemo(
    (): Record<string, typeof parseAsString> => Object.fromEntries(fields.map((field) => [field.id, parseAsString])),
    [fields],
  );
  const [raw, setRaw] = useQueryStates(keys, { history: 'replace' });
  const values = useMemo(() => {
    const read: Record<string, FilterValue> = {};
    for (const field of fields) {
      const text = raw[field.id];
      const value = typeof text === 'string' ? fromUrl(field, text) : null;
      if (value !== null && isActiveFilter(value)) read[field.id] = value;
    }
    return read;
  }, [fields, raw]);

  // A URL value that reads as nothing, or as less than it says, is written back as what it reads as
  const reported = useRef(onDropped);
  // The URL text last reported: an effect that runs again before the rewrite lands does not say it twice
  const lastReported = useRef<string | null>(null);
  useEffect(() => {
    reported.current = onDropped;
  });
  useEffect(() => {
    const settled = fields.filter(
      (field) => typeof raw[field.id] === 'string' && !(field.kind === 'enum' && field.optionsLoading === true),
    );
    const rewritten = settled.filter((field) => {
      const value = values[field.id];
      return value === undefined || toUrl(value) !== raw[field.id];
    });
    if (rewritten.length === 0) return;
    void setRaw(
      Object.fromEntries(
        rewritten.map((field) => {
          const value = values[field.id];
          return [field.id, value === undefined ? null : toUrl(value)];
        }),
      ),
    );
    // Spaces or a repeated id are tidied without a word; a value that is lost is reported
    const lost = rewritten.filter((field) => losesSomething(field, raw[field.id] ?? '', values[field.id]));
    if (lost.length === 0) return;
    const report = JSON.stringify(lost.map((field) => [field.id, raw[field.id]]));
    if (report === lastReported.current) return;
    lastReported.current = report;
    reported.current?.(lost);
  }, [fields, raw, values, setRaw]);

  const setValues = useCallback(
    (next: FilterValues): void => {
      void setRaw(
        Object.fromEntries(
          fields.map((field) => {
            const value = next[field.id];
            return [field.id, value === undefined || !isActiveFilter(value) ? null : toUrl(value)];
          }),
        ),
      );
    },
    [fields, setRaw],
  );
  return [values, setValues];
}

/** A field's value from its URL form, or `null` when the text does not read as one. */
function fromUrl(field: FilterField, text: string): FilterValue | null {
  if (field.kind === 'enum') {
    const ids =
      field.optionsLoading === true
        ? text
            .split(',')
            .map((id) => id.trim())
            .filter((id, index, all) => id !== '' && all.indexOf(id) === index)
        : parseEnumList(text, new Set(field.options.map((option) => option.value)));
    if (ids === null || ids.length === 0) return null;
    return { kind: 'enum', values: field.multi ? ids : ids.slice(0, 1) };
  }
  if (field.kind === 'range') {
    const range = parseRange(text);
    if (range === null) return null;
    // A field of one end keeps that end only, and an end outside the field's bounds is dropped
    const min = field.ends === 'max' ? null : withinBounds(range.min, field.bounds);
    const max = field.ends === 'min' ? null : withinBounds(range.max, field.bounds);
    return min === null && max === null ? null : { kind: 'range', min, max };
  }
  const value = parseText(text);
  return value === null ? null : { kind: 'text', ...value };
}

function withinBounds(end: number | null, bounds: RangeFilterField['bounds']): number | null {
  if (end === null || bounds === undefined) return end;
  return end >= bounds.min && end <= bounds.max ? end : null;
}

/** Whether reading `text` as `value` lost part of it: an unknown id, an end the field does not take, or all. */
function losesSomething(field: FilterField, text: string, value: FilterValue | undefined): boolean {
  if (value === undefined) return true;
  if (field.kind === 'enum' && value.kind === 'enum') {
    const ids = new Set(
      text
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id !== ''),
    );
    return ids.size > value.values.length;
  }
  if (field.kind === 'range' && value.kind === 'range') {
    const range = parseRange(text);
    return range === null || range.min !== value.min || range.max !== value.max;
  }
  return false;
}

function toUrl(value: FilterValue): string {
  if (value.kind === 'enum') return formatEnumList(value.values);
  if (value.kind === 'range') return formatRange(value);
  return formatText(value);
}
