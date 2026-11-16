'use client';

import { useEffect, useRef, type MouseEvent, type ReactElement, type ReactNode } from 'react';

import { Popover } from '@/components/ui/popover';
import { Tooltip } from '@/components/ui/tooltip';
import { CELL_CONTROL } from '@/lib/tables/grid-focus';
import { cn } from '@/lib/utils';

const stop = (event: MouseEvent): void => event.stopPropagation();

/** A trigger that holds a name or a link and a muted count: "Northwind, HubSpot, Salesforce +7". */
const LIST_TRIGGER =
  'flex min-w-0 max-w-full cursor-pointer items-center gap-1.5 rounded-xs text-left type-body text-foreground hover:underline focus-visible:focus-ring';

export interface ListPopoverProps {
  /** The trigger's accessible name, which says what opens ("Brands mentioned in the answers for This prompt: 10 brands. Open the list"). */
  label: string;
  /** What the cell shows: the first names or the most cited page, then the muted `+N`. */
  trigger: ReactNode;
  /** The visible heading, which is also the dialog's name. */
  title: string;
  subtitle: string;
  /** The sentence after the rows, below a hairline. */
  note: string;
  /** The `ListRow` rows of the ordered list. */
  children: ReactNode;
  /** The own brand's row, in its own block under the list when it ranks below the rows shown. */
  pinned?: ReactNode;
  open: boolean;
  /** Called with `false` when the list closes, whichever way it closed (Escape, a click outside, a scroll, a resize). */
  onOpenChange: (open: boolean) => void;
  /** `grid` (default): the trigger is a control of a table cell, which F2 reaches and whose click does not open the row. */
  context?: 'grid' | 'list' | undefined;
}

/**
 * The popover that two columns open (brands mentioned, pages cited): a heading and its subtitle, up to ten rows, the own
 * brand pinned under them when it ranks lower, and a note. It is the `Popover` of the design system, 416 px wide and
 * no more than the window minus 24 px. Tab moves between the controls inside it (the Add buttons), Escape and a click
 * outside close it and focus returns to the trigger. Scrolling anything but the list itself, or resizing the window,
 * closes it too, since it would otherwise hang over rows it no longer belongs to. It lives inside its cell, so a row
 * that leaves the table takes its list with it.
 */
export function ListPopover({
  label,
  trigger,
  title,
  subtitle,
  note,
  children,
  pinned,
  open,
  onOpenChange,
  context = 'grid',
}: ListPopoverProps): ReactElement {
  const popup = useRef<HTMLDivElement>(null);
  const grid = context === 'grid';
  useEffect(() => {
    if (!open) return undefined;
    const close = (): void => onOpenChange(false);
    const onScroll = (event: Event): void => {
      if (event.target instanceof Node && popup.current?.contains(event.target) === true) return;
      close();
    };
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open, onOpenChange]);
  return (
    <Popover
      ref={popup}
      initialFocus={popup}
      aria-label={title}
      width="content"
      padding="list"
      open={open}
      onOpenChange={onOpenChange}
      className="w-104 max-w-(--available-width)"
      // The mock's list holds ten rows, a header and a note without scrolling
      style={{ maxHeight: 'min(34rem, var(--available-height))' }}
      // The popup renders in a portal, but a React click still bubbles to the row that holds the cell
      {...(grid ? { onClick: stop } : {})}
      trigger={
        <button
          type="button"
          aria-label={label}
          {...(grid ? { ...CELL_CONTROL, onClick: stop } : {})}
          className={LIST_TRIGGER}
        >
          {trigger}
        </button>
      }
    >
      <div className="-m-3 flex flex-col">
        <div className="px-3 pt-3 pb-2">
          <p className="type-body-strong text-foreground">{title}</p>
          <p className="type-meta">{subtitle}</p>
        </div>
        <ol className="flex flex-col px-1 pb-1">{children}</ol>
        {pinned === undefined ? null : (
          <ol className="flex flex-col border-t border-border-subtle px-1 py-1">{pinned}</ol>
        )}
        <p className="border-t border-border-subtle px-3 py-2 type-meta">{note}</p>
      </div>
    </Popover>
  );
}

export interface ListRowProps {
  place: number | null;
  /** The name and what goes beside it. */
  main: ReactNode;
  /** The figure at the right. */
  value: ReactNode;
  /** The own brand or the own site: a primary subtle fill. */
  own?: boolean;
  /** What the row's figure rests on, as a tooltip; a row without one has none. */
  tip?: string | undefined;
}

/** One line of a list: the place (muted), what it is, and its value. */
export function ListRow({ place, main, value, own = false, tip }: ListRowProps): ReactElement {
  const row = (
    <li className={cn('flex min-h-control-sm items-center gap-2 rounded-md px-2 py-1', own && 'bg-primary-subtle')}>
      <span className="w-6 shrink-0 num type-meta text-foreground-tertiary">{place ?? ''}</span>
      <div className="min-w-0 flex-1">{main}</div>
      <div className="shrink-0">{value}</div>
    </li>
  );
  return tip === undefined ? row : <Tooltip content={tip}>{row}</Tooltip>;
}
