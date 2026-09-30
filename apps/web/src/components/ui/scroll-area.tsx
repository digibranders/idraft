import { ScrollArea as ScrollAreaPrimitive } from '@base-ui/react/scroll-area';
import type { ReactElement, ReactNode } from 'react';

import { cn } from '@/lib/utils';

/** `popover` and `menu`: 400 px. `command`: 480 px. `fill`: the height of the parent. */
export type ScrollAreaHeight = 'popover' | 'menu' | 'command' | 'fill';

export interface ScrollAreaProps extends Omit<ScrollAreaPrimitive.Root.Props, 'children' | 'className' | 'render'> {
  maxHeight: ScrollAreaHeight;
  /**
   * Names the region. Give it when the content has nothing focusable: the region then takes keyboard focus
   * while it overflows, so it can be scrolled with the arrow keys. Without it the region is never a tab
   * stop, because the controls inside already bring the keyboard user to every part of it.
   */
  label?: string | undefined;
  children: ReactNode;
  className?: string | undefined;
}

const HEIGHT_CLASS: Readonly<Record<ScrollAreaHeight, string>> = {
  popover: cn('max-h-100'),
  menu: cn('max-h-100'),
  command: cn('max-h-120'),
  fill: cn('h-full'),
};

/**
 * A scrolling region with a thin token-colored scrollbar, for popover bodies, menus and panels whose header
 * and footer stay put (16-drawers-dialogs-popovers.md section 5.1). Tables and the page scroll on their own.
 */
export function ScrollArea({ maxHeight, label, children, className, ...props }: ScrollAreaProps): ReactElement {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      {...props}
      className={cn('relative flex min-h-0 flex-col', maxHeight === 'fill' && 'h-full', className)}
    >
      <ScrollAreaPrimitive.Viewport
        className={cn('min-h-0 overscroll-contain focus-visible:focus-ring-inset', HEIGHT_CLASS[maxHeight])}
        // Base UI makes the viewport a tab stop only while it overflows. A named region keeps that; an
        // unnamed one is taken out of the tab order, since an unnamed stop tells a screen reader nothing.
        {...(label === undefined ? { tabIndex: -1 } : { role: 'region', 'aria-label': label })}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar
        orientation="vertical"
        className="flex w-2 touch-none justify-center py-0.5 select-none"
      >
        <ScrollAreaPrimitive.Thumb className="w-1 rounded-full bg-border-strong" />
      </ScrollAreaPrimitive.Scrollbar>
    </ScrollAreaPrimitive.Root>
  );
}
