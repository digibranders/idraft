'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState, type ReactElement } from 'react';

import { FilterEditor, FilterEditorFooter, needsFooter } from './filter-editor';
import { OPERATOR_MESSAGE, type FilterField } from './types';
import { IconButton } from '@/components/ui/icon-button';
import { Popover } from '@/components/ui/popover';
import type { FilterValue } from '@/lib/filters/filter-values';
import { formatInteger } from '@/lib/format';

/** An enum chip names up to this many values, then counts them (13-filters-search.md section 3). */
const NAMED_VALUES = 2;

export interface ChipText {
  /** Before the colon: "Intent", or "Keyword contains" for a text filter. */
  name: string;
  /** After the colon, drawn in weight 500: "Commercial, Transactional". */
  value: string;
}

/** The chip's text for a field and its applied value. */
export function useChipText(): (field: FilterField, value: FilterValue) => ChipText {
  const t = useTranslations('filters');
  return (field, value) => {
    if (field.kind === 'text' && value.kind === 'text') {
      return { name: `${field.label} ${t(`operators.${OPERATOR_MESSAGE[value.operator]}`)}`, value: value.text.trim() };
    }
    if (field.kind === 'range' && value.kind === 'range') {
      const format = field.format ?? formatInteger;
      const text =
        value.min !== null && value.max !== null
          ? t('rangeBoth', { min: format(value.min), max: format(value.max) })
          : value.min !== null
            ? t('rangeMin', { min: format(value.min) })
            : t('rangeMax', { max: format(value.max ?? 0) });
      return { name: field.label, value: text };
    }
    if (field.kind === 'enum' && value.kind === 'enum') {
      const labels = value.values.map((id) => field.options.find((option) => option.value === id)?.label ?? id);
      return {
        name: field.label,
        value: labels.length > NAMED_VALUES ? t('valueCount', { count: labels.length }) : labels.join(', '),
      };
    }
    return { name: field.label, value: '' };
  };
}

export interface FilterChipProps {
  field: FilterField;
  /** The applied value. */
  value: FilterValue;
  /** Commits a new value; `null` removes the filter. */
  onApply: (value: FilterValue | null) => void;
  onRemove: () => void;
}

/**
 * An active filter (13-filters-search.md sections 2 and 8): "Field: **Value**" on a neutral chip. The chip
 * opens its editor; the X removes it. The editor works on a draft taken from the applied value each time
 * it opens, so closing it without applying changes nothing.
 */
export function FilterChip({ field, value, onApply, onRemove }: FilterChipProps): ReactElement {
  const t = useTranslations('filters');
  const chipText = useChipText();
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<FilterValue>(value);
  const text = chipText(field, value);
  const full = `${text.name}: ${text.value}`;
  const changeOpen = (next: boolean): void => {
    if (next) setDraft(value);
    setOpen(next);
  };
  const apply = (next: FilterValue | null): void => {
    setOpen(false);
    if (next === null) onRemove();
    else onApply(next);
  };
  return (
    <div
      data-filter-chip={field.id}
      className="inline-flex h-control max-w-full items-center rounded-md bg-neutral-subtle type-body"
    >
      <Popover
        open={open}
        onOpenChange={changeOpen}
        title={field.label}
        footer={
          needsFooter(field) ? (
            <FilterEditorFooter field={field} draft={draft} applied={value} onDraftChange={setDraft} formId={formId} />
          ) : undefined
        }
        trigger={
          <button
            type="button"
            aria-label={t('edit', { chip: full })}
            className="flex h-full min-w-0 items-center rounded-md pr-1 pl-3 focus-visible:focus-ring"
          >
            {/* A long value truncates at 240 px (25 section 6.4); the button's name holds all of it */}
            <span className="max-w-60 truncate">
              {text.name}: <span className="type-inline-strong">{text.value}</span>
            </span>
          </button>
        }
      >
        <FilterEditor field={field} draft={draft} onDraftChange={setDraft} onApply={apply} formId={formId} />
      </Popover>
      <IconButton
        icon={X}
        size="icon-xs"
        variant="ghost"
        label={t('remove', { chip: full })}
        onClick={onRemove}
        onKeyDown={(event) => {
          if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault();
            onRemove();
          }
        }}
        className="mr-1.5"
      />
    </div>
  );
}
