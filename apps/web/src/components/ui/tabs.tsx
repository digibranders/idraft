'use client';

import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import { Ellipsis } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type ReactElement, type ReactNode, type RefObject } from 'react';

import { IconButton } from './icon-button';
import { Menu } from './menu';
import { segmentClassName } from './segmented-control';
import { cn } from '@/lib/utils';

export interface TabItem<TValue extends string> {
  value: TValue;
  /** A noun of one or two words. */
  label: string;
  /** A count after the label, already formatted. Underline tabs only. */
  count?: string | undefined;
  disabled?: boolean | undefined;
}

export interface TabsProps<TValue extends string> extends Omit<
  TabsPrimitive.Root.Props,
  'className' | 'render' | 'children' | 'value' | 'defaultValue' | 'onValueChange' | 'orientation'
> {
  /** `underline`: 44 px page and inspector tabs. `segmented`: 32 px tabs inside a panel, such as chart modes. */
  variant: 'underline' | 'segmented';
  /** Names the tab list. */
  label: string;
  value: TValue;
  /** The caller writes the choice to the URL, so a view can be shared and Back works. */
  onValueChange: (value: TValue) => void;
  items: readonly TabItem<TValue>[];
  /** One `TabsPanel` per item. */
  children: ReactNode;
  className?: string | undefined;
  /** Layout of the tab row only: the inspector pads it to its header's edges. */
  listClassName?: string | undefined;
  /**
   * Underline tabs only. The name of the trailing menu button that holds the tabs that do not fit the row
   * ("More tabs"). Without it every tab stays in the row.
   */
  overflowLabel?: string | undefined;
  /** Custom slot for placing the tab list (e.g. inside a toolbar). */
  renderList?: ((list: ReactElement) => ReactNode) | undefined;
}

/** The label with an unseen heavier copy under it, so the tab has the same width whether chosen or not. */
function ReservedLabel({ label }: { label: string }): ReactElement {
  return (
    <span className="grid">
      <span className="col-start-1 row-start-1">{label}</span>
      <span aria-hidden="true" className="invisible col-start-1 row-start-1 type-body-strong">
        {label}
      </span>
    </span>
  );
}

const UNDERLINE_TAB =
  'inline-flex h-tab shrink-0 cursor-pointer items-center gap-1.5 type-body text-foreground-secondary outline-none select-none not-data-active:not-data-disabled:hover:text-foreground focus-visible:focus-ring-inset data-active:type-body-strong data-active:text-primary-text data-disabled:cursor-not-allowed data-disabled:text-foreground-disabled';
/** The space between underline tabs, and between the last one and the More tabs button: `gap-6`. */
const TAB_GAP_PX = 24;

/** What an underline tab holds: the label, and a count after it. */
function UnderlineTabContent<TValue extends string>({ item }: { item: TabItem<TValue> }): ReactElement {
  return (
    <>
      <ReservedLabel label={item.label} />
      {/* A flex container ignores the space for layout; it keeps label and count apart in the name */}
      {item.count !== undefined ? ' ' : null}
      {item.count !== undefined ? <span className="num type-micro text-foreground-tertiary">{item.count}</span> : null}
    </>
  );
}

/**
 * The indexes of the tabs that stay in the row: all of them when they fit, otherwise the most that fit beside
 * the More tabs button. The chosen tab always stays, taking the place of the last one that fits.
 */
function fitTabs(widths: readonly number[], moreWidth: number, available: number, chosen: number): number[] {
  const all = widths.map((_, index) => index);
  const shownFor = (count: number): number[] =>
    count === all.length
      ? all
      : all.slice(0, count).map((index, slot) => (slot === count - 1 && chosen >= count ? chosen : index));
  for (let count = all.length; count > 1; count -= 1) {
    const shown = shownFor(count);
    const tabs = shown.reduce((sum, index) => sum + (widths[index] ?? 0) + TAB_GAP_PX, -TAB_GAP_PX);
    if (tabs + (count < all.length ? TAB_GAP_PX + moreWidth : 0) <= available) return shown;
  }
  return shownFor(Math.min(1, all.length));
}

/**
 * Which tabs fit the row. Each tab and the More tabs button are measured in a hidden copy, and the room is
 * the row's own width; until both are known, every tab is shown.
 */
function useTabFit<TValue extends string>(
  items: readonly TabItem<TValue>[],
  value: TValue,
  enabled: boolean,
): { row: RefObject<HTMLDivElement | null>; probe: RefObject<HTMLDivElement | null>; shown: readonly number[] } {
  const row = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState<number | null>(null);
  const [measured, setMeasured] = useState<{ tabs: readonly number[]; more: number } | null>(null);
  const signature = items.map((item) => `${item.value}|${item.label}|${item.count ?? ''}`).join('\n');
  useLayoutEffect(() => {
    const rowElement = row.current;
    const probeElement = probe.current;
    if (!enabled || rowElement === null || probeElement === null) return undefined;
    const measure = (): void => {
      const tabs = [...probeElement.querySelectorAll<HTMLElement>('[data-measure="tab"]')].map(
        (element) => element.offsetWidth,
      );
      const more = probeElement.querySelector<HTMLElement>('[data-measure="more"]')?.offsetWidth ?? 0;
      setMeasured((last) =>
        last !== null &&
        last.more === more &&
        last.tabs.length === tabs.length &&
        last.tabs.every((w, i) => w === tabs[i])
          ? last
          : { tabs, more },
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) if (entry.target === rowElement) setAvailable(entry.contentRect.width);
      // A label that changes width (a font arriving) changes the fit too
      measure();
    });
    observer.observe(rowElement);
    return () => observer.disconnect();
  }, [enabled, signature]);
  const known = enabled && available !== null && measured !== null && measured.tabs.length === items.length;
  const shown = known
    ? fitTabs(
        measured.tabs,
        measured.more,
        available,
        items.findIndex((item) => item.value === value),
      )
    : items.map((_, index) => index);
  return { row, probe, shown };
}

