'use client';

import { Combobox as ComboboxPrimitive } from '@base-ui/react/combobox';
import { Check, Plus, X } from 'lucide-react';
import { useMemo, useRef, useState, type FocusEvent, type ReactElement, type Ref } from 'react';

import { Icon } from './icon';
import { nameListAfterField } from './popup-label';
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
  /**
   * Whether text left in the field when focus leaves it becomes a value (with `creatable`), so an alias typed
   * before Save is not lost. Default `true`. Turn it off where a value has a cost when it is made, such as a
   * group created on save: text that is only a search then stays a search, and a value is added by choosing
   * its row or pressing Enter.
   */
  commitOnBlur?: boolean | undefined;
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
  commitOnBlur = true,
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
  // The element around the text field, which names the list after the field's label
  const field = useRef<HTMLDivElement>(null);
  const toOption = useMemo(
    () =>
      (item: TItem): Option<TItem> => ({ key: itemKey(item), label: itemToString(item), kind: 'item', item }),
    [itemKey, itemToString],
  );
  const chosen = useMemo(() => value.map(toOption), [value, toOption]);
  const typed = query.trim();
  const createOf = (text: string): Option<TItem> | null => {
    if (creatable === undefined || text === '') return null;
    // No add row when a suggestion or a chosen value already has the typed text
    const lowered = text.toLocaleLowerCase();
    const known = [...items.map(toOption), ...chosen].some((option) => option.label.toLocaleLowerCase() === lowered);
    return known ? null : { key: CREATE_KEY, label: creatable.label(text), kind: 'create', query: text };
  };
  const create = createOf(typed);
  // Chosen values are chips, not rows, so Enter on a highlighted row never removes one. The add row comes
  // first, so Enter adds what was typed rather than the first suggestion that contains it.
  const chosenKeys = new Set(chosen.map((option) => option.key));
  const listed = items.map(toOption).filter((option) => !chosenKeys.has(option.key));
  const options = create === null ? listed : [create, ...listed];

  const change = (next: readonly Option<TItem>[]): void => {
    // A created value that equals a chosen one is not added twice
    const values = new Map<string, TItem>();
    for (const option of next) {
      const item = option.kind === 'item' ? option.item : creatable?.onCreate(option.query);
      if (item !== undefined && !values.has(itemKey(item))) values.set(itemKey(item), item);
    }
    onValueChange([...values.values()]);
    setQuery('');
  };

  // Leaving the field keeps what was typed as a value, so an alias typed before Save is not lost
  const leave = (event: FocusEvent<HTMLDivElement>): void => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    if (commitOnBlur && create !== null) change([...chosen, create]);
    onBlur?.();
  };

  return (
    <ComboboxPrimitive.Root<Option<TItem>, true>
      multiple
      items={options}
      value={chosen}
      onValueChange={change}
      inputValue={query}
      onInputValueChange={setQuery}
      onOpenChange={(open, details) => {
        // The list stays open after each pick, so several values can be chosen in a row
        if (!open && details.reason === 'item-press') details.cancel();
      }}
      itemToStringLabel={(option) => option.label}
      isItemEqualToValue={(a, b) => a.key === b.key}
      autoHighlight
      disabled={disabled}
    >
      <ComboboxPrimitive.InputGroup
        ref={field}
        data-slot="multi-select"
        // Moving between the chips and the text field is not leaving the field
        onBlur={leave}
        className={cn(
          // Three rows of chips with their gaps, then the field scrolls; centered while they fit, from the
          // top once they overflow, so no chip ends up above the scroll origin
          'flex max-h-[calc(3*var(--size-badge)+--spacing(4)+2px)] min-h-control w-full min-w-0 cursor-text items-center-safe overflow-y-auto rounded-md border border-border bg-surface px-1.5 py-1 has-[input:focus-visible]:focus-ring has-[input[data-disabled]]:bg-surface-disabled has-[input[data-invalid]]:border-negative-solid',
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
            <ComboboxPrimitive.List
              ref={(list) => nameListAfterField(field.current, list)}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1 outline-none data-empty:hidden"
            >
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
