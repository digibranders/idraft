'use client';

import { Drawer as DrawerPrimitive } from '@base-ui/react/drawer';
import type { ReactElement, ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface DrawerProps extends Omit<DrawerPrimitive.Popup.Props, 'className' | 'render' | 'children' | 'title'> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Names the drawer for assistive technology. It is not shown. */
  title: string;
  children: ReactNode;
  className?: string | undefined;
}

/**
 * The navigation drawer below 1024 px (19-responsive-behavior.md section 3.1): a panel from the left edge,
 * 280 px wide at most, that always leaves 56 px of the page visible. It is modal: focus stays inside,
 * Escape, a click on the scrim and a swipe to the left close it, and focus returns to the button that
 * opened it.
 */
export function Drawer({ open, onOpenChange, title, children, className, ...props }: DrawerProps): ReactElement {
  return (
    <DrawerPrimitive.Root open={open} onOpenChange={(next) => onOpenChange(next)} swipeDirection="left">
      <DrawerPrimitive.Portal className="[--z-dropdown:var(--z-drawer)]">
        <DrawerPrimitive.Backdrop
          data-slot="drawer-scrim"
          className="fixed inset-0 z-(--z-drawer) bg-(--scrim) transition-opacity duration-(--duration-slow) ease-standard data-ending-style:opacity-0 data-ending-style:duration-(--duration-base) data-ending-style:ease-exit data-starting-style:opacity-0"
        />
        <DrawerPrimitive.Viewport className="fixed inset-0 z-(--z-drawer) flex">
          <DrawerPrimitive.Popup
            data-slot="drawer"
            {...props}
            className={cn(
              // Base UI writes the swipe offset as an inline transform, so enter and exit use `transform` too:
              // a `translate` beside it would add up and move the panel twice as far as the finger
              'h-full w-[min(17.5rem,calc(100vw-3.5rem))] [transform:translateX(var(--drawer-swipe-movement-x,0px))] overflow-y-auto overscroll-contain border-r border-border bg-surface transition-transform duration-(--duration-slow) ease-standard outline-none data-ending-style:[transform:translateX(-100%)] data-ending-style:duration-(--duration-base) data-ending-style:ease-exit data-starting-style:[transform:translateX(-100%)] data-swiping:duration-(--duration-instant)',
              className,
            )}
          >
            <DrawerPrimitive.Content className="flex min-h-full flex-col">
              <DrawerPrimitive.Title className="sr-only">{title}</DrawerPrimitive.Title>
              {children}
            </DrawerPrimitive.Content>
          </DrawerPrimitive.Popup>
        </DrawerPrimitive.Viewport>
      </DrawerPrimitive.Portal>
    </DrawerPrimitive.Root>
  );
}
