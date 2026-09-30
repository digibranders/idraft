'use client';

import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip';
import { Children, cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';

import { Kbd, useAriaKeyShortcuts } from './kbd';

/** A tooltip opens after 400 ms of hover. Within 300 ms of one closing, the next opens at once (16 section 6.1). */
const OPEN_DELAY_MS = 400;
const INSTANT_WINDOW_MS = 300;
const OFFSET_PX = 6;

export interface TooltipProviderProps {
  children: ReactNode;
  /** The hover delay. Tests pass 0 so they do not wait. */
  delay?: number | undefined;
}

/** Mounted once at the root of the app, so every tooltip shares the delay and the instant window. */
export function TooltipProvider({ children, delay = OPEN_DELAY_MS }: TooltipProviderProps): ReactElement {
  return (
    <TooltipPrimitive.Provider delay={delay} closeDelay={0} timeout={INSTANT_WINDOW_MS}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

type Describable = { 'aria-describedby'?: string; 'aria-keyshortcuts'?: string };

export interface TooltipProps {
  /** One line that names or explains the trigger. Text only: no links, no controls. */
  content: string;
  /** A second line in a lighter color, for detail such as the counts behind a value. */
  detail?: string | undefined;
  /** `bottom` for table headers and the top bar, `right` for the collapsed sidebar. */
  side?: 'top' | 'bottom' | 'right' | undefined;
  /**
   * `description` (default): the text adds to what the trigger already says. It is attached to the trigger
   * with `aria-describedby`, from a hidden element that is in the document whether the tooltip is open or not.
   * `label`: the text repeats the trigger's own accessible name (an icon button, a truncated value), so it
   * is for sighted users only and is not announced a second time.
   */
  purpose?: 'description' | 'label' | undefined;
  /** Shown as key caps after the text and exposed on the trigger as `aria-keyshortcuts`. */
  shortcut?: readonly string[] | undefined;
  /** The tooltip is left out, for a trigger that needs one only some of the time. */
  disabled?: boolean | undefined;
  /** Asked each time the tooltip is about to open. Returning false keeps it closed (a value that fits needs no tooltip). */
  shouldOpen?: (() => boolean) | undefined;
  /** The element the tooltip is about. It must pass its props and its ref on to a DOM element. */
  children: ReactElement<Describable>;
}

/**
 * One or two lines about one element (16-drawers-dialogs-popovers.md section 6.1). It opens on hover after
 * the shared delay and on keyboard focus at once, stays while the pointer is over it, closes with Escape
 * and never times out (WCAG 1.4.13).
 */
export function Tooltip({
  content,
  detail,
  side = 'top',
  purpose = 'description',
  shortcut,
  disabled = false,
  shouldOpen,
  children,
}: TooltipProps): ReactElement {
  const descriptionId = useId();
  const ariaKeyShortcuts = useAriaKeyShortcuts(shortcut);
  const describes = purpose === 'description' && !disabled;
  // An element handed down from a Server Component can arrive as a lazy reference without props.
  // `Children.toArray` resolves it, so its own attributes are read, merged and rendered on both sides.
  const resolved = Children.toArray(children)[0];
  const child = isValidElement<Describable>(resolved) ? resolved : children;
  const triggerProps: Describable = {};
  if (describes) triggerProps['aria-describedby'] = descriptionId;
  if (ariaKeyShortcuts !== undefined) triggerProps['aria-keyshortcuts'] = ariaKeyShortcuts;
  // Base UI lets the child's own attributes win over the ones given to the trigger. That is right for a
  // shortcut the child declares itself. A description it already has (a quota note, a field error) is
  // kept, and this one is added after it.
  const ownDescription = child.props['aria-describedby'];
  const trigger =
    describes && ownDescription !== undefined
      ? cloneElement(child, { 'aria-describedby': `${ownDescription} ${descriptionId}` })
      : child;
  return (
    <TooltipPrimitive.Root
      disabled={disabled}
      onOpenChange={(open, details) => {
        if (open && shouldOpen && !shouldOpen()) details.cancel();
      }}
    >
      <TooltipPrimitive.Trigger render={trigger} {...triggerProps} />
      {describes ? (
        <span id={descriptionId} hidden>
          {detail === undefined ? content : `${content} ${detail}`}
        </span>
      ) : null}
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner side={side} sideOffset={OFFSET_PX} className="z-(--z-tooltip)">
          {/* The popup is for the eye: assistive technology reads the description above, or the trigger's own name */}
          <TooltipPrimitive.Popup
            data-slot="tooltip"
            aria-hidden="true"
            className="flex max-w-tooltip-max flex-col rounded-md border border-border bg-surface-elevated px-2 py-1.5 type-meta text-foreground shadow-popover transition-opacity duration-(--duration-base) ease-standard data-ending-style:opacity-0 data-ending-style:duration-(--duration-fast) data-ending-style:ease-exit data-instant:duration-(--duration-instant) data-starting-style:opacity-0"
          >
            <span className="flex items-center gap-2">
              <span>{content}</span>
              {shortcut ? <Kbd keys={shortcut} decorative /> : null}
            </span>
            {detail === undefined ? null : <span className="text-foreground-tertiary">{detail}</span>}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
