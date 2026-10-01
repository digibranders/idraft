'use client';

import { Combobox as ComboboxPrimitive } from '@base-ui/react/combobox';
import { Check, ChevronDown, X } from 'lucide-react';
import { useMemo, useRef, useState, type ReactElement, type ReactNode, type Ref } from 'react';

import { Icon } from './icon';
import { IconButton } from './icon-button';
import { InputGroup } from './input-group';
import { inputVariants, type InputSize } from './input-variants';
import { nameListAfterField } from './popup-label';
import { POPUP_COLLISION, POPUP_GROUP_LABEL, POPUP_ITEM, POPUP_MOTION, POPUP_SURFACE } from './popup-styles';
import { Spinner } from './spinner';
import { cn } from '@/lib/utils';

/**
 * A button that opens the list, with the search field inside the popup: the form of a switcher. Without it
 * the combobox is a text field with the list below it: the form of a field in a form. The button is a
 * combobox for assistive technology, which is not named by its content, so it needs a name that says what
 * it chooses and what is chosen: "Project: Fynix".
 */
type ComboboxTrigger =
  { trigger: ReactElement; triggerLabel: string } | { trigger?: undefined; triggerLabel?: undefined };

interface ComboboxOwnProps<TItem> {
  value: TItem | null;
  onValueChange: (value: TItem | null) => void;
  items: readonly TItem[];
  /** The text of an item: what the input shows for the chosen one and what typing is matched against. */
  itemToString: (item: TItem) => string;
  /** A stable key, which also decides whether two items are the same one. */
  itemKey: (item: TItem) => string;
  /** Items with the same group name that follow each other are listed under it. */
  groupOf?: ((item: TItem) => string) | undefined;
  /** A richer row than the text alone, such as a name with a second line. */
  renderItem?: ((item: TItem) => ReactNode) | undefined;
  /**
   * Server mode: the caller loads `items` for the query (debounced 250 ms, from 2 characters, 50 results
   * at most) and the list is shown as given. Without it, the list is filtered here as the user types.
   */
  onQueryChange?: ((query: string) => void) | undefined;
  /** Set by the caller once a request has run for 300 ms. The previous results stay visible. */
  loading?: boolean | undefined;
  /** "Searching". */
  loadingText?: string | undefined;
  /** "No locations match "berl"". */
  emptyText: (query: string) => string;
  /** An example of what to type, or the name of the search field inside a popup. */
  placeholder: string;
  /** The name of the button that removes the value: "Clear". */
  clearLabel: string;
  /** The name of the button that opens the list: "Show options". */
  openLabel: string;
  /** Stays at the bottom of the popup, under the list: an action such as "Create project". */
  footer?: ReactNode | undefined;
  size?: InputSize | undefined;
  disabled?: boolean | undefined;
  name?: string | undefined;
  required?: boolean | undefined;
  /** The text field, so a form can focus it after a failed submit: `inputRef={field.ref}`. */
  inputRef?: Ref<HTMLInputElement> | undefined;
  id?: string | undefined;
  onBlur?: (() => void) | undefined;
  'aria-required'?: boolean | undefined;
  /** Layout only, on the field. The width of a field is set on `Field`. */
  className?: string | undefined;
}

export type ComboboxProps<TItem> = ComboboxOwnProps<TItem> & ComboboxTrigger;

/**
 * Base UI gives the buttons of the field the label, the description and the invalid state of the field.
 * They have a name of their own, which their tooltip shows too, and they are not what is invalid.
 */
const OWN_NAME = { 'aria-labelledby': undefined, 'aria-describedby': undefined, 'aria-invalid': undefined } as const;

/** The reasons the input changes because of the user's own typing. */
const TYPED: ReadonlySet<string> = new Set(['input-change', 'input-clear', 'input-paste', 'clear-press']);

interface ItemGroup<TItem> {
  value: string;
  items: TItem[];
}

/** Consecutive items with the same group name form one group; the order of the items is kept. */
function grouped<TItem>(items: readonly TItem[], groupOf: (item: TItem) => string): ItemGroup<TItem>[] {
  const groups: ItemGroup<TItem>[] = [];
  for (const item of items) {
    const name = groupOf(item);
    const last = groups[groups.length - 1];
    if (last && last.value === name) last.items.push(item);
    else groups.push({ value: name, items: [item] });
  }
  return groups;
}

/**
 * One choice from a long or server-loaded list, found by typing (10-forms.md section 6.3). Focus stays in
 * the text field while arrows move through the list, Enter chooses and Escape closes. Short known lists
 * are a `Select`; several values are a `MultiSelect`.
 */
