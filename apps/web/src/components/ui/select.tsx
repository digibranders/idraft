'use client';

import { Select as SelectPrimitive } from '@base-ui/react/select';
import { Check, ChevronDown } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';

import { Icon } from './icon';
import { inputVariants, type InputSize } from './input-variants';
import { POPUP_COLLISION, POPUP_GROUP_LABEL, POPUP_ITEM, POPUP_MOTION, POPUP_SURFACE } from './popup-styles';
import { cn } from '@/lib/utils';

export interface SelectOption<TValue extends string> {
  value: TValue;
  label: string;
  /** What the list and the trigger show in place of the label, such as an engine's logo and name. The label stays the option's text for typeahead. */
  display?: ReactNode | undefined;
  /** A short fact at the end of the row, in meta type: "28 days" (C 116). */
  note?: string | undefined;
  /** A second line under the label. */
  description?: string | undefined;
  /** Options with the same group name are listed together under it. */
  group?: string | undefined;
  disabled?: boolean | undefined;
  /** A decorative mark (a logo) shown before the label in the trigger and the list. It is hidden from assistive tech. */
  icon?: ReactNode | undefined;
}

export interface SelectProps<TValue extends string> extends Omit<
  SelectPrimitive.Trigger.Props,
  'className' | 'render' | 'children' | 'value' | 'defaultValue'
> {
  value: TValue | null;
  onValueChange: (value: TValue) => void;
  /** Shown while nothing is chosen: "Select a workload". */
  placeholder: string;
  options: readonly SelectOption<TValue>[];
  size?: InputSize | undefined;
  /** Sent with a native form submit. A react-hook-form field does not need it. */
  name?: string | undefined;
  required?: boolean | undefined;
  /** The name of the list of options, which the trigger's `aria-label` does not give it ("Platform in view"). */
  listLabel?: string | undefined;
  /** Layout of the popup only, its width: `min-w-52` (C 114). */
  popupClassName?: string | undefined;
  /** Layout only. The width of a field is set on `Field`. */
  className?: string | undefined;
}

interface OptionGroup<TValue extends string> {
  name: string | undefined;
  options: SelectOption<TValue>[];
}

/** Consecutive options with the same group name form one group; the order of the options is kept. */
function grouped<TValue extends string>(options: readonly SelectOption<TValue>[]): OptionGroup<TValue>[] {
  const groups: OptionGroup<TValue>[] = [];
  for (const option of options) {
    const last = groups[groups.length - 1];
    if (last && last.name === option.group) last.options.push(option);
    else groups.push({ name: option.group, options: [option] });
  }
  return groups;
}

function Option<TValue extends string>({ option }: { option: SelectOption<TValue> }): ReactElement {
  return (
    <SelectPrimitive.Item
      value={option.value}
      label={option.label}
      disabled={option.disabled}
      className={cn(POPUP_ITEM, option.description !== undefined && 'h-auto items-start py-1.5')}
    >
      <span className="flex h-5 w-4 shrink-0 items-center justify-center">
        <SelectPrimitive.ItemIndicator className="flex">
          <Icon icon={Check} size="sm" />
        </SelectPrimitive.ItemIndicator>
      </span>
      {option.icon === undefined ? null : (
        <span aria-hidden="true" className="flex h-5 shrink-0 items-center">
          {option.icon}
        </span>
      )}
      <span className={cn('flex min-w-0 flex-col', option.note !== undefined && 'flex-1')}>
        <SelectPrimitive.ItemText>{option.display ?? option.label}</SelectPrimitive.ItemText>
        {option.description === undefined ? null : <span className="type-meta">{option.description}</span>}
      </span>
      {option.note === undefined ? null : <span className="ml-auto shrink-0 pl-4 type-meta">{option.note}</span>}
    </SelectPrimitive.Item>
  );
}

/**
 * One choice from about 5 to 15 known options (10-forms.md section 6.2). The list opens below the trigger
 * like every other popover, so the label and the fields around it stay visible. Fewer options that are
 * worth seeing side by side are a `SegmentedControl` or a `RadioGroup`; native `<select>` is not used.
 */
export function Select<TValue extends string>({
  value,
  onValueChange,
  placeholder,
  options,
  size = 'md',
  name,
  required,
  disabled,
  listLabel,
  popupClassName,
  className,
  ...props
}: SelectProps<TValue>): ReactElement {
  const selectedIcon = options.find((option) => option.value === value)?.icon;
  return (
    <SelectPrimitive.Root<TValue>
      items={options}
      value={value}
      // The list offers no empty option, so there is no way back to "nothing chosen"
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
      name={name}
      required={required}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        data-slot="select"
        {...props}
        className={cn(
          inputVariants({ variant: 'outline', size }),
          'flex cursor-default items-center gap-2 text-left',
          'justify-between',
          className,
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          {selectedIcon === undefined ? null : (
            <span aria-hidden="true" className="flex shrink-0 items-center">
              {selectedIcon}
            </span>
          )}
          <SelectPrimitive.Value
            placeholder={placeholder}
            className="min-w-0 truncate data-placeholder:text-foreground-tertiary"
          >
            {(current: TValue | null) => {
              const option = options.find((candidate) => candidate.value === current);
              return option === undefined ? placeholder : (option.display ?? option.label);
            }}
          </SelectPrimitive.Value>
        </span>
        <SelectPrimitive.Icon className="ml-auto flex shrink-0 text-foreground-muted">
          <Icon icon={ChevronDown} size="sm" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner
          alignItemWithTrigger={false}
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          collisionAvoidance={POPUP_COLLISION}
          className="z-(--z-dropdown)"
        >
          <SelectPrimitive.Popup
            data-slot="select-popup"
            className={cn(
              'max-h-(--available-height) min-w-(--anchor-width) overflow-y-auto p-1',
              POPUP_SURFACE,
              POPUP_MOTION,
              popupClassName,
            )}
          >
            <SelectPrimitive.List {...(listLabel === undefined ? {} : { 'aria-label': listLabel })}>
              {grouped(options).map((group, index) =>
                group.name === undefined ? (
                  group.options.map((option) => <Option key={option.value} option={option} />)
                ) : (
                  <SelectPrimitive.Group key={`${String(index)}:${group.name}`}>
                    <SelectPrimitive.GroupLabel className={POPUP_GROUP_LABEL}>{group.name}</SelectPrimitive.GroupLabel>
                    {group.options.map((option) => (
                      <Option key={option.value} option={option} />
                    ))}
                  </SelectPrimitive.Group>
                ),
              )}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
