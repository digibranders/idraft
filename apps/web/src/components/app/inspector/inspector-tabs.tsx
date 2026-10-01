'use client';

import type { ReactElement, ReactNode } from 'react';

import { Tabs, TabsPanel, type TabItem } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

/** The tab row, padded to the header's 16 px edges as its last row. */
const TAB_ROW = cn('mt-1 shrink-0 px-4');

export interface InspectorTabsProps<TValue extends string> {
  /** Names the tab list: "Keyword sections". */
  label: string;
  value: TValue;
  onValueChange: (value: TValue) => void;
  /** At most five, "Overview" first (16-drawers-dialogs-popovers.md section 2.3). */
  items: readonly TabItem<TValue>[];
  /** One `InspectorPanel` per item. */
  children: ReactNode;
}

/**
 * The inspector's 44 px underline tabs: the last row of its header, with the panels in the body's scroll
 * container under it. Arrow keys choose a tab at once, so a panel shows its skeleton immediately.
 */
export function InspectorTabs<TValue extends string>({
  label,
  value,
  onValueChange,
  items,
  children,
}: InspectorTabsProps<TValue>): ReactElement {
  return (
    <Tabs
      variant="underline"
      label={label}
      value={value}
      onValueChange={onValueChange}
      items={items}
      className="min-h-0 flex-1"
      listClassName={TAB_ROW}
    >
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
    </Tabs>
  );
}

/** One tab's cards, 12 px apart in 16 px of padding. */
export function InspectorPanel<TValue extends string>({
  value,
  children,
}: {
  value: TValue;
  children: ReactNode;
}): ReactElement {
  return (
    <TabsPanel value={value} className="flex flex-col gap-3 p-4">
      {children}
    </TabsPanel>
  );
}

/** The body of an inspector without tabs: the same scroll container and spacing. */
export function InspectorBody({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-border">
      <div className="flex flex-col gap-3 p-4">{children}</div>
    </div>
  );
}
