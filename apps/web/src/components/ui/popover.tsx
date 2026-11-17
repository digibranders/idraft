'use client';

import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import type { ReactElement, ReactNode } from 'react';

import { POPUP_COLLISION, POPUP_MOTION, POPUP_SURFACE } from './popup-styles';
import { ScrollArea } from './scroll-area';
import { cn } from '@/lib/utils';

/** `notifications` is for the notification center only, `date-range` for the date range picker only. */
export type PopoverWidth = 'content' | 'min' | 'max' | 'notifications' | 'date-range' | 'narrow' | 'wide';
type PopoverPadding = 'list' | 'text' | 'menu' | 'none';

export interface PopoverProps extends Omit<
  PopoverPrimitive.Popup.Props,
  'className' | 'render' | 'children' | 'title'
> {
  /** The control the popover belongs to. It must pass its props and its ref on to a DOM element. */
  trigger: ReactElement;
  /** A visible heading that names the popup. Without it, pass `aria-label`. */
  title?: string | undefined;
  /**
   * 12 px around lists (filters, column chooser), 16 px around text (a method definition). `menu` is 4 px, for rows
   * that pad themselves like a menu's; `none` is for a popup whose sections pad themselves.
   */
  padding?: PopoverPadding | undefined;
  /**
   * `content` sizes to the content between 280 and 360 px. `narrow` (256 px) and `wide` (384 px) are the Citations
   * pickers' fixed widths.
   */
  width?: PopoverWidth | undefined;
  side?: 'bottom' | 'top' | 'left' | 'right' | undefined;
  align?: 'start' | 'center' | 'end' | undefined;
  /** Distance from the trigger in px. Default 4; the Citations competitors picker sits 8 px away, as the preview's does. */
  sideOffset?: number | undefined;
  open?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  children: ReactNode;
  /** Stays in place while the body scrolls. */
  footer?: ReactNode | undefined;
  className?: string | undefined;
}

const WIDTH_CLASS: Readonly<Record<PopoverWidth, string>> = {
  content: cn('max-w-[min(var(--size-popover-max),var(--available-width))] min-w-popover-min'),
  min: cn('w-popover-min'),
  max: cn('w-popover-max'),
  notifications: cn('w-95'),
  'date-range': cn('w-162'),
  // The popup is already capped by `max-w-(--available-width)`
  narrow: cn('w-64'),
  wide: cn('w-96'),
};
const PADDING_CLASS: Readonly<Record<PopoverPadding, string>> = {
  list: cn('p-3'),
  text: cn('p-4'),
  menu: cn('p-1'),
  none: '',
};
/** `menu` and `none` pad their own sections, so the sections sit flush (no 12 px between them). */
const GAP_CLASS: Readonly<Record<PopoverPadding, string>> = {
  list: cn('gap-3'),
  text: cn('gap-3'),
  menu: '',
  none: '',
};

/**
 * A short interaction anchored to a control (16-drawers-dialogs-popovers.md section 5.1): a filter editor,
 * quick settings, a definition. It is not modal: focus moves into it, Escape and a click outside close
 * it, and focus returns to the trigger. It may open one more floating layer and never a dialog.
 */
export function Popover({
  trigger,
  title,
  padding = 'list',
  width = 'content',
  side = 'bottom',
  align = 'start',
  sideOffset = 4,
  open,
  onOpenChange,
  children,
  footer,
  className,
  ...props
}: PopoverProps): ReactElement {
  return (
    <PopoverPrimitive.Root
      {...(open === undefined ? {} : { open })}
      {...(onOpenChange ? { onOpenChange: (next: boolean) => onOpenChange(next) } : {})}
    >
      <PopoverPrimitive.Trigger render={trigger} />
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner
          side={side}
          align={align}
          sideOffset={sideOffset}
          collisionPadding={8}
          collisionAvoidance={POPUP_COLLISION}
          className="z-(--z-dropdown)"
        >
          <PopoverPrimitive.Popup
            data-slot="popover"
            {...props}
            className={cn(
              'flex max-h-[min(var(--size-popover-max-h),var(--available-height))] max-w-(--available-width) flex-col',
              POPUP_SURFACE,
              POPUP_MOTION,
              WIDTH_CLASS[width],
              className,
            )}
          >
            <ScrollArea maxHeight="fill" className="min-h-0 flex-1">
              <div className={cn('flex flex-col', GAP_CLASS[padding], PADDING_CLASS[padding])}>
                {title === undefined ? null : (
                  <PopoverPrimitive.Title className="type-subsection-title">{title}</PopoverPrimitive.Title>
                )}
                {children}
              </div>
            </ScrollArea>
            {footer === undefined ? null : (
              <div
                className={cn(
                  'flex shrink-0 items-center justify-end gap-2 border-t border-border-subtle',
                  PADDING_CLASS[padding],
                )}
              >
                {footer}
              </div>
            )}
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
