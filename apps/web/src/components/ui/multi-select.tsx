'use client';

import { Combobox as ComboboxPrimitive } from '@base-ui/react/combobox';
import { Check, Plus, X } from 'lucide-react';
import { useMemo, useState, type ReactElement, type Ref } from 'react';

import { Icon } from './icon';
import { POPUP_COLLISION, POPUP_ITEM, POPUP_MOTION, POPUP_SURFACE } from './popup-styles';
import { TAG_CLASS, TAG_REMOVE_CLASS } from './tag';
import { cn } from '@/lib/utils';

/** Adding values the list does not hold: an alias, a new tag. */
export interface MultiSelectCreatable<TItem> {
  /** The row that adds what was typed: `Add "HubSpot CRM"`. */
  label: (query: string) => string;
  /** The value made from what was typed. */
  onCreate: (query: string) => TItem;
}

export interface MultiSelectProps<TItem> {
  value: readonly TItem[];
  onValueChange: (value: readonly TItem[]) => void;
  /** The suggestions; may be empty when every value is typed. */
  items: readonly TItem[];
  /** The text of a value: what its chip shows and what typing is matched against. */
  itemToString: (item: TItem) => string;
  /** A stable key, which also decides whether two values are the same one. */
  itemKey: (item: TItem) => string;
  creatable?: MultiSelectCreatable<TItem> | undefined;
  /** An example of a value, shown while nothing is chosen. */
  placeholder: string;
  /** What the open list says with no row to show: "No tags match "q4"", or how to add one. */
  emptyText: (query: string) => string;
  /** The name of the list of chosen values: "Chosen aliases". */
  chipsLabel: string;
  /** The name of a chip's remove button: "Remove HubSpot CRM". */
  removeLabel: (value: string) => string;
  /** How to reach and remove the chips by keyboard, for assistive technology. */
  chipsHint: (count: number) => string;
  /** How to remove a focused chip: "Press Backspace or Delete to remove". */
  chipHint: string;
  disabled?: boolean | undefined;
  /** The text field, so a form can focus it after a failed submit: `inputRef={field.ref}`. */
  inputRef?: Ref<HTMLInputElement> | undefined;
  id?: string | undefined;
  onBlur?: (() => void) | undefined;
  'aria-required'?: boolean | undefined;
  /** Layout only. The width of a field is set on `Field`. */
  className?: string | undefined;
}

/** A row of the list: a value, or the row that adds what was typed. */
type Option<TItem> =
  | { key: string; label: string; kind: 'item'; item: TItem }
  | { key: string; label: string; kind: 'create'; query: string };

const CREATE_KEY = '\u0000create';

/**
 * Several values from a list, or free values with suggestions: tags, aliases (10-forms.md section 6.4).
 * The chosen values are chips inside the field; Backspace in the empty field removes the last one, Left
 * Arrow from the start of the field moves to the chips. With `creatable`, what was typed can be added as
 * a value of its own. The chips wrap to three rows, then the field scrolls.
 */
