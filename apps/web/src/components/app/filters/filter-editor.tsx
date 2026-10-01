'use client';

import { useTranslations } from 'next-intl';
import { useId, useState, type FormEvent, type KeyboardEvent, type ReactElement } from 'react';

import {
  OPERATOR_MESSAGE,
  type EnumFilterField,
  type FilterField,
  type RangeFilterField,
  type TextFilterField,
} from './types';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel, GroupError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { RadioGroup } from '@/components/ui/radio-group';
import { Select } from '@/components/ui/select';
import { formatInteger } from '@/lib/format';
import { isActiveFilter, sameFilterValue, type FilterValue, type TextOperator } from '@/lib/filters/filter-values';

/** Enum lists longer than this get a search box (13 section 3). */
const SEARCH_FROM = 8;

/** Whether the editor commits with Apply; a single choice applies at once and has no footer. */
export const needsFooter = (field: FilterField): boolean => !(field.kind === 'enum' && !field.multi);

/** The empty draft of a field: what Clear leaves. */
export function emptyDraft(field: FilterField): FilterValue {
  if (field.kind === 'enum') return { kind: 'enum', values: [] };
  if (field.kind === 'range') return { kind: 'range', min: null, max: null };
  return { kind: 'text', operator: field.operators[0] ?? 'contains', text: '' };
}

/** A whole number as typed, or `null` while the text is empty or not one. */
function parseWhole(text: string): number | null {
  const trimmed = text.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  const number = Number(trimmed);
  return Number.isSafeInteger(number) ? number : null;
}

/**
 * Enter in a field applies. Done by the field rather than by implicit submission, because Apply sits in the
 * popover's footer, outside the form, and a form with two fields and no button of its own does not submit.
 */
function submitOnEnter(event: KeyboardEvent<HTMLInputElement>): void {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  event.currentTarget.form?.requestSubmit();
}

const RANGE_ENDS = ['min', 'max'] as const;

/** A range whose minimum is above its maximum cannot be applied. */
const rangeOutOfOrder = (draft: FilterValue): boolean =>
  draft.kind === 'range' && draft.min !== null && draft.max !== null && draft.min > draft.max;

export interface FilterEditorProps {
  field: FilterField;
  draft: FilterValue;
  onDraftChange: (draft: FilterValue) => void;
  /** Commits a value; `null` removes the filter. */
  onApply: (value: FilterValue | null) => void;
  /** The form the footer's Apply submits. */
  formId: string;
}

/**
 * The body of a filter's editor popover (13-filters-search.md section 3). A single choice applies at once;
 * the others edit a draft that Apply (or Enter) commits, and Escape or a click outside discards.
 */
export function FilterEditor({ field, draft, onDraftChange, onApply, formId }: FilterEditorProps): ReactElement {
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (rangeOutOfOrder(draft)) return;
    onApply(isActiveFilter(draft) ? draft : null);
  };
  return (
    <form id={formId} noValidate onSubmit={submit} className="flex flex-col gap-3">
      {field.kind === 'enum' ? (
        <EnumEditor field={field} draft={draft} onDraftChange={onDraftChange} onApply={onApply} />
      ) : field.kind === 'range' ? (
        <RangeEditor field={field} draft={draft} onDraftChange={onDraftChange} />
      ) : (
        <TextEditor field={field} draft={draft} onDraftChange={onDraftChange} />
      )}
    </form>
  );
}

export interface FilterEditorFooterProps {
  field: FilterField;
  draft: FilterValue;
  applied: FilterValue | null;
  onDraftChange: (draft: FilterValue) => void;
  formId: string;
}

/**
 * Clear on the left unticks everything; Apply on the right commits, disabled until the draft differs from
 * the applied filter. Clear then Apply removes the filter.
 */
export function FilterEditorFooter({
  field,
  draft,
  applied,
  onDraftChange,
  formId,
}: FilterEditorFooterProps): ReactElement {
  const t = useTranslations('filters');
  const current = isActiveFilter(draft) ? draft : null;
  return (
    <div className="flex w-full items-center justify-between gap-2">
      <Button variant="ghost" size="sm" disabled={current === null} onClick={() => onDraftChange(emptyDraft(field))}>
        {t('clear')}
      </Button>
      <Button
        type="submit"
        form={formId}
        variant="primary"
        size="sm"
        disabled={sameFilterValue(current, applied) || rangeOutOfOrder(draft)}
      >
        {t('apply')}
      </Button>
    </div>
  );
}

