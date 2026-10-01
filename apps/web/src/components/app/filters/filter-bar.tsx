'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';

import { FilterChip } from './filter-chip';
import { FilterEditor, FilterEditorFooter, emptyDraft, needsFooter } from './filter-editor';
import type { FilterField, FilterValues } from './types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover } from '@/components/ui/popover';
import type { FilterValue } from '@/lib/filters/filter-values';

/** The field picker gets a search box above this many fields, like an enum editor. */
const SEARCH_FROM = 8;
/** Where focus goes when the last chip is removed. */
const ADD_TARGET = '__add';
/** The first control of an editor: a field, a radio, a checkbox or the operator select. */
const FIRST_CONTROL = 'input:not([type="hidden"]), [role="radio"], [role="checkbox"], [role="combobox"], button';

export interface FilterBarProps {
  /** Every field the screen filters on, in the order the picker lists them and the chips show. */
  fields: readonly FilterField[];
  /** The applied filters by field id; a field without a value has no chip. */
  values: FilterValues;
  /** The new applied filters: one changed, one removed, or none left after "Clear filters". */
  onChange: (values: FilterValues) => void;
  /** Right-aligned on the first row: the result count on overview pages, or a legend. */
  trailing?: ReactNode | undefined;
}

/**
 * The filter row of a screen (13-filters-search.md sections 2, 3 and 8): a chip per applied filter,
 * "+ Filter" to add one, and "Clear filters" while any is applied. Scope controls (date range, location,
 * device) live elsewhere and are never cleared here.
 */
export function FilterBar({ fields, values, onChange, trailing }: FilterBarProps): ReactElement {
  const t = useTranslations('filters');
  const groupRef = useRef<HTMLDivElement>(null);
  // The chip, or "+ Filter", to focus once a removal has rendered.
  const pendingFocus = useRef<string | null>(null);
  const active = fields.filter((field) => values[field.id] !== undefined);
  const available = fields.filter((field) => values[field.id] === undefined);

  useEffect(() => {
    const target = pendingFocus.current;
    const group = groupRef.current;
    if (target === null || group === null) return;
    pendingFocus.current = null;
    const element =
      target === ADD_TARGET
        ? group.querySelector<HTMLElement>('[data-filter-add]')
        : group.querySelector<HTMLElement>(`[data-filter-chip="${CSS.escape(target)}"] button`);
    element?.focus();
  });

  const set = (id: string, value: FilterValue | null): void => {
    const next: Record<string, FilterValue> = {};
    for (const field of fields) {
      const current = field.id === id ? value : (values[field.id] ?? null);
      if (current !== null) next[field.id] = current;
    }
    onChange(next);
  };
  const remove = (id: string): void => {
    const index = active.findIndex((field) => field.id === id);
    const after = active[index + 1] ?? active[index - 1];
    pendingFocus.current = after === undefined ? ADD_TARGET : after.id;
    set(id, null);
  };
  const clearAll = (): void => {
    pendingFocus.current = ADD_TARGET;
    onChange({});
  };

  return (
    <div className="flex items-start gap-4">
      <div
        ref={groupRef}
        role="group"
        aria-label={t('bar')}
        className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
      >
        {active.map((field) => {
          const value = values[field.id];
          return value === undefined ? null : (
            <FilterChip
              key={field.id}
              field={field}
              value={value}
              onApply={(next) => set(field.id, next)}
              onRemove={() => remove(field.id)}
            />
          );
        })}
        <AddFilter fields={available} onAdd={(id, value) => set(id, value)} />
        {active.length === 0 ? null : (
          <Button variant="link" size="sm" onClick={clearAll}>
            {t('clearAll')}
          </Button>
        )}
      </div>
      {trailing === undefined ? null : <div className="flex h-control shrink-0 items-center">{trailing}</div>}
    </div>
  );
}

/** "+ Filter": a field picker, then that field's editor in the same popover. */
function AddFilter({
  fields,
  onAdd,
}: {
  fields: readonly FilterField[];
  onAdd: (id: string, value: FilterValue) => void;
}): ReactElement {
  const t = useTranslations('filters');
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<FilterField | null>(null);
  const [draft, setDraft] = useState<FilterValue | null>(null);
  const [search, setSearch] = useState('');
  const changeOpen = (next: boolean): void => {
    setOpen(next);
    if (next) {
      setPicked(null);
      setDraft(null);
      setSearch('');
    }
  };
  const pick = (field: FilterField): void => {
    setPicked(field);
    setDraft(emptyDraft(field));
  };
  // The field's button goes when its editor replaces the list, so focus moves on to the editor's first control
  const editorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (picked === null) return;
    editorRef.current?.querySelector<HTMLElement>(FIRST_CONTROL)?.focus();
  }, [picked]);
  const apply = (value: FilterValue | null): void => {
    setOpen(false);
    if (picked !== null && value !== null) onAdd(picked.id, value);
  };
  const needle = search.trim().toLocaleLowerCase();
  const shown = fields.filter((field) => needle === '' || field.label.toLocaleLowerCase().includes(needle));
  return (
    <Popover
      open={open}
      onOpenChange={changeOpen}
      title={picked === null ? t('chooseField') : picked.label}
      footer={
        picked !== null && draft !== null && needsFooter(picked) ? (
          <FilterEditorFooter field={picked} draft={draft} applied={null} onDraftChange={setDraft} formId={formId} />
        ) : undefined
      }
      trigger={
        <Button
          variant="ghost"
          icon={Plus}
          disabled={fields.length === 0}
          aria-label={t('addLabel')}
          data-filter-add=""
        >
          {t('add')}
        </Button>
      }
    >
      {picked !== null && draft !== null ? (
        <div ref={editorRef}>
          <FilterEditor field={picked} draft={draft} onDraftChange={setDraft} onApply={apply} formId={formId} />
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {fields.length > SEARCH_FROM ? (
            <Input
              size="sm"
              type="search"
              value={search}
              onValueChange={setSearch}
              aria-label={t('searchFields')}
              placeholder={t('searchFields')}
              className="mb-1"
            />
          ) : null}
          {shown.length === 0 ? (
            <p className="type-meta">{t('noFields')}</p>
          ) : (
            <ul className="flex flex-col">
              {shown.map((field) => (
                <li key={field.id}>
                  <Button variant="ghost" size="sm" onClick={() => pick(field)} className="w-full justify-start">
                    {field.label}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Popover>
  );
}