export function Combobox<TItem>({
  value,
  onValueChange,
  items,
  itemToString,
  itemKey,
  groupOf,
  renderItem,
  onQueryChange,
  loading = false,
  loadingText,
  emptyText,
  placeholder,
  clearLabel,
  openLabel,
  trigger,
  triggerLabel,
  footer,
  size = 'md',
  disabled,
  name,
  required,
  inputRef,
  id,
  onBlur,
  'aria-required': ariaRequired,
  className,
}: ComboboxProps<TItem>): ReactElement {
  const [query, setQuery] = useState('');
  // The element around the text field, which names the list after the field's label
  const field = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => (groupOf ? grouped(items, groupOf) : undefined), [items, groupOf]);
  const row = (item: TItem): ReactElement => (
    <ComboboxPrimitive.Item key={itemKey(item)} value={item} className={cn(POPUP_ITEM, 'h-auto min-h-8 py-1.5')}>
      <span className="flex size-4 shrink-0 items-center justify-center">
        <ComboboxPrimitive.ItemIndicator className="flex">
          <Icon icon={Check} size="sm" />
        </ComboboxPrimitive.ItemIndicator>
      </span>
      <span className="min-w-0 flex-1">{renderItem ? renderItem(item) : itemToString(item)}</span>
    </ComboboxPrimitive.Item>
  );
  return (
    <ComboboxPrimitive.Root<TItem>
      items={groups ?? items}
      value={value}
      onValueChange={(next) => onValueChange(next)}
      itemToStringLabel={itemToString}
      isItemEqualToValue={(a, b) => itemKey(a) === itemKey(b)}
      // In server mode the items are already the answer to the query
      {...(onQueryChange ? { filter: null } : {})}
      onInputValueChange={(next, details) => {
        setQuery(next);
        // Only what the user types or clears is a query. Choosing an item also rewrites the input, and
        // that must not start a search for the chosen name.
        if (TYPED.has(details.reason)) onQueryChange?.(next);
      }}
      // A switcher is searched and confirmed with Enter, so the first match is ready to be chosen
      {...(trigger ? { autoHighlight: true } : {})}
      disabled={disabled}
      name={name}
      required={required}
    >
      {trigger ? (
        <ComboboxPrimitive.Trigger render={trigger} aria-label={triggerLabel} />
      ) : (
        <ComboboxPrimitive.InputGroup
          render={
            <InputGroup
              ref={field}
              data-slot="combobox"
              size={size}
              className={className}
              trailing={
                <>
                  <ComboboxPrimitive.Clear
                    render={<IconButton icon={X} label={clearLabel} size="icon-xs" {...OWN_NAME} />}
                  />
                  <ComboboxPrimitive.Trigger
                    // Base UI names the button after the field. It has a name of its own, which its tooltip shows too.
                    render={<IconButton icon={ChevronDown} label={openLabel} size="icon-xs" {...OWN_NAME} />}
                  />
                </>
              }
            >
              <ComboboxPrimitive.Input
                ref={inputRef}
                id={id}
                onBlur={onBlur}
                aria-required={ariaRequired}
                placeholder={placeholder}
                className={inputVariants({ variant: 'bare' })}
              />
            </InputGroup>
          }
        />
      )}
      <ComboboxPrimitive.Portal>
        <ComboboxPrimitive.Positioner
          align="start"
          sideOffset={4}
          collisionPadding={8}
          collisionAvoidance={POPUP_COLLISION}
          className="z-(--z-dropdown)"
        >
          <ComboboxPrimitive.Popup
            data-slot="combobox-popup"
            // With the search field inside, the popup is a dialog and needs a name
            {...(trigger ? { 'aria-label': placeholder } : {})}
            className={cn(
              'flex max-h-[min(var(--size-popover-max-h),var(--available-height))] max-w-(--available-width) flex-col',
              trigger ? 'w-popover-min' : 'w-(--anchor-width)',
              POPUP_SURFACE,
              POPUP_MOTION,
            )}
          >
            {trigger ? (
              <div className="shrink-0 border-b border-border-subtle p-1">
                <ComboboxPrimitive.Input
                  placeholder={placeholder}
                  aria-label={placeholder}
                  className={inputVariants({ variant: 'outline', size: 'sm' })}
                />
              </div>
            ) : null}
            <ComboboxPrimitive.Status className="shrink-0">
              {loading ? (
                <span className="flex h-8 items-center gap-2 px-3 type-meta">
                  <Spinner size="sm" />
                  {loadingText}
                </span>
              ) : null}
            </ComboboxPrimitive.Status>
            {/* While a search runs, "no match" would be a guess */}
            <ComboboxPrimitive.Empty className="shrink-0">
              {loading ? null : (
                <span className="flex min-h-8 items-center px-3 py-1.5 type-meta">{emptyText(query)}</span>
              )}
            </ComboboxPrimitive.Empty>
            <ComboboxPrimitive.List
              ref={(list) => nameListAfterField(field.current, list)}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1 outline-none data-empty:hidden"
            >
              {groups
                ? (group: ItemGroup<TItem>) => (
                    <ComboboxPrimitive.Group key={group.value} items={group.items}>
                      <ComboboxPrimitive.GroupLabel className={POPUP_GROUP_LABEL}>
                        {group.value}
                      </ComboboxPrimitive.GroupLabel>
                      <ComboboxPrimitive.Collection>{row}</ComboboxPrimitive.Collection>
                    </ComboboxPrimitive.Group>
                  )
                : row}
            </ComboboxPrimitive.List>
            {footer === undefined ? null : <div className="shrink-0 border-t border-border-subtle p-1">{footer}</div>}
          </ComboboxPrimitive.Popup>
        </ComboboxPrimitive.Positioner>
      </ComboboxPrimitive.Portal>
    </ComboboxPrimitive.Root>
  );
}
