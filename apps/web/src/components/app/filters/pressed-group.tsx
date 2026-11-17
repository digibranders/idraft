import type { ReactElement } from 'react';

import { cn } from '@/lib/utils';

export interface PressedGroupItem<TValue extends string> {
  value: TValue;
  label: string;
  /** Preformatted: "13". */
  count?: string | undefined;
}

export interface PressedGroupProps<TValue extends string> {
  /** Names the group: "Domain type". */
  label: string;
  value: TValue;
  items: readonly PressedGroupItem<TValue>[];
  onValueChange: (value: TValue) => void;
}

/**
 * A filter of one table's rows by kind, with the rows of each kind (13 section 10, the Cited pages owner filter,
 * C 545 to 557): toggle buttons in one rounded group, one pressed. It scrolls sideways on a narrow screen.
 */
export function PressedGroup<TValue extends string>({
  label,
  value,
  items,
  onValueChange,
}: PressedGroupProps<TValue>): ReactElement {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex max-w-full overflow-x-auto rounded-md border border-border bg-surface p-0.5"
    >
      {items.map((item) => {
        const pressed = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            aria-pressed={pressed}
            // The two spans sit in one flex row, so the name needs its space spelled out: "Your site 13"
            aria-label={item.count === undefined ? undefined : `${item.label} ${item.count}`}
            onClick={() => onValueChange(item.value)}
            className={cn(
              'flex h-6 shrink-0 items-center gap-1.5 rounded-sm px-2 whitespace-nowrap outline-none focus-visible:focus-ring-inset',
              pressed
                ? 'bg-primary-subtle type-body-strong text-primary-text'
                : 'type-body text-foreground-secondary hover:bg-surface-hover hover:text-foreground',
            )}
          >
            <span>{item.label}</span>
            {item.count === undefined ? null : <span className="num type-meta">{item.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
