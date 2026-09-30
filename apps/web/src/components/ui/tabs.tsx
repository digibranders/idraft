'use client';

import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import type { ReactElement, ReactNode } from 'react';

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
  ...props
}: TabsProps<TValue>): ReactElement {
  const underline = variant === 'underline';
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
      <TabsPrimitive.List
        aria-label={label}
        activateOnFocus
        className={cn('relative flex', underline ? 'gap-6 border-b border-border' : 'w-fit')}
      >
        {items.map((item) => (
          <TabsPrimitive.Tab
            key={item.value}
            value={item.value}
            disabled={item.disabled}
            // A segmented tab is drawn like a segment, which reads the chosen state from `data-checked`
            {...(!underline && item.value === value ? { 'data-checked': '' } : {})}
            className={
              underline
                ? cn(
                    'inline-flex h-tab shrink-0 cursor-pointer items-center gap-1.5 type-body text-foreground-secondary outline-none select-none not-data-active:not-data-disabled:hover:text-foreground focus-visible:focus-ring-inset data-active:type-body-strong data-active:text-primary-text data-disabled:cursor-not-allowed data-disabled:text-foreground-disabled',
                  )
                : segmentClassName('sm')
            }
          >
            <ReservedLabel label={item.label} />
            {/* A flex container ignores the space for layout; it keeps label and count apart in the name */}
            {underline && item.count !== undefined ? ' ' : null}
            {underline && item.count !== undefined ? (
              <span className="num type-micro text-foreground-tertiary">{item.count}</span>
            ) : null}
          </TabsPrimitive.Tab>
        ))}
        {underline ? (
          // No transition: the indicator is under the new tab at once (21-motion.md section 5)
          <TabsPrimitive.Indicator className="absolute bottom-0 left-(--active-tab-left) h-0.5 w-(--active-tab-width) bg-primary" />
        ) : null}
      </TabsPrimitive.List>
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
