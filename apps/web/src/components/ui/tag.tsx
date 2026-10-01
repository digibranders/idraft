'use client';

import { X } from 'lucide-react';
import type { ComponentProps, KeyboardEvent, ReactElement } from 'react';

import { Icon } from './icon';
import { cn } from '@/lib/utils';

/** The chip itself: the neutral badge style at 22 px (14-badges-status.md section 2). Shared with `MultiSelect`. */
export const TAG_CLASS = cn(
  'inline-flex h-badge max-w-full min-w-0 shrink-0 items-center gap-1 rounded-sm border border-neutral-border bg-neutral-subtle px-2 type-micro text-neutral-text',
);

/**
 * The remove button: a 16 px glyph area whose target grows to 24 px past the chip (the spacing exception
 * of chip rows, 20-accessibility.md section 9). Shared with `MultiSelect`.
 */
export const TAG_REMOVE_CLASS = cn(
  'relative -mr-1 flex size-4 shrink-0 items-center justify-center rounded-xs text-neutral-text outline-none after:absolute after:-inset-1 hover:bg-neutral-border focus-visible:focus-ring',
);

/** A tag that can be removed has a remove button, which needs a name: "Remove HubSpot CRM". */
type Removal = { onRemove: () => void; removeLabel: string } | { onRemove?: undefined; removeLabel?: undefined };

export type TagProps = Omit<ComponentProps<'span'>, 'children'> &
  Removal & {
    /** The value the chip shows. */
    label: string;
  };

/**
 * A removable value chip: a keyword tag, an alias (25-component-inventory.md section 3.18). Backspace or
 * Delete on its focused remove button removes it too. The caller moves focus once the tag is gone, to the
 * next tag or the field it belongs to (20-accessibility.md section 6). Filters are `FilterChip`; a category
 * that cannot be removed is a `Badge`.
 */
export function Tag({ label, onRemove, removeLabel, className, ...props }: TagProps): ReactElement {
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== 'Backspace' && event.key !== 'Delete') return;
    event.preventDefault();
    onRemove?.();
  };
  return (
    <span data-slot="tag" {...props} className={cn(TAG_CLASS, onRemove ? 'pr-1' : '', className)}>
      <span className="truncate">{label}</span>
      {onRemove ? (
        <button
          type="button"
          aria-label={removeLabel}
          className={TAG_REMOVE_CLASS}
          onClick={onRemove}
          onKeyDown={onKeyDown}
        >
          <Icon icon={X} size="xs" />
        </button>
      ) : null}
    </span>
  );
}
