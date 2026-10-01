'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactElement } from 'react';

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

/**
 * One end of a range as typed: `null` while empty, the number for a whole number (group separators
 * allowed, as the chip prints them: "2,000"), and `NaN` for anything else or a number outside the field's
 * bounds, which the editor reports and refuses to apply.
 */
function parseEnd(text: string, bounds: RangeFilterField['bounds']): number | null {
  const trimmed = text.trim();
  // A minus sign alone is a number on its way, not a wrong one
  if (trimmed === '' || trimmed === '-') return null;
  const digits = trimmed.replace(/[,\s]/g, '');
  const number = /^-?\d+$/.test(digits) ? Number(digits) : Number.NaN;
  if (!Number.isSafeInteger(number)) return Number.NaN;
  return bounds === undefined || (number >= bounds.min && number <= bounds.max) ? number : Number.NaN;
}

/** A range with an end that is not a whole number in bounds cannot be applied. */
const rangeInvalid = (draft: FilterValue): boolean =>
  draft.kind === 'range' &&
  ((draft.min !== null && Number.isNaN(draft.min)) || (draft.max !== null && Number.isNaN(draft.max)));

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
    if (rangeOutOfOrder(draft) || rangeInvalid(draft)) return;
    // Text is applied as the URL keeps it, so the next open compares like with like
    const value = draft.kind === 'text' ? { ...draft, text: draft.text.trim() } : draft;
    onApply(isActiveFilter(value) ? value : null);
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
  const trimmed = draft.kind === 'text' ? { ...draft, text: draft.text.trim() } : draft;
  const current = isActiveFilter(trimmed) ? trimmed : null;
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
        disabled={sameFilterValue(current, applied) || rangeOutOfOrder(draft) || rangeInvalid(draft)}
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
  if (!field.multi) return <SingleChoiceEditor field={field} selected={selected[0] ?? null} onApply={onApply} />;
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

/**
 * A single choice, which applies at once (13 section 3) but only when the person picks: a click, Space or
 * Enter. Arrow keys move the checked radio as radios do, and only that, so stepping through the options
 * never applies one on the way (WCAG 3.2.2). The keys and the pointer are read with native listeners,
 * which see an event before Base UI turns it into a change.
 */
function SingleChoiceEditor({
  field,
  selected,
  onApply,
}: {
  field: EnumFilterField;
  selected: string | null;
  onApply: (value: FilterValue | null) => void;
}): ReactElement {
  const container = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(selected);
  const draftRef = useRef(selected);
  // A pointer press makes the next change a pick; any key makes it a move
  const picking = useRef(false);
  const latestApply = useRef(onApply);
  useEffect(() => {
    latestApply.current = onApply;
  }, [onApply]);
  useEffect(() => {
    const element = container.current;
    if (element === null) return undefined;
    const apply = (value: string): void => latestApply.current({ kind: 'enum', values: [value] });
    const onPointerDown = (): void => {
      picking.current = true;
    };
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      picking.current = false;
      if (event.key !== ' ' && event.key !== 'Enter') return;
      const radios = [...element.querySelectorAll<HTMLElement>('[role="radio"]')];
      const option = field.options[radios.findIndex((radio) => radio === document.activeElement)];
      if (option === undefined) return;
      event.preventDefault();
      apply(option.value);
    };
    // A click on the option already checked changes nothing, so no change event applies it
    const onClick = (event: MouseEvent): void => {
      if (event.detail === 0 || !(event.target instanceof Node)) return;
      const target = event.target;
      const labels = [...element.querySelectorAll('label')];
      const option = field.options[labels.findIndex((label) => label.contains(target))];
      if (option !== undefined && option.value === draftRef.current) apply(option.value);
    };
    element.addEventListener('pointerdown', onPointerDown, true);
    element.addEventListener('keydown', onKeyDown, true);
    element.addEventListener('click', onClick);
    return () => {
      element.removeEventListener('pointerdown', onPointerDown, true);
      element.removeEventListener('keydown', onKeyDown, true);
      element.removeEventListener('click', onClick);
    };
  }, [field.options]);
  return (
    <div ref={container}>
      <RadioGroup<string>
        legend={field.label}
        value={draft}
        onValueChange={(value) => {
          draftRef.current = value;
          // The radio follows at once, also while the popover fades out after a pick
          setDraft(value);
          if (picking.current) {
            picking.current = false;
            latestApply.current({ kind: 'enum', values: [value] });
          }
        }}
        options={field.options.map((option) => ({ value: option.value, label: option.label }))}
      />
    </div>
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
  // What was typed, so "2,000" stays as typed and a wrong entry stays visible beside its error
  const [typed, setTyped] = useState<{ min: string; max: string }>({ min: '', max: '' });
  const range = draft.kind === 'range' ? draft : { kind: 'range' as const, min: null, max: null };
  const invalid = rangeInvalid(range);
  const error = invalid
    ? field.bounds === undefined
      ? t('wholeNumber')
      : t('wholeNumberBetween', { min: formatInteger(field.bounds.min), max: formatInteger(field.bounds.max) })
    : rangeOutOfOrder(range)
      ? t('rangeOrder')
      : null;
  // The typed text while it still reads as the draft's value; the draft's own value after Clear
  const shown = (end: 'min' | 'max'): string => {
    const value = range[end];
    const fromTyped = parseEnd(typed[end], field.bounds);
    const same =
      value === null ? fromTyped === null : Number.isNaN(value) ? Number.isNaN(fromTyped) : fromTyped === value;
    return same ? typed[end] : value === null ? '' : String(value);
  };
  const change = (end: 'min' | 'max', text: string): void => {
    setTyped((current) => ({ ...current, [end]: text }));
    onDraftChange({ ...range, [end]: parseEnd(text, field.bounds) });
  };
  return (
    <div className="grid grid-cols-2 gap-3">
      {RANGE_ENDS.map((end) => {
        const wrong = range[end] !== null && Number.isNaN(range[end]);
        return (
          <Field key={end} invalid={error !== null && (wrong || !invalid)}>
            <FieldLabel>{t(end === 'min' ? 'minimum' : 'maximum')}</FieldLabel>
            <Input
              size="sm"
              inputMode="numeric"
              value={shown(end)}
              onValueChange={(text) => change(end, text)}
              onKeyDown={submitOnEnter}
              aria-describedby={error === null ? undefined : errorId}
            />
          </Field>
        );
      })}
      {error === null ? null : <GroupError id={errorId} message={error} className="col-span-2" />}
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
