'use client';

import { Menu as MenuPrimitive } from '@base-ui/react/menu';
import { Check, ChevronRight, type LucideIcon } from 'lucide-react';
import { useId, type ReactElement, type ReactNode } from 'react';

import { Icon } from './icon';
import { Kbd, useAriaKeyShortcuts } from './kbd';
import { POPUP_COLLISION, POPUP_GROUP_LABEL, POPUP_ITEM, POPUP_MOTION, POPUP_SURFACE } from './popup-styles';
import { cn } from '@/lib/utils';

export interface MenuItemDef {
  /** Stable within the menu. For radio items it is also the value. */
  id: string;
  label: string;
  /** Either every item of a group has an icon or none does. */
  icon?: LucideIcon | undefined;
  /** Key ids as `Kbd` takes them. */
  shortcut?: readonly string[] | undefined;
  /** `link` navigates and needs `link`; `submenu` needs `items`. */
  kind?: 'action' | 'checkbox' | 'radio' | 'submenu' | 'link' | undefined;
  /** For checkbox and radio items. */
  checked?: boolean | undefined;
  /** Items with the same group name that follow each other are listed under it. */
  group?: string | undefined;
  /** Destructive items are listed last, after a separator. */
  tone?: 'default' | 'destructive' | undefined;
  /** Disables the item and shows why in place of the shortcut. The item stays reachable by keyboard. */
  disabledReason?: string | undefined;
  /** A short fact at the end of the item, such as "14 of 20 left today". It takes the place of a shortcut; a reason takes its place. */
  detail?: string | undefined;
  onSelect?: (() => void) | undefined;
  /** The link to render for `kind: 'link'`: the router's `<Link href="..." />` or an `<a>`. */
  link?: ReactElement | undefined;
  /** The items of a submenu. One level only. */
  items?: readonly MenuItemDef[] | undefined;
}

export interface MenuProps extends Omit<MenuPrimitive.Popup.Props, 'className' | 'render' | 'children'> {
  /** The button that opens the menu. It must pass its props and its ref on to a DOM element. */
  trigger: ReactElement;
  items: readonly MenuItemDef[];
  /** `end` for a trigger at the right edge of a region. */
  align?: 'start' | 'end' | undefined;
  /**
   * Text above the items that is not an item, such as the account menu's name and email. It is not
   * focusable; a separator follows it.
   */
  header?: ReactNode | undefined;
  open?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
}

const POPUP = cn(
  'max-h-[min(var(--size-popover-max-h),var(--available-height))] max-w-menu-max min-w-menu-min overflow-y-auto p-1',
  POPUP_SURFACE,
  POPUP_MOTION,
);
const DESTRUCTIVE = cn('text-negative-text data-highlighted:bg-negative-subtle');
const SEPARATOR = cn('my-1 h-px bg-border-subtle');

interface Section {
  name: string | undefined;
  items: MenuItemDef[];
}

/** Consecutive items with the same group name form one section; the order of the items is kept. */
function sections(items: readonly MenuItemDef[]): Section[] {
  const result: Section[] = [];
  for (const item of items) {
    const last = result[result.length - 1];
    if (last && last.name === item.group) last.items.push(item);
    else result.push({ name: item.group, items: [item] });
  }
  return result;
}

/** Runs of radio items become one radio group each; everything else stays a single item. */
function runs(items: readonly MenuItemDef[]): (MenuItemDef | MenuItemDef[])[] {
  const result: (MenuItemDef | MenuItemDef[])[] = [];
  for (const item of items) {
    const last = result[result.length - 1];
    if (item.kind !== 'radio') result.push(item);
    else if (Array.isArray(last)) last.push(item);
    else result.push([item]);
  }
  return result;
}

interface RowProps {
  item: MenuItemDef;
  /** A submenu cannot open another one. */
  nested: boolean;
}

/** What every kind of item shows: the leading slot, the label and what sits at the end of the row. */
function RowContent({
  item,
  indicator,
  reasonId,
}: {
  item: MenuItemDef;
  indicator?: ReactNode;
  reasonId: string;
}): ReactElement {
  const tertiary = item.tone === 'destructive' ? undefined : 'text-foreground-tertiary';
  return (
    <>
      {indicator === undefined ? null : (
        <span className="flex size-4 shrink-0 items-center justify-center">{indicator}</span>
      )}
      {item.icon ? <Icon icon={item.icon} size="sm" className={tertiary} /> : null}
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.disabledReason !== undefined || item.detail !== undefined ? (
        <span id={reasonId} className="pl-4 type-meta">
          {item.disabledReason ?? item.detail}
        </span>
      ) : item.shortcut ? (
        <Kbd keys={item.shortcut} decorative className="pl-4" />
      ) : null}
    </>
  );
}

