'use client';

import { Drawer as DrawerPrimitive } from '@base-ui/react/drawer';
import type { ReactElement, ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface SheetProps extends Omit<DrawerPrimitive.Popup.Props, 'className' | 'render' | 'children'> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The id of the visible heading inside that names the sheet. */
  'aria-labelledby': string;
  children: ReactNode;
  className?: string | undefined;
}

/**
 * A full-screen sheet from the bottom edge, for detail views below 768 px (16-drawers-dialogs-popovers.md
 * section 2.6, the inspector's sheet). It is modal: focus stays inside, the page behind is inert, Escape
 * and a swipe down close it, and focus returns to what opened it unless `finalFocus` says otherwise.
 */
export function Sheet({ open, onOpenChange, children, className, ...props }: SheetProps): ReactElement {
  return (
    <DrawerPrimitive.Root open={open} onOpenChange={(next) => onOpenChange(next)} swipeDirection="down">
      <DrawerPrimitive.Portal className="[--z-dropdown:var(--z-drawer)]">
        <DrawerPrimitive.Backdrop
          data-slot="sheet-scrim"
          className="fixed inset-0 z-(--z-drawer) bg-(--scrim) transition-opacity duration-(--duration-slow) ease-standard data-ending-style:opacity-0 data-ending-style:duration-(--duration-base) data-ending-style:ease-exit data-starting-style:opacity-0"
        />
        <DrawerPrimitive.Viewport className="fixed inset-0 z-(--z-drawer) flex">
          <DrawerPrimitive.Popup
            data-slot="sheet"
            {...props}
            className={cn(
              // As the navigation drawer: the swipe offset is an inline transform, so enter and exit use one too
              'flex h-full w-full [transform:translateY(var(--drawer-swipe-movement-y,0px))] flex-col overflow-hidden bg-background transition-transform duration-(--duration-slow) ease-standard outline-none data-ending-style:[transform:translateY(100%)] data-ending-style:duration-(--duration-base) data-ending-style:ease-exit data-starting-style:[transform:translateY(100%)] data-swiping:duration-(--duration-instant)',
              className,
            )}
          >
            <DrawerPrimitive.Content className="flex min-h-0 flex-1 flex-col">{children}</DrawerPrimitive.Content>
          </DrawerPrimitive.Popup>
        </DrawerPrimitive.Viewport>
      </DrawerPrimitive.Portal>
    </DrawerPrimitive.Root>
  );
}