/**
 * Switches between panels on one page (09-buttons-controls.md section 12). Arrow keys move focus and
 * choose the tab at once, so a panel must show its skeleton immediately. Tabs that change the route path
 * are links, not tabs (`TabNav`); a view option is a `SegmentedControl`.
 */
export function Tabs<TValue extends string>({
  variant,
  label,
  value,
  onValueChange,
  items,
  children,
  className,
  listClassName,
  overflowLabel,
  renderList,
  ...props
}: TabsProps<TValue>): ReactElement {
  const underline = variant === 'underline';
  const overflowing = underline && overflowLabel !== undefined;
  const { row, probe, shown } = useTabFit(items, value, overflowing);
  const shownItems = shown.flatMap((index) => items[index] ?? []);
  const hiddenItems = items.filter((item) => !shownItems.includes(item));
  const list = (
    <TabsPrimitive.List
      aria-label={label}
      activateOnFocus
      className={cn(
        'relative flex',
        underline ? 'gap-6' : 'w-fit',
        // With the More tabs button the row carries the rule and the padding, so the rule runs under the button too
        underline && !overflowing && 'border-b border-border',
        overflowing ? 'shrink-0' : listClassName,
      )}
    >
      {shownItems.map((item) => (
        <TabsPrimitive.Tab
          key={item.value}
          value={item.value}
          disabled={item.disabled}
          // A segmented tab is drawn like a segment, which reads the chosen state from `data-checked`
          {...(!underline && item.value === value ? { 'data-checked': '' } : {})}
          className={underline ? UNDERLINE_TAB : segmentClassName('sm')}
        >
          {underline ? <UnderlineTabContent item={item} /> : <ReservedLabel label={item.label} />}
        </TabsPrimitive.Tab>
      ))}
      {underline ? (
        // No transition: the indicator is under the new tab at once (21-motion.md section 5)
        <TabsPrimitive.Indicator className="absolute bottom-0 left-(--active-tab-left) h-0.5 w-(--active-tab-width) bg-primary" />
      ) : null}
    </TabsPrimitive.List>
  );
  const listElement = overflowing ? (
    <div ref={row} className={cn('relative flex items-center gap-6 border-b border-border', listClassName)}>
      {list}
      {/* shortcut: a disabled tab that does not fit is left out of the menu, which cannot show a disabled item without a reason; no tab is disabled where this is used */}
      {hiddenItems.length === 0 ? null : (
        <Menu
          trigger={<IconButton icon={Ellipsis} size="icon-sm" label={overflowLabel} className="shrink-0" />}
          items={hiddenItems
            .filter((item) => item.disabled !== true)
            .map((item) => ({
              id: item.value,
              label: item.label,
              detail: item.count,
              onSelect: () => onValueChange(item.value),
            }))}
        />
      )}
      {/* A copy of every tab and of the More tabs button, out of sight and out of reach, to read their widths from */}
      <div
        ref={probe}
        aria-hidden="true"
        inert
        className="pointer-events-none invisible absolute top-0 left-0 flex h-0 w-max max-w-full gap-6 overflow-hidden"
      >
        {items.map((item) => (
          <span key={item.value} data-measure="tab" className={UNDERLINE_TAB}>
            <UnderlineTabContent item={item} />
          </span>
        ))}
        <span data-measure="more">
          <IconButton icon={Ellipsis} size="icon-sm" label={overflowLabel} />
        </span>
      </div>
    </div>
  ) : (
    list
  );
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      {...props}
      value={value}
      onValueChange={(next) => {
        const match = items.find((item) => item.value === next);
        if (match) onValueChange(match.value);
      }}
      className={cn('flex min-w-0 flex-col', className)}
    >
      {renderList !== undefined ? renderList(listElement) : listElement}
      {children}
    </TabsPrimitive.Root>
  );
}

export interface TabsPanelProps<TValue extends string> extends Omit<
  TabsPrimitive.Panel.Props,
  'className' | 'render' | 'value'
> {
  value: TValue;
  className?: string | undefined;
}

/** The content of one tab. Base UI makes the panel a tab stop, so its content is reachable right after the tab list. */
export function TabsPanel<TValue extends string>({ value, className, ...props }: TabsPanelProps<TValue>): ReactElement {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-panel"
      {...props}
      value={value}
      className={cn('min-w-0 rounded-xs outline-none focus-visible:focus-ring', className)}
    />
  );
}