function Row({ item, nested }: RowProps): ReactElement {
  const reasonId = useId();
  const ariaKeyShortcuts = useAriaKeyShortcuts(item.shortcut);
  const disabled = item.disabledReason !== undefined;
  const shared = {
    disabled,
    'aria-keyshortcuts': ariaKeyShortcuts,
    'aria-describedby': disabled || item.detail !== undefined ? reasonId : undefined,
    className: cn(POPUP_ITEM, item.tone === 'destructive' && DESTRUCTIVE),
  };
  switch (item.kind) {
    case 'checkbox':
      return (
        <MenuPrimitive.CheckboxItem
          {...shared}
          label={item.label}
          checked={item.checked === true}
          onCheckedChange={() => item.onSelect?.()}
        >
          <RowContent
            item={item}
            reasonId={reasonId}
            indicator={
              <MenuPrimitive.CheckboxItemIndicator className="flex">
                <Icon icon={Check} size="sm" />
              </MenuPrimitive.CheckboxItemIndicator>
            }
          />
        </MenuPrimitive.CheckboxItem>
      );
    case 'radio':
      return (
        <MenuPrimitive.RadioItem {...shared} label={item.label} value={item.id}>
          <RowContent
            item={item}
            reasonId={reasonId}
            indicator={<MenuPrimitive.RadioItemIndicator className="size-1.5 rounded-full bg-foreground" />}
          />
        </MenuPrimitive.RadioItem>
      );
    case 'link':
      // A link that is disabled has nowhere to go: it is listed as a plain item that says why
      if (disabled) break;
      return (
        <MenuPrimitive.LinkItem
          {...shared}
          label={item.label}
          closeOnClick
          {...(item.link ? { render: item.link } : {})}
          onClick={() => item.onSelect?.()}
        >
          <RowContent item={item} reasonId={reasonId} />
        </MenuPrimitive.LinkItem>
      );
    case 'submenu':
      if (nested || !item.items) break;
      return (
        <MenuPrimitive.SubmenuRoot>
          <MenuPrimitive.SubmenuTrigger {...shared} label={item.label}>
            <RowContent item={item} reasonId={reasonId} />
            <Icon icon={ChevronRight} size="sm" className="text-foreground-tertiary" />
          </MenuPrimitive.SubmenuTrigger>
          <MenuPrimitive.Portal>
            <MenuPrimitive.Positioner sideOffset={4} collisionPadding={8} className="z-(--z-dropdown)">
              <MenuPrimitive.Popup className={POPUP}>
                <Items items={item.items} nested />
              </MenuPrimitive.Popup>
            </MenuPrimitive.Positioner>
          </MenuPrimitive.Portal>
        </MenuPrimitive.SubmenuRoot>
      );
    default:
      break;
  }
  return (
    <MenuPrimitive.Item {...shared} label={item.label} onClick={() => item.onSelect?.()}>
      <RowContent item={item} reasonId={reasonId} />
    </MenuPrimitive.Item>
  );
}

function Items({ items, nested }: { items: readonly MenuItemDef[]; nested: boolean }): ReactElement {
  // Destructive items go last, after a separator, whatever position they were given in
  const regular = items.filter((item) => item.tone !== 'destructive');
  const destructive = items.filter((item) => item.tone === 'destructive');
  const groups = sections(regular);
  if (destructive.length > 0) groups.push({ name: undefined, items: destructive });
  return (
    <>
      {groups.map((section, index) => {
        const rows = runs(section.items).map((entry) =>
          Array.isArray(entry) ? (
            <MenuPrimitive.RadioGroup
              key={entry.map((item) => item.id).join(' ')}
              value={entry.find((item) => item.checked === true)?.id ?? null}
              onValueChange={(id: unknown) => entry.find((item) => item.id === id)?.onSelect?.()}
            >
              {entry.map((item) => (
                <Row key={item.id} item={item} nested={nested} />
              ))}
            </MenuPrimitive.RadioGroup>
          ) : (
            <Row key={entry.id} item={entry} nested={nested} />
          ),
        );
        return (
          <MenuPrimitive.Group key={section.items[0]?.id ?? String(index)}>
            {index === 0 ? null : <MenuPrimitive.Separator className={SEPARATOR} />}
            {section.name === undefined ? null : (
              <MenuPrimitive.GroupLabel className={POPUP_GROUP_LABEL}>{section.name}</MenuPrimitive.GroupLabel>
            )}
            {rows}
          </MenuPrimitive.Group>
        );
      })}
    </>
  );
}

/**
 * A list of commands or single choices opened from a button (09-buttons-controls.md section 10). Enter,
 * Space or Down Arrow open it, arrows move, typing a letter jumps, Enter activates and Escape closes and
 * returns focus to the trigger. A menu holds commands, never a form: a value chosen from a list is a
 * `Select`.
 */
export function Menu({
  trigger,
  items,
  align = 'start',
  header,
  open,
  onOpenChange,
  ...props
}: MenuProps): ReactElement {
  return (
    <MenuPrimitive.Root
      {...(open === undefined ? {} : { open })}
      {...(onOpenChange ? { onOpenChange: (next: boolean) => onOpenChange(next) } : {})}
    >
      <MenuPrimitive.Trigger render={trigger} />
      <MenuPrimitive.Portal>
        <MenuPrimitive.Positioner
          align={align}
          sideOffset={4}
          collisionPadding={8}
          collisionAvoidance={POPUP_COLLISION}
          className="z-(--z-dropdown)"
        >
          <MenuPrimitive.Popup data-slot="menu" {...props} className={POPUP}>
            {header === undefined ? null : (
              <>
                <div role="presentation" data-slot="menu-header" className="px-2 py-1.5">
                  {header}
                </div>
                <MenuPrimitive.Separator className={SEPARATOR} />
              </>
            )}
            <Items items={items} nested={false} />
          </MenuPrimitive.Popup>
        </MenuPrimitive.Positioner>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Root>
  );
}
