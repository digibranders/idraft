'use client';

import type { ReactElement } from 'react';

import { toneOf } from './action-tone';
import type { RecordAction } from './types';
import { Menu, type MenuItemDef } from '@/components/ui/menu';

/** Where a group's actions sit in a row menu (16-drawers-dialogs-popovers.md section 5.3). */
const GROUP_ORDER: Readonly<Record<RecordAction<unknown>['group'], number>> = {
  open: 0,
  object: 1,
  copy: 2,
  destructive: 3,
};

/**
 * The items of one row's menu, the same for the More button and for the right click: open actions first and
 * destructive ones last. Each acts on this one row.
 */
export function rowMenuItems<TRow>(actions: readonly RecordAction<TRow>[], row: TRow, id: string): MenuItemDef[] {
  return [...actions]
    .sort((a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group])
    .map((action) => ({
      id: action.id,
      label: action.label,
      icon: action.icon,
      tone: toneOf(action),
      disabledReason: action.disabledReason ?? undefined,
      onSelect: () => action.onSelect([row], { ids: new Set([id]), allMatching: false }),
    }));
}

export interface MenuPoint {
  x: number;
  y: number;
}

export interface RowContextMenuProps {
  /** Where the menu opens, in viewport coordinates; `null` while it is closed. */
  point: MenuPoint | null;
  items: readonly MenuItemDef[];
  /** The menu's name: "Actions for crm pricing". */
  name: string;
  onClose: () => void;
  /**
   * Where focus goes when the menu closes: the cell that was clicked, so the arrow keys move on from it, or
   * `false` for nowhere (another menu has taken over).
   */
  finalFocus: () => HTMLElement | boolean;
}

/**
 * The row menu opened at the pointer by a right click or a touch long press. It is the `Menu` of the More
 * button, anchored to a button of no size at the point, so nothing is drawn but the menu and nothing is in the
 * page until it is used. The anchor is keyed by the point: a second right click opens the menu afresh there.
 */
export function RowContextMenu({ point, items, name, onClose, finalFocus }: RowContextMenuProps): ReactElement | null {
  if (point === null) return null;
  return (
    <Menu
      key={`${String(point.x)}:${String(point.y)}`}
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      finalFocus={finalFocus}
      items={items}
      trigger={
        <button
          type="button"
          tabIndex={-1}
          aria-label={name}
          data-slot="row-context-anchor"
          className="pointer-events-none fixed size-0 overflow-hidden p-0 opacity-0"
          // Coordinates of the pointer: dynamic, so inline, as the pinned columns' `left` is
          style={{ left: point.x, top: point.y }}
        />
      }
    />
  );
}