function EnumEditor({
  field,
  draft,
  onDraftChange,
  onApply,
}: {
  field: EnumFilterField;
  draft: FilterValue;
  onDraftChange: (draft: FilterValue) => void;
  onApply: (value: FilterValue | null) => void;
}): ReactElement {
  const t = useTranslations('filters');
  const [search, setSearch] = useState('');
  const selected = draft.kind === 'enum' ? draft.values : [];
  if (!field.multi) {
    return (
      <RadioGroup<string>
        legend={field.label}
        value={selected[0] ?? null}
        onValueChange={(value) => onApply({ kind: 'enum', values: [value] })}
        options={field.options.map((option) => ({ value: option.value, label: option.label }))}
      />
    );
  }
  const needle = search.trim().toLocaleLowerCase();
  const shown = field.options.filter((option) => needle === '' || option.label.toLocaleLowerCase().includes(needle));
  const set = (values: readonly string[]): void => onDraftChange({ kind: 'enum', values });
  const toggle = (value: string, on: boolean): void =>
    set(on ? [...selected, value] : selected.filter((candidate) => candidate !== value));
  const allShown = shown.length > 0 && shown.every((option) => selected.includes(option.value));
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="sr-only">{field.label}</legend>
      {field.options.length > SEARCH_FROM ? (
        <Input
          size="sm"
          type="search"
          value={search}
          onValueChange={setSearch}
          aria-label={t('search')}
          placeholder={t('search')}
          className="mb-1"
        />
      ) : null}
      {shown.length === 0 ? (
        <p className="type-meta">{t('noOptions')}</p>
      ) : (
        <>
          <Checkbox
            checked={
              allShown ? true : shown.some((option) => selected.includes(option.value)) ? 'indeterminate' : false
            }
            label={t('selectAll')}
            onCheckedChange={(on) =>
              set(
                on
                  ? [...new Set([...selected, ...shown.map((option) => option.value)])]
                  : selected.filter((value) => !shown.some((option) => option.value === value)),
              )
            }
          />
          <ul className="flex flex-col">
            {shown.map((option) => (
              <li key={option.value} className="group/option flex h-control-sm items-center gap-2">
                <Checkbox
                  checked={selected.includes(option.value)}
                  label={option.label}
                  onCheckedChange={(on) => toggle(option.value, on)}
                  className="min-w-0 flex-1"
                />
                <Button
                  variant="link"
                  size="sm"
                  aria-label={t('onlyLabel', { option: option.label })}
                  onClick={() => set([option.value])}
                  className="opacity-0 group-focus-within/option:opacity-100 group-hover/option:opacity-100"
                >
                  {t('only')}
                </Button>
                {option.count === null || option.count === undefined ? null : (
                  <span className="num type-meta">{formatInteger(option.count)}</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </fieldset>
  );
}

function RangeEditor({
  field,
  draft,
  onDraftChange,
}: {
  field: RangeFilterField;
  draft: FilterValue;
  onDraftChange: (draft: FilterValue) => void;
}): ReactElement {
  const t = useTranslations('filters');
  const errorId = useId();
  // What was typed, so a partial entry ("-") stays in the field while the draft holds no number yet
  const [typed, setTyped] = useState<{ min: string; max: string }>({ min: '', max: '' });
  const range = draft.kind === 'range' ? draft : { kind: 'range' as const, min: null, max: null };
  const outOfOrder = rangeOutOfOrder(range);
  // The typed text while it still reads as the draft's number; the draft's own value after Clear
  const shown = (end: 'min' | 'max'): string => {
    const value = range[end];
    return parseWhole(typed[end]) === value ? typed[end] : value === null ? '' : String(value);
  };
  const change = (end: 'min' | 'max', text: string): void => {
    setTyped((current) => ({ ...current, [end]: text }));
    onDraftChange({ ...range, [end]: parseWhole(text) });
  };
  return (
    <div className="grid grid-cols-2 gap-3">
      {RANGE_ENDS.map((end) => (
        <Field key={end} invalid={outOfOrder}>
          <FieldLabel>{t(end === 'min' ? 'minimum' : 'maximum')}</FieldLabel>
          <Input
            size="sm"
            inputMode="numeric"
            min={field.bounds?.min}
            max={field.bounds?.max}
            value={shown(end)}
            onValueChange={(text) => change(end, text)}
            onKeyDown={submitOnEnter}
            aria-describedby={outOfOrder ? errorId : undefined}
          />
        </Field>
      ))}
      {outOfOrder ? <GroupError id={errorId} message={t('rangeOrder')} className="col-span-2" /> : null}
    </div>
  );
}

function TextEditor({
  field,
  draft,
  onDraftChange,
}: {
  field: TextFilterField;
  draft: FilterValue;
  onDraftChange: (draft: FilterValue) => void;
}): ReactElement {
  const t = useTranslations('filters');
  const text =
    draft.kind === 'text' ? draft : { kind: 'text' as const, operator: field.operators[0] ?? 'contains', text: '' };
  return (
    <div className="flex flex-col gap-3">
      <Field>
        <FieldLabel>{t('operator')}</FieldLabel>
        <Select<TextOperator>
          size="sm"
          value={text.operator}
          placeholder={t('operator')}
          onValueChange={(operator) => onDraftChange({ ...text, operator })}
          options={field.operators.map((operator) => ({
            value: operator,
            label: t(`operators.${OPERATOR_MESSAGE[operator]}`),
          }))}
        />
      </Field>
      <Field>
        <FieldLabel>{t('text')}</FieldLabel>
        <Input
          size="sm"
          value={text.text}
          onValueChange={(value) => onDraftChange({ ...text, text: value })}
          onKeyDown={submitOnEnter}
        />
      </Field>
    </div>
  );
}