export function MultiSelect<TItem>({
  value,
  onValueChange,
  items,
  itemToString,
  itemKey,
  creatable,
  placeholder,
  emptyText,
  chipsLabel,
  removeLabel,
  chipsHint,
  chipHint,
  disabled,
  inputRef,
  id,
  onBlur,
  'aria-required': ariaRequired,
  className,
}: MultiSelectProps<TItem>): ReactElement {
  const [query, setQuery] = useState('');
  const toOption = useMemo(
    () =>
      (item: TItem): Option<TItem> => ({ key: itemKey(item), label: itemToString(item), kind: 'item', item }),
    [itemKey, itemToString],
  );
  const chosen = useMemo(() => value.map(toOption), [value, toOption]);
  const typed = query.trim();
  const options = useMemo(() => {
    const listed = items.map(toOption);
    if (creatable === undefined || typed === '') return listed;
    // The add row shows only when nothing listed or chosen already has the typed text
    const lowered = typed.toLocaleLowerCase();
    const known = [...listed, ...chosen].some((option) => option.label.toLocaleLowerCase() === lowered);
    if (known) return listed;
    const create: Option<TItem> = { key: CREATE_KEY, label: creatable.label(typed), kind: 'create', query: typed };
    return [...listed, create];
  }, [items, toOption, creatable, typed, chosen]);

  const change = (next: Option<TItem>[]): void => {
    // A created value that equals a chosen one is not added twice
    const values = new Map<string, TItem>();
    for (const option of next) {
      const item = option.kind === 'item' ? option.item : creatable?.onCreate(option.query);
      if (item !== undefined && !values.has(itemKey(item))) values.set(itemKey(item), item);
    }
    onValueChange([...values.values()]);
    setQuery('');
  };

  return (
    <ComboboxPrimitive.Root<Option<TItem>, true>
      multiple
      items={options}
      value={chosen}
      onValueChange={change}
      inputValue={query}
      onInputValueChange={setQuery}
      itemToStringLabel={(option) => option.label}
      isItemEqualToValue={(a, b) => a.key === b.key}
      // Enter adds the typed value when it is the only row
      autoHighlight
      disabled={disabled}
    >
      <ComboboxPrimitive.InputGroup
        data-slot="multi-select"
        className={cn(
          // Three rows of chips with their gaps, then the field scrolls
          'flex max-h-[calc(3*var(--size-badge)+--spacing(4)+2px)] min-h-control w-full min-w-0 cursor-text items-center overflow-y-auto rounded-md border border-border bg-surface px-1.5 py-1 has-[input:focus-visible]:focus-ring has-[input[data-disabled]]:bg-surface-disabled has-[input[data-invalid]]:border-negative-solid',
          className,
        )}
      >
        <ComboboxPrimitive.Chips
          className="flex w-full min-w-0 flex-wrap items-center gap-1"
          aria-label={chosen.length > 0 ? chipsLabel : undefined}
        >
          {chosen.map((option) => (
            <ComboboxPrimitive.Chip
              key={option.key}
              aria-label={option.label}
              aria-description={chipHint}
              className={cn(TAG_CLASS, 'pr-1 outline-none focus-visible:focus-ring')}
            >
              <span className="truncate">{option.label}</span>
              <ComboboxPrimitive.ChipRemove aria-label={removeLabel(option.label)} className={TAG_REMOVE_CLASS}>
                <Icon icon={X} size="xs" />
              </ComboboxPrimitive.ChipRemove>
            </ComboboxPrimitive.Chip>
          ))}
          <ComboboxPrimitive.Input
            ref={inputRef}
            id={id}
            onBlur={onBlur}
            aria-required={ariaRequired}
            aria-description={chosen.length > 0 ? chipsHint(chosen.length) : undefined}
            placeholder={chosen.length > 0 ? '' : placeholder}
            className="h-badge min-w-24 flex-1 bg-transparent px-1.5 type-input-touch text-foreground outline-none placeholder:text-foreground-tertiary data-disabled:cursor-not-allowed data-disabled:text-foreground-disabled md:type-body"
          />
        </ComboboxPrimitive.Chips>
      </ComboboxPrimitive.InputGroup>
      <ComboboxPrimitive.Portal>
        <ComboboxPrimitive.Positioner
          align="start"
          sideOffset={4}
          collisionPadding={8}
          collisionAvoidance={POPUP_COLLISION}
          className="z-(--z-dropdown)"
        >
          <ComboboxPrimitive.Popup
            data-slot="multi-select-popup"
            className={cn(
              'flex max-h-[min(var(--size-popover-max-h),var(--available-height))] w-(--anchor-width) max-w-(--available-width) flex-col',
              POPUP_SURFACE,
              POPUP_MOTION,
            )}
          >
            <ComboboxPrimitive.Empty className="shrink-0">
              <span className="flex min-h-8 items-center px-3 py-1.5 type-meta">{emptyText(typed)}</span>
            </ComboboxPrimitive.Empty>
            <ComboboxPrimitive.List className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1 outline-none data-empty:hidden">
              {(option: Option<TItem>) => (
                <ComboboxPrimitive.Item
                  key={option.key}
                  value={option}
                  className={cn(POPUP_ITEM, 'h-auto min-h-8 py-1.5')}
                >
                  <span className="flex size-4 shrink-0 items-center justify-center">
                    {option.kind === 'create' ? (
                      <Icon icon={Plus} size="sm" />
                    ) : (
                      <ComboboxPrimitive.ItemIndicator className="flex">
                        <Icon icon={Check} size="sm" />
                      </ComboboxPrimitive.ItemIndicator>
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                </ComboboxPrimitive.Item>
              )}
            </ComboboxPrimitive.List>
          </ComboboxPrimitive.Popup>
        </ComboboxPrimitive.Positioner>
      </ComboboxPrimitive.Portal>
    </ComboboxPrimitive.Root>
  );
}
