'use client';

import { Fieldset as FieldsetPrimitive } from '@base-ui/react/fieldset';
import { Radio as RadioPrimitive } from '@base-ui/react/radio';
import { RadioGroup as RadioGroupPrimitive } from '@base-ui/react/radio-group';
import type { LucideIcon } from 'lucide-react';
import type { ReactElement, Ref } from 'react';

import { Icon } from './icon';
import { useRadioFocus, type FocusHandle } from './radio-group';
import { cn } from '@/lib/utils';

export interface SegmentedControlItem<TValue extends string> {
  value: TValue;
  /** Two words at most. */
  label: string;
  icon?: LucideIcon | undefined;
  /** A count after the label, already formatted. */
  count?: string | undefined;
  disabled?: boolean | undefined;
}

export interface SegmentedControlProps<TValue extends string> extends Omit<
  RadioGroupPrimitive.Props<TValue>,
  'className' | 'render' | 'children' | 'value' | 'defaultValue' | 'onValueChange' | 'aria-label'
> {
  /**
   * `view` switches an option of the current screen and is named by `label` without showing it. `radio`
   * sets a form value and shows `label` above the control as its legend. A control that switches panels is
   * `Tabs variant="segmented"`.
   */
  semantics: 'view' | 'radio';
  label: string;
  value: TValue;
  onValueChange: (value: TValue) => void;
  /** 2 to 5 for a view option, 2 to 4 for a form value. */
  items: readonly SegmentedControlItem<TValue>[];
  /** 32 px in toolbars and panels, 36 px in page headers and forms. */
  size?: 'sm' | 'md' | undefined;
  /** Lets a form move focus to the chosen segment after a failed submit: `focusRef={field.ref}`. */
  focusRef?: Ref<FocusHandle> | undefined;
  className?: string | undefined;
}

const SIZE_CLASS: Readonly<Record<'sm' | 'md', string>> = { sm: cn('h-control-sm px-2'), md: cn('h-control px-3') };

/**
 * The look of one segment, shared with the segmented tabs. Each segment draws its own border and overlaps
 * the one before it by 1 px. The chosen one is positioned, so its outline paints above both neighbors and
 * follows the rounded outer corner. The outer corners are found by type: Base UI puts a hidden input
 * after every radio, so the last segment is not the last child.
 */
export function segmentClassName(size: 'sm' | 'md'): string {
  return cn(
    'inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 border border-border bg-surface type-body text-foreground-secondary transition-colors duration-(--duration-fast) ease-standard outline-none select-none not-first:-ml-px first-of-type:rounded-l-md last-of-type:rounded-r-md not-data-checked:not-data-disabled:hover:bg-surface-hover not-data-checked:not-data-disabled:hover:text-foreground focus-visible:relative focus-visible:focus-ring-inset data-checked:relative data-checked:border-primary-border data-checked:bg-primary-subtle data-checked:type-body-strong data-checked:text-primary-text data-disabled:cursor-not-allowed data-disabled:text-foreground-disabled',
    SIZE_CLASS[size],
  );
}

/**
 * A few short options side by side, one of them chosen (09-buttons-controls.md section 6). It is a radio
 * group: arrow keys move and select, Tab leaves. The chosen segment is marked by its tint, its outline and
 * its heavier label, and every segment reserves the width of the heavier label so nothing shifts.
 */
export function SegmentedControl<TValue extends string>({
  semantics,
  label,
  value,
  onValueChange,
  items,
  size = 'md',
  focusRef,
  className,
  ...props
}: SegmentedControlProps<TValue>): ReactElement {
  const groupRef = useRadioFocus(focusRef);
  const segments = items.map((item) => (
    <RadioPrimitive.Root
      key={item.value}
      value={item.value}
      disabled={item.disabled}
      className={segmentClassName(size)}
    >
      {item.icon ? <Icon icon={item.icon} size={size === 'sm' ? 'sm' : 'default'} /> : null}
      <span className="grid">
        <span className="col-start-1 row-start-1">{item.label}</span>
        {/* The heavier copy is never seen or read: it only holds the width the label has when chosen */}
        <span aria-hidden="true" className="invisible col-start-1 row-start-1 type-body-strong">
          {item.label}
        </span>
      </span>
      {/* A flex container ignores the space for layout; it keeps label and count apart in the name */}
      {item.count === undefined ? null : ' '}
      {/* The count keeps the regular weight, so its width does not change with the choice */}
      {item.count === undefined ? null : <span className="num type-body">{item.count}</span>}
    </RadioPrimitive.Root>
  ));
  // A view option is named without showing the name; a form value gets a visible legend below
  const viewProps = semantics === 'view' ? { 'aria-label': label, 'data-slot': 'segmented-control' } : {};
  const group = (
    <RadioGroupPrimitive<TValue>
      {...props}
      {...viewProps}
      ref={groupRef}
      value={value}
      onValueChange={onValueChange}
      className={cn('flex w-fit', semantics === 'view' && className)}
    >
      {segments}
    </RadioGroupPrimitive>
  );
  if (semantics === 'view') return group;
  return (
    <FieldsetPrimitive.Root data-slot="segmented-control" className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <FieldsetPrimitive.Legend className="type-label">{label}</FieldsetPrimitive.Legend>
      {group}
    </FieldsetPrimitive.Root>
  );
}
