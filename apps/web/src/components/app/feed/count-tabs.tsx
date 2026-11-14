'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState, type KeyboardEvent, type ReactElement } from 'react';

import { Badge } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface CountTabsItem<TValue extends string> {
  value: TValue;
  label: string;
  /** Preformatted by the caller (`formatCompact`); `EMPTY_VALUE` when unknown, never "0" for unknown. */
  countText: string;
  /** Why the type cannot be pressed: the item stays focusable and says so in a tooltip. */
  disabledReason?: string | undefined;
}

export interface CountTabsProps<TValue extends string> {
  /** The toolbar's name: "Event types". */
  label: string;
  allLabel: string;
  allCountText: string;
  /** Only the types present. */
  items: readonly CountTabsItem<TValue>[];
  /** Empty: "All" is pressed. */
  value: readonly TValue[];
  onValueChange: (value: readonly TValue[]) => void;
  /** 32 or 36 px: `md` on pages, `sm` in the inspector. Default `md`. */
  size?: 'sm' | 'md' | undefined;
}

/** Pressing a type adds or removes it; removing the last one gives [] (All). Pure. */
export function toggleCountTab<TValue extends string>(value: readonly TValue[], item: TValue): readonly TValue[] {
  return value.includes(item) ? value.filter((entry) => entry !== item) : [...value, item];
}

const SIZE = { sm: cn('h-control-sm'), md: cn('h-control') } as const;
const BUTTON = cn(
  'inline-flex shrink-0 items-center gap-2 rounded-md border px-3 outline-none focus-visible:focus-ring',
  'aria-disabled:cursor-not-allowed aria-disabled:text-foreground-disabled',
);
// A pressed item is solid and heavier, so it is not told apart by colour alone
const PRESSED = cn('border-primary bg-primary type-body-strong text-primary-foreground');
const RELEASED = cn('border-border bg-surface type-body text-foreground hover:bg-surface-hover');
const PRESSED_COUNT = cn('border-transparent bg-primary-hover text-primary-foreground');

/** One entry of the toolbar: "All" (`value` null) or a type. */
interface Entry<TValue extends string> {
  /** Cannot collide: "All" has its own prefix, so a type whose value is '' is not the same key. */
  key: string;
  value: TValue | null;
  label: string;
  countText: string;
  disabledReason: string | undefined;
}

/**
 * The event-type filter (23-application-patterns.md section 9.3): bordered toggle buttons with their counts in a
 * toolbar of one Tab stop. "All" is pressed when nothing else is; several types can be pressed together.
 *
 * A `value` whose types are all missing from `items` (a filter left over from another window) presses nothing,
 * not even "All": the filter is still active, and the toolbar says so with `data-unmatched-value` instead of
 * drawing a false "All". The caller should drop such a value.
 */
export function CountTabs<TValue extends string>({
  label,
  allLabel,
  allCountText,
  items,
  value,
  onValueChange,
  size = 'md',
}: CountTabsProps<TValue>): ReactElement {
  const t = useTranslations('common.countTabs');
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [focused, setFocused] = useState<number | null>(null);
  const entries: readonly Entry<TValue>[] = [
    { key: 'all', value: null, label: allLabel, countText: allCountText, disabledReason: undefined },
    ...items.map((item) => ({
      key: `type:${item.value}`,
      value: item.value,
      label: item.label,
      countText: item.countText,
      disabledReason: item.disabledReason,
    })),
  ];
  const isPressed = (entry: Entry<TValue>): boolean =>
    entry.value === null ? value.length === 0 : value.includes(entry.value);
  // One Tab stop: where focus last was, else the first pressed item (All for an empty selection)
  const firstPressed = Math.max(0, entries.findIndex(isPressed));
  const unmatched = value.length > 0 && !entries.some(isPressed);
  const tabStop = focused !== null && focused < entries.length ? focused : firstPressed;

  const press = (entry: Entry<TValue>): void => {
    if (entry.disabledReason !== undefined) return;
    if (entry.value === null) {
      if (value.length > 0) onValueChange([]);
      return;
    }
    onValueChange(toggleCountTab(value, entry.value));
  };
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const last = entries.length - 1;
    const target =
      event.key === 'ArrowRight'
        ? index === last
          ? 0
          : index + 1
        : event.key === 'ArrowLeft'
          ? index === 0
            ? last
            : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (target === null) return;
    event.preventDefault();
    buttons.current[target]?.focus();
  };

  return (
    <div
      role="toolbar"
      aria-label={label}
      data-unmatched-value={unmatched ? true : undefined}
      className="flex flex-wrap gap-2"
    >
      {entries.map((entry, index) => {
        const pressed = isPressed(entry);
        const button = (
          <button
            key={entry.key}
            ref={(node) => {
              buttons.current[index] = node;
            }}
            type="button"
            aria-pressed={pressed}
            aria-disabled={entry.disabledReason === undefined ? undefined : true}
            aria-label={t('item', { label: entry.label, count: entry.countText })}
            tabIndex={index === tabStop ? 0 : -1}
            onFocus={() => setFocused(index)}
            onKeyDown={(event) => move(event, index)}
            onClick={() => press(entry)}
            className={cn(BUTTON, SIZE[size], pressed ? PRESSED : RELEASED)}
          >
            {entry.label}
            <Badge className={cn(pressed && PRESSED_COUNT)}>{entry.countText}</Badge>
          </button>
        );
        return entry.disabledReason === undefined ? (
          button
        ) : (
          <Tooltip key={entry.key} content={entry.disabledReason}>
            {button}
          </Tooltip>
        );
      })}
    </div>
  );
}
